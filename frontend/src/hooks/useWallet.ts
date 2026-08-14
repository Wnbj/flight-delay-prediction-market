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

export function useWallet(): WalletState {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = getInjectedProvider();
  const hasProvider = provider !== null;

  const readChain = useCallback(async () => {
    if (!provider) return;
    try {
      const id = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(id, 16));
    } catch {
      /* provider may reject before connection; harmless */
    }
  }, [provider]);

  // Pick up an already-authorised account without prompting.
  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    (async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
        if (!cancelled && accounts.length > 0) setAccount(accounts[0]);
      } catch {
        /* ignore */
      }
      await readChain();
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, readChain]);

  useEffect(() => {
    if (!provider) return;
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
  }, [provider]);

  /**
   * Closing the MetaMask popup without approving or rejecting leaves the
   * request permanently unsettled — the promise never resolves, so no `finally`
   * can run. `connecting` is therefore only ever a label hint; it must never
   * gate the button, or dismissing the popup would lock the user out for good.
   */
  const connect = useCallback(async () => {
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
        // MetaMask still holds the earlier request; a new one cannot open.
        setError("MetaMask already has a connection request open — open the extension and approve it.");
      } else if (code === 4001) {
        setError("Connection rejected in wallet.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to connect");
      }
      setConnecting(false);
    }
  }, [provider, readChain]);

  /**
   * If the user approves in MetaMask after our request was orphaned, nothing
   * resolves here — so re-read accounts whenever the tab regains focus.
   */
  useEffect(() => {
    if (!provider) return;
    const recheck = async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          setConnecting(false);
          setError(null);
          await readChain();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [provider, readChain]);

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
