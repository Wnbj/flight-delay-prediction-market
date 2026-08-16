import { category } from "../lib/categories";
import { formatToken, formatPercent, formatMarketValue } from "../lib/format";
import { impliedYesPercent, isOneSided, statusLabel, totalPool } from "../lib/parimutuel";
import {
  isPriceMarket,
  MarketStatus,
  priceAssetLabel,
  type Market,
  type StakeEvent,
} from "../lib/types";
import { Countdown } from "./Countdown";
import { LivePrice } from "./LivePrice";
import { Sparkline } from "./Sparkline";

export function MarketCard({
  market,
  events,
  onOpen,
}: {
  market: Market;
  events: StakeEvent[];
  onOpen: (key: string) => void;
}) {
  const cat = category(market.categoryId);
  const yes = impliedYesPercent(market);
  const no = yes === null ? null : 100 - yes;

  return (
    <div
      className="card card-interactive"
      onClick={() => onOpen(market.key)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(market.key);
        }
      }}
    >
      <div
        style={{
          margin: "calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) 0",
          height: 110,
          borderRadius: "var(--radius-md) var(--radius-md) 0 0",
          background:
            "linear-gradient(160deg, var(--color-surface), var(--color-neutral-900))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {cat.icon(44)}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="tag" style={cat.tagStyle}>
          {cat.name}
        </span>
        <span
          className="muted"
          style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
        >
          <ClockIcon />
          {market.status === MarketStatus.Open ? (
            <Countdown market={market} size={11} showLabel={false} />
          ) : (
            statusLabel(market.status)
          )}
        </span>
      </div>

      <div className="heading" style={{ fontSize: 17, lineHeight: 1.25 }}>
        {market.question}
      </div>

      {/* Crypto questions read alike at a glance, so surface the term that
          actually distinguishes them. */}
      {isPriceMarket(market) && (
        <div className="muted" style={{ fontSize: 12 }}>
          {priceAssetLabel(market)} · strike {formatMarketValue(market.categoryId, market.strikePrice)}
        </div>
      )}

      <LivePrice market={market} size={12} />

      <Sparkline market={market} events={events} />

      <div style={{ display: "flex", height: 22, borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${yes ?? 50}%`, background: "var(--color-accent)" }} />
        <div style={{ width: `${no ?? 50}%`, background: "var(--color-neutral-700)" }} />
      </div>

      <div
        className="muted-strong"
        style={{
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 4,
          fontSize: 11,
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>
          {yes === null
            ? "No stakes yet"
            : `Yes ${formatPercent(yes)} · No ${formatPercent(no)}`}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>{formatToken(totalPool(market))} pool</span>
      </div>

      {isOneSided(market) && market.status === MarketStatus.Open && (
        <div style={{ fontSize: 11, color: "var(--color-accent-300)" }}>
          One-sided — voids unless the other side is backed
        </div>
      )}
    </div>
  );
}

export function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
