import { describe, expect, it } from "vitest";
import { derivePositions, deriveTraders } from "./useChainData";
import { MarketStatus, Outcome, type Market, type StakeEvent } from "../lib/types";
import { crypto0, flight0, stock0 } from "../lib/identity.test";

/**
 * Portfolio and leaderboard derivation.
 *
 * Both walk stakes against markets, and both must key off the composite market
 * key. Market ids restart at zero in every contract, so keying by id would let
 * a stake on flight 0 pay out against crypto 0 — a wrong balance shown to a
 * user about their own money.
 */

const alice = "0x00000000000000000000000000000000000a11ce" as const;
const bob = "0x0000000000000000000000000000000000000b0b" as const;

const stake = (marketKey: string, user: string, isYes: boolean, amount: bigint): StakeEvent => ({
  marketKey,
  user: user as `0x${string}`,
  isYes,
  amount,
  blockNumber: 1n,
  txHash: `0x${"0".repeat(64)}`,
});

const resolved = (m: Market, outcome: Outcome, yesPool: bigint, noPool: bigint): Market =>
  ({
    ...m,
    status: outcome === Outcome.Void ? MarketStatus.Void : MarketStatus.Settled,
    outcome,
    yesPool,
    noPool,
  }) as Market;

describe("derivePositions", () => {
  it("attaches each stake to its own market when ids collide", () => {
    const markets = [flight0, crypto0, stock0];
    const stakes = new Map([
      [flight0.key, { yes: 1_000_000n, no: 0n, claimed: false }],
      [stock0.key, { yes: 0n, no: 5_000_000n, claimed: false }],
    ]);

    const positions = derivePositions(markets, stakes);

    expect(positions).toHaveLength(2);
    expect(positions.map((p) => p.market.key).sort()).toEqual([flight0.key, stock0.key]);
    // The crypto market shares flight's numeric id and must not pick up its stake.
    expect(positions.find((p) => p.market.categoryId === "crypto")).toBeUndefined();
    expect(positions.find((p) => p.market.key === stock0.key)?.no).toBe(5_000_000n);
  });

  it("skips markets the wallet never staked on", () => {
    const stakes = new Map([[flight0.key, { yes: 0n, no: 0n, claimed: false }]]);
    expect(derivePositions([flight0], stakes)).toHaveLength(0);
  });

  /**
   * Claiming must not erase the record of having won. `claimable` goes to zero
   * because there is nothing left to collect, but `entitlement` is what P&L is
   * measured against — netting off claimed positions reported a winning wallet
   * as flat.
   */
  it("keeps entitlement after a claim, while claimable drops to zero", () => {
    const m = resolved(flight0, Outcome.Yes, 1_000_000n, 3_000_000n);
    const stakes = new Map([[m.key, { yes: 1_000_000n, no: 0n, claimed: true }]]);

    const [p] = derivePositions([m], stakes);

    expect(p!.status).toBe("Claimed");
    expect(p!.claimable).toBe(0n);
    expect(p!.entitlement).toBe(4_000_000n);
  });

  it("labels a losing position Lost, not Open", () => {
    const m = resolved(flight0, Outcome.No, 1_000_000n, 3_000_000n);
    const stakes = new Map([[m.key, { yes: 1_000_000n, no: 0n, claimed: false }]]);
    const [p] = derivePositions([m], stakes);
    expect(p!.status).toBe("Lost");
    expect(p!.claimable).toBe(0n);
  });

  it("labels a void position Refundable even though the market never resolved", () => {
    const m = resolved(crypto0, Outcome.Void, 1_000_000n, 1_000_000n);
    const stakes = new Map([[m.key, { yes: 1_000_000n, no: 0n, claimed: false }]]);
    const [p] = derivePositions([m], stakes);
    expect(p!.status).toBe("Refundable");
    expect(p!.claimable).toBe(1_000_000n);
  });

  it("distinguishes awaiting settlement from still open", () => {
    const stakes = new Map([[flight0.key, { yes: 1_000_000n, no: 0n, claimed: false }]]);
    expect(derivePositions([flight0], stakes)[0]!.status).toBe("Open");

    const requested = { ...flight0, status: MarketStatus.SettlementRequested } as Market;
    expect(derivePositions([requested], stakes)[0]!.status).toBe("Awaiting settlement");
  });
});

describe("deriveTraders", () => {
  /**
   * Parimutuel is zero-sum by construction: the winners split exactly what the
   * losers put in. If the leaderboard does not sum to zero, it is
   * double-counting or losing a stake somewhere.
   */
  it("is zero-sum across a settled market", () => {
    const m = resolved(flight0, Outcome.Yes, 1_000_000n, 3_000_000n);
    const traders = deriveTraders(
      [m],
      [stake(m.key, alice, true, 1_000_000n), stake(m.key, bob, false, 3_000_000n)],
    );

    expect(traders.reduce((sum, t) => sum + t.profit, 0n)).toBe(0n);
    expect(traders.find((t) => t.address === alice)?.profit).toBe(3_000_000n);
    expect(traders.find((t) => t.address === bob)?.profit).toBe(-3_000_000n);
  });

  it("counts a void as neither a win nor a loss", () => {
    const m = resolved(crypto0, Outcome.Void, 1_000_000n, 1_000_000n);
    const [t] = deriveTraders([m], [stake(m.key, alice, true, 1_000_000n)]);

    expect(t!.settledMarkets).toBe(1);
    expect(t!.wins).toBe(0);
    expect(t!.profit).toBe(0n);
  });

  it("ignores markets that have not resolved", () => {
    const [t] = deriveTraders([flight0], [stake(flight0.key, alice, true, 1_000_000n)]);
    expect(t!.settledMarkets).toBe(0);
    expect(t!.profit).toBe(0n);
    // The stake still counts as capital committed, even unresolved.
    expect(t!.staked).toBe(1_000_000n);
  });

  /**
   * The same numeric id in two contracts, one won and one lost. Keyed by id
   * these would collapse together and report a single wrong figure.
   */
  it("does not merge same-id markets from different contracts", () => {
    const won = resolved(flight0, Outcome.Yes, 1_000_000n, 1_000_000n);
    const lost = resolved(crypto0, Outcome.No, 1_000_000n, 1_000_000n);

    const [t] = deriveTraders(
      [won, lost],
      [stake(won.key, alice, true, 1_000_000n), stake(lost.key, alice, true, 1_000_000n)],
    );

    expect(t!.settledMarkets).toBe(2);
    expect(t!.wins).toBe(1);
    // +1 on the won market, -1 on the lost one.
    expect(t!.profit).toBe(0n);
  });

  it("sorts by profit, best first", () => {
    const m = resolved(flight0, Outcome.Yes, 1_000_000n, 3_000_000n);
    const traders = deriveTraders(
      [m],
      [stake(m.key, alice, true, 1_000_000n), stake(m.key, bob, false, 3_000_000n)],
    );
    expect(traders[0]!.address).toBe(alice);
  });
});
