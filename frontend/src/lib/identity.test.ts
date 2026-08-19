import { describe, expect, it } from "vitest";
import { contractFor, marketKey } from "./chain";
import { buildPath, KNOWN_PATHS, parse } from "./router";
import type { View } from "./view";
import { CATEGORIES, LIVE_CATEGORIES } from "./categories";
import {
  AMM_MARKET_ADDRESS,
  CRYPTO_MARKET_ADDRESS,
  FLIGHT_MARKET_ADDRESS,
  RESERVE_MARKET_ADDRESS,
  STOCK_MARKET_ADDRESS,
  attestationFor,
  DON_FORWARDER,
  MOCK_FORWARDER,
} from "./config";
import { MarketStatus, Outcome, type Market } from "./types";

/**
 * The identity layer: which contract a market belongs to, and how a market is
 * named across the app.
 *
 * This file exists because of a real bug. `sendStake` branched on
 * `categoryId === "crypto"` with the flight contract as the else, so when a
 * third category arrived every stock write was delivered to FlightMarket. Ids
 * restart at zero in each contract, so it landed on a real but unrelated
 * market. It passed typecheck, passed build, passed manual browser testing,
 * and was caught by a user clicking Stake.
 *
 * Nothing here needs a chain or a wallet — it is all pure routing logic, which
 * is exactly why leaving it untested was indefensible.
 *
 * Addresses come from config rather than being written out here. The property
 * under test is that each category reaches its OWN contract, not that any
 * particular string was deployed — pinning the literals made a redeploy break
 * these tests for no reason that mattered.
 */

const base = {
  closeTime: 2_000_000_000,
  settleAfter: 2_000_003_600,
  status: MarketStatus.Open,
  outcome: Outcome.Unset,
  evidenceHash: `0x${"0".repeat(64)}` as `0x${string}`,
  yesPool: 1_000_000n,
  noPool: 1_000_000n,
};

/** Same numeric id in every contract — the collision the key exists for. */
export const flight0: Market = {
  ...base,
  id: 0,
  key: marketKey("flights", 0),
  contract: FLIGHT_MARKET_ADDRESS,
  categoryId: "flights",
  question: "Will AA100 arrive 30m+ late?",
  flightIata: "AA100",
  departureDate: 20260817,
  thresholdMinutes: 30,
  observedDelay: 0,
};

export const crypto0: Market = {
  ...base,
  id: 0,
  key: marketKey("crypto", 0),
  contract: CRYPTO_MARKET_ADDRESS,
  categoryId: "crypto",
  question: "Will BTC be at or above $63,000?",
  asset: "BTC",
  strikePrice: 6_300_000_000_000n,
  expiryTime: 2_000_003_000,
  observedPrice: 0n,
};

export const stock0: Market = {
  ...base,
  id: 0,
  key: marketKey("stocks", 0),
  contract: STOCK_MARKET_ADDRESS,
  categoryId: "stocks",
  question: "Will CSPX be at or above $840?",
  symbol: "CSPX",
  feed: "0x4b531A318B0e44B549F3b2f824721b3D0d51930A",
  strikePrice: 84_000_000_000n,
  expiryTime: 2_000_003_000,
  maxStaleness: 100_000,
  observedPrice: 0n,
};

export const reserve0: Market = {
  ...base,
  id: 0,
  key: marketKey("reserves", 0),
  contract: RESERVE_MARKET_ADDRESS,
  categoryId: "reserves",
  question: "Will stETH reserves be at or above 9,000,000?",
  symbol: "STETH",
  feed: "0x8328e01902A47942Eecb9DBF97d6bF9dd3bd07E6",
  strikePrice: 900_000_000_000_000n,
  expiryTime: 2_000_003_000,
  maxStaleness: 172_800,
  observedPrice: 0n,
};

export const amm0: Market = {
  ...base,
  id: 0,
  key: marketKey("amm", 0),
  contract: AMM_MARKET_ADDRESS,
  categoryId: "amm",
  question: "AMM: will BTC be at or above $63,000?",
  asset: "BTC",
  strikePrice: 6_300_000_000_000n,
  expiryTime: 2_000_003_000,
  yesPriceBps: 6_282,
  yesReserve: 7_692_308n,
  noReserve: 13_000_000n,
  collateral: 13_000_000n,
  creator: "0xEe7b1Bf33f5aa65c7294bAa81EbcD89f732DB90a",
  // The seed was 10 mUSDC, denominated 1:1 in LP shares at creation.
  totalLpShares: 10_000_000n,
  feeBps: 30,
  observedPrice: 0n,
};

const all = [flight0, crypto0, stock0, reserve0, amm0];

describe("contractFor", () => {
  it("routes every market to the contract it was read from", () => {
    for (const m of all) {
      expect(contractFor(m).address.toLowerCase()).toBe(m.contract.toLowerCase());
    }
  });

  /**
   * The regression test proper. Before the fix this was the failure: three
   * markets, three categories, but only two distinct destinations, because
   * anything not crypto fell through to flights.
   */
  it("gives every category its own distinct destination", () => {
    const destinations = new Set(all.map((m) => contractFor(m).address.toLowerCase()));
    expect(destinations.size).toBe(all.length);
  });

  it("never sends a non-flight market to the flight contract", () => {
    const flightAddress = contractFor(flight0).address.toLowerCase();
    for (const m of [crypto0, stock0, reserve0, amm0]) {
      expect(contractFor(m).address.toLowerCase()).not.toBe(flightAddress);
    }
  });
});

describe("marketKey", () => {
  it("distinguishes the same id across contracts", () => {
    const keys = all.map((m) => m.key);
    expect(new Set(keys).size).toBe(all.length);
  });

  it("is what identifies a market, not the bare id", () => {
    expect(flight0.id).toBe(crypto0.id);
    expect(flight0.key).not.toBe(crypto0.key);
  });
});

describe("category registry", () => {
  /**
   * A category marked live with no contract behind it renders an empty tab;
   * one backed by a contract but not marked live hides real markets.
   */
  it("marks exactly the categories that have markets as live", () => {
    const live = LIVE_CATEGORIES.map((c) => c.id).sort();
    expect(live).toEqual(["amm", "crypto", "flights", "reserves", "stocks"]);
  });

  it("has no duplicate ids", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("URL round trip", () => {
  it("survives a detail URL for every category", () => {
    for (const m of all) {
      const path = buildPath({ view: "detail", selectedKey: m.key, categoryFilter: "all" });
      const [pathname, search = ""] = path.split("?");
      expect(parse(pathname!, search).selectedKey).toBe(m.key);
    }
  });

  it("puts the category in the path, so ids cannot collide across contracts", () => {
    expect(buildPath({ view: "detail", selectedKey: flight0.key, categoryFilter: "all" })).toBe(
      "/markets/flights/0",
    );
    expect(buildPath({ view: "detail", selectedKey: stock0.key, categoryFilter: "all" })).toBe(
      "/markets/stocks/0",
    );
  });

  it("keeps the category filter across a markets-list round trip", () => {
    const path = buildPath({ view: "markets", selectedKey: null, categoryFilter: "stocks" });
    const [pathname, search = ""] = path.split("?");
    expect(parse(pathname!, search).categoryFilter).toBe("stocks");
  });

  it("falls back to landing on an unknown path rather than throwing", () => {
    expect(parse("/nonsense", "").view).toBe("landing");
  });
});

/**
 * Registering a route touches six places and the compiler guards five of them:
 * the `View` union, the `buildPath` switch (defaultless, so it fails to compile
 * without a case), the `parse` branch, the nav entry and the render block.
 *
 * The sixth is the address-bar correction that runs once on mount. Forgetting
 * it does not fail anything — it silently rewrites a deep link to `/`, which
 * looks exactly like the link being wrong. So it is asserted here instead.
 */
describe("route registration", () => {
  const VIEWS: View[] = ["landing", "markets", "detail", "portfolio", "leaderboard", "live"];

  it("survives a round trip for every top-level view", () => {
    for (const view of VIEWS) {
      if (view === "detail") continue; // needs a market key; covered above
      const path = buildPath({ view, selectedKey: null, categoryFilter: "all" });
      const [pathname, search = ""] = path.split("?");
      expect(parse(pathname!, search).view).toBe(view);
    }
  });

  it("recognises every view's own path as one the app owns", () => {
    for (const view of VIEWS) {
      const path = buildPath({ view, selectedKey: "crypto:0", categoryFilter: "all" });
      if (path === "/") continue; // the landing page is the fallback itself
      expect(KNOWN_PATHS.test(path), `${view} -> ${path} would be rewritten to /`).toBe(true);
    }
  });
});

/**
 * The one place this app could lie about its own trust model.
 *
 * The claim used to sit in a separate env flag from the address it described,
 * so an app pointed at the real forwarder could still say "mock" — and would,
 * on the day someone changed one and forgot the other. Deriving it removes the
 * gap rather than documenting it.
 */
describe("attestationFor", () => {
  it("calls a mock delivery what it is, and does not call it consensus", () => {
    const label = attestationFor(MOCK_FORWARDER);
    expect(label).toContain("not DON consensus");
    expect(label).toContain("simulate --broadcast");
  });

  it("claims DON signing only for the production forwarder", () => {
    expect(attestationFor(DON_FORWARDER)).toContain("signed by the DON");
  });

  it("ignores case, because addresses arrive checksummed and lowercased", () => {
    expect(attestationFor(DON_FORWARDER.toUpperCase().replace("0X", "0x"))).toBe(
      attestationFor(DON_FORWARDER),
    );
  });

  /**
   * The case that matters most: an address nobody has taught it about must not
   * be guessed into either story.
   */
  it("refuses to characterise an unknown forwarder", () => {
    const label = attestationFor("0x000000000000000000000000000000000000dead");
    expect(label).toContain("unrecognised");
    expect(label).not.toContain("DON consensus");
    expect(label).not.toContain("signed by the DON");
  });
});
