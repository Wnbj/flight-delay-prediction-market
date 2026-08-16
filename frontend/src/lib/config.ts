import { defineChain } from "viem";
import { sepolia } from "viem/chains";

/**
 * Deployed POC addresses on Ethereum Sepolia. Override via .env.local
 * (VITE_MARKET_ADDRESS / VITE_TOKEN_ADDRESS) when you redeploy.
 */
export const FLIGHT_MARKET_ADDRESS = (import.meta.env.VITE_FLIGHT_MARKET_ADDRESS ??
  "0x09068efb21fabeac59694e01428cf438cf38e2b3") as `0x${string}`;

export const CRYPTO_MARKET_ADDRESS = (import.meta.env.VITE_CRYPTO_MARKET_ADDRESS ??
  "0x8DA11eb17D5F3f4427aA3017E95e50b132A210be") as `0x${string}`;

export const STOCK_MARKET_ADDRESS = (import.meta.env.VITE_STOCK_MARKET_ADDRESS ??
  "0x451bcdB90EC6f6F5f40B5B2578aef641e36b71ca") as `0x${string}`;

export const RESERVE_MARKET_ADDRESS = (import.meta.env.VITE_RESERVE_MARKET_ADDRESS ??
  "0xa768Be2741A0464b81606649eCa45bfF7aD4d939") as `0x${string}`;

// Redeployed 2026-08-16 for multi-LP. The previous address
// (0x21A2…4801) is single-provider and answers to `pool()`, not `poolState()`;
// its five markets are settled and drained, so nothing is stranded there.
export const AMM_MARKET_ADDRESS = (import.meta.env.VITE_AMM_MARKET_ADDRESS ??
  "0xc9961096dc98eE17eD28bB417BB726F1b64f84FF") as `0x${string}`;

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

/**
 * The KeystoneForwarder that delivers reports to our receivers.
 *
 * Overridable because it is not a fixed property of the system: this address is
 * the MockKeystoneForwarder that `cre workflow simulate --broadcast` calls, and
 * it changes when reports start arriving from a real DON. It is also shared
 * with other people's workflows on Sepolia, so anything reading its logs must
 * filter by receiver rather than assume every report is ours.
 */
export const FORWARDER_ADDRESS = (import.meta.env.VITE_FORWARDER_ADDRESS ??
  "0x15fC6ae953E024d975e77382eEeC56A9101f9F88") as `0x${string}`;

/**
 * Whether reports are being delivered by a real DON yet.
 *
 * Flipping this is the whole change when deploy access arrives — it decides
 * what the UI is allowed to claim about how a settlement was attested, and
 * nothing else in the app needs to know.
 */
export const DON_DEPLOYED = import.meta.env.VITE_DON_DEPLOYED === "true";

/**
 * What the UI is allowed to say about how a settlement was attested.
 *
 * One constant, used everywhere the question comes up, because the honest
 * answer changes on a single day and it must not be left half-changed. Today
 * the report is produced by one local execution and broadcast; that is a real
 * on-chain write and a real signature check by the receiver, but it is not
 * consensus, and calling it consensus would be the one place this app lies.
 */
export const ATTESTATION_LABEL = DON_DEPLOYED
  ? "Delivered through the Chainlink CRE forwarder and signed by the DON."
  : "Delivered through the mock forwarder by `cre workflow simulate --broadcast` — " +
    "one local execution, not DON consensus. The write and the receiver's checks are real.";

export const EXPLORER = "https://sepolia.etherscan.io";

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
export const blockUrl = (block: bigint) => `${EXPLORER}/block/${block}`;

/** MockUSDC is 6-decimal, like real USDC. */
export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = "mUSDC";
