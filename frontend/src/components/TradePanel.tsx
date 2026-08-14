import { useState } from "react";
import type { Address } from "viem";
import { TOKEN_SYMBOL, txUrl } from "../lib/config";
import { formatToken, parseToken } from "../lib/format";
import {
  estimatePayout,
  impliedYesPercent,
  isOpenForStaking,
  canRequestSettlement,
  statusLabel,
} from "../lib/parimutuel";
import { sendApprove, sendClaim, sendMint, sendRequestSettlement, sendStake, waitForTx } from "../lib/chain";
import type { Market, Position, Side } from "../lib/types";
import type { WalletState } from "../hooks/useWallet";

type Busy = null | "approving" | "staking" | "claiming" | "minting" | "settling";

export function TradePanel({
  market,
  wallet,
  balance,
  allowance,
  position,
  now,
  onDone,
}: {
  market: Market;
  wallet: WalletState;
  balance: bigint;
  allowance: bigint;
  position: Position | undefined;
  now: number;
  onDone: () => void;
}) {
  const [side, setSide] = useState<Side>("yes");
  const [amountText, setAmountText] = useState("1");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const amount = parseToken(amountText);
  const yes = impliedYesPercent(market);
  const open = isOpenForStaking(market, now);
  const account = wallet.account;

  const estimate = amount ? estimatePayout(market, side, amount) : null;
  const needsApproval = amount !== null && allowance < amount;
  const insufficient = amount !== null && amount > balance;

  const run = async (label: Busy, fn: (acct: Address) => Promise<`0x${string}`>) => {
    if (!account) return;
    setBusy(label);
    setError(null);
    setLastTx(null);
    try {
      const hash = await fn(account);
      setLastTx(hash);
      await waitForTx(hash);
      await onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const doStake = async () => {
    if (!account || !amount) return;
    if (allowance < amount) {
      setBusy("approving");
      setError(null);
      try {
        const h = await sendApprove(account, amount);
        setLastTx(h);
        await waitForTx(h);
      } catch (e) {
        setError(friendlyError(e));
        setBusy(null);
        return;
      }
    }
    await run("staking", (a) => sendStake(a, market.id, side === "yes", amount));
  };

  if (!account) {
    return (
      <aside className="trade-panel">
        <div className="eyebrow">Trade</div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Connect a wallet on Sepolia to stake on this market.
        </p>
        <button className="btn btn-accent" onClick={() => void wallet.connect()}>
          Connect wallet
        </button>
      </aside>
    );
  }

  return (
    <aside className="trade-panel">
      <div className="eyebrow">Trade</div>

      {open ? (
        <>
          <div className="seg" style={{ width: "100%" }}>
            <button
              className={side === "yes" ? "active" : ""}
              style={{ flex: 1 }}
              onClick={() => setSide("yes")}
            >
              Yes {yes === null ? "—" : `${yes.toFixed(0)}%`}
            </button>
            <button
              className={side === "no" ? "active" : ""}
              style={{ flex: 1 }}
              onClick={() => setSide("no")}
            >
              No {yes === null ? "—" : `${(100 - yes).toFixed(0)}%`}
            </button>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 12,
                marginBottom: 5,
                color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
              }}
            >
              Amount ({TOKEN_SYMBOL})
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0.00"
            />
            <div
              className="muted-strong"
              style={{ fontSize: 11, marginTop: 4, display: "flex", justifyContent: "space-between" }}
            >
              <span>Balance {formatToken(balance)}</span>
              <button
                onClick={() => void run("minting", (a) => sendMint(a, 100_000_000n))}
                disabled={busy !== null}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  color: "var(--color-accent)",
                  fontSize: 11,
                }}
                title="MockUSDC has an open mint for testing"
              >
                {busy === "minting" ? "Minting…" : "Get 100 test tokens"}
              </button>
            </div>
          </div>

          <div
            className="muted-strong"
            style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}
          >
            <span>Est. payout if {side === "yes" ? "Yes" : "No"}</span>
            <span style={{ color: "var(--color-text)" }}>
              {estimate ? formatToken(estimate.payout) : "—"}
            </span>
          </div>

          {estimate?.refundOnly && (
            <div style={{ fontSize: 11, color: "var(--color-accent-300)" }}>
              Nothing staked on the other side yet — as it stands this market would void and
              refund, not pay out.
            </div>
          )}

          <p className="muted-strong" style={{ fontSize: 11, margin: 0 }}>
            Parimutuel: your share of the whole pot is fixed at settlement, so this estimate moves
            as others stake.
          </p>

          {insufficient && (
            <div style={{ fontSize: 12, color: "var(--color-negative)" }}>
              Not enough {TOKEN_SYMBOL}.
            </div>
          )}

          <button
            className="btn btn-accent"
            style={{ width: "100%" }}
            disabled={!amount || amount <= 0n || insufficient || busy !== null || wallet.wrongNetwork}
            onClick={() => void doStake()}
          >
            {busy === "approving"
              ? "Approving…"
              : busy === "staking"
                ? "Staking…"
                : needsApproval
                  ? "Approve & stake"
                  : "Place stake"}
          </button>
        </>
      ) : (
        <div className="muted" style={{ fontSize: 13 }}>
          Staking is closed — market is {statusLabel(market.status).toLowerCase()}.
        </div>
      )}

      {canRequestSettlement(market, now) && (
        <button
          className="btn"
          style={{ width: "100%" }}
          disabled={busy !== null}
          onClick={() => void run("settling", (a) => sendRequestSettlement(a, market.id))}
          title="Emits SettlementRequested, which is what the CRE workflow listens for"
        >
          {busy === "settling" ? "Requesting…" : "Request settlement"}
        </button>
      )}

      {position && position.claimable > 0n && !position.claimed && (
        <button
          className="btn btn-accent"
          style={{ width: "100%" }}
          disabled={busy !== null}
          onClick={() => void run("claiming", (a) => sendClaim(a, market.id))}
        >
          {busy === "claiming" ? "Claiming…" : `Claim ${formatToken(position.claimable)}`}
        </button>
      )}

      {position && (
        <div className="muted-strong" style={{ fontSize: 11, borderTop: "1px solid var(--color-divider)", paddingTop: "var(--space-2)" }}>
          Your stake: {formatToken(position.yes)} Yes · {formatToken(position.no)} No
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "var(--color-negative)" }}>{error}</div>
      )}

      {lastTx && (
        <a
          href={txUrl(lastTx)}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, color: "var(--color-accent)" }}
        >
          View transaction ↗
        </a>
      )}
    </aside>
  );
}

/** Wallet/RPC errors are verbose; surface the useful line and the contract's own reverts. */
function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|denied transaction/i.test(msg)) return "Transaction rejected in wallet.";
  if (/BadStatus/.test(msg)) return "Market is not in a state that allows this.";
  if (/TooLate/.test(msg)) return "Staking has closed for this market.";
  if (/TooEarly/.test(msg)) return "Too early — settlement is not yet allowed.";
  if (/NothingToClaim/.test(msg)) return "Nothing to claim on this market.";
  if (/AlreadyClaimed/.test(msg)) return "Already claimed.";
  if (/insufficient funds/i.test(msg)) return "Not enough Sepolia ETH for gas.";
  const first = msg.split("\n")[0];
  return first.length > 160 ? `${first.slice(0, 160)}…` : first;
}
