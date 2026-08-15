/** Mirrors FlightMarket.Status. */
export enum MarketStatus {
  Open = 0,
  Locked = 1,
  SettlementRequested = 2,
  Settled = 3,
  Void = 4,
}

/** Mirrors FlightMarket.Outcome. */
export enum Outcome {
  Unset = 0,
  Yes = 1,
  No = 2,
  Void = 3,
}

export type CategoryId = "flights" | "sports" | "crypto" | "stocks" | "pop" | "current";

export type Side = "yes" | "no";

/**
 * Fields every market has, whatever it is about — mirrors
 * ParimutuelMarket.Core on chain.
 */
interface MarketBase {
  /** Index within its own contract. NOT unique across contracts. */
  id: number;
  /**
   * Unique across every contract, as `"<category>:<id>"`. Market ids restart
   * at 0 in each contract, so anything identifying a market across the app —
   * React keys, event lookups, position matching — must use this, never `id`.
   */
  key: string;
  contract: `0x${string}`;
  question: string;
  closeTime: number;
  settleAfter: number;
  status: MarketStatus;
  outcome: Outcome;
  evidenceHash: `0x${string}`;
  yesPool: bigint;
  noPool: bigint;
}

export interface FlightMarket extends MarketBase {
  categoryId: "flights";
  flightIata: string;
  departureDate: number;
  thresholdMinutes: number;
  /** Minutes late, as agreed by the oracle. Negative means early. */
  observedDelay: number;
}

export interface CryptoMarket extends MarketBase {
  categoryId: "crypto";
  asset: "BTC" | "ETH";
  /** Strike and observed price both carry 8 decimals, as on chain. */
  strikePrice: bigint;
  expiryTime: number;
  observedPrice: bigint;
}

export interface StockMarket extends MarketBase {
  categoryId: "stocks";
  /** Registered feed symbol, e.g. "CSPX". */
  symbol: string;
  /** The Chainlink aggregator this market settles from. */
  feed: `0x${string}`;
  /** Strike and observed price both carry 8 decimals, as on chain. */
  strikePrice: bigint;
  expiryTime: number;
  /** How stale the round at expiry may be before the market voids, in seconds. */
  maxStaleness: number;
  observedPrice: bigint;
}

/**
 * A union rather than one wide interface with optional fields: it makes
 * reading a flight's `thresholdMinutes` off a crypto market a compile error
 * instead of a silent `undefined` rendered to the user.
 */
export type Market = FlightMarket | CryptoMarket | StockMarket;

/** Markets whose terms are a price against a strike, whatever the asset. */
export type PriceMarket = CryptoMarket | StockMarket;

export function isPriceMarket(m: Market): m is PriceMarket {
  return m.categoryId === "crypto" || m.categoryId === "stocks";
}

/**
 * What to call the thing being priced. Crypto markets name a fixed asset from
 * an enum; stock markets name whichever feed symbol the owner registered, so
 * the label has to come from different places.
 */
export function priceAssetLabel(m: PriceMarket): string {
  return m.categoryId === "crypto" ? m.asset : m.symbol;
}

export interface StakeEvent {
  /** Composite market key — see MarketBase.key. */
  marketKey: string;
  user: `0x${string}`;
  isYes: boolean;
  amount: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
}

export interface SettledEvent {
  /** Composite market key — see MarketBase.key. */
  marketKey: string;
  outcome: Outcome;
  /** Minutes late for flights, price at 8 decimals for crypto. */
  observedValue: bigint;
  evidenceHash: `0x${string}`;
  txHash: `0x${string}`;
}

/** A connected wallet's stake in one market, with settlement applied. */
export interface Position {
  market: Market;
  yes: bigint;
  no: bigint;
  claimed: boolean;
  /** What claim() would pay right now — 0 once claimed, or while unresolved. */
  claimable: bigint;
  /**
   * What this position is owed in total, whether or not it has been claimed.
   * P&L must be measured against this: netting off already-claimed positions
   * would report a winning wallet as flat or losing.
   */
  entitlement: bigint;
  status: "Open" | "Awaiting settlement" | "Won" | "Lost" | "Refundable" | "Claimed";
}

export interface TraderStats {
  address: `0x${string}`;
  staked: bigint;
  settledMarkets: number;
  wins: number;
  /** Net profit across settled markets; voids are neutral. */
  profit: bigint;
}
