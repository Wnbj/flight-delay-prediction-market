import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  readAllowance,
  readMarkets,
  readSettledEvents,
  readStakeEvents,
  readTokenBalance,
  readWalletStakes,
} from "../lib/chain";
import { claimablePayout } from "../lib/parimutuel";
import {
  MarketStatus,
  type Market,
  type Position,
  type SettledEvent,
  type StakeEvent,
  type TraderStats,
} from "../lib/types";

export interface ChainData {
  markets: Market[];
  stakeEvents: StakeEvent[];
  settledEvents: SettledEvent[];
  positions: Position[];
  balance: bigint;
  /** Keyed by spender (market contract) — ERC-20 allowance is per spender. */
  allowances: Map<string, bigint>;
  loading: boolean;
  error: string | null;
  /** Markets loaded but event history did not — charts and leaderboard are thin. */
  historyDegraded: boolean;
  refresh: () => Promise<void>;
}

function derivePositions(
  markets: Market[],
  stakes: Map<string, { yes: bigint; no: bigint; claimed: boolean }>,
): Position[] {
  const out: Position[] = [];
  markets.forEach((m) => {
    const s = stakes.get(m.key);
    if (!s || (s.yes === 0n && s.no === 0n)) return;

    const entitlement = claimablePayout(m, s.yes, s.no);
    const claimable = s.claimed ? 0n : entitlement;

    let status: Position["status"];
    if (s.claimed) status = "Claimed";
    else if (m.status === MarketStatus.Void) status = "Refundable";
    else if (m.status === MarketStatus.Settled) {
      status = entitlement > 0n ? "Won" : "Lost";
    } else if (m.status === MarketStatus.SettlementRequested) {
      status = "Awaiting settlement";
    } else status = "Open";

    out.push({
      market: m,
      yes: s.yes,
      no: s.no,
      claimed: s.claimed,
      claimable,
      entitlement,
      status,
    });
  });
  return out;
}

/**
 * Leaderboard built from real Staked events plus settled outcomes — no invented
 * traders. With a handful of test wallets this is necessarily sparse; that is a
 * truthful reflection of the chain rather than a gap to be padded.
 */
export function deriveTraders(markets: Market[], stakes: StakeEvent[]): TraderStats[] {
  const byUser = new Map<
    Address,
    { staked: bigint; perMarket: Map<string, { yes: bigint; no: bigint }> }
  >();

  for (const e of stakes) {
    let rec = byUser.get(e.user);
    if (!rec) {
      rec = { staked: 0n, perMarket: new Map() };
      byUser.set(e.user, rec);
    }
    rec.staked += e.amount;
    let pm = rec.perMarket.get(e.marketKey);
    if (!pm) {
      pm = { yes: 0n, no: 0n };
      rec.perMarket.set(e.marketKey, pm);
    }
    if (e.isYes) pm.yes += e.amount;
    else pm.no += e.amount;
  }

  // Keyed by composite key, not id: flight 0 and crypto 0 are different
  // markets and must not collapse into one another here.
  const marketByKey = new Map(markets.map((m) => [m.key, m]));
  const out: TraderStats[] = [];

  for (const [address, rec] of byUser) {
    let profit = 0n;
    let wins = 0;
    let settledMarkets = 0;

    for (const [key, pm] of rec.perMarket) {
      const m = marketByKey.get(key);
      if (!m) continue;
      const isResolved =
        m.status === MarketStatus.Settled || m.status === MarketStatus.Void;
      if (!isResolved) continue;

      settledMarkets += 1;
      const staked = pm.yes + pm.no;
      const payout = claimablePayout(m, pm.yes, pm.no);
      profit += payout - staked;
      // A void refunds rather than resolving, so it counts as neither win nor loss.
      if (m.status === MarketStatus.Settled && payout > staked) wins += 1;
    }

    out.push({ address, staked: rec.staked, settledMarkets, wins, profit });
  }

  return out.sort((a, b) => (b.profit === a.profit ? 0 : b.profit > a.profit ? 1 : -1));
}

export function useChainData(account: Address | null): ChainData {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [stakeEvents, setStakeEvents] = useState<StakeEvent[]>([]);
  const [settledEvents, setSettledEvents] = useState<SettledEvent[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [balance, setBalance] = useState<bigint>(0n);
  /** Keyed by spender (market contract) — ERC-20 allowance is per spender. */
  const [allowances, setAllowances] = useState<Map<string, bigint>>(new Map());
  const [loading, setLoading] = useState(true);
  const [historyDegraded, setHistoryDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      /*
       * Markets are the page; event history only enriches it (sparklines,
       * activity, leaderboard). Public RPCs fail getLogs often enough that
       * tying the two together would blank the whole app over a flaky log
       * query, so events are allowed to fail on their own.
       */
      const ms = await readMarkets();
      setMarkets(ms);

      const [se, sv] = await Promise.all([
        readStakeEvents().catch(() => null),
        readSettledEvents().catch(() => null),
      ]);
      if (se) setStakeEvents(se);
      if (sv) setSettledEvents(sv);
      setHistoryDegraded(se === null || sv === null);

      if (account) {
        // Allowance is per spender, so each market contract needs its own.
        const spenders = [...new Set(ms.map((m) => m.contract))];
        const [stakes, bal, allows] = await Promise.all([
          readWalletStakes(account, ms),
          readTokenBalance(account),
          Promise.all(spenders.map((s) => readAllowance(account, s))),
        ]);
        setPositions(derivePositions(ms, stakes));
        setBalance(bal);
        setAllowances(new Map(spenders.map((s, i) => [s, allows[i]!])));
      } else {
        setPositions([]);
        setBalance(0n);
        setAllowances(new Map());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chain data");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return {
    markets,
    stakeEvents,
    settledEvents,
    positions,
    balance,
    allowances,
    loading,
    error,
    historyDegraded,
    refresh,
  };
}
