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
  allowance: bigint;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function derivePositions(
  markets: Market[],
  stakes: { yes: bigint; no: bigint; claimed: boolean }[],
): Position[] {
  const out: Position[] = [];
  markets.forEach((m, i) => {
    const s = stakes[i];
    if (!s || (s.yes === 0n && s.no === 0n)) return;

    const claimable = s.claimed ? 0n : claimablePayout(m, s.yes, s.no);

    let status: Position["status"];
    if (s.claimed) status = "Claimed";
    else if (m.status === MarketStatus.Void) status = "Refundable";
    else if (m.status === MarketStatus.Settled) {
      status = claimable > 0n ? "Won" : "Lost";
    } else if (m.status === MarketStatus.SettlementRequested) {
      status = "Awaiting settlement";
    } else status = "Open";

    out.push({ market: m, yes: s.yes, no: s.no, claimed: s.claimed, claimable, status });
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
    { staked: bigint; perMarket: Map<number, { yes: bigint; no: bigint }> }
  >();

  for (const e of stakes) {
    let rec = byUser.get(e.user);
    if (!rec) {
      rec = { staked: 0n, perMarket: new Map() };
      byUser.set(e.user, rec);
    }
    rec.staked += e.amount;
    let pm = rec.perMarket.get(e.marketId);
    if (!pm) {
      pm = { yes: 0n, no: 0n };
      rec.perMarket.set(e.marketId, pm);
    }
    if (e.isYes) pm.yes += e.amount;
    else pm.no += e.amount;
  }

  const marketById = new Map(markets.map((m) => [m.id, m]));
  const out: TraderStats[] = [];

  for (const [address, rec] of byUser) {
    let profit = 0n;
    let wins = 0;
    let settledMarkets = 0;

    for (const [marketId, pm] of rec.perMarket) {
      const m = marketById.get(marketId);
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
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [ms, se, sv] = await Promise.all([
        readMarkets(),
        readStakeEvents(),
        readSettledEvents(),
      ]);
      setMarkets(ms);
      setStakeEvents(se);
      setSettledEvents(sv);

      if (account) {
        const [stakes, bal, allow] = await Promise.all([
          readWalletStakes(account, ms.length),
          readTokenBalance(account),
          readAllowance(account),
        ]);
        setPositions(derivePositions(ms, stakes));
        setBalance(bal);
        setAllowance(allow);
      } else {
        setPositions([]);
        setBalance(0n);
        setAllowance(0n);
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
    allowance,
    loading,
    error,
    refresh,
  };
}
