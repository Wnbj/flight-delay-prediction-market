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

/**
 * Current implied probability of Yes, 0–100. Null when nothing is staked yet.
 *
 * An AMM market is read from its quoted price, NOT from its reserves. In a
 * constant-product pool the price of YES is the *opposite* reserve over the
 * total — the scarcer YES is, the dearer it is — so applying the parimutuel
 * ratio to those numbers reports the odds exactly inverted.
 */
export function impliedYesPercent(m: Market): number | null {
  if (m.categoryId === "amm") return m.yesPriceBps / 100;
  const total = m.yesPool + m.noPool;
  if (total === 0n) return null;
  return Number((m.yesPool * 10000n) / total) / 100;
}

/**
 * The money actually at stake.
 *
 * For an AMM that is the collateral, not the sum of the reserves: one unit of
 * collateral mints one YES *and* one NO, so adding the two reserves counts the
 * same money twice.
 */
export function totalPool(m: Market): bigint {
  if (m.categoryId === "amm") return m.collateral;
  return m.yesPool + m.noPool;
}

/**
 * A one-sided book cannot pay out — FlightMarket voids it at settlement
 * regardless of the outcome the DON agrees on. Worth surfacing in the UI
 * before someone stakes into a market that can only refund.
 */
export function isOneSided(m: Market): boolean {
  // An AMM market has no such failure: every share is individually
  // collateralised, so it settles correctly even with no trades at all.
  if (m.categoryId === "amm") return false;
  const total = m.yesPool + m.noPool;
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
  // AMM shares are worth one unit each if they win — no proportional split,
  // because each was collateralised individually when it was minted. A void
  // pays half a unit per share either side, which is the only division that
  // stays solvent when one unit of collateral backs one share of each side.
  if (m.categoryId === "amm") {
    if (m.status === MarketStatus.Void) return (yesStake + noStake) / 2n;
    if (m.status !== MarketStatus.Settled) return 0n;
    if (m.outcome === Outcome.Yes) return yesStake;
    if (m.outcome === Outcome.No) return noStake;
    return 0n;
  }

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
