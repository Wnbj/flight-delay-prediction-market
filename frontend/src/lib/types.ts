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

export type CategoryId = "flights" | "sports" | "crypto" | "pop" | "current";

export type Side = "yes" | "no";

/** One market, as read from the chain and enriched for display. */
export interface Market {
  id: number;
  categoryId: CategoryId;
  question: string;
  /** Flight-specific payload; other categories will carry their own. */
  flightIata: string;
  departureDate: number;
  thresholdMinutes: number;
  closeTime: number;
  settleAfter: number;
  status: MarketStatus;
  outcome: Outcome;
  evidenceHash: `0x${string}`;
  observedDelay: number;
  yesPool: bigint;
  noPool: bigint;
}

export interface StakeEvent {
  marketId: number;
  user: `0x${string}`;
  isYes: boolean;
  amount: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
}

export interface SettledEvent {
  marketId: number;
  outcome: Outcome;
  observedDelay: number;
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
