import { describe, expect, it } from "vitest";
import {
  claimablePayout,
  estimatePayout,
  impliedYesPercent,
  isOneSided,
  totalPool,
} from "./parimutuel";
import { MarketStatus, Outcome, type Market } from "./types";
import { crypto0 } from "./identity.test";

/**
 * The payout maths the UI shows before anyone signs anything.
 *
 * `claimablePayout` mirrors the contract's `claim()`, truncating division and
 * all. If it drifts from the contract, the app promises a number the chain
 * will not pay — so the tests below are written against the contract's rules,
 * not against the function's current behaviour.
 */

const market = (over: Partial<Market>): Market => ({ ...crypto0, ...over }) as Market;

const settled = (outcome: Outcome, yesPool: bigint, noPool: bigint) =>
  market({ status: MarketStatus.Settled, outcome, yesPool, noPool });

describe("claimablePayout", () => {
  it("pays the winning side its share of the whole pot", () => {
    // Yes pool 1, No pool 3, pot 4. A sole Yes staker takes everything.
    expect(claimablePayout(settled(Outcome.Yes, 1_000_000n, 3_000_000n), 1_000_000n, 0n)).toBe(
      4_000_000n,
    );
  });

  it("pays a loser nothing, whatever they staked", () => {
    expect(claimablePayout(settled(Outcome.No, 1_000_000n, 3_000_000n), 1_000_000n, 0n)).toBe(0n);
  });

  it("splits proportionally between winners on the same side", () => {
    const m = settled(Outcome.Yes, 4_000_000n, 4_000_000n);
    const a = claimablePayout(m, 1_000_000n, 0n);
    const b = claimablePayout(m, 3_000_000n, 0n);
    expect(a).toBe(2_000_000n);
    expect(b).toBe(6_000_000n);
    expect(a + b).toBe(totalPool(m));
  });

  it("refunds both sides on a void, regardless of outcome", () => {
    const m = market({ status: MarketStatus.Void, outcome: Outcome.Yes });
    expect(claimablePayout(m, 700_000n, 300_000n)).toBe(1_000_000n);
  });

  it("pays nothing while the market is unresolved", () => {
    for (const status of [
      MarketStatus.Open,
      MarketStatus.Locked,
      MarketStatus.SettlementRequested,
    ]) {
      expect(claimablePayout(market({ status }), 1_000_000n, 0n)).toBe(0n);
    }
  });

  /**
   * A settled market whose winning pool is empty would divide by zero on
   * chain, so the contract cannot reach that state — but the UI reads chain
   * data it does not control and must not crash on it.
   */
  it("returns zero rather than dividing by an empty winning pool", () => {
    expect(claimablePayout(settled(Outcome.Yes, 0n, 3_000_000n), 0n, 1_000_000n)).toBe(0n);
    expect(claimablePayout(settled(Outcome.No, 3_000_000n, 0n), 1_000_000n, 0n)).toBe(0n);
  });

  /**
   * Solvency: the contract can only ever pay out what it holds. Truncating
   * division must always round in the pot's favour, never against it.
   */
  it("never pays out more than the pot, across awkward splits", () => {
    for (const yesPool of [1n, 7n, 999_999n, 1_000_001n, 3_333_333n]) {
      for (const noPool of [1n, 13n, 1_000_000n, 7_777_777n]) {
        const m = settled(Outcome.Yes, yesPool, noPool);
        // One winner holding the entire winning pool is the largest single claim.
        expect(claimablePayout(m, yesPool, 0n)).toBeLessThanOrEqual(yesPool + noPool);
      }
    }
  });

  it("splits three uneven winners without exceeding the pot", () => {
    const m = settled(Outcome.Yes, 1_000_003n, 5_000_000n);
    const stakes = [333_334n, 333_334n, 333_335n];
    const paid = stakes.reduce((sum, s) => sum + claimablePayout(m, s, 0n), 0n);
    expect(paid).toBeLessThanOrEqual(totalPool(m));
  });
});

describe("estimatePayout", () => {
  it("accounts for the stake being added to its own side", () => {
    // Staking 1 on Yes with pools 1/2 makes it 2/2: pot 4, half the Yes pool.
    const e = estimatePayout(market({ yesPool: 1_000_000n, noPool: 2_000_000n }), "yes", 1_000_000n);
    expect(e?.payout).toBe(2_000_000n);
    expect(e?.profit).toBe(1_000_000n);
  });

  /**
   * Staking into an empty book cannot win — the contract voids a one-sided
   * market — so promising a multiple would be a lie the chain refuses to pay.
   */
  it("reports refund-only when the other side is empty", () => {
    const e = estimatePayout(market({ yesPool: 0n, noPool: 0n }), "yes", 1_000_000n);
    expect(e).toEqual({ payout: 1_000_000n, profit: 0n, refundOnly: true });
  });

  it("rejects a non-positive amount rather than guessing", () => {
    expect(estimatePayout(market({}), "yes", 0n)).toBeNull();
    expect(estimatePayout(market({}), "yes", -1n)).toBeNull();
  });
});

describe("impliedYesPercent", () => {
  it("is null with no stakes, rather than a misleading 50%", () => {
    expect(impliedYesPercent(market({ yesPool: 0n, noPool: 0n }))).toBeNull();
  });

  it("reads the pools as a probability", () => {
    expect(impliedYesPercent(market({ yesPool: 3_000_000n, noPool: 1_000_000n }))).toBe(75);
    expect(impliedYesPercent(market({ yesPool: 1_000_000n, noPool: 1_000_000n }))).toBe(50);
  });
});

describe("isOneSided", () => {
  it("flags a book that can only void", () => {
    expect(isOneSided(market({ yesPool: 1_000_000n, noPool: 0n }))).toBe(true);
    expect(isOneSided(market({ yesPool: 0n, noPool: 1_000_000n }))).toBe(true);
  });

  it("does not flag an empty book, which nobody has committed to yet", () => {
    expect(isOneSided(market({ yesPool: 0n, noPool: 0n }))).toBe(false);
  });

  it("does not flag a two-sided book", () => {
    expect(isOneSided(market({ yesPool: 1n, noPool: 1n }))).toBe(false);
  });
});
