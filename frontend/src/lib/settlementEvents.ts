import { parseAbiItem } from "viem";
import {
  AMM_MARKET_ADDRESS,
  CRYPTO_MARKET_ADDRESS,
  DEPLOY_BLOCK,
  FLIGHT_MARKET_ADDRESS,
  FORWARDER_ADDRESS,
  RESERVE_MARKET_ADDRESS,
  STOCK_MARKET_ADDRESS,
} from "./config";
import { logsInChunks, marketKey, publicClient } from "./chain";
import type { CategoryId } from "./types";

/**
 * Every log a settlement leaves behind, decoded in one place.
 *
 * WHAT A SETTLEMENT ACTUALLY LOOKS LIKE ON CHAIN, which is what this module
 * exists to make readable:
 *
 *   SettlementRequested          the market is handed to the oracle
 *        ↓  (an unobservable gap — see below)
 *   one transaction containing
 *     ReportProcessed            the forwarder's verdict on delivery
 *     Settled                    ONLY IF the receiver accepted it
 *        ↓
 *   Claimed / Redeemed           money leaving
 *
 * The gap is genuinely empty. The workflow reconciles three venues to a median
 * and discards them, and hashes an evidence document it never publishes, so
 * nothing between request and report reaches the chain at all.
 *
 * THE ONE THAT MATTERS: a rejected report leaves NO trace on the receiver.
 * `ReceiverTemplate.onReport` reverts before `_processReport` runs, so there is
 * no `Settled`, no revert visible to a log reader, nothing. The forwarder's
 * `ReportProcessed(..., false)` is the only evidence that a delivery was even
 * attempted. Reading it is the difference between showing a failure and showing
 * a market that merely looks slow.
 */

// --- signatures -------------------------------------------------------------

/**
 * Verified by hash against a real receipt rather than taken from documentation:
 * topic0 is 0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5.
 * The hash pins the TYPES only — the RUNBOOK calls the bool both `success` and
 * `result`, and nothing on chain settles which name is right. `result` is what
 * the upstream KeystoneForwarder declares.
 */
const REPORT_PROCESSED_EVENT = parseAbiItem(
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
);

/** Crypto and AMM are byte-identical here — deliberately. Address discriminates. */
const CRYPTO_REQUESTED_EVENT = parseAbiItem(
  "event SettlementRequested(uint256 indexed marketId, uint8 asset, uint64 strikePrice, uint64 expiryTime)",
);
const FLIGHT_REQUESTED_EVENT = parseAbiItem(
  "event SettlementRequested(uint256 indexed marketId, string flightIata, uint32 departureDate, uint16 thresholdMinutes)",
);
const STOCK_REQUESTED_EVENT = parseAbiItem(
  "event SettlementRequested(uint256 indexed marketId, address feed, uint64 strikePrice, uint64 closeTime, uint64 expiryTime, uint32 maxStaleness)",
);
/** No closeTime — reserves deliberately do not get the movement check. */
const RESERVE_REQUESTED_EVENT = parseAbiItem(
  "event SettlementRequested(uint256 indexed marketId, address feed, uint64 strikePrice, uint64 expiryTime, uint32 maxStaleness)",
);

const CRYPTO_SETTLED_EVENT = parseAbiItem(
  "event Settled(uint256 indexed marketId, uint8 outcome, int256 observedValue, bytes32 evidenceHash)",
);
/** FlightMarket predates the shared base and still declares int32. */
const FLIGHT_SETTLED_EVENT = parseAbiItem(
  "event Settled(uint256 indexed marketId, uint8 outcome, int32 observedDelay, bytes32 evidenceHash)",
);

const CLAIMED_EVENT = parseAbiItem(
  "event Claimed(uint256 indexed marketId, address indexed user, uint256 amount)",
);
/** The AMM pays out through `redeem`, not `claim`. Distinct topic0. */
const REDEEMED_EVENT = parseAbiItem(
  "event Redeemed(uint256 indexed marketId, address indexed holder, uint256 amount)",
);

export const SETTLEMENT_EVENTS = {
  reportProcessed: REPORT_PROCESSED_EVENT,
  cryptoRequested: CRYPTO_REQUESTED_EVENT,
  flightRequested: FLIGHT_REQUESTED_EVENT,
  stockRequested: STOCK_REQUESTED_EVENT,
  reserveRequested: RESERVE_REQUESTED_EVENT,
  cryptoSettled: CRYPTO_SETTLED_EVENT,
  flightSettled: FLIGHT_SETTLED_EVENT,
  claimed: CLAIMED_EVENT,
  redeemed: REDEEMED_EVENT,
} as const;

// --- which contract is which -----------------------------------------------

/**
 * Address is the ONLY safe discriminator.
 *
 * Crypto and AMM share topic0 on both `SettlementRequested` and `Settled`, so a
 * reader keyed on the event signature would merge two different markets that
 * happen to share a numeric id. This is the same trap the workflow avoids by
 * taking its receiver from `triggerEvent.address` rather than from config.
 */
export const CONTRACT_CATEGORY = new Map<string, CategoryId>([
  [FLIGHT_MARKET_ADDRESS.toLowerCase(), "flights"],
  [CRYPTO_MARKET_ADDRESS.toLowerCase(), "crypto"],
  [STOCK_MARKET_ADDRESS.toLowerCase(), "stocks"],
  [RESERVE_MARKET_ADDRESS.toLowerCase(), "reserves"],
  [AMM_MARKET_ADDRESS.toLowerCase(), "amm"],
]);

export const RECEIVER_ADDRESSES = [
  FLIGHT_MARKET_ADDRESS,
  CRYPTO_MARKET_ADDRESS,
  STOCK_MARKET_ADDRESS,
  RESERVE_MARKET_ADDRESS,
  AMM_MARKET_ADDRESS,
] as const;

/**
 * Two categories sharing an address would silently merge their markets, with no
 * type error and no runtime error — one bad paste in `.env.local` is enough.
 * Asserted at module load so it cannot be discovered from wrong numbers.
 */
if (CONTRACT_CATEGORY.size !== RECEIVER_ADDRESSES.length) {
  throw new Error(
    "Two market contracts share an address — check VITE_*_MARKET_ADDRESS. " +
      `Expected ${RECEIVER_ADDRESSES.length} distinct, got ${CONTRACT_CATEGORY.size}.`,
  );
}

export function categoryOf(address: string): CategoryId | null {
  return CONTRACT_CATEGORY.get(address.toLowerCase()) ?? null;
}

// --- decoded shapes ---------------------------------------------------------

interface LogBase {
  blockNumber: bigint;
  txHash: `0x${string}`;
  /** Half of the dedupe key — a transaction can carry several of these. */
  logIndex: number;
}

export interface RequestedLog extends LogBase {
  kind: "requested";
  marketKey: string;
  /**
   * The terms as the ORACLE received them, not as `markets()` reports them now.
   * Reading them off the event is what makes the row honest: it shows what was
   * actually handed over, which is the thing that determines the answer.
   */
  terms: { label: string; value: string }[];
}

export interface ReportLog extends LogBase {
  kind: "report";
  /** The contract the report was delivered to. It carries no market id. */
  receiver: `0x${string}`;
  category: CategoryId | null;
  accepted: boolean;
  workflowExecutionId: `0x${string}`;
  reportId: `0x${string}`;
}

export interface SettledLog extends LogBase {
  kind: "settled";
  marketKey: string;
  outcome: number;
  observedValue: bigint;
  evidenceHash: `0x${string}`;
}

export interface PayoutLog extends LogBase {
  kind: "payout";
  marketKey: string;
  who: `0x${string}`;
  amount: bigint;
  /** `redeem` on the AMM, `claim` everywhere else. */
  via: "claim" | "redeem";
}

export type SettlementLog = RequestedLog | ReportLog | SettledLog | PayoutLog;

export type LogFamily = "requested" | "report" | "settled" | "payout";

export interface SettlementScan {
  logs: SettlementLog[];
  /** Head as this node reported it when the scan began. A hint, not a promise. */
  head: bigint;
  failures: { family: LogFamily; message: string }[];
}

// --- reading ----------------------------------------------------------------

const keyFor = (address: string, marketId: bigint): string | null => {
  const category = categoryOf(address);
  return category === null ? null : marketKey(category, Number(marketId));
};

/**
 * Read every settlement log from `from` to the head.
 *
 * Failures are per family and RETURNED, never swallowed — the same rule
 * `readMarkets` follows. A family that fails leaves its logs absent, and a
 * caller that quietly rendered a shorter pipeline would be claiming the chain
 * said something it did not.
 */
export async function readSettlementLogs(
  opts: { from?: bigint; families?: LogFamily[] } = {},
): Promise<SettlementScan> {
  const from = opts.from ?? DEPLOY_BLOCK;
  const wanted = opts.families;
  const head = await publicClient.getBlockNumber();
  const failures: { family: LogFamily; message: string }[] = [];

  const run = async <T>(family: LogFamily, fn: () => Promise<T[]>): Promise<T[]> => {
    if (wanted && !wanted.includes(family)) return [];
    try {
      return await fn();
    } catch (e) {
      failures.push({ family, message: e instanceof Error ? e.message : String(e) });
      return [];
    }
  };

  const scan = <T>(fetch: (fromBlock: bigint, toBlock: bigint | "latest") => Promise<T[]>) =>
    logsInChunks(fetch, from);

  const [requested, reports, settled, payouts] = await Promise.all([
    run<RequestedLog>("requested", async () => {
      const [crypto, flight, stock, reserve] = await Promise.all([
        scan((fromBlock, toBlock) =>
          publicClient.getLogs({
            address: [CRYPTO_MARKET_ADDRESS, AMM_MARKET_ADDRESS],
            event: CRYPTO_REQUESTED_EVENT,
            fromBlock,
            toBlock,
          }),
        ),
        scan((fromBlock, toBlock) =>
          publicClient.getLogs({
            address: FLIGHT_MARKET_ADDRESS,
            event: FLIGHT_REQUESTED_EVENT,
            fromBlock,
            toBlock,
          }),
        ),
        scan((fromBlock, toBlock) =>
          publicClient.getLogs({
            address: STOCK_MARKET_ADDRESS,
            event: STOCK_REQUESTED_EVENT,
            fromBlock,
            toBlock,
          }),
        ),
        scan((fromBlock, toBlock) =>
          publicClient.getLogs({
            address: RESERVE_MARKET_ADDRESS,
            event: RESERVE_REQUESTED_EVENT,
            fromBlock,
            toBlock,
          }),
        ),
      ]);

      const out: RequestedLog[] = [];
      for (const l of crypto) {
        const key = keyFor(l.address, l.args.marketId!);
        if (!key) continue;
        out.push({
          kind: "requested",
          marketKey: key,
          terms: [
            { label: "Asset", value: Number(l.args.asset!) === 1 ? "ETH" : "BTC" },
            { label: "Strike", value: l.args.strikePrice!.toString() },
            { label: "Expiry", value: l.args.expiryTime!.toString() },
          ],
          blockNumber: l.blockNumber!,
          txHash: l.transactionHash!,
          logIndex: l.logIndex!,
        });
      }
      for (const l of flight) {
        out.push({
          kind: "requested",
          marketKey: marketKey("flights", Number(l.args.marketId!)),
          terms: [
            { label: "Flight", value: l.args.flightIata! },
            { label: "Date", value: String(l.args.departureDate!) },
            { label: "Threshold", value: `${l.args.thresholdMinutes!} min` },
          ],
          blockNumber: l.blockNumber!,
          txHash: l.transactionHash!,
          logIndex: l.logIndex!,
        });
      }
      for (const l of stock) {
        out.push({
          kind: "requested",
          marketKey: marketKey("stocks", Number(l.args.marketId!)),
          terms: [
            { label: "Feed", value: l.args.feed! },
            { label: "Strike", value: l.args.strikePrice!.toString() },
            { label: "Expiry", value: l.args.expiryTime!.toString() },
          ],
          blockNumber: l.blockNumber!,
          txHash: l.transactionHash!,
          logIndex: l.logIndex!,
        });
      }
      for (const l of reserve) {
        out.push({
          kind: "requested",
          marketKey: marketKey("reserves", Number(l.args.marketId!)),
          terms: [
            { label: "Feed", value: l.args.feed! },
            { label: "Strike", value: l.args.strikePrice!.toString() },
            { label: "Expiry", value: l.args.expiryTime!.toString() },
          ],
          blockNumber: l.blockNumber!,
          txHash: l.transactionHash!,
          logIndex: l.logIndex!,
        });
      }
      return out;
    }),

    /**
     * Filtered by indexed receiver, not filtered client-side. Other people's
     * workflows share this forwarder — measured, not assumed — so an unfiltered
     * read would both cost more and mix their settlements into ours.
     */
    run<ReportLog>("report", async () => {
      const logs = await scan((fromBlock, toBlock) =>
        publicClient.getLogs({
          address: FORWARDER_ADDRESS,
          event: REPORT_PROCESSED_EVENT,
          args: { receiver: [...RECEIVER_ADDRESSES] },
          fromBlock,
          toBlock,
        }),
      );
      return logs.map((l) => ({
        kind: "report" as const,
        receiver: l.args.receiver!,
        category: categoryOf(l.args.receiver!),
        accepted: l.args.result!,
        workflowExecutionId: l.args.workflowExecutionId!,
        reportId: l.args.reportId!,
        blockNumber: l.blockNumber!,
        txHash: l.transactionHash!,
        logIndex: l.logIndex!,
      }));
    }),

    run<SettledLog>("settled", async () => {
      const [shared, flight] = await Promise.all([
        scan((fromBlock, toBlock) =>
          publicClient.getLogs({
            address: [
              CRYPTO_MARKET_ADDRESS,
              STOCK_MARKET_ADDRESS,
              RESERVE_MARKET_ADDRESS,
              AMM_MARKET_ADDRESS,
            ],
            event: CRYPTO_SETTLED_EVENT,
            fromBlock,
            toBlock,
          }),
        ),
        scan((fromBlock, toBlock) =>
          publicClient.getLogs({
            address: FLIGHT_MARKET_ADDRESS,
            event: FLIGHT_SETTLED_EVENT,
            fromBlock,
            toBlock,
          }),
        ),
      ]);

      const out: SettledLog[] = [];
      for (const l of shared) {
        const key = keyFor(l.address, l.args.marketId!);
        if (!key) continue;
        out.push({
          kind: "settled",
          marketKey: key,
          outcome: Number(l.args.outcome!),
          observedValue: l.args.observedValue!,
          evidenceHash: l.args.evidenceHash!,
          blockNumber: l.blockNumber!,
          txHash: l.transactionHash!,
          logIndex: l.logIndex!,
        });
      }
      for (const l of flight) {
        out.push({
          kind: "settled",
          marketKey: marketKey("flights", Number(l.args.marketId!)),
          outcome: Number(l.args.outcome!),
          // Widened at the decode boundary so the fold sees one shape. An early
          // arrival is a negative delay and must survive as one.
          observedValue: BigInt(l.args.observedDelay!),
          evidenceHash: l.args.evidenceHash!,
          blockNumber: l.blockNumber!,
          txHash: l.transactionHash!,
          logIndex: l.logIndex!,
        });
      }
      return out;
    }),

    run<PayoutLog>("payout", async () => {
      const [claimed, redeemed] = await Promise.all([
        scan((fromBlock, toBlock) =>
          publicClient.getLogs({
            address: [
              FLIGHT_MARKET_ADDRESS,
              CRYPTO_MARKET_ADDRESS,
              STOCK_MARKET_ADDRESS,
              RESERVE_MARKET_ADDRESS,
            ],
            event: CLAIMED_EVENT,
            fromBlock,
            toBlock,
          }),
        ),
        scan((fromBlock, toBlock) =>
          publicClient.getLogs({
            address: AMM_MARKET_ADDRESS,
            event: REDEEMED_EVENT,
            fromBlock,
            toBlock,
          }),
        ),
      ]);

      const out: PayoutLog[] = [];
      for (const l of claimed) {
        const key = keyFor(l.address, l.args.marketId!);
        if (!key) continue;
        out.push({
          kind: "payout",
          marketKey: key,
          who: l.args.user!,
          amount: l.args.amount!,
          via: "claim",
          blockNumber: l.blockNumber!,
          txHash: l.transactionHash!,
          logIndex: l.logIndex!,
        });
      }
      for (const l of redeemed) {
        out.push({
          kind: "payout",
          marketKey: marketKey("amm", Number(l.args.marketId!)),
          who: l.args.holder!,
          amount: l.args.amount!,
          via: "redeem",
          blockNumber: l.blockNumber!,
          txHash: l.transactionHash!,
          logIndex: l.logIndex!,
        });
      }
      return out;
    }),
  ]);

  return {
    logs: [...requested, ...reports, ...settled, ...payouts].sort(orderLogs),
    head,
    failures,
  };
}

/** Chain order: block, then position within the block. */
export function orderLogs(a: SettlementLog, b: SettlementLog): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** The dedupe identity of a log. A transaction carries several. */
export const logId = (l: SettlementLog) => `${l.txHash}:${l.logIndex}`;

/**
 * Fold a fresh scan into what is already known, by union.
 *
 * WHY UNION AND NOT REPLACE-THE-WINDOW, which is the obvious way to make a
 * reorg self-correcting: **this endpoint answers identical queries with
 * different results.** Measured, four full scans back to back, no errors
 * reported by any of them:
 *
 *     settled   23 · 27 · 27 · 27
 *     requested 28 · 24 · 24 · 28
 *     report    39 · 39 · 33 · 39
 *
 * The short answers are always missing the most RECENT logs, which is the other
 * face of asking for `"latest"`: the upper bound is resolved by whichever
 * load-balanced node serves the call, and one that lags simply has fewer blocks
 * to report. It does not error, because from its own point of view it answered
 * completely.
 *
 * Deleting a window on the strength of that would make a settled market flicker
 * back to "waiting for a report" whenever a lagging node answered — during a
 * demo, on the one screen whose whole job is to be believed. A union cannot do
 * that. What it gives up is automatic reorg correction, which at this depth is
 * a far rarer event than the lag that is provably happening right now, and a
 * page reload resolves it.
 */
export function mergeLogs(
  known: Map<string, SettlementLog>,
  incoming: SettlementLog[],
): Map<string, SettlementLog> {
  for (const l of incoming) known.set(logId(l), l);
  return known;
}
