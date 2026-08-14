import {
  EVMClient,
  EVMLogCapability,
  HTTPClient,
  getNetwork,
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
  type EVMLogPayload,
} from "@chainlink/cre-sdk"
import {
  decodeEventLog,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
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

type Config = {
  contractAddress: string
  chainSelectorName: string
  apiUrl: string          // base URL of the flight status API
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

// --- API response ------------------------------------------------------------

const flightSchema = z.object({
  status: z.string(),
  arrivalDelayMinutes: z.number().nullable(),
})

/**
 * Per-node result.
 *
 * CONSENSUS HAZARD: every field here is aggregated across nodes, so anything
 * that varies per node breaks consensus. `delayMinutes` is deliberately
 * bucketed to whole minutes and `fetchedAt` is dropped via `ignore` — raw
 * API timestamps differ on every node and would never agree.
 */
type Observation = {
  delayMinutes: number
  status: string
  fetchedAt: number
}

const fetchFlight = (
  sendRequester: HTTPSendRequester,
  apiUrl: string,
  flightIata: string,
  departureDate: number,
): Observation => {
  const url = `${apiUrl}?flight=${flightIata}&date=${departureDate}`
  const response = sendRequester.sendRequest({ url, method: "GET" }).result()

  if (!ok(response)) {
    throw new Error(`HTTP ${response.statusCode} for ${flightIata}`)
  }

  const parsed = flightSchema.parse(json(response))

  // Cancelled/diverted resolve YES per the contract's documented rules.
  // Round to whole minutes so independent nodes converge on one value.
  const delay =
    parsed.arrivalDelayMinutes === null ? 0 : Math.round(parsed.arrivalDelayMinutes)

  return {
    delayMinutes: delay,
    status: parsed.status.toLowerCase(),
    fetchedAt: 0,
  }
}

const onSettlementRequested = (
  runtime: Runtime<Config>,
  triggerEvent: EVMLogPayload,
): string => {
  // --- decode the event ---
  const decoded = decodeEventLog({
    abi: settlementRequestedAbi,
    data: triggerEvent.data as `0x${string}`,
    topics: triggerEvent.topics as [`0x${string}`, ...`0x${string}`[]],
  })

  const { marketId, flightIata, departureDate, thresholdMinutes } = decoded.args
  runtime.log(
    `Settling market ${marketId}: ${flightIata} on ${departureDate}, threshold ${thresholdMinutes}m`,
  )

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
        flightIata,
        Number(departureDate),
      )
      .result()

    observedDelay = obs.delayMinutes
    observedStatus = obs.status

    const isDisrupted = obs.status === "cancelled" || obs.status === "diverted"
    const isLanded = obs.status === "landed" || obs.status === "arrived"

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
  const encoded = encodeAbiParameters(
    parseAbiParameters("uint256 marketId, uint8 outcome, int32 delayMinutes, bytes32 evidenceHash"),
    [marketId, outcome, observedDelay, evidenceHash],
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

const initWorkflow = (config: Config) => {
  const evmLog = new EVMLogCapability()
  return [
    handler(
      evmLog.trigger({
        contractAddress: config.contractAddress,
        chainSelectorName: config.chainSelectorName,
        eventSignature: "SettlementRequested(uint256,string,uint32,uint16)",
      }),
      onSettlementRequested,
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
