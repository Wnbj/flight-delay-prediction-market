import {
  EVMClient,
  HTTPClient,
  getNetwork,
  logTriggerConfig,
  prepareReportRequest,
  bytesToHex,
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
  encodeAbiParameters,
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

const fetchFlight = (
  sendRequester: HTTPSendRequester,
  apiUrl: string,
  apiKey: string,
  flightIata: string,
  departureDateIso: string,
): Observation => {
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

  const isDisrupted =
    flight.status === "Canceled" ||
    flight.status === "CanceledUncertain" ||
    flight.status === "Diverted"
  const isLanded = flight.status === "Arrived"

  let delayMinutes = 0
  if (isLanded && flight.arrival?.scheduledTime && flight.arrival?.revisedTime) {
    const scheduled = parseAeroDataBoxUtc(flight.arrival.scheduledTime.utc)
    const actual = parseAeroDataBoxUtc(flight.arrival.revisedTime.utc)
    // Round to whole minutes so independent nodes converge on one value.
    delayMinutes = Math.round((actual - scheduled) / 60_000)
  }

  // Bucket down to the three states _processReport's caller cares about —
  // matches the mock's {landed, cancelled, diverted, in-progress} shape.
  const bucketedStatus = isDisrupted ? "cancelled" : isLanded ? "landed" : "airborne"

  return {
    delayMinutes,
    status: bucketedStatus,
    fetchedAt: 0,
  }
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
        flightIata,
        departureDateIso,
      )
      .result()

    observedDelay = obs.delayMinutes
    observedStatus = obs.status

    const isDisrupted = obs.status === "cancelled"
    const isLanded = obs.status === "landed"

    if (isDisrupted) {
      outcome = OUTCOME_YES
    } else if (!isLanded) {
      // Still airborne or unknown: no final delay yet. Void rather than guess.
      outcome = OUTCOME_VOID
    } else {
      outcome = obs.delayMinutes >= Number(thresholdMinutes) ? OUTCOME_YES : OUTCOME_NO
    }
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

export const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
  })
  if (!network) {
    throw new Error(`Unknown chain selector name: ${config.chainSelectorName}`)
  }

  const evmClient = new EVMClient(network.chainSelector.selector)

  return [
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
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
