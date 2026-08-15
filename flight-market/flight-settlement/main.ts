import {
  EVMClient,
  HTTPClient,
  getNetwork,
  logTriggerConfig,
  prepareReportRequest,
  bytesToHex,
  blockNumber,
  encodeCallMsg,
  protoBigIntToBigint,
  TxStatus,
  handler,
  Runner,
  json,
  ok,
  ConsensusAggregationByFields,
  median,
  identical,
  ignore,
  type Runtime,
  type HTTPSendRequester,
  type EVMLog,
} from "@chainlink/cre-sdk"
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  keccak256,
  toEventSelector,
  toHex,
} from "viem"
import { z } from "zod"

/**
 * Flight-delay prediction market settlement.
 *
 * FlightMarket.sol emits SettlementRequested -> this workflow fetches the flight's
 * actual arrival delay -> DON reaches consensus -> signed report goes back to
 * onReport(), which flips the market to Settled or Void.
 *
 * Outcome codes MUST match the Solidity `Outcome` enum:
 *   0 = Unset, 1 = Yes (delayed >= threshold), 2 = No, 3 = Void
 */

export type Config = {
  contractAddress: string
  chainSelectorName: string
  apiUrl: string          // AeroDataBox base URL, e.g. https://aerodatabox.p.rapidapi.com
  apiKey: string          // RapidAPI key for AeroDataBox — never committed, see config.staging.example.json
  /**
   * Optional second, independent provider. Empty string disables it and the
   * workflow runs single-source.
   *
   * DON consensus protects against a dishonest or broken *node*; it cannot
   * protect against a wrong *source*, because every node queries the same one.
   * A second provider is what closes that gap.
   *
   * Expected to serve `{ status, arrivalDelayMinutes }` — see
   * `simpleSourceSchema`. Adapting a real provider means writing one small
   * function like `readAeroDataBox`, not changing anything below it.
   */
  secondaryUrl?: string
  /**
   * CryptoMarket address. Empty string leaves the crypto handler unregistered
   * and the workflow settles flights only.
   */
  cryptoContractAddress?: string
  /**
   * StockMarket address. Empty string leaves the stock handler unregistered.
   */
  stockContractAddress?: string
  gasLimit: string
}

const OUTCOME_YES = 1
const OUTCOME_NO = 2
const OUTCOME_VOID = 3

// --- event ABI ---------------------------------------------------------------
// Must match FlightMarket.sol exactly.
const settlementRequestedAbi = [
  {
    type: "event",
    name: "SettlementRequested",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "flightIata", type: "string", indexed: false },
      { name: "departureDate", type: "uint32", indexed: false },
      { name: "thresholdMinutes", type: "uint16", indexed: false },
    ],
  },
] as const

const SETTLEMENT_REQUESTED_TOPIC = toEventSelector(
  "SettlementRequested(uint256,string,uint32,uint16)",
)

// Must match CryptoMarket.sol exactly.
const cryptoSettlementRequestedAbi = [
  {
    type: "event",
    name: "SettlementRequested",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "asset", type: "uint8", indexed: false },
      { name: "strikePrice", type: "uint64", indexed: false },
      { name: "expiryTime", type: "uint64", indexed: false },
    ],
  },
] as const

const CRYPTO_SETTLEMENT_REQUESTED_TOPIC = toEventSelector(
  "SettlementRequested(uint256,uint8,uint64,uint64)",
)

// Must match StockMarket.sol exactly. It carries closeTime as well as expiry
// because the workflow has to check the price moved while the market was live.
const stockSettlementRequestedAbi = [
  {
    type: "event",
    name: "SettlementRequested",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "feed", type: "address", indexed: false },
      { name: "strikePrice", type: "uint64", indexed: false },
      { name: "closeTime", type: "uint64", indexed: false },
      { name: "expiryTime", type: "uint64", indexed: false },
      { name: "maxStaleness", type: "uint32", indexed: false },
    ],
  },
] as const

const STOCK_SETTLEMENT_REQUESTED_TOPIC = toEventSelector(
  "SettlementRequested(uint256,address,uint64,uint64,uint64,uint32)",
)

/** The AggregatorV3Interface subset this workflow reads. */
const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "getRoundData",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint80" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const

/**
 * How far back the round walk will go before giving up.
 *
 * A daily feed needs one or two steps to reach the round in force at expiry
 * and a couple more to reach the one at close. The bound exists because
 * roundIds are phase-encoded: decrementing past the first round of a phase
 * does not roll into the previous phase, it lands on a round that was never
 * published. Voiding beats walking into nothing.
 */
const MAX_ROUND_WALK = 24

/** Matches CryptoMarket.Asset. */
const ASSET_SYMBOLS = ["BTC", "ETH"] as const

/** Prices are carried at 8 decimals, matching the strike stored on chain. */
const PRICE_DECIMALS = 100_000_000

// --- API response --------------------------------------------------------
// AeroDataBox (via RapidAPI): GET /flights/number/{iata}/{YYYY-MM-DD}
// Schema pulled from the live OpenAPI spec (doc.aerodatabox.com), not guessed —
// field names and the FlightStatus enum below are verbatim from FlightContract.
// https://doc.aerodatabox.com/docs/openapi-rapidapi-v1.json

const dateTimeSchema = z.object({
  utc: z.string(),
})

const movementSchema = z.object({
  scheduledTime: dateTimeSchema.optional(),
  revisedTime: dateTimeSchema.optional(),
})

const flightStatusEnum = z.enum([
  "Unknown", "Expected", "EnRoute", "CheckIn", "Boarding", "GateClosed",
  "Departed", "Delayed", "Approaching", "Arrived", "Canceled", "Diverted",
  "CanceledUncertain",
])

const flightContractSchema = z.object({
  status: flightStatusEnum,
  arrival: movementSchema.optional(),
})

// The endpoint returns an array (codeshares can produce more than one entry).
const flightResponseSchema = z.array(flightContractSchema)

/**
 * AeroDataBox's own timestamp format: "2026-08-14 12:55Z" — space instead of
 * "T", no seconds. Not RFC 3339, so `Date.parse` on it is implementation
 * defined: V8 (bun, this file's local tests) accepts it, but the actual
 * workflow runs in the WASM/QuickJS runtime, which returned NaN for it —
 * caught by running the real simulator against a live flight, not by local
 * testing. `Date.UTC` takes numeric components with no string-format
 * ambiguity, so it can't silently disagree between engines the way parsing
 * a string can.
 */
const parseAeroDataBoxUtc = (s: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})Z$/.exec(s)
  if (!m) throw new Error(`Unrecognized AeroDataBox timestamp: ${s}`)
  const [, y, mo, d, h, mi] = m
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi))
}

/**
 * Per-node result.
 *
 * CONSENSUS HAZARD: every field here is aggregated across nodes, so anything
 * that varies per node breaks consensus. `delayMinutes` is deliberately
 * bucketed to whole minutes and `fetchedAt` is dropped via `ignore` — raw
 * API timestamps (lastUpdatedUtc, request time) differ on every node and
 * would never agree.
 */
type Observation = {
  delayMinutes: number
  status: string
  fetchedAt: number
}

/** What one provider reported, before any cross-source reconciliation. */
type SourceReading = {
  delayMinutes: number
  status: string
}

/**
 * Shape expected from a secondary provider. Deliberately minimal so adapting
 * a new one is a small function rather than a schema negotiation — and so the
 * repo's existing mock gist can stand in as a controllable second source when
 * testing the disagreement path.
 */
const simpleSourceSchema = z.object({
  status: z.string(),
  arrivalDelayMinutes: z.number().nullable(),
})

const readAeroDataBox = (
  sendRequester: HTTPSendRequester,
  apiUrl: string,
  apiKey: string,
  flightIata: string,
  departureDateIso: string,
): SourceReading => {
  const url = `${apiUrl}/flights/number/${flightIata}/${departureDateIso}?dateLocalRole=Departure`
  const response = sendRequester
    .sendRequest({
      url,
      method: "GET",
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
      },
    })
    .result()

  // 204 = no matching flight for that number/date.
  if (response.statusCode === 204) {
    throw new Error(`No flight found for ${flightIata} on ${departureDateIso}`)
  }
  if (!ok(response)) {
    throw new Error(`HTTP ${response.statusCode} for ${flightIata}`)
  }

  const flights = flightResponseSchema.parse(json(response))
  // Prefer the operating leg over a codeshare entry when both are present.
  const flight = flights[0]
  if (!flight) {
    throw new Error(`Empty flight list for ${flightIata} on ${departureDateIso}`)
  }

  // `CanceledUncertain` is deliberately NOT treated as cancelled. AeroDataBox
  // defines it as "status of the flight is uncertain, may be cancelled" — a
  // maybe, not a fact. Paying a market out on a maybe is the worst available
  // failure: the UI promises Yes for "cancelled or diverted", and someone
  // would collect real money on an unconfirmed signal. It falls through to
  // `airborne` below, which voids and refunds everyone — the same treatment
  // the contract already documents for unavailable data.
  //
  // This is not an edge case: 75 of 565 arrivals sampled at ORD (13%) carried
  // this status.
  const isDisrupted = flight.status === "Canceled" || flight.status === "Diverted"
  const isLanded = flight.status === "Arrived"

  let delayMinutes = 0
  if (isLanded && flight.arrival?.scheduledTime && flight.arrival?.revisedTime) {
    const scheduled = parseAeroDataBoxUtc(flight.arrival.scheduledTime.utc)
    const actual = parseAeroDataBoxUtc(flight.arrival.revisedTime.utc)
    // Round to whole minutes so independent nodes converge on one value.
    delayMinutes = Math.round((actual - scheduled) / 60_000)
  }

  return {
    delayMinutes,
    status: isDisrupted ? "cancelled" : isLanded ? "landed" : "airborne",
  }
}

const readSecondary = (
  sendRequester: HTTPSendRequester,
  url: string,
  flightIata: string,
  departureDateIso: string,
): SourceReading => {
  const response = sendRequester
    .sendRequest({
      url: `${url}?flight=${flightIata}&date=${departureDateIso}`,
      method: "GET",
    })
    .result()

  if (!ok(response)) {
    throw new Error(`Secondary source HTTP ${response.statusCode} for ${flightIata}`)
  }

  const parsed = simpleSourceSchema.parse(json(response))
  const status = parsed.status.toLowerCase()
  return {
    delayMinutes:
      parsed.arrivalDelayMinutes === null ? 0 : Math.round(parsed.arrivalDelayMinutes),
    status: status === "diverted" ? "cancelled" : status,
  }
}

/**
 * Which way a single source would settle the market. Reconciliation compares
 * *this*, not the raw minutes: two sources reporting 44 and 46 against a
 * 45-minute threshold are only ~2 minutes apart, but they disagree about who
 * gets paid. Averaging them would silently manufacture an answer neither
 * source actually gave.
 */
const outcomeFor = (reading: SourceReading, thresholdMinutes: number): number => {
  if (reading.status === "cancelled") return OUTCOME_YES
  if (reading.status !== "landed") return OUTCOME_VOID
  return reading.delayMinutes >= thresholdMinutes ? OUTCOME_YES : OUTCOME_NO
}

const fetchFlight = (
  sendRequester: HTTPSendRequester,
  apiUrl: string,
  apiKey: string,
  secondaryUrl: string,
  flightIata: string,
  departureDateIso: string,
  thresholdMinutes: number,
): Observation => {
  const readings: SourceReading[] = [
    readAeroDataBox(sendRequester, apiUrl, apiKey, flightIata, departureDateIso),
  ]

  // Empty string = single-source mode. A failing secondary is NOT swallowed:
  // losing the cross-check silently would leave the market resolving on one
  // source while appearing to be corroborated.
  if (secondaryUrl !== "") {
    readings.push(readSecondary(sendRequester, secondaryUrl, flightIata, departureDateIso))
  }

  const outcomes = readings.map((r) => outcomeFor(r, thresholdMinutes))
  const allAgree = outcomes.every((o) => o === outcomes[0])
  if (!allAgree) {
    // Throwing voids the market and refunds everyone. When independent
    // sources contradict each other about a real-world fact, refusing to
    // settle is the honest answer — picking a winner would be a coin flip
    // dressed up as data.
    throw new Error(
      `Sources disagree on outcome for ${flightIata}: ${readings
        .map((r, i) => `${r.status}/${r.delayMinutes}m->${outcomes[i]}`)
        .join(" vs ")}`,
    )
  }

  // Sources agree on the outcome, so any spread left is noise within one
  // side of the threshold. Median generalises past two sources; with two it
  // is the midpoint, rounded to keep nodes converging on one integer.
  const sorted = [...readings].sort((a, b) => a.delayMinutes - b.delayMinutes)
  const mid = sorted.length / 2
  const medianDelay =
    sorted.length % 2 === 1
      ? sorted[Math.floor(mid)]!.delayMinutes
      : Math.round((sorted[mid - 1]!.delayMinutes + sorted[mid]!.delayMinutes) / 2)

  return {
    delayMinutes: medianDelay,
    status: readings[0]!.status,
    fetchedAt: 0,
  }
}

// --- crypto price sources -------------------------------------------------
//
// Three independent USD spot venues. Binance is deliberately excluded: its
// liquid pair is BTC/USDT, and pricing a USD-denominated market off a Tether
// pair adds a systematic basis rather than independent signal. Measured live,
// Binance sat ~$70 (0.11%) away from the USD venues while Coinbase, Kraken and
// Bitstamp agreed within ~$6 (0.01%) of each other.
//
// Every source is asked for the ONE-MINUTE CANDLE CONTAINING EXPIRY and its
// close is used, rather than a spot quote. Spot would give each DON node a
// different number depending on the millisecond it happened to ask, so
// consensus could never be exact. A closed historical candle is the same value
// for every node, however far apart they run.

const cryptoPriceSchemas = {
  /** Coinbase Exchange: [[ time, low, high, open, close, volume ], …] */
  coinbase: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])),
  /** Bitstamp: named fields, unlike the others. */
  bitstamp: z.object({
    data: z.object({
      ohlc: z.array(z.object({ timestamp: z.string(), close: z.string() })),
    }),
  }),
  /** Kraken: { result: { <dynamic pair key>: [[ time, open, high, low, close, … ], …] } } */
  kraken: z.object({
    error: z.array(z.string()),
    result: z.record(z.string(), z.unknown()),
  }),
}

const requireOk = (response: { statusCode: number }, venue: string) => {
  if (!ok(response as never)) {
    throw new Error(`${venue} HTTP ${response.statusCode}`)
  }
}

/**
 * The window is deliberately five minutes either side of the minute we want,
 * not the minute itself.
 *
 * Coinbase drops candles from narrow ranges in a way that has nothing to do
 * with whether the data exists. Asking for exactly `[T, T+60]` returns an empty
 * array for a minute that a wider request returns happily, and reproducibly so
 * — it cost this workflow a live market, voided for "no candle" against a
 * minute that had traded 1.04 BTC. Measured over 114 requests across both
 * products: `[T, T+60]` never returned the candle, `[T-60, T+60]` missed 8% of
 * the time, and `[T-300, T+300]` missed none. The response is ~650 bytes, so
 * the margin is free.
 *
 * All three venues are therefore asked for a range and searched for the exact
 * minute, never trusted to return the one bucket asked for.
 */
const readCoinbasePrice = (
  sendRequester: HTTPSendRequester,
  symbol: string,
  minuteStart: number,
): number => {
  const url = `https://api.exchange.coinbase.com/products/${symbol}-USD/candles?granularity=60&start=${minuteStart - 300}&end=${minuteStart + 300}`
  const response = sendRequester.sendRequest({ url, method: "GET" }).result()
  requireOk(response, "Coinbase")

  const candles = cryptoPriceSchemas.coinbase.parse(json(response))
  const candle = candles.find((c) => c[0] === minuteStart)
  if (!candle) throw new Error(`Coinbase has no candle for minute ${minuteStart}`)
  return candle[4]
}

const readBitstampPrice = (
  sendRequester: HTTPSendRequester,
  symbol: string,
  minuteStart: number,
): number => {
  const url = `https://www.bitstamp.net/api/v2/ohlc/${symbol.toLowerCase()}usd/?step=60&limit=5&start=${minuteStart - 120}`
  const response = sendRequester.sendRequest({ url, method: "GET" }).result()
  requireOk(response, "Bitstamp")

  const parsed = cryptoPriceSchemas.bitstamp.parse(json(response))
  const candle = parsed.data.ohlc.find((c) => Number(c.timestamp) === minuteStart)
  if (!candle) throw new Error(`Bitstamp has no candle for minute ${minuteStart}`)
  return Number(candle.close)
}

const readKrakenPrice = (
  sendRequester: HTTPSendRequester,
  symbol: string,
  minuteStart: number,
): number => {
  // Kraken calls Bitcoin XBT, and `since` is exclusive — ask from the minute
  // before so the one we want is included.
  const pair = symbol === "BTC" ? "XBTUSD" : `${symbol}USD`
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1&since=${minuteStart - 60}`
  const response = sendRequester.sendRequest({ url, method: "GET" }).result()
  requireOk(response, "Kraken")

  const parsed = cryptoPriceSchemas.kraken.parse(json(response))
  if (parsed.error.length > 0) throw new Error(`Kraken error: ${parsed.error.join(",")}`)

  // The result key is the venue's own pair name (XXBTZUSD), not what we asked
  // for, so find the array rather than guessing the key.
  let candles: unknown[] | undefined
  for (const key of Object.keys(parsed.result)) {
    if (key !== "last" && Array.isArray(parsed.result[key])) {
      candles = parsed.result[key] as unknown[]
      break
    }
  }
  if (!candles) throw new Error("Kraken returned no candle series")

  for (const row of candles) {
    const c = row as unknown[]
    if (Number(c[0]) === minuteStart) return Number(c[4])
  }
  throw new Error(`Kraken has no candle for minute ${minuteStart}`)
}

/** Price in whole units, scaled to the 8-decimal integer the contract uses. */
const toScaledPrice = (price: number): number => Math.round(price * PRICE_DECIMALS)

const fetchCryptoPrice = (
  sendRequester: HTTPSendRequester,
  symbol: string,
  minuteStart: number,
  strikePrice: number,
): Observation => {
  const venues: { name: string; read: () => number }[] = [
    { name: "coinbase", read: () => readCoinbasePrice(sendRequester, symbol, minuteStart) },
    { name: "bitstamp", read: () => readBitstampPrice(sendRequester, symbol, minuteStart) },
    { name: "kraken", read: () => readKrakenPrice(sendRequester, symbol, minuteStart) },
  ]

  const prices = venues.map((v) => toScaledPrice(v.read()))

  // Same rule as the flight path: sources must agree on the OUTCOME, not merely
  // be numerically close. Two venues either side of the strike are only cents
  // apart but disagree about who gets paid, and averaging them would invent an
  // answer neither venue gave.
  const outcomes = prices.map((p) => (p >= strikePrice ? OUTCOME_YES : OUTCOME_NO))
  if (!outcomes.every((o) => o === outcomes[0])) {
    throw new Error(
      `Venues disagree on ${symbol} vs strike ${strikePrice}: ${venues
        .map((v, i) => `${v.name}=${prices[i]}->${outcomes[i]}`)
        .join(" vs ")}`,
    )
  }

  const sorted = [...prices].sort((a, b) => a - b)
  const medianPrice = sorted[Math.floor(sorted.length / 2)]!

  return { delayMinutes: medianPrice, status: "priced", fetchedAt: 0 }
}

export const onSettlementRequested = (
  runtime: Runtime<Config>,
  triggerEvent: EVMLog,
): string => {
  // --- decode the event ---
  // Log carries raw protobuf bytes (Uint8Array), so hex-encode before viem sees it.
  const decoded = decodeEventLog({
    abi: settlementRequestedAbi,
    data: bytesToHex(triggerEvent.data),
    topics: triggerEvent.topics.map((t) => bytesToHex(t)) as [
      `0x${string}`,
      ...`0x${string}`[],
    ],
  })

  const { marketId, flightIata, departureDate, thresholdMinutes } = decoded.args
  runtime.log(
    `Settling market ${marketId}: ${flightIata} on ${departureDate}, threshold ${thresholdMinutes}m`,
  )

  // AeroDataBox wants YYYY-MM-DD; the contract stores YYYYMMDD as a uint32.
  const dateDigits = departureDate.toString()
  const departureDateIso = `${dateDigits.slice(0, 4)}-${dateDigits.slice(4, 6)}-${dateDigits.slice(6, 8)}`

  // --- fetch with consensus ---
  const httpClient = new HTTPClient()
  const aggregation = ConsensusAggregationByFields<Observation>({
    delayMinutes: median,
    status: identical,
    fetchedAt: ignore,
  })

  let outcome: number
  let observedDelay: number
  let observedStatus: string

  try {
    const obs = httpClient
      .sendRequest(runtime, fetchFlight, aggregation)(
        runtime.config.apiUrl,
        runtime.config.apiKey,
        runtime.config.secondaryUrl ?? "",
        flightIata,
        departureDateIso,
        Number(thresholdMinutes),
      )
      .result()

    observedDelay = obs.delayMinutes
    observedStatus = obs.status

    // Same rule `outcomeFor` applied per source, now over the consensus
    // result. Kept as one shared function so the per-source agreement check
    // and the final settlement can never drift apart.
    outcome = outcomeFor(
      { delayMinutes: obs.delayMinutes, status: obs.status },
      Number(thresholdMinutes),
    )
  } catch (err) {
    // Data unavailable or nodes disagreed -> refund path, never a coin flip.
    runtime.log(`Resolution failed, voiding market ${marketId}: ${err}`)
    outcome = OUTCOME_VOID
    observedDelay = 0
    observedStatus = "unavailable"
  }

  // --- evidence hash ---
  // Hash the NORMALIZED, consensus-agreed values. Hashing the raw API payload
  // would produce a different hash on every node and never reach consensus.
  // DON Time, not Date.now(), which is non-deterministic across nodes.
  const settledAt = Math.floor(runtime.now().getTime() / 1000)
  const evidence = JSON.stringify({
    marketId: marketId.toString(),
    flightIata,
    departureDate: Number(departureDate),
    thresholdMinutes: Number(thresholdMinutes),
    observedDelay,
    observedStatus,
    outcome,
    settledAt,
  })
  const evidenceHash = keccak256(toHex(evidence))

  runtime.log(
    `Market ${marketId} -> outcome=${outcome} delay=${observedDelay}m status=${observedStatus} evidence=${evidenceHash}`,
  )

  // --- signed report onchain ---
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
  })
  if (!network) {
    throw new Error(`Unknown chain selector name: ${runtime.config.chainSelectorName}`)
  }

  const evmClient = new EVMClient(network.chainSelector.selector)

  // Must match onReport's abi.decode: (uint256, uint8, int32, bytes32)
  //
  // delayMinutes is passed as a BigInt, not the plain `number` viem's types
  // declare for int32 — the cast below is deliberate. viem's encoder
  // range-checks with `value < min` against a bigint bound; in this
  // workflow's WASM/QuickJS runtime that mixed number-vs-bigint comparison
  // is simply wrong for negative numbers (confirmed directly against the
  // real runtime: `-33 < -2147483648n` evaluated to `true` here, though not
  // in Node/bun) and throws a spurious IntegerOutOfRangeError. Passing a
  // bigint keeps the comparison same-type on both sides and sidesteps it.
  const encoded = encodeAbiParameters(
    parseAbiParameters("uint256 marketId, uint8 outcome, int32 delayMinutes, bytes32 evidenceHash"),
    [marketId, outcome, BigInt(observedDelay) as unknown as number, evidenceHash],
  )

  const signedReport = runtime.report(prepareReportRequest(encoded)).result()

  const txResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.contractAddress,
      report: signedReport,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()

  if (txResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Write failed: ${txResult.errorMessage || txResult.txStatus}`)
  }

  const txHash = bytesToHex(txResult.txHash ?? new Uint8Array(32))
  runtime.log(`Settled market ${marketId} in tx ${txHash}`)
  return txHash
}

export const onCryptoSettlementRequested = (
  runtime: Runtime<Config>,
  triggerEvent: EVMLog,
): string => {
  const decoded = decodeEventLog({
    abi: cryptoSettlementRequestedAbi,
    data: bytesToHex(triggerEvent.data),
    topics: triggerEvent.topics.map((t) => bytesToHex(t)) as [
      `0x${string}`,
      ...`0x${string}`[],
    ],
  })

  const { marketId, asset, strikePrice, expiryTime } = decoded.args
  const symbol = ASSET_SYMBOLS[Number(asset)]
  if (!symbol) throw new Error(`Unknown asset index ${asset}`)

  // Settle on the close of the minute expiry fell in. CryptoMarket holds
  // settlement back a minute past expiry so this candle is always closed.
  const minuteStart = Math.floor(Number(expiryTime) / 60) * 60
  const strike = Number(strikePrice)

  runtime.log(
    `Settling crypto market ${marketId}: ${symbol} vs strike ${strike} at minute ${minuteStart}`,
  )

  const httpClient = new HTTPClient()
  const aggregation = ConsensusAggregationByFields<Observation>({
    delayMinutes: median,
    status: identical,
    fetchedAt: ignore,
  })

  let outcome: number
  let observedPrice: number

  try {
    const obs = httpClient
      .sendRequest(runtime, fetchCryptoPrice, aggregation)(symbol, minuteStart, strike)
      .result()

    observedPrice = obs.delayMinutes
    outcome = observedPrice >= strike ? OUTCOME_YES : OUTCOME_NO
  } catch (err) {
    // Venues contradicted each other, or the data was unavailable. Refund
    // rather than pick a side.
    runtime.log(`Resolution failed, voiding crypto market ${marketId}: ${err}`)
    outcome = OUTCOME_VOID
    observedPrice = 0
  }

  const settledAt = Math.floor(runtime.now().getTime() / 1000)
  const evidence = JSON.stringify({
    marketId: marketId.toString(),
    asset: symbol,
    strikePrice: strike,
    expiryTime: Number(expiryTime),
    minuteStart,
    observedPrice,
    outcome,
    settledAt,
  })
  const evidenceHash = keccak256(toHex(evidence))

  runtime.log(
    `Crypto market ${marketId} -> outcome=${outcome} price=${observedPrice} strike=${strike} evidence=${evidenceHash}`,
  )

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
  })
  if (!network) {
    throw new Error(`Unknown chain selector name: ${runtime.config.chainSelectorName}`)
  }
  const evmClient = new EVMClient(network.chainSelector.selector)

  // Must match ParimutuelMarket._processReport: (uint256, uint8, int256, bytes32).
  // BigInt for the same reason as the flight path — see the note there.
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "uint256 marketId, uint8 outcome, int256 observedValue, bytes32 evidenceHash",
    ),
    [marketId, outcome, BigInt(observedPrice), evidenceHash],
  )

  const signedReport = runtime.report(prepareReportRequest(encoded)).result()

  const txResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.cryptoContractAddress ?? "",
      report: signedReport,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()

  if (txResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Write failed: ${txResult.errorMessage || txResult.txStatus}`)
  }

  const txHash = bytesToHex(txResult.txHash ?? new Uint8Array(32))
  runtime.log(`Settled crypto market ${marketId} in tx ${txHash}`)
  return txHash
}

// --- stock / commodity settlement, from a Chainlink Data Feed ---------------

type FeedRound = { roundId: bigint; answer: bigint; updatedAt: number }

/**
 * One feed read, pinned to a block.
 *
 * The block matters more than the call. Every DON node runs this
 * independently, so reading at "latest" would give each node whatever head it
 * happened to see and the report bytes would differ — the same problem that
 * made spot quotes unusable for the crypto market. Pinning to the block the
 * settlement request was mined in gives every node one agreed reference point,
 * taken from the trigger they all received.
 */
const readFeedRound = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  feed: string,
  atBlock: bigint,
  roundId?: bigint,
): FeedRound => {
  const data =
    roundId === undefined
      ? encodeFunctionData({ abi: feedAbi, functionName: "latestRoundData" })
      : encodeFunctionData({ abi: feedAbi, functionName: "getRoundData", args: [roundId] })

  const reply = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: "0x0000000000000000000000000000000000000000",
        to: feed as `0x${string}`,
        data,
      }),
      blockNumber: blockNumber(atBlock),
    })
    .result()

  const decoded = decodeFunctionResult({
    abi: feedAbi,
    functionName: roundId === undefined ? "latestRoundData" : "getRoundData",
    data: bytesToHex(reply.data ?? new Uint8Array()),
  }) as readonly [bigint, bigint, bigint, bigint, bigint]

  const updatedAt = Number(decoded[3])
  // A feed answers zero for a round it never published, rather than reverting.
  if (updatedAt === 0) throw new Error(`Feed round ${roundId ?? "latest"} is unset`)

  return { roundId: decoded[0], answer: decoded[1], updatedAt }
}

/**
 * The round that was in force at `target` — the most recent one published at
 * or before it. Walks back from `from`, so successive lookups going further
 * into the past can continue from where the last one stopped.
 */
const roundInForceAt = (
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  feed: string,
  atBlock: bigint,
  from: FeedRound,
  target: number,
): FeedRound => {
  let round = from
  for (let i = 0; i < MAX_ROUND_WALK; i++) {
    if (round.updatedAt <= target) return round
    round = readFeedRound(runtime, evmClient, feed, atBlock, round.roundId - 1n)
  }
  throw new Error(`No feed round at or before ${target} within ${MAX_ROUND_WALK} rounds`)
}

export const onStockSettlementRequested = (
  runtime: Runtime<Config>,
  triggerEvent: EVMLog,
): string => {
  const decoded = decodeEventLog({
    abi: stockSettlementRequestedAbi,
    data: bytesToHex(triggerEvent.data),
    topics: triggerEvent.topics.map((t) => bytesToHex(t)) as [
      `0x${string}`,
      ...`0x${string}`[],
    ],
  })

  const { marketId, feed, strikePrice, closeTime, expiryTime, maxStaleness } = decoded.args
  const strike = BigInt(strikePrice)
  const expiry = Number(expiryTime)
  const close = Number(closeTime)

  if (!triggerEvent.blockNumber) {
    throw new Error("Trigger log carries no block number to pin reads to")
  }
  const atBlock = protoBigIntToBigint(triggerEvent.blockNumber)

  runtime.log(
    `Settling stock market ${marketId}: feed ${feed} vs strike ${strike} at ${expiry}, pinned to block ${atBlock}`,
  )

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
  })
  if (!network) {
    throw new Error(`Unknown chain selector name: ${runtime.config.chainSelectorName}`)
  }
  const evmClient = new EVMClient(network.chainSelector.selector)

  let outcome: number
  let observedPrice = 0n
  let priceAtClose = 0n

  try {
    const latest = readFeedRound(runtime, evmClient, feed, atBlock)
    const atExpiry = roundInForceAt(runtime, evmClient, feed, atBlock, latest, expiry)

    // A feed that stopped publishing keeps answering with its last value, and
    // that value gets less true every hour. Better to refund than to settle a
    // market on a price from a day the question was not about.
    const age = expiry - atExpiry.updatedAt
    if (age > Number(maxStaleness)) {
      throw new Error(`Round at expiry is ${age}s old, tolerance is ${maxStaleness}s`)
    }
    if (atExpiry.answer <= 0n) {
      throw new Error(`Feed answered ${atExpiry.answer} at expiry`)
    }

    const atClose = roundInForceAt(runtime, evmClient, feed, atBlock, atExpiry, close)

    // THE TRADING-CALENDAR CHECK. A feed publishes through the weekend, simply
    // repeating the last price with a fresh timestamp — measured on CSPX/USD,
    // the answer changed on every weekday round and not once from Friday to
    // Saturday. If the price never moved between the book closing and expiry,
    // the outcome was already fixed when the last stake was placed, and paying
    // it out would reward whoever noticed the market was over. The chain cannot
    // know an exchange calendar; it can notice that nothing happened.
    if (atClose.answer === atExpiry.answer) {
      throw new Error(
        `Price did not move between close and expiry (${atExpiry.answer}) — market was already decided`,
      )
    }

    observedPrice = atExpiry.answer
    priceAtClose = atClose.answer
    outcome = observedPrice >= strike ? OUTCOME_YES : OUTCOME_NO
  } catch (err) {
    runtime.log(`Resolution failed, voiding stock market ${marketId}: ${err}`)
    outcome = OUTCOME_VOID
    observedPrice = 0n
  }

  const settledAt = Math.floor(runtime.now().getTime() / 1000)
  const evidence = JSON.stringify({
    marketId: marketId.toString(),
    feed,
    strikePrice: strike.toString(),
    closeTime: close,
    expiryTime: expiry,
    priceAtClose: priceAtClose.toString(),
    observedPrice: observedPrice.toString(),
    outcome,
    settledAt,
  })
  const evidenceHash = keccak256(toHex(evidence))

  runtime.log(
    `Stock market ${marketId} -> outcome=${outcome} price=${observedPrice} strike=${strike} evidence=${evidenceHash}`,
  )

  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "uint256 marketId, uint8 outcome, int256 observedValue, bytes32 evidenceHash",
    ),
    [marketId, outcome, observedPrice, evidenceHash],
  )

  const signedReport = runtime.report(prepareReportRequest(encoded)).result()

  const txResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.stockContractAddress ?? "",
      report: signedReport,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result()

  if (txResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Write failed: ${txResult.errorMessage || txResult.txStatus}`)
  }

  const txHash = bytesToHex(txResult.txHash ?? new Uint8Array(32))
  runtime.log(`Settled stock market ${marketId} in tx ${txHash}`)
  return txHash
}

export const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
  })
  if (!network) {
    throw new Error(`Unknown chain selector name: ${config.chainSelectorName}`)
  }

  const evmClient = new EVMClient(network.chainSelector.selector)

  const handlers = [
    handler(
      // topics[0] = event signature; no filter on the indexed marketId.
      evmClient.logTrigger(
        logTriggerConfig({
          addresses: [config.contractAddress as `0x${string}`],
          topics: [[SETTLEMENT_REQUESTED_TOPIC]],
          confidence: "LATEST",
        }),
      ),
      onSettlementRequested,
    ),
  ]

  // One workflow, two triggers. The crypto market is a separate contract with
  // its own event signature, so it needs its own trigger — but it settles
  // through the same report envelope, so it belongs in the same workflow
  // rather than a second deployment to keep in sync.
  if (config.cryptoContractAddress && config.cryptoContractAddress !== "") {
    handlers.push(
      handler(
        evmClient.logTrigger(
          logTriggerConfig({
            addresses: [config.cryptoContractAddress as `0x${string}`],
            topics: [[CRYPTO_SETTLEMENT_REQUESTED_TOPIC]],
            confidence: "LATEST",
          }),
        ),
        onCryptoSettlementRequested,
      ),
    )
  }

  // The stock market settles from an on-chain feed rather than HTTP, but the
  // report envelope and the receiver checks are identical, so it is a third
  // trigger here rather than a third workflow.
  if (config.stockContractAddress && config.stockContractAddress !== "") {
    handlers.push(
      handler(
        evmClient.logTrigger(
          logTriggerConfig({
            addresses: [config.stockContractAddress as `0x${string}`],
            topics: [[STOCK_SETTLEMENT_REQUESTED_TOPIC]],
            confidence: "LATEST",
          }),
        ),
        onStockSettlementRequested,
      ),
    )
  }

  return handlers
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
