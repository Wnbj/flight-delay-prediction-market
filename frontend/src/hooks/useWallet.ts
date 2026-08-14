import { useCallback, useEffect, useState } from "react";
import { numberToHex, type Address } from "viem";
import { chain } from "../lib/config";
import { getInjectedProvider } from "../lib/chain";

export interface WalletState {
  account: Address | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  hasProvider: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
}

/**
 * Wallet access is strictly opt-in: nothing here touches the injected provider
 * until the user clicks Connect. No `eth_accounts` probe, no `eth_chainId`, no
 * event listeners on mount — so loading the page never surfaces a wallet prompt
 * and never fingerprints the visitor. Browsing markets works entirely off the
 * public RPC.
 */
export function useWallet(): WalletState {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Flips only when the user actively asks to connect. Gates all provider I/O. */
  const [attempted, setAttempted] = useState(false);

  const provider = getInjectedProvider();
  const hasProvider = provider !== null;

  const readChain = useCallback(async () => {
    if (!provider) return;
    try {
      const id = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(id, 16));
    } catch {
      /* harmless — chain id is only used for the wrong-network hint */
    }
  }, [provider]);

  /**
   * Closing the MetaMask popup without approving or rejecting leaves
   * eth_requestAccounts unsettled forever, so no `finally` can run here.
   * `connecting` is therefore only ever a label hint and must never gate the
   * button, or dismissing the popup would lock the user out until a reload.
   */
  const connect = useCallback(async () => {
    setAttempted(true);
    if (!provider) {
      setError("No browser wallet detected. Install MetaMask to trade.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as Address[];
      setAccount(accounts[0] ?? null);
      await readChain();
      setConnecting(false);
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === -32002) {
        setError(
          "MetaMask already has a connection request open — open the extension and approve it.",
        );
      } else if (code === 4001) {
        setError("Connection rejected in wallet.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to connect");
      }
      setConnecting(false);
    }
  }, [provider, readChain]);

  // Account/chain switches only matter once the user has opted in.
  useEffect(() => {
    if (!provider || !attempted) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as Address[];
      setAccount(accounts.length > 0 ? accounts[0] : null);
    };
    const onChain = (...args: unknown[]) => {
      setChainId(Number.parseInt(args[0] as string, 16));
    };
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener("accountsChanged", onAccounts);
      provider.removeListener("chainChanged", onChain);
    };
  }, [provider, attempted]);

  /**
   * The wallet popup steals focus; closing it hands focus back, which is our
   * only signal that a request was dismissed rather than answered.
   *
   * This handler must NOT call the provider. MetaMask keeps a dismissed
   * `eth_requestAccounts` queued, and any further request while one is pending
   * makes it re-open the popup — so probing here would reopen the window the
   * user just closed, on every focus.
   *
   * Nothing is lost by staying silent: if the user approves the queued request
   * later, the original promise resolves and `accountsChanged` fires. Both
   * paths already set the account.
   */
  useEffect(() => {
    if (!attempted) return;
    const onReturn = () => {
      if (document.visibilityState === "hidden") return;
      setConnecting(false);
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [attempted]);

  /**
   * Backstop for setups where the popup never blurs the page, so no focus event
   * arrives. Without this the label could still stick indefinitely.
   */
  useEffect(() => {
    if (!connecting) return;
    const t = setTimeout(() => setConnecting(false), 45_000);
    return () => clearTimeout(t);
  }, [connecting]);

  const switchNetwork = useCallback(async () => {
    if (!provider) return;
    setError(null);
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: numberToHex(chain.id) }],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch network");
    }
  }, [provider]);

  return {
    account,
    chainId,
    connecting,
    error,
    hasProvider,
    wrongNetwork: account !== null && chainId !== null && chainId !== chain.id,
    connect,
    switchNetwork,
  };
}
