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

export type CategoryId =
  | "flights"
  | "sports"
  | "crypto"
  | "stocks"
  | "reserves"
  | "amm"
  | "pop"
  | "current";

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
/**
 * Proof-of-Reserve and fund-NAV markets. Structurally the same terms as a
 * stock market, but a different contract with a different settlement rule —
 * reserves have no trading session, so they are never voided merely for
 * sitting still. Kept as its own type so the two cannot be confused.
 */
export interface ReserveMarket extends MarketBase {
  categoryId: "reserves";
  symbol: string;
  feed: `0x${string}`;
  /** Strike and observed level both carry 8 decimals, whatever the feed uses. */
  strikePrice: bigint;
  expiryTime: number;
  maxStaleness: number;
  observedPrice: bigint;
}

/**
 * A market priced by an automated market maker rather than a parimutuel pool.
 *
 * The shape differs in a way that matters: `yesReserve`/`noReserve` are SHARES
 * THE POOL HOLDS, not money staked on a side, and the price of YES is the
 * OPPOSITE reserve over the total — the scarcer YES is in the pool, the dearer
 * it is. Reading these two like parimutuel pools inverts the odds, which is
 * why `yesPriceBps` is carried explicitly and read from the contract rather
 * than derived here.
 */
export interface AmmMarket extends MarketBase {
  categoryId: "amm";
  asset: "BTC" | "ETH";
  strikePrice: bigint;
  expiryTime: number;
  /** Marginal price of YES, 0–10000. Also the price a small buy executes at. */
  yesPriceBps: number;
  yesReserve: bigint;
  noReserve: bigint;
  /** Complete sets minted — the money actually at stake in this market. */
  collateral: bigint;
  maker: `0x${string}`;
  observedPrice: bigint;
}

export type Market =
  | FlightMarket
  | CryptoMarket
  | StockMarket
  | ReserveMarket
  | AmmMarket;

/** Markets whose terms are a price against a strike, whatever the asset. */
export type PriceMarket = CryptoMarket | StockMarket | ReserveMarket | AmmMarket;

export function isPriceMarket(m: Market): m is PriceMarket {
  return (
    m.categoryId === "crypto" ||
    m.categoryId === "stocks" ||
    m.categoryId === "reserves" ||
    m.categoryId === "amm"
  );
}

/**
 * What to call the thing being priced. Crypto markets name a fixed asset from
 * an enum; stock markets name whichever feed symbol the owner registered, so
 * the label has to come from different places.
 */
export function priceAssetLabel(m: PriceMarket): string {
  return m.categoryId === "crypto" || m.categoryId === "amm" ? m.asset : m.symbol;
}

/**
 * One trade on a market, whichever pricing model it uses.
 *
 * `amount` is always COLLATERAL — what left or reached the trader's wallet —
 * so anything counting money can treat every market alike. What differs is
 * what the collateral bought: a parimutuel stake buys a claim on a pot, while
 * an AMM trade buys a fixed number of shares at a price, and can be reversed
 * by selling them back. Those extras live in `amm` rather than being forced
 * into the shared fields, because a sell is a NEGATIVE position change and
 * silently folding it into `amount` would make every total wrong.
 */
export interface StakeEvent {
  /** Composite market key — see MarketBase.key. */
  marketKey: string;
  user: `0x${string}`;
  isYes: boolean;
  /** Collateral. Spent on a stake or a buy; RECEIVED on an AMM sell. */
  amount: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  /** Present only for AMM trades. */
  amm?: {
    direction: "buy" | "sell";
    /** Shares gained on a buy, given up on a sell. */
    shares: bigint;
  };
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
  /**
   * Collateral actually put in, net of anything sold back.
   *
   * NOT `yes + no`. For a parimutuel market the two are the same number, but
   * for an AMM `yes`/`no` are SHARES — claims paying one unit each — so using
   * them as the cost basis both inflates the amount at risk and makes a
   * winning position score zero profit, since entitlement would be compared
   * against itself.
   */
  cost: bigint;
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
