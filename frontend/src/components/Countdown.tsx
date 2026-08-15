import { useNow } from "../hooks/useNow";
import { isPriceMarket, MarketStatus, type Market } from "../lib/types";

/**
 * A market moves through three deadlines, and which one matters depends on
 * where the clock is. Showing "closes in" while staking is open is useful;
 * still showing it after the book has shut is not, because the number a trader
 * now cares about is when the price gets read.
 */
function phase(market: Market, now: number): { label: string; target: number } | null {
  if (market.status !== MarketStatus.Open) return null;

  // Every price market has an expiry — the moment its answer is fixed — that
  // comes well before settlement is even permitted. Counting down to
  // settleAfter would tell a trader the question is still open for another
  // half hour after it has actually been decided. Flights have no such moment:
  // the flight lands when it lands, and settleAfter is the first honest
  // deadline there is.
  const resolveAt = isPriceMarket(market) ? market.expiryTime : market.settleAfter;

  if (now < market.closeTime) return { label: "Trading closes in", target: market.closeTime };
  if (now < resolveAt) return { label: "Resolves in", target: resolveAt };
  if (now < market.settleAfter) return { label: "Settles in", target: market.settleAfter };
  return { label: "Awaiting settlement", target: 0 };
}

/** h:mm:ss inside a day, mm:ss inside an hour, days beyond that. */
function clock(seconds: number): string {
  if (seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    return `${days}d ${hours}h`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function Countdown({
  market,
  size = 13,
  showLabel = true,
}: {
  market: Market;
  size?: number;
  showLabel?: boolean;
}) {
  // Ticking once a second is only worth the re-render while something is
  // actually counting down; a market with days to run updates a "3d 4h" label
  // that changes once an hour.
  const far = market.closeTime - Math.floor(Date.now() / 1000) > 86_400;
  const now = useNow(far ? 60_000 : 1_000);

  const p = phase(market, now);
  if (!p) return null;

  const remaining = Math.max(0, p.target - now);
  const urgent = p.target > 0 && remaining < 300;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        fontSize: size,
      }}
    >
      {showLabel && (
        <span className="muted" style={{ fontSize: size - 2 }}>
          {p.label}
        </span>
      )}
      {p.target > 0 && (
        <span
          className="heading"
          style={{
            // Without tabular figures every digit change nudges the layout,
            // which is very visible on a number that changes every second.
            fontVariantNumeric: "tabular-nums",
            color: urgent ? "var(--color-accent)" : undefined,
          }}
        >
          {clock(remaining)}
        </span>
      )}
    </span>
  );
}
