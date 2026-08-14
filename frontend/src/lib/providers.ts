import type { EIP1193Provider } from "viem";

/**
 * EIP-6963 wallet discovery.
 *
 * `window.ethereum` is a single slot that every installed wallet competes for.
 * With more than one extension present the winner is arbitrary, and some inject
 * an arbitration shim (it shows up as an `isSelectingExtension` flag) that never
 * answers a request unless its own picker is dealt with. Talking to that object
 * means requests hang while the wallet the user is looking at was never asked.
 *
 * EIP-6963 sidesteps the whole fight: each wallet announces itself with its own
 * provider object, so we can hold the exact one the user picked.
 */

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface WalletOption {
  info: WalletInfo;
  provider: EIP1193Provider;
}

interface AnnounceEvent extends Event {
  detail: WalletOption;
}

const STORAGE_KEY = "predictsafe.wallet.rdns";

/**
 * Wallets announce asynchronously and may announce late, so this subscribes
 * rather than resolving once. Returns an unsubscribe function.
 */
export function subscribeToWallets(onChange: (wallets: WalletOption[]) => void): () => void {
  const found = new Map<string, WalletOption>();

  const onAnnounce = (event: Event) => {
    const { detail } = event as AnnounceEvent;
    if (!detail?.info?.uuid) return;
    found.set(detail.info.uuid, detail);
    onChange([...found.values()].sort((a, b) => a.info.name.localeCompare(b.info.name)));
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
}

/**
 * Pre-EIP-6963 wallets never announce, so fall back to the legacy slot. Only
 * used when discovery turns up nothing at all.
 */
export function legacyProvider(): EIP1193Provider | null {
  return (window as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null;
}

export function rememberWallet(rdns: string) {
  try {
    localStorage.setItem(STORAGE_KEY, rdns);
  } catch {
    /* private mode — the choice just won't persist */
  }
}

export function forgetWallet() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function rememberedWallet(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The provider chosen for this session. `chain.ts` builds wallet clients from
 * it, so signing goes to the same wallet the user connected with rather than
 * whichever extension happens to own `window.ethereum`.
 */
let active: EIP1193Provider | null = null;

export function setActiveProvider(p: EIP1193Provider | null) {
  active = p;
}

export function getActiveProvider(): EIP1193Provider | null {
  return active;
}
