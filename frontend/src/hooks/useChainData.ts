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

export function derivePositions(
  markets: Market[],
  stakes: Map<string, { yes: bigint; no: bigint; claimed: boolean }>,
  /**
   * Trades by this wallet, needed only to price AMM positions: the contract
   * records the shares you hold, not what you paid for them, and a sale
   * returns collateral without leaving a trace in the balance.
   */
  trades: StakeEvent[] = [],
  account: Address | null = null,
): Position[] {
  const netInByMarket = new Map<string, bigint>();
  for (const e of trades) {
    if (!e.amm) continue;
    if (account && e.user.toLowerCase() !== account.toLowerCase()) continue;
    const sign = e.amm.direction === "buy" ? 1n : -1n;
    netInByMarket.set(e.marketKey, (netInByMarket.get(e.marketKey) ?? 0n) + sign * e.amount);
  }

  const out: Position[] = [];
  markets.forEach((m) => {
    const s = stakes.get(m.key);
    if (!s || (s.yes === 0n && s.no === 0n)) return;

    const entitlement = claimablePayout(m, s.yes, s.no);
    const claimable = s.claimed ? 0n : entitlement;
    const cost = m.categoryId === "amm" ? (netInByMarket.get(m.key) ?? 0n) : s.yes + s.no;

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
      cost,
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
  /**
   * Per market, per trader: the position held and the money that changed
   * hands.
   *
   * Parimutuel and AMM cannot share one accumulator. In a parimutuel market
   * your stake IS your position, so one number does both jobs. In an AMM they
   * are different quantities in different units — collateral spent versus
   * shares held — and a sell moves them in opposite directions: the position
   * shrinks while cash comes back. Adding a sell to "staked" would report
   * someone who bought and sold as having risked twice as much as they did.
   */
  type Book = {
    /** Shares held (AMM) or collateral staked (parimutuel), per side. */
    yes: bigint;
    no: bigint;
    /** Net collateral put in: buys and stakes less anything sold back. */
    netIn: bigint;
    isAmm: boolean;
  };

  const byUser = new Map<Address, { staked: bigint; perMarket: Map<string, Book> }>();

  for (const e of stakes) {
    let rec = byUser.get(e.user);
    if (!rec) {
      rec = { staked: 0n, perMarket: new Map() };
      byUser.set(e.user, rec);
    }

    let book = rec.perMarket.get(e.marketKey);
    if (!book) {
      book = { yes: 0n, no: 0n, netIn: 0n, isAmm: e.amm !== undefined };
      rec.perMarket.set(e.marketKey, book);
    }

    if (e.amm) {
      const sign = e.amm.direction === "buy" ? 1n : -1n;
      if (e.isYes) book.yes += sign * e.amm.shares;
      else book.no += sign * e.amm.shares;
      book.netIn += sign * e.amount;
      // Capital at risk is what is still in, so a sale returns it.
      rec.staked += sign * e.amount;
    } else {
      if (e.isYes) book.yes += e.amount;
      else book.no += e.amount;
      book.netIn += e.amount;
      rec.staked += e.amount;
    }
  }

  // Keyed by composite key, not id: flight 0 and crypto 0 are different
  // markets and must not collapse into one another here.
  const marketByKey = new Map(markets.map((m) => [m.key, m]));
  const out: TraderStats[] = [];

  for (const [address, rec] of byUser) {
    let profit = 0n;
    let wins = 0;
    let settledMarkets = 0;

    for (const [key, book] of rec.perMarket) {
      const m = marketByKey.get(key);
      if (!m) continue;
      const isResolved = m.status === MarketStatus.Settled || m.status === MarketStatus.Void;
      if (!isResolved) continue;

      settledMarkets += 1;
      // Profit is redemption value less net cash in — which for an AMM already
      // nets off anything sold back before expiry, so a position closed early
      // scores its realised result rather than nothing.
      const payout = claimablePayout(m, book.yes, book.no);
      profit += payout - book.netIn;
      // A void refunds rather than resolving, so it counts as neither win nor loss.
      if (m.status === MarketStatus.Settled && payout > book.netIn) wins += 1;
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
        setPositions(derivePositions(ms, stakes, se ?? [], account));
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
