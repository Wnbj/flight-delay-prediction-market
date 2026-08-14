import { MarketStatus, Outcome, type Market, type Side } from "./types";

/**
 * Parimutuel maths, deliberately mirroring FlightMarket.sol.
 *
 * IMPORTANT — this market is parimutuel, not an order book. There is no "share
 * price" you lock in at entry: your payout is your fraction of the winning pool
 * multiplied by the whole pot, computed at settlement. So a percentage here is
 * a *current implied probability*, never a price you bought at, and any payout
 * figure is an estimate that moves whenever anyone else stakes.
 *
 * All arithmetic uses bigint with truncating division so displayed figures
 * match what `claim()` actually transfers, down to the last unit.
 */

/** Current implied probability of Yes, 0–100. Null when nothing is staked yet. */
export function impliedYesPercent(m: Market): number | null {
  const total = m.yesPool + m.noPool;
  if (total === 0n) return null;
  return Number((m.yesPool * 10000n) / total) / 100;
}

/** Total staked across both sides. */
export function totalPool(m: Market): bigint {
  return m.yesPool + m.noPool;
}

/**
 * A one-sided book cannot pay out — FlightMarket voids it at settlement
 * regardless of the outcome the DON agrees on. Worth surfacing in the UI
 * before someone stakes into a market that can only refund.
 */
export function isOneSided(m: Market): boolean {
  const total = totalPool(m);
  return total > 0n && (m.yesPool === 0n || m.noPool === 0n);
}

export function isOpenForStaking(m: Market, nowSeconds: number): boolean {
  return m.status === MarketStatus.Open && nowSeconds < m.closeTime;
}

export function canRequestSettlement(m: Market, nowSeconds: number): boolean {
  return (
    (m.status === MarketStatus.Open || m.status === MarketStatus.Locked) &&
    nowSeconds >= m.settleAfter
  );
}

export interface PayoutEstimate {
  /** Gross tokens returned if this side wins. */
  payout: bigint;
  /** payout - stake. Negative is impossible here (payout >= stake when you win). */
  profit: bigint;
  /**
   * True when the stake would leave the book one-sided, meaning the only
   * possible result is a refund rather than a win.
   */
  refundOnly: boolean;
}

/**
 * What staking `amount` on `side` would return **if that side wins**, given the
 * pools as they stand right now. Other stakes landing afterwards will change it.
 */
export function estimatePayout(
  m: Market,
  side: Side,
  amount: bigint,
): PayoutEstimate | null {
  if (amount <= 0n) return null;

  const yesPool = side === "yes" ? m.yesPool + amount : m.yesPool;
  const noPool = side === "no" ? m.noPool + amount : m.noPool;
  const total = yesPool + noPool;
  const winningPool = side === "yes" ? yesPool : noPool;
  const losingPool = side === "yes" ? noPool : yesPool;

  // Contract voids a one-sided book: everyone is refunded their own stake.
  if (losingPool === 0n) {
    return { payout: amount, profit: 0n, refundOnly: true };
  }

  const payout = (amount * total) / winningPool;
  return { payout, profit: payout - amount, refundOnly: false };
}

/**
 * Exactly what `claim()` would transfer to a holder of these stakes.
 * Mirrors FlightMarket.claim, including its truncating division.
 */
export function claimablePayout(
  m: Market,
  yesStake: bigint,
  noStake: bigint,
): bigint {
  if (m.status === MarketStatus.Void) {
    return yesStake + noStake;
  }
  if (m.status !== MarketStatus.Settled) {
    return 0n;
  }
  const total = m.yesPool + m.noPool;
  if (m.outcome === Outcome.Yes) {
    if (m.yesPool === 0n) return 0n;
    return (yesStake * total) / m.yesPool;
  }
  if (m.outcome === Outcome.No) {
    if (m.noPool === 0n) return 0n;
    return (noStake * total) / m.noPool;
  }
  return 0n;
}

export function outcomeLabel(o: Outcome): string {
  switch (o) {
    case Outcome.Yes:
      return "Yes";
    case Outcome.No:
      return "No";
    case Outcome.Void:
      return "Void";
    default:
      return "—";
  }
}

export function statusLabel(s: MarketStatus): string {
  switch (s) {
    case MarketStatus.Open:
      return "Open";
    case MarketStatus.Locked:
      return "Locked";
    case MarketStatus.SettlementRequested:
      return "Settling";
    case MarketStatus.Settled:
      return "Settled";
    case MarketStatus.Void:
      return "Void";
    default:
      return "Unknown";
  }
}
