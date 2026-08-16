import { defineChain } from "viem";
import { sepolia } from "viem/chains";

/**
 * Deployed POC addresses on Ethereum Sepolia. Override via .env.local
 * (VITE_MARKET_ADDRESS / VITE_TOKEN_ADDRESS) when you redeploy.
 */
export const MARKET_ADDRESS = (import.meta.env.VITE_MARKET_ADDRESS ??
  "0x09068efb21fabeac59694e01428cf438cf38e2b3") as `0x${string}`;

export const CRYPTO_MARKET_ADDRESS = (import.meta.env.VITE_CRYPTO_MARKET_ADDRESS ??
  "0x8DA11eb17D5F3f4427aA3017E95e50b132A210be") as `0x${string}`;

export const STOCK_MARKET_ADDRESS = (import.meta.env.VITE_STOCK_MARKET_ADDRESS ??
  "0x451bcdB90EC6f6F5f40B5B2578aef641e36b71ca") as `0x${string}`;

export const RESERVE_MARKET_ADDRESS = (import.meta.env.VITE_RESERVE_MARKET_ADDRESS ??
  "0xa768Be2741A0464b81606649eCa45bfF7aD4d939") as `0x${string}`;

export const TOKEN_ADDRESS = (import.meta.env.VITE_TOKEN_ADDRESS ??
  "0xcd123a8d74ef062dddd2287e87bc88eb3b208b54") as `0x${string}`;

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * Block the contracts were deployed in. Event scans start here instead of 0 —
 * public RPCs cap getLogs ranges, and there is nothing to find before this.
 */
export const DEPLOY_BLOCK = BigInt(
  import.meta.env.VITE_DEPLOY_BLOCK ?? "11489414",
);

export const chain = defineChain({
  ...sepolia,
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const EXPLORER = "https://sepolia.etherscan.io";

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;

/** MockUSDC is 6-decimal, like real USDC. */
export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = "mUSDC";
