import { useCallback, useEffect, useState } from "react";
import { numberToHex, type Address } from "viem";
import { chain } from "../lib/config";
import { getInjectedProvider } from "../lib/chain";

export interface WalletState {
  account: Address | null;
  chainId: number | null;
  error: string | null;
  hasProvider: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
}

/**
 * Wallet access is strictly opt-in: nothing here touches the injected provider
 * until the user clicks Connect. No `eth_accounts` probe, no `eth_chainId`, no
 * event listeners on mount — so loading the page never surfaces a wallet prompt
 * and never fingerprints the visitor. Browsing markets works entirely off the
 * public RPC.
 *
 * There is deliberately no transient "connecting" state. Leaving it needs a
 * signal that the request finished, and none of the available ones are
 * dependable: `eth_requestAccounts` never settles when the popup is dismissed,
 * and window focus never returns if the popup did not take focus in the first
 * place. Any such state therefore risks sticking and making the button look
 * dead. The wallet's own popup is the feedback that the click registered, and
 * the button stays live so a second click always does something.
 */
export function useWallet(): WalletState {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Flips only when the user actively asks to connect. Gates all provider I/O. */
  const [attempted, setAttempted] = useState(false);
  /**
   * Set by an explicit disconnect. Without it, the wallet emitting
   * `accountsChanged` (an account switch, say) would silently sign the user
   * back in moments after they asked to leave.
   */
  const [dismissed, setDismissed] = useState(false);

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

  const connect = useCallback(async () => {
    setAttempted(true);
    setDismissed(false);
    if (!provider) {
      setError("No browser wallet detected. Install MetaMask to trade.");
      return;
    }
    setError(null);
    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as Address[];
      setAccount(accounts[0] ?? null);
      await readChain();
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
    }
  }, [provider, readChain]);

  // Account/chain switches only matter once the user has opted in.
  useEffect(() => {
    if (!provider || !attempted) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as Address[];
      // Respect an explicit disconnect; only a fresh connect() re-opts in.
      setAccount(accounts.length > 0 && !dismissed ? accounts[0] : null);
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
  }, [provider, attempted, dismissed]);

  /**
   * EIP-1193 has no dapp-side logout: the wallet owns the permission, so the
   * honest scope of this is "forget the account here". We also ask MetaMask to
   * revoke `eth_accounts` so the next connect prompts again rather than
   * silently re-authorising — that method is recent, so failure is ignored and
   * the local disconnect still stands.
   */
  const disconnect = useCallback(async () => {
    setAccount(null);
    setChainId(null);
    setError(null);
    setDismissed(true);
    try {
      await provider?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      /* older wallets have no such method; local disconnect is still in effect */
    }
  }, [provider]);

  /**
   * An account can arrive without passing through connect()'s success branch —
   * via `accountsChanged`, or from a queued request the user approves later.
   *
   * Two things have to be settled here rather than there: a connection error
   * left over from an earlier attempt would otherwise sit on screen next to a
   * working connection, and the chain id would never be read, so the
   * wrong-network warning could stay silent on the wrong network.
   *
   * Reading the chain is safe at this point: an account existing means the
   * permission request has been answered, so there is no queued request left
   * for MetaMask to re-surface.
   */
  useEffect(() => {
    if (!account) return;
    setError(null);
    void readChain();
  }, [account, readChain]);

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
    error,
    hasProvider,
    wrongNetwork: account !== null && chainId !== null && chainId !== chain.id,
    connect,
    disconnect,
    switchNetwork,
  };
}
