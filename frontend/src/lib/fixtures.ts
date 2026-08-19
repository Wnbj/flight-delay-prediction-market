import { marketKey } from "./chain";
import {
  AMM_MARKET_ADDRESS,
  CRYPTO_MARKET_ADDRESS,
  FLIGHT_MARKET_ADDRESS,
  RESERVE_MARKET_ADDRESS,
  STOCK_MARKET_ADDRESS,
} from "./config";
import { MarketStatus, Outcome, type Market } from "./types";

/**
 * Market fixtures shared by the test suites.
 *
 * These live in their own module rather than in `identity.test.ts`, where they
 * started. Five suites imported them from there, and `bun test` treats a test
 * file that has already been imported as one it has already run — so a whole
 * run at the root silently executed 141 of 226 tests while reporting success.
 * `vitest run`, which package.json declares, always ran all of them. Fixtures
 * in a plain module make the two agree.
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
