import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { getActiveProvider } from "./providers";
import {
  AMM_MARKET_ADDRESS,
  chain,
  CRYPTO_MARKET_ADDRESS,
  DEPLOY_BLOCK,
  MARKET_ADDRESS,
  RESERVE_MARKET_ADDRESS,
  RPC_URL,
  STOCK_MARKET_ADDRESS,
  TOKEN_ADDRESS,
} from "./config";
import {
  ammMarketAbi,
  cryptoMarketAbi,
  flightMarketAbi,
  mockUsdcAbi,
  reserveMarketAbi,
  stockMarketAbi,
} from "./abi";
import {
  MarketStatus,
  Outcome,
  type Market,
  type SettledEvent,
  type StakeEvent,
} from "./types";

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

/**
 * Signing must go to the wallet the user actually connected with — see
 * lib/providers for why `window.ethereum` is not that wallet when several
 * extensions are installed.
 */
export function walletClientFor(account: Address) {
  const provider = getActiveProvider();
  if (!provider) throw new Error("No wallet connected");
  return createWalletClient({ account, chain, transport: custom(provider) });
}

const marketContract = { address: MARKET_ADDRESS, abi: flightMarketAbi } as const;
const cryptoContract = { address: CRYPTO_MARKET_ADDRESS, abi: cryptoMarketAbi } as const;
const stockContract = { address: STOCK_MARKET_ADDRESS, abi: stockMarketAbi } as const;
const reserveContract = { address: RESERVE_MARKET_ADDRESS, abi: reserveMarketAbi } as const;
const ammContract = { address: AMM_MARKET_ADDRESS, abi: ammMarketAbi } as const;
const tokenContract = { address: TOKEN_ADDRESS, abi: mockUsdcAbi } as const;

/** Market ids restart at 0 per contract, so identity has to carry the category. */
export const marketKey = (categoryId: string, id: number) => `${categoryId}:${id}`;

/** Which contract a market's stake/claim calls should go to. */
export function contractFor(market: Market) {
  switch (market.categoryId) {
    case "crypto":
      return cryptoContract;
    case "stocks":
      return stockContract;
    case "reserves":
      return reserveContract;
    case "amm":
      return ammContract;
    default:
      return marketContract;
  }
}

async function readFlightMarkets(): Promise<Market[]> {
  const n = Number(
    (await publicClient.readContract({
      ...marketContract,
      functionName: "marketCount",
    })) as bigint,
  );
  if (n === 0) return [];

  const results = await publicClient.multicall({
    contracts: Array.from({ length: n }, (_, i) => ({
      ...marketContract,
      functionName: "markets" as const,
      args: [BigInt(i)] as const,
    })),
    allowFailure: false,
  });

  return results.map((r, i) => {
    const t = r as unknown as [
      string, string, number, number, bigint, bigint,
      number, number, `0x${string}`, number, bigint, bigint,
    ];
    return {
      id: i,
      key: marketKey("flights", i),
      contract: MARKET_ADDRESS,
      categoryId: "flights",
      question: t[0],
      flightIata: t[1],
      departureDate: Number(t[2]),
      thresholdMinutes: Number(t[3]),
      closeTime: Number(t[4]),
      settleAfter: Number(t[5]),
      status: Number(t[6]) as MarketStatus,
      outcome: Number(t[7]) as Outcome,
      evidenceHash: t[8],
      observedDelay: Number(t[9]),
      yesPool: t[10],
      noPool: t[11],
    } satisfies Market;
  });
}

const ASSET_SYMBOLS = ["BTC", "ETH"] as const;

/**
 * AmmMarket.Status -> MarketStatus. It has no Locked state, so the numbers do
 * not line up with the parimutuel enum and a plain cast would report a
 * settlement-requested market as merely locked.
 */
const AMM_STATUS: Record<number, MarketStatus> = {
  0: MarketStatus.Open,
  1: MarketStatus.SettlementRequested,
  2: MarketStatus.Settled,
  3: MarketStatus.Void,
};

async function readCryptoMarkets(): Promise<Market[]> {
  const n = Number(
    (await publicClient.readContract({
      ...cryptoContract,
      functionName: "marketCount",
    })) as bigint,
  );
  if (n === 0) return [];

  // Core and terms are separate mappings on chain — the shared parimutuel base
  // holds one, the crypto contract the other — so both are needed per market.
  const results = await publicClient.multicall({
    contracts: Array.from({ length: n }, (_, i) => i).flatMap((i) => [
      { ...cryptoContract, functionName: "core" as const, args: [BigInt(i)] as const },
      { ...cryptoContract, functionName: "terms" as const, args: [BigInt(i)] as const },
    ]),
    allowFailure: false,
  });

  return Array.from({ length: n }, (_, i) => {
    const c = results[i * 2] as unknown as [
      string, bigint, bigint, number, number, `0x${string}`, bigint, bigint, bigint,
    ];
    const t = results[i * 2 + 1] as unknown as [number, bigint, bigint];
    return {
      id: i,
      key: marketKey("crypto", i),
      contract: CRYPTO_MARKET_ADDRESS,
      categoryId: "crypto",
      question: c[0],
      closeTime: Number(c[1]),
      settleAfter: Number(c[2]),
      status: Number(c[3]) as MarketStatus,
      outcome: Number(c[4]) as Outcome,
      evidenceHash: c[5],
      observedPrice: c[6],
      yesPool: c[7],
      noPool: c[8],
      asset: ASSET_SYMBOLS[Number(t[0])] ?? "BTC",
      strikePrice: t[1],
      expiryTime: Number(t[2]),
    } satisfies Market;
  });
}

/**
 * The read surface StockMarket and ReserveMarket share, verified identical
 * across both build artifacts. Their full ABIs differ — the reserve
 * SettlementRequested event carries no closeTime — so a union of the two has
 * no single type viem can read through. This is the shared subset.
 */
const feedMarketReadAbi = [
  {
    type: "function",
    name: "marketCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "core",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "question", type: "string" },
      { name: "closeTime", type: "uint64" },
      { name: "settleAfter", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "outcome", type: "uint8" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "observedValue", type: "int256" },
      { name: "yesPool", type: "uint256" },
      { name: "noPool", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "terms",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "feed", type: "address" },
      { name: "strikePrice", type: "uint64" },
      { name: "expiryTime", type: "uint64" },
      { name: "maxStaleness", type: "uint32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbolFor",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const;

/**
 * Stock and reserve markets are read identically — same base, same `terms`
 * shape — and differ only in which contract they came from and what the
 * category is called. One reader, two callers, so the two cannot drift.
 */
async function readFeedMarkets(
  address: `0x${string}`,
  categoryId: "stocks" | "reserves",
): Promise<Market[]> {
  const contract = { address, abi: feedMarketReadAbi } as const;
  const n = Number(
    (await publicClient.readContract({
      ...contract,
      functionName: "marketCount",
    })) as bigint,
  );
  if (n === 0) return [];

  const results = await publicClient.multicall({
    contracts: Array.from({ length: n }, (_, i) => i).flatMap((i) => [
      { ...contract, functionName: "core" as const, args: [BigInt(i)] as const },
      { ...contract, functionName: "terms" as const, args: [BigInt(i)] as const },
    ]),
    allowFailure: false,
  });

  // The symbol lives in the contract's feed registry rather than in the
  // market's terms, so it is looked up by feed address in a second pass.
  const feeds = Array.from(
    { length: n },
    (_, i) => (results[i * 2 + 1] as unknown as [`0x${string}`, bigint, bigint, number])[0],
  );
  const symbols = (await publicClient.multicall({
    contracts: feeds.map((feed) => ({
      ...contract,
      functionName: "symbolFor" as const,
      args: [feed] as const,
    })),
    allowFailure: false,
  })) as unknown as string[];

  return Array.from({ length: n }, (_, i) => {
    const c = results[i * 2] as unknown as [
      string, bigint, bigint, number, number, `0x${string}`, bigint, bigint, bigint,
    ];
    const t = results[i * 2 + 1] as unknown as [`0x${string}`, bigint, bigint, number];
    return {
      id: i,
      key: marketKey(categoryId, i),
      contract: address,
      categoryId,
      question: c[0],
      closeTime: Number(c[1]),
      settleAfter: Number(c[2]),
      status: Number(c[3]) as MarketStatus,
      outcome: Number(c[4]) as Outcome,
      evidenceHash: c[5],
      observedPrice: c[6],
      yesPool: c[7],
      noPool: c[8],
      feed: t[0],
      strikePrice: t[1],
      expiryTime: Number(t[2]),
      maxStaleness: Number(t[3]),
      // A feed removed from the registry after the market was created leaves
      // the market perfectly settleable but nameless; show the address rather
      // than an empty label.
      symbol: symbols[i] || t[0].slice(0, 10),
    } satisfies Market;
  });
}

async function readAmmMarkets(): Promise<Market[]> {
  const n = Number(
    (await publicClient.readContract({
      ...ammContract,
      functionName: "marketCount",
    })) as bigint,
  );
  if (n === 0) return [];

  const results = await publicClient.multicall({
    contracts: Array.from({ length: n }, (_, i) => i).flatMap((i) => [
      { ...ammContract, functionName: "terms" as const, args: [BigInt(i)] as const },
      { ...ammContract, functionName: "pool" as const, args: [BigInt(i)] as const },
      { ...ammContract, functionName: "yesPriceBps" as const, args: [BigInt(i)] as const },
    ]),
    allowFailure: false,
  });

  return Array.from({ length: n }, (_, i) => {
    const t = results[i * 3] as unknown as [string, number, bigint, bigint, bigint, bigint];
    const p = results[i * 3 + 1] as unknown as [
      number, number, bigint, `0x${string}`, `0x${string}`, bigint, bigint, bigint,
    ];
    const priceBps = Number(results[i * 3 + 2] as unknown as bigint);

    return {
      id: i,
      key: marketKey("amm", i),
      contract: AMM_MARKET_ADDRESS,
      categoryId: "amm",
      question: t[0],
      asset: ASSET_SYMBOLS[Number(t[1])] ?? "BTC",
      strikePrice: t[2],
      closeTime: Number(t[3]),
      expiryTime: Number(t[4]),
      settleAfter: Number(t[5]),
      // AmmMarket has its own Status enum without a Locked state, so the two
      // are mapped rather than cast: its 1 is SettlementRequested, not Locked.
      status: AMM_STATUS[p[0]] ?? MarketStatus.Open,
      outcome: Number(p[1]) as Outcome,
      observedPrice: p[2],
      evidenceHash: p[3],
      maker: p[4],
      yesReserve: p[5],
      noReserve: p[6],
      collateral: p[7],
      yesPriceBps: priceBps,
      // MarketBase's pool fields carry the reserves so shared components have
      // something to render, but nothing may read the ODDS off them — see
      // impliedYesPercent, which special-cases this category for that reason.
      yesPool: p[5],
      noPool: p[6],
    } satisfies Market;
  });
}

/** Every market across every deployed market contract. */
export async function readMarkets(): Promise<Market[]> {
  const [flights, crypto, stocks, reserves, amm] = await Promise.all([
    readFlightMarkets(),
    readCryptoMarkets(),
    readFeedMarkets(STOCK_MARKET_ADDRESS, "stocks"),
    readFeedMarkets(RESERVE_MARKET_ADDRESS, "reserves"),
    readAmmMarkets(),
  ]);
  return [...flights, ...crypto, ...stocks, ...reserves, ...amm];
}

export interface WalletStake {
  yes: bigint;
  no: bigint;
  claimed: boolean;
}

/** One wallet's stakes, keyed by composite market key across both contracts. */
export async function readWalletStakes(
  user: Address,
  markets: Market[],
): Promise<Map<string, WalletStake>> {
  const out = new Map<string, WalletStake>();
  if (markets.length === 0) return out;

  // The AMM names the same three things differently, because they are
  // different things: you hold SHARES you bought, not a STAKE you placed, and
  // you REDEEM them rather than claiming a share of a pot.
  const holdingAbi = [
    {
      type: "function",
      name: "yesShares",
      inputs: [
        { name: "", type: "uint256" },
        { name: "", type: "address" },
      ],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "noShares",
      inputs: [
        { name: "", type: "uint256" },
        { name: "", type: "address" },
      ],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "redeemed",
      inputs: [
        { name: "", type: "uint256" },
        { name: "", type: "address" },
      ],
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "view",
    },
  ] as const;

  const parimutuel = markets.filter((m) => m.categoryId !== "amm");
  const amm = markets.filter((m) => m.categoryId === "amm");

  const [pRes, aRes] = await Promise.all([
    parimutuel.length === 0
      ? Promise.resolve([] as unknown[])
      : publicClient.multicall({
          contracts: parimutuel.flatMap((m) => {
            const c = contractFor(m);
            const id = BigInt(m.id);
            return [
              { ...c, functionName: "yesStake" as const, args: [id, user] as const },
              { ...c, functionName: "noStake" as const, args: [id, user] as const },
              { ...c, functionName: "claimed" as const, args: [id, user] as const },
            ];
          }),
          allowFailure: false,
        }),
    amm.length === 0
      ? Promise.resolve([] as unknown[])
      : publicClient.multicall({
          contracts: amm.flatMap((m) => {
            const c = { address: m.contract, abi: holdingAbi } as const;
            const id = BigInt(m.id);
            return [
              { ...c, functionName: "yesShares" as const, args: [id, user] as const },
              { ...c, functionName: "noShares" as const, args: [id, user] as const },
              { ...c, functionName: "redeemed" as const, args: [id, user] as const },
            ];
          }),
          allowFailure: false,
        }),
  ]);

  parimutuel.forEach((m, i) => {
    out.set(m.key, {
      yes: pRes[i * 3] as bigint,
      no: pRes[i * 3 + 1] as bigint,
      claimed: pRes[i * 3 + 2] as boolean,
    });
  });
  amm.forEach((m, i) => {
    out.set(m.key, {
      yes: aRes[i * 3] as bigint,
      no: aRes[i * 3 + 1] as bigint,
      claimed: aRes[i * 3 + 2] as boolean,
    });
  });
  return out;
}


export async function readTokenBalance(user: Address): Promise<bigint> {
  return (await publicClient.readContract({
    ...tokenContract,
    functionName: "balanceOf",
    args: [user],
  })) as bigint;
}

/**
 * ERC-20 allowance is granted per spender, so the two market contracts each
 * need their own. Staking on crypto after approving only flights would revert.
 */
export async function readAllowance(user: Address, spender: Address): Promise<bigint> {
  return (await publicClient.readContract({
    ...tokenContract,
    functionName: "allowance",
    args: [user, spender],
  })) as bigint;
}

const STAKED_EVENT = parseAbiItem(
  "event Staked(uint256 indexed marketId, address indexed user, bool isYes, uint256 amount)",
);
// Both contracts emit Staked identically. Settled differs: the flight contract
// predates the shared base and still declares int32, the base uses int256.
const FLIGHT_SETTLED_EVENT = parseAbiItem(
  "event Settled(uint256 indexed marketId, uint8 outcome, int32 observedDelay, bytes32 evidenceHash)",
);
const CRYPTO_SETTLED_EVENT = parseAbiItem(
  "event Settled(uint256 indexed marketId, uint8 outcome, int256 observedValue, bytes32 evidenceHash)",
);

/**
 * Public RPCs cap getLogs spans, so walk the range in chunks.
 *
 * The final chunk asks for "latest" rather than the block number we just read.
 * These endpoints sit behind a load balancer: eth_blockNumber can be answered
 * by a node that is ahead of the one that then serves eth_getLogs, which
 * rejects the range as extending beyond its head. Letting the serving node
 * decide its own upper bound removes the mismatch entirely.
 */
async function logsInChunks<T>(
  fetchRange: (from: bigint, to: bigint | "latest") => Promise<T[]>,
): Promise<T[]> {
  const latest = await publicClient.getBlockNumber();
  const STEP = 45_000n;
  const out: T[] = [];
  for (let from = DEPLOY_BLOCK; from <= latest; from += STEP) {
    const end = from + STEP - 1n;
    const reachesHead = end >= latest;
    out.push(...(await fetchRange(from, reachesHead ? "latest" : end)));
    if (reachesHead) break;
  }
  return out;
}

export async function readStakeEvents(): Promise<StakeEvent[]> {
  const read = (address: `0x${string}`, categoryId: string) =>
    logsInChunks((fromBlock, toBlock) =>
      publicClient.getLogs({ address, event: STAKED_EVENT, fromBlock, toBlock }),
    ).then((logs) =>
      logs.map((l) => ({
        marketKey: marketKey(categoryId, Number(l.args.marketId!)),
        user: l.args.user!,
        isYes: l.args.isYes!,
        amount: l.args.amount!,
        blockNumber: l.blockNumber!,
        txHash: l.transactionHash!,
      })),
    );

  const [flights, crypto, stocks, reserves] = await Promise.all([
    read(MARKET_ADDRESS, "flights"),
    read(CRYPTO_MARKET_ADDRESS, "crypto"),
    read(STOCK_MARKET_ADDRESS, "stocks"),
    read(RESERVE_MARKET_ADDRESS, "reserves"),
  ]);
  return [...flights, ...crypto, ...stocks, ...reserves];
}

export async function readSettledEvents(): Promise<SettledEvent[]> {
  // The stock contract inherits the same base as the crypto one, so it emits
  // the identical int256 Settled event.
  const [flightLogs, cryptoLogs, stockLogs] = await Promise.all([
    logsInChunks((fromBlock, toBlock) =>
      publicClient.getLogs({
        address: MARKET_ADDRESS,
        event: FLIGHT_SETTLED_EVENT,
        fromBlock,
        toBlock,
      }),
    ),
    logsInChunks((fromBlock, toBlock) =>
      publicClient.getLogs({
        address: CRYPTO_MARKET_ADDRESS,
        event: CRYPTO_SETTLED_EVENT,
        fromBlock,
        toBlock,
      }),
    ),
    logsInChunks((fromBlock, toBlock) =>
      publicClient.getLogs({
        address: STOCK_MARKET_ADDRESS,
        event: CRYPTO_SETTLED_EVENT,
        fromBlock,
        toBlock,
      }),
    ),
  ]);

  return [
    ...flightLogs.map((l) => ({
      marketKey: marketKey("flights", Number(l.args.marketId!)),
      outcome: Number(l.args.outcome!) as Outcome,
      observedValue: BigInt(l.args.observedDelay!),
      evidenceHash: l.args.evidenceHash!,
      txHash: l.transactionHash!,
    })),
    ...cryptoLogs.map((l) => ({
      marketKey: marketKey("crypto", Number(l.args.marketId!)),
      outcome: Number(l.args.outcome!) as Outcome,
      observedValue: l.args.observedValue!,
      evidenceHash: l.args.evidenceHash!,
      txHash: l.transactionHash!,
    })),
    ...stockLogs.map((l) => ({
      marketKey: marketKey("stocks", Number(l.args.marketId!)),
      outcome: Number(l.args.outcome!) as Outcome,
      observedValue: l.args.observedValue!,
      evidenceHash: l.args.evidenceHash!,
      txHash: l.transactionHash!,
    })),
  ];
}

// ---- writes ---------------------------------------------------------------

export async function sendApprove(account: Address, spender: Address, amount: bigint) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    ...tokenContract,
    functionName: "approve",
    args: [spender, amount],
    chain,
    account,
  });
}

export async function sendMint(account: Address, amount: bigint) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    ...tokenContract,
    functionName: "mint",
    args: [account, amount],
    chain,
    account,
  });
}

// Writes take the market itself rather than a bare id: an id alone is
// ambiguous now that both contracts number their markets from 0, and sending
// `stake(3, …)` to the wrong contract would hit a real but unintended market.

/**
 * The write surface every market contract shares, verified identical across
 * all three build artifacts.
 *
 * Writes use this rather than each contract's full ABI so the address can vary
 * while the call shape cannot — a union of three full ABIs has no single type
 * viem can generate a call from, which is what made the old code reach for a
 * hardcoded branch in the first place. The shared errors are included so a
 * revert still decodes to a name the UI can explain.
 */
const marketWriteAbi = [
  {
    type: "function",
    name: "stake",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "isYes", type: "bool" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claim",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "requestSettlement",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "error", name: "BadStatus", inputs: [] },
  { type: "error", name: "TooEarly", inputs: [] },
  { type: "error", name: "TooLate", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  { type: "error", name: "AlreadyClaimed", inputs: [] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
] as const;

// Every write routes through `contractFor`. These used to branch on
// `categoryId === "crypto"` with the flight contract as the else, which was
// correct for exactly as long as there were two contracts. Adding stocks made
// the else wrong without making it a type error: a stake on a stock market was
// sent to FlightMarket with the same numeric id, landing on an unrelated real
// market — id 0 there is a settled flight, so it reverted with BadStatus and
// the money never moved. A third category made silent misrouting the default.

export async function sendStake(
  account: Address,
  market: Market,
  isYes: boolean,
  amount: bigint,
) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    address: contractFor(market).address,
    abi: marketWriteAbi,
    functionName: "stake",
    args: [BigInt(market.id), isYes, amount] as const,
    chain,
    account,
  });
}

const ammWriteAbi = [
  {
    type: "function",
    name: "buy",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "isYes", type: "bool" },
      { name: "collateralIn", type: "uint256" },
      { name: "minSharesOut", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "redeem",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "quote",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "isYes", type: "bool" },
      { name: "collateralIn", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  { type: "error", name: "SlippageTooHigh", inputs: [] },
  { type: "error", name: "TooLate", inputs: [] },
  { type: "error", name: "BadStatus", inputs: [] },
  { type: "error", name: "NothingToRedeem", inputs: [] },
  { type: "error", name: "AlreadyRedeemed", inputs: [] },
] as const;

/** Shares `collateralIn` buys right now — the exact number `buy` will return. */
export async function quoteAmmShares(
  market: Market,
  isYes: boolean,
  collateralIn: bigint,
): Promise<bigint> {
  if (market.categoryId !== "amm" || collateralIn <= 0n) return 0n;
  return (await publicClient.readContract({
    address: market.contract,
    abi: ammWriteAbi,
    functionName: "quote",
    args: [BigInt(market.id), isYes, collateralIn],
  })) as bigint;
}

/**
 * Buy AMM shares.
 *
 * `minSharesOut` is required by the contract rather than optional, because the
 * price moves with the size of the trade itself — a caller who has not stated
 * a bound has not been asked to think about one.
 */
export async function sendAmmBuy(
  account: Address,
  market: Market,
  isYes: boolean,
  collateralIn: bigint,
  minSharesOut: bigint,
) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    address: market.contract,
    abi: ammWriteAbi,
    functionName: "buy",
    args: [BigInt(market.id), isYes, collateralIn, minSharesOut] as const,
    chain,
    account,
  });
}

export async function sendAmmRedeem(account: Address, market: Market) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    address: market.contract,
    abi: ammWriteAbi,
    functionName: "redeem",
    args: [BigInt(market.id)] as const,
    chain,
    account,
  });
}

export async function sendClaim(account: Address, market: Market) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    address: contractFor(market).address,
    abi: marketWriteAbi,
    functionName: "claim",
    args: [BigInt(market.id)] as const,
    chain,
    account,
  });
}

export async function sendRequestSettlement(account: Address, market: Market) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    address: contractFor(market).address,
    abi: marketWriteAbi,
    functionName: "requestSettlement",
    args: [BigInt(market.id)] as const,
    chain,
    account,
  });
}

export function waitForTx(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash });
}
