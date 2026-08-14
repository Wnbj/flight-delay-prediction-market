import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbiItem,
  type Address,
} from "viem";
import { getActiveProvider } from "./providers";
import { chain, DEPLOY_BLOCK, MARKET_ADDRESS, RPC_URL, TOKEN_ADDRESS } from "./config";
import { flightMarketAbi, mockUsdcAbi } from "./abi";
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
const tokenContract = { address: TOKEN_ADDRESS, abi: mockUsdcAbi } as const;

/**
 * Every market currently on chain. All of them are flight markets — see
 * lib/categories for how additional categories would slot in.
 */
export async function readMarkets(): Promise<Market[]> {
  const count = (await publicClient.readContract({
    ...marketContract,
    functionName: "marketCount",
  })) as bigint;

  const n = Number(count);
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

export interface WalletStake {
  yes: bigint;
  no: bigint;
  claimed: boolean;
}

/** One wallet's stakes across every market. */
export async function readWalletStakes(
  user: Address,
  marketCount: number,
): Promise<WalletStake[]> {
  if (marketCount === 0) return [];

  const calls = [];
  for (let i = 0; i < marketCount; i++) {
    const id = BigInt(i);
    calls.push(
      { ...marketContract, functionName: "yesStake" as const, args: [id, user] as const },
      { ...marketContract, functionName: "noStake" as const, args: [id, user] as const },
      { ...marketContract, functionName: "claimed" as const, args: [id, user] as const },
    );
  }

  const res = await publicClient.multicall({ contracts: calls, allowFailure: false });

  const out: WalletStake[] = [];
  for (let i = 0; i < marketCount; i++) {
    out.push({
      yes: res[i * 3] as bigint,
      no: res[i * 3 + 1] as bigint,
      claimed: res[i * 3 + 2] as boolean,
    });
  }
  return out;
}

export async function readTokenBalance(user: Address): Promise<bigint> {
  return (await publicClient.readContract({
    ...tokenContract,
    functionName: "balanceOf",
    args: [user],
  })) as bigint;
}

export async function readAllowance(user: Address): Promise<bigint> {
  return (await publicClient.readContract({
    ...tokenContract,
    functionName: "allowance",
    args: [user, MARKET_ADDRESS],
  })) as bigint;
}

const STAKED_EVENT = parseAbiItem(
  "event Staked(uint256 indexed marketId, address indexed user, bool isYes, uint256 amount)",
);
const SETTLED_EVENT = parseAbiItem(
  "event Settled(uint256 indexed marketId, uint8 outcome, int32 observedDelay, bytes32 evidenceHash)",
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
  const logs = await logsInChunks((fromBlock, toBlock) =>
    publicClient.getLogs({
      address: MARKET_ADDRESS,
      event: STAKED_EVENT,
      fromBlock,
      toBlock,
    }),
  );

  return logs.map((l) => ({
    marketId: Number(l.args.marketId!),
    user: l.args.user!,
    isYes: l.args.isYes!,
    amount: l.args.amount!,
    blockNumber: l.blockNumber!,
    txHash: l.transactionHash!,
  }));
}

export async function readSettledEvents(): Promise<SettledEvent[]> {
  const logs = await logsInChunks((fromBlock, toBlock) =>
    publicClient.getLogs({
      address: MARKET_ADDRESS,
      event: SETTLED_EVENT,
      fromBlock,
      toBlock,
    }),
  );

  return logs.map((l) => ({
    marketId: Number(l.args.marketId!),
    outcome: Number(l.args.outcome!) as Outcome,
    observedDelay: Number(l.args.observedDelay!),
    evidenceHash: l.args.evidenceHash!,
    txHash: l.transactionHash!,
  }));
}

// ---- writes ---------------------------------------------------------------

export async function sendApprove(account: Address, amount: bigint) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    ...tokenContract,
    functionName: "approve",
    args: [MARKET_ADDRESS, amount],
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

export async function sendStake(
  account: Address,
  marketId: number,
  isYes: boolean,
  amount: bigint,
) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    ...marketContract,
    functionName: "stake",
    args: [BigInt(marketId), isYes, amount],
    chain,
    account,
  });
}

export async function sendClaim(account: Address, marketId: number) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    ...marketContract,
    functionName: "claim",
    args: [BigInt(marketId)],
    chain,
    account,
  });
}

export async function sendRequestSettlement(account: Address, marketId: number) {
  const wallet = walletClientFor(account);
  return wallet.writeContract({
    ...marketContract,
    functionName: "requestSettlement",
    args: [BigInt(marketId)],
    chain,
    account,
  });
}

export function waitForTx(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash });
}
