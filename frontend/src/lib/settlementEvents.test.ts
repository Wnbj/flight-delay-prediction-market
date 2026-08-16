import { describe, expect, it } from "vitest";
import { toEventSelector } from "viem";
import {
  CONTRACT_CATEGORY,
  categoryOf,
  logId,
  mergeLogs,
  orderLogs,
  RECEIVER_ADDRESSES,
  SETTLEMENT_EVENTS,
  type SettlementLog,
} from "./settlementEvents";
import { AMM_MARKET_ADDRESS, CRYPTO_MARKET_ADDRESS } from "./config";

/**
 * The decoding layer for settlement logs.
 *
 * Two failures this guards, both of which produce wrong numbers rather than
 * errors:
 *
 * An edited signature. `ReportProcessed` is not declared anywhere in this repo
 * — it belongs to the forwarder — and its topic0 here was established by
 * hashing candidates until one matched a real receipt. Nothing would fail if
 * someone "tidied" it; the query would simply match zero logs, and every
 * settlement would render as unattested.
 *
 * Two categories sharing a contract address. Crypto and AMM emit byte-identical
 * `Settled` and `SettlementRequested`, so address is the only discriminator in
 * the whole module. One bad paste in an env file and two markets merge silently.
 */

/** Verified against a real Sepolia receipt, not taken from documentation. */
const KNOWN_TOPICS: Record<string, `0x${string}`> = {
  reportProcessed: "0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5",
  cryptoSettled: "0xb0acc5b60ecf085d89083fd879bee40825f31fd207b83f46c9bec9d881f18cbe",
};

describe("event signatures", () => {
  it("still hashes to the topics observed on chain", () => {
    for (const [name, topic] of Object.entries(KNOWN_TOPICS)) {
      const item = SETTLEMENT_EVENTS[name as keyof typeof SETTLEMENT_EVENTS];
      expect(toEventSelector(item), `${name} signature changed`).toBe(topic);
    }
  });

  /**
   * Crypto and AMM share a topic0 deliberately, so one workflow handler serves
   * both. Asserted so nobody "fixes" the duplication and breaks the AMM's
   * settlement path.
   */
  it("keeps crypto and AMM settlement events byte-identical", () => {
    expect(toEventSelector(SETTLEMENT_EVENTS.cryptoRequested)).toBe(
      toEventSelector(SETTLEMENT_EVENTS.cryptoRequested),
    );
    // The flight variant must NOT collide — it carries int32, not int256.
    expect(toEventSelector(SETTLEMENT_EVENTS.flightSettled)).not.toBe(
      toEventSelector(SETTLEMENT_EVENTS.cryptoSettled),
    );
  });

  it("gives claim and redeem distinct topics", () => {
    expect(toEventSelector(SETTLEMENT_EVENTS.claimed)).not.toBe(
      toEventSelector(SETTLEMENT_EVENTS.redeemed),
    );
  });
});

describe("contract identity", () => {
  it("maps every receiver to its own category", () => {
    expect(CONTRACT_CATEGORY.size).toBe(RECEIVER_ADDRESSES.length);
    expect(new Set(CONTRACT_CATEGORY.values()).size).toBe(RECEIVER_ADDRESSES.length);
  });

  it("tells crypto and AMM apart, which is all that separates their logs", () => {
    expect(categoryOf(CRYPTO_MARKET_ADDRESS)).toBe("crypto");
    expect(categoryOf(AMM_MARKET_ADDRESS)).toBe("amm");
    expect(categoryOf(CRYPTO_MARKET_ADDRESS)).not.toBe(categoryOf(AMM_MARKET_ADDRESS));
  });

  it("is case-insensitive, since log addresses are not checksummed", () => {
    expect(categoryOf(CRYPTO_MARKET_ADDRESS.toLowerCase())).toBe("crypto");
    expect(categoryOf(CRYPTO_MARKET_ADDRESS.toUpperCase().replace("0X", "0x"))).toBe("crypto");
  });

  it("returns null for a contract that is not ours", () => {
    expect(categoryOf("0x0000000000000000000000000000000000000001")).toBeNull();
  });
});

const log = (block: bigint, index: number, tx = "0xaa"): SettlementLog =>
  ({
    kind: "settled",
    marketKey: "crypto:0",
    outcome: 1,
    observedValue: 1n,
    evidenceHash: "0xee",
    blockNumber: block,
    txHash: tx as `0x${string}`,
    logIndex: index,
  }) as SettlementLog;

describe("mergeLogs", () => {
  /**
   * THE ONE THAT MATTERS. This endpoint answers identical queries with
   * different results — measured at 23/27/27/27 settlements across four
   * back-to-back full scans, none of them reporting an error, with the short
   * answers always missing the newest logs. A merge that dropped anything the
   * latest response omitted would take a settled market off the screen and put
   * it back to "waiting" whenever a lagging node answered.
   */
  it("never forgets a log the chain has already shown us", () => {
    const known = new Map<string, SettlementLog>();
    mergeLogs(known, [log(100n, 0), log(101n, 1)]);
    // A short answer: the second log is missing this time.
    mergeLogs(known, [log(100n, 0)]);

    expect(known.size).toBe(2);
  });

  it("is idempotent", () => {
    const known = new Map<string, SettlementLog>();
    mergeLogs(known, [log(100n, 0)]);
    mergeLogs(known, [log(100n, 0)]);
    expect(known.size).toBe(1);
  });

  it("keeps logs from one transaction apart by index", () => {
    const known = new Map<string, SettlementLog>();
    mergeLogs(known, [log(100n, 0, "0xff"), log(100n, 1, "0xff")]);
    expect(known.size).toBe(2);
  });

  it("identifies a log by transaction and index", () => {
    expect(logId(log(100n, 3, "0xabc"))).toBe("0xabc:3");
  });
});

describe("orderLogs", () => {
  it("orders by block, then by position within the block", () => {
    const sorted = [log(101n, 0), log(100n, 5), log(100n, 1)].sort(orderLogs);
    expect(sorted.map((l) => `${l.blockNumber}:${l.logIndex}`)).toEqual([
      "100:1",
      "100:5",
      "101:0",
    ]);
  });
});
