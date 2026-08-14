import { useMemo, useState } from "react";
import { category } from "../lib/categories";
import { addressUrl, txUrl } from "../lib/config";
import {
  formatDepartureDate,
  formatPercent,
  formatRelative,
  formatTimestamp,
  formatToken,
  shortAddress,
} from "../lib/format";
import {
  impliedYesPercent,
  isOneSided,
  outcomeLabel,
  statusLabel,
  totalPool,
} from "../lib/parimutuel";
import {
  MarketStatus,
  Outcome,
  type Market,
  type Position,
  type SettledEvent,
  type StakeEvent,
} from "../lib/types";
import { Sparkline } from "../components/Sparkline";
import { MarketCard } from "../components/MarketCard";
import { TradePanel } from "../components/TradePanel";
import type { WalletState } from "../hooks/useWallet";

type Tab = "overview" | "activity" | "rules";

export function Detail({
  market,
  markets,
  stakeEvents,
  settledEvents,
  positions,
  wallet,
  balance,
  allowance,
  now,
  onBack,
  onOpenMarket,
  onRefresh,
}: {
  market: Market;
  markets: Market[];
  stakeEvents: StakeEvent[];
  settledEvents: SettledEvent[];
  positions: Position[];
  wallet: WalletState;
  balance: bigint;
  allowance: bigint;
  now: number;
  onBack: () => void;
  onOpenMarket: (id: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const cat = category(market.categoryId);
  const yes = impliedYesPercent(market);

  const marketStakes = useMemo(
    () =>
      stakeEvents
        .filter((e) => e.marketId === market.id)
        .sort((a, b) => Number(b.blockNumber - a.blockNumber)),
    [stakeEvents, market.id],
  );

  const traders = useMemo(
    () => new Set(marketStakes.map((e) => e.user.toLowerCase())).size,
    [marketStakes],
  );

  const settlement = settledEvents.find((e) => e.marketId === market.id);
  const position = positions.find((p) => p.market.id === market.id);
  const related = markets.filter((m) => m.categoryId === market.categoryId && m.id !== market.id).slice(0, 3);

  return (
    <div className="page" style={{ paddingTop: 40, maxWidth: 1300 }}>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onBack();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          marginBottom: "var(--space-4)",
          textDecoration: "none",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        Back to markets
      </a>

      <div>
        <span className="tag" style={{ ...cat.tagStyle, marginBottom: "var(--space-2)" }}>
          {cat.name}
        </span>
      </div>
      <h1
        className="heading"
        style={{ fontSize: 36, lineHeight: 1.1, maxWidth: 760, margin: "0 0 var(--space-2)" }}
      >
        {market.question}
      </h1>

      <div className="detail-grid">
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--space-4)",
              marginBottom: "var(--space-4)",
              flexWrap: "wrap",
            }}
          >
            <div className="heading" style={{ fontSize: 44, color: "var(--color-accent)" }}>
              {formatPercent(yes)}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              implied chance of Yes · {formatToken(totalPool(market))} staked ·{" "}
              {market.status === MarketStatus.Open && now < market.closeTime
                ? `closes ${formatRelative(market.closeTime, now)}`
                : statusLabel(market.status)}
            </div>
          </div>

          <Sparkline market={market} events={stakeEvents} height={160} strokeWidth={1.5} />

          {settlement && (
            <div
              className="card"
              style={{ marginTop: "var(--space-4)", boxShadow: "var(--shadow-md)" }}
            >
              <div className="eyebrow">Settled by Chainlink CRE</div>
              <div style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>
                <Stat label="Outcome" value={outcomeLabel(settlement.outcome)} />
                <Stat
                  label="Observed delay"
                  value={
                    settlement.outcome === Outcome.Void
                      ? "—"
                      : `${settlement.observedDelay} min`
                  }
                />
                <Stat label="Threshold" value={`${market.thresholdMinutes} min`} />
              </div>
              <a
                href={txUrl(settlement.txHash)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: "var(--color-accent)" }}
              >
                Settlement transaction ↗
              </a>
              <div className="muted-strong" style={{ fontSize: 11, wordBreak: "break-all" }}>
                Evidence hash {settlement.evidenceHash}
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: "var(--space-4)",
              borderBottom: "1px solid var(--color-divider)",
              margin: "var(--space-6) 0 var(--space-4)",
            }}
          >
            {(["overview", "activity", "rules"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  cursor: "pointer",
                  background: "transparent",
                  border: "none",
                  fontFamily: "var(--font-heading)",
                  fontWeight: "var(--font-heading-weight)" as never,
                  fontSize: 14,
                  padding: "8px 0",
                  textTransform: "capitalize",
                  color: tab === t ? "var(--color-accent)" : "var(--color-text)",
                  opacity: tab === t ? 1 : 0.7,
                  borderBottom: `2px solid ${tab === t ? "var(--color-accent)" : "transparent"}`,
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div>
              <p style={{ maxWidth: 600, opacity: 0.85, margin: 0 }}>
                Resolves <strong>Yes</strong> if flight {market.flightIata} on{" "}
                {formatDepartureDate(market.departureDate)} arrives at least{" "}
                {market.thresholdMinutes} minutes late, or is cancelled or diverted. Resolves{" "}
                <strong>No</strong> if it lands less than {market.thresholdMinutes} minutes late.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-8)",
                  marginTop: "var(--space-4)",
                  flexWrap: "wrap",
                }}
              >
                <Stat label="Pool" value={formatToken(totalPool(market))} />
                <Stat label="Backers" value={String(traders)} />
                <Stat label="Closes" value={formatTimestamp(market.closeTime)} />
                <Stat label="Settleable from" value={formatTimestamp(market.settleAfter)} />
              </div>
              {isOneSided(market) && market.status === MarketStatus.Open && (
                <p style={{ fontSize: 13, color: "var(--color-accent-300)", marginTop: "var(--space-4)" }}>
                  Only one side is backed. A one-sided book cannot pay out, so this market would
                  void and refund everyone at settlement.
                </p>
              )}
            </div>
          )}

          {tab === "activity" && (
            <div style={{ maxWidth: 620 }}>
              {marketStakes.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  No stakes on this market yet.
                </p>
              ) : (
                marketStakes.map((e) => (
                  <div
                    key={`${e.txHash}-${e.user}-${e.amount}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "var(--space-2) 0",
                      borderBottom: "1px solid var(--color-divider)",
                      fontSize: 13,
                    }}
                  >
                    <a
                      href={addressUrl(e.user)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none" }}
                    >
                      {shortAddress(e.user)}
                    </a>
                    <span className="muted">staked {e.isYes ? "Yes" : "No"}</span>
                    <a
                      href={txUrl(e.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none" }}
                    >
                      {formatToken(e.amount)}
                    </a>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "rules" && (
            <div style={{ maxWidth: 620, opacity: 0.85, fontSize: 14 }}>
              <p style={{ marginTop: 0 }}>
                Resolution rules are encoded on chain, so the oracle has no discretion:
              </p>
              <ul style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                <li>
                  <strong>Yes</strong> — arrival delay ≥ {market.thresholdMinutes} minutes, or the
                  flight is cancelled or diverted.
                </li>
                <li>
                  <strong>No</strong> — arrival delay &lt; {market.thresholdMinutes} minutes.
                </li>
                <li>
                  <strong>Void</strong> — the data is unavailable, the oracle nodes disagree, or
                  only one side of the book is backed. Everyone is refunded their own stake.
                </li>
              </ul>
              <p>
                Anyone may call <code>requestSettlement()</code> once the settle-after time passes.
                That emits the log a Chainlink CRE workflow listens for; the network fetches the
                flight result, reaches consensus, and writes a signed report back to{" "}
                <code>onReport()</code>. Payouts are parimutuel: the winning side splits the entire
                pot in proportion to stake.
              </p>
            </div>
          )}
        </div>

        <TradePanel
          market={market}
          wallet={wallet}
          balance={balance}
          allowance={allowance}
          position={position}
          now={now}
          onDone={onRefresh}
        />
      </div>

      {related.length > 0 && (
        <div style={{ marginTop: "var(--space-8)" }}>
          <h3 className="heading" style={{ fontSize: 22, margin: "0 0 var(--space-4)" }}>
            More in {cat.name}
          </h3>
          <div className="grid-3">
            {related.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                events={stakeEvents}
                now={now}
                onOpen={onOpenMarket}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="muted"
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
      </div>
      <div className="heading" style={{ fontSize: 18 }}>
        {value}
      </div>
    </div>
  );
}
