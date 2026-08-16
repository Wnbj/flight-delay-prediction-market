import { orderLogs, type PayoutLog, type ReportLog, type RequestedLog, type SettledLog, type SettlementLog } from "./settlementEvents";
import type { LpEvent, Market } from "./types";

/**
 * Folding settlement logs into what actually happened to each market.
 *
 * THE STATE IS DERIVED FROM LOGS, NEVER FROM `market.status`. Two reasons, both
 * live: `AmmMarket.Status` has no `Locked`, so its numbers sit one below every
 * other contract's, and `Locked` is never assigned by any contract at all — a
 * status-driven state machine therefore has both a dead branch and an
 * off-by-one waiting in it. Logs have neither problem, and they also carry the
 * one thing status cannot: that a delivery was attempted and refused.
 */

export type PipelineState =
  /** Requested, nothing back yet. */
  | "in-flight"
  /** The forwarder recorded a refused delivery and the market never settled. */
  | "rejected"
  /** A refused delivery for a market that was ALREADY settled — a duplicate. */
  | "duplicate"
  /** Delivered, accepted, written. A void outcome is still a settlement. */
  | "settled"
  /** Settled, but no forwarder log in range — absence of evidence, not failure. */
  | "settled-unattested"
  /** Settled and at least some money has left. */
  | "paid";

export interface Attempt {
  /** `${marketKey}#${n}` — a market can be attempted more than once. */
  id: string;
  marketKey: string;
  /** Null when the market's own category failed to load. The row still shows. */
  market: Market | null;
  requested: RequestedLog | null;
  report: ReportLog | null;
  settled: SettledLog | null;
  payouts: PayoutLog[];
  state: PipelineState;
  /** First block of the attempt, for sorting. */
  startedAt: bigint;
  blocksToReport: number | null;
  /** Only when both block timestamps are known. Never derived from height. */
  secondsToReport: number | null;
}

export interface Pipelines {
  attempts: Attempt[];
  /**
   * Refused reports that could not be tied to one market.
   *
   * A refused report names a receiver contract and nothing else — no market id
   * — so when several markets on that contract were in flight at the time, the
   * chain genuinely does not say which one it was. Guessing the most recent
   * would present an inference as a fact, and with a five-rung ladder settled
   * in sequence the ambiguous case is ordinary rather than exotic.
   */
  unattributed: ReportLog[];
}

const isRequested = (l: SettlementLog): l is RequestedLog => l.kind === "requested";
const isReport = (l: SettlementLog): l is ReportLog => l.kind === "report";
const isSettled = (l: SettlementLog): l is SettledLog => l.kind === "settled";
const isPayout = (l: SettlementLog): l is PayoutLog => l.kind === "payout";

/**
 * @param blockTimes unix seconds per block, as far as they are known. Gaps are
 *                   expected — timestamps are fetched lazily and a missing one
 *                   means "not looked up yet", never "instant".
 */
export function buildPipelines(
  markets: Market[],
  logs: SettlementLog[],
  lpWithdrawals: LpEvent[] = [],
  blockTimes: Map<bigint, number> = new Map(),
): Pipelines {
  const marketByKey = new Map(markets.map((m) => [m.key, m]));

  // Deduped first: the live feed rescans an overlapping window every tick, so
  // the same log arrives repeatedly and must fold to the same result.
  const seen = new Set<string>();
  const ordered: SettlementLog[] = [];
  for (const l of [...logs].sort(orderLogs)) {
    const id = `${l.txHash}:${l.logIndex}`;
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(l);
  }

  /**
   * Attempts per market, split at each request. A market that was refused and
   * then requested again has two attempts, and collapsing them would hide the
   * refusal — which is the one thing here worth seeing.
   */
  const byMarket = new Map<string, Attempt[]>();
  const attemptsInOrder: Attempt[] = [];

  const newAttempt = (marketKey: string, startedAt: bigint): Attempt => {
    const list = byMarket.get(marketKey) ?? [];
    const attempt: Attempt = {
      id: `${marketKey}#${list.length}`,
      marketKey,
      market: marketByKey.get(marketKey) ?? null,
      requested: null,
      report: null,
      settled: null,
      payouts: [],
      state: "in-flight",
      startedAt,
      blocksToReport: null,
      secondsToReport: null,
    };
    list.push(attempt);
    byMarket.set(marketKey, list);
    attemptsInOrder.push(attempt);
    return attempt;
  };

  const openAttempt = (marketKey: string, at: bigint): Attempt => {
    const list = byMarket.get(marketKey);
    const last = list?.[list.length - 1];
    // A settled attempt is closed; anything after it belongs to a new one.
    if (last && !last.settled) return last;
    return newAttempt(marketKey, at);
  };

  for (const log of ordered) {
    if (isRequested(log)) {
      const attempt = newAttempt(log.marketKey, log.blockNumber);
      attempt.requested = log;
      continue;
    }
    if (isSettled(log)) {
      const attempt = openAttempt(log.marketKey, log.blockNumber);
      attempt.settled = log;
      continue;
    }
    if (isPayout(log)) {
      const list = byMarket.get(log.marketKey);
      // Payouts belong to whichever attempt actually settled the market.
      const target = list?.filter((a) => a.settled).pop() ?? list?.[list.length - 1];
      if (target) target.payouts.push(log);
      continue;
    }
  }

  // --- reports, last, because attribution depends on the rest --------------

  const unattributed: ReportLog[] = [];
  const settledByTx = new Map<`0x${string}`, SettledLog[]>();
  for (const l of ordered) {
    if (!isSettled(l)) continue;
    const list = settledByTx.get(l.txHash) ?? [];
    list.push(l);
    settledByTx.set(l.txHash, list);
  }

  for (const report of ordered.filter(isReport)) {
    /**
     * Accepted: the `Settled` in the SAME transaction names the market. Exact,
     * and the only association the chain actually provides.
     */
    const inTx = settledByTx.get(report.txHash) ?? [];
    if (inTx.length > 0) {
      for (const s of inTx) {
        const list = byMarket.get(s.marketKey);
        const target = list?.find((a) => a.settled === s);
        if (target) target.report = report;
      }
      continue;
    }

    if (report.accepted) {
      // Accepted but nothing settled in the transaction. Not something this
      // system produces; surfaced rather than silently dropped.
      unattributed.push(report);
      continue;
    }

    /**
     * Refused. The only handle is (receiver contract, block). Attach it when
     * exactly one attempt on that contract was open; otherwise say so.
     */
    if (report.category === null) {
      unattributed.push(report);
      continue;
    }
    const candidates = attemptsInOrder.filter(
      (a) =>
        a.marketKey.startsWith(`${report.category}:`) &&
        a.startedAt <= report.blockNumber &&
        !a.report,
    );
    const open = candidates.filter((a) => !a.settled);

    if (open.length === 1) {
      open[0]!.report = report;
    } else if (open.length === 0 && candidates.length > 0) {
      // Every candidate is already settled — a refused duplicate, which the
      // cron sweeps produce legitimately by re-settling inside the finality
      // window. Attach to the most recent so it reads as what it is.
      candidates[candidates.length - 1]!.report = report;
    } else {
      unattributed.push(report);
    }
  }

  // --- liquidity withdrawals count as payouts too --------------------------

  for (const w of lpWithdrawals) {
    if (w.direction !== "withdraw") continue;
    const list = byMarket.get(w.marketKey);
    const target = list?.filter((a) => a.settled).pop();
    if (!target) continue;
    target.payouts.push({
      kind: "payout",
      marketKey: w.marketKey,
      who: w.provider,
      amount: w.amount,
      via: "redeem",
      blockNumber: w.blockNumber,
      txHash: w.txHash,
      logIndex: -1,
    });
  }

  // --- final state ---------------------------------------------------------

  for (const a of attemptsInOrder) {
    a.state = stateOf(a);

    const from = a.requested?.blockNumber;
    const to = a.report?.blockNumber ?? a.settled?.blockNumber;
    if (from !== undefined && to !== undefined) {
      a.blocksToReport = Number(to - from);
      const t0 = blockTimes.get(from);
      const t1 = blockTimes.get(to);
      // Never blocks × 12s. An unknown timestamp stays unknown.
      a.secondsToReport = t0 !== undefined && t1 !== undefined ? t1 - t0 : null;
    }
  }

  return {
    attempts: attemptsInOrder.sort((x, y) => (x.startedAt === y.startedAt ? 0 : x.startedAt < y.startedAt ? -1 : 1)),
    unattributed,
  };
}

function stateOf(a: Attempt): PipelineState {
  if (a.settled) {
    if (a.payouts.length > 0) return "paid";
    // A report that arrived after the market was already settled is a refused
    // duplicate, not a failure — the contract rejecting a re-settlement is the
    // sweep working as designed.
    if (a.report && !a.report.accepted) return "duplicate";
    if (!a.report) return "settled-unattested";
    return "settled";
  }
  if (a.report && !a.report.accepted) return "rejected";
  return "in-flight";
}

/** Attempts still waiting or refused — what the top of the page shows. */
export function inFlight(p: Pipelines): Attempt[] {
  return p.attempts.filter((a) => a.state === "in-flight" || a.state === "rejected");
}

/** Everything resolved, newest first. */
export function history(p: Pipelines): Attempt[] {
  return p.attempts
    .filter((a) => a.state !== "in-flight" && a.state !== "rejected")
    .sort((x, y) => (y.startedAt === x.startedAt ? 0 : y.startedAt > x.startedAt ? 1 : -1));
}
