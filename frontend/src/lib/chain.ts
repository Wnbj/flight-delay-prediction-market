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
  chain,
  CRYPTO_MARKET_ADDRESS,
  DEPLOY_BLOCK,
  MARKET_ADDRESS,
  RPC_URL,
  STOCK_MARKET_ADDRESS,
  TOKEN_ADDRESS,
} from "./config";
import { cryptoMarketAbi, flightMarketAbi, mockUsdcAbi, stockMarketAbi } from "./abi";
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

async function readStockMarkets(): Promise<Market[]> {
  const n = Number(
    (await publicClient.readContract({
      ...stockContract,
      functionName: "marketCount",
    })) as bigint,
  );
  if (n === 0) return [];

  const results = await publicClient.multicall({
    contracts: Array.from({ length: n }, (_, i) => i).flatMap((i) => [
      { ...stockContract, functionName: "core" as const, args: [BigInt(i)] as const },
      { ...stockContract, functionName: "terms" as const, args: [BigInt(i)] as const },
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
      ...stockContract,
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
      key: marketKey("stocks", i),
      contract: STOCK_MARKET_ADDRESS,
      categoryId: "stocks",
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

/** Every market across every deployed market contract. */
export async function readMarkets(): Promise<Market[]> {
  const [flights, crypto, stocks] = await Promise.all([
    readFlightMarkets(),
    readCryptoMarkets(),
    readStockMarkets(),
  ]);
  return [...flights, ...crypto, ...stocks];
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

  const calls = markets.flatMap((m) => {
    const c = contractFor(m);
    const id = BigInt(m.id);
    return [
      { ...c, functionName: "yesStake" as const, args: [id, user] as const },
      { ...c, functionName: "noStake" as const, args: [id, user] as const },
      { ...c, functionName: "claimed" as const, args: [id, user] as const },
    ];
  });

  const res = await publicClient.multicall({ contracts: calls, allowFailure: false });

  markets.forEach((m, i) => {
    out.set(m.key, {
      yes: res[i * 3] as bigint,
      no: res[i * 3 + 1] as bigint,
      claimed: res[i * 3 + 2] as boolean,
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

  const [flights, crypto, stocks] = await Promise.all([
    read(MARKET_ADDRESS, "flights"),
    read(CRYPTO_MARKET_ADDRESS, "crypto"),
    read(STOCK_MARKET_ADDRESS, "stocks"),
  ]);
  return [...flights, ...crypto, ...stocks];
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

export async function sendStake(
  account: Address,
  market: Market,
  isYes: boolean,
  amount: bigint,
) {
  const wallet = walletClientFor(account);
  const args = [BigInt(market.id), isYes, amount] as const;
  return market.categoryId === "crypto"
    ? wallet.writeContract({ ...cryptoContract, functionName: "stake", args, chain, account })
    : wallet.writeContract({ ...marketContract, functionName: "stake", args, chain, account });
}

export async function sendClaim(account: Address, market: Market) {
  const wallet = walletClientFor(account);
  const args = [BigInt(market.id)] as const;
  return market.categoryId === "crypto"
    ? wallet.writeContract({ ...cryptoContract, functionName: "claim", args, chain, account })
    : wallet.writeContract({ ...marketContract, functionName: "claim", args, chain, account });
}

export async function sendRequestSettlement(account: Address, market: Market) {
  const wallet = walletClientFor(account);
  const args = [BigInt(market.id)] as const;
  return market.categoryId === "crypto"
    ? wallet.writeContract({
        ...cryptoContract,
        functionName: "requestSettlement",
        args,
        chain,
        account,
      })
    : wallet.writeContract({
        ...marketContract,
        functionName: "requestSettlement",
        args,
        chain,
        account,
      });
}

export function waitForTx(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash });
}
