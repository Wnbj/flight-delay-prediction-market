import { useSpotPrice } from "../hooks/useSpot";
import { formatUsdNumber, toUsdNumber } from "../lib/format";
import { MarketStatus, type Market } from "../lib/types";

/**
 * Live price against the strike, for a market that has not resolved yet.
 *
 * Shown only while the answer is still open. Once a market settles, the number
 * that matters is the observed price the oracle actually used, and putting a
 * live quote next to it would invite the reader to check the settlement against
 * a price nobody settled on.
 */
export function LivePrice({
  market,
  size = 13,
}: {
  market: Market;
  size?: number;
}) {
  const symbol =
    market.categoryId === "crypto" || market.categoryId === "amm" ? market.asset : null;
  const spot = useSpotPrice(symbol);

  if (symbol === null || (market.categoryId !== "crypto" && market.categoryId !== "amm"))
    return null;
  if (market.status !== MarketStatus.Open) return null;
  if (spot === null) return null;

  // Open is not the same as undecided. A market whose expiry has passed but
  // which nobody has settled yet already has its answer fixed at the expiry
  // price; showing today's spot against its strike would suggest the outcome
  // is still in play. Re-checked on each spot poll, so it disappears on its
  // own when expiry passes.
  if (Math.floor(Date.now() / 1000) >= market.expiryTime) return null;

  const strike = toUsdNumber(market.strikePrice);
  const gap = spot - strike;
  const above = gap >= 0;

  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: size }}>
      <span className="muted" style={{ fontSize: size - 2 }}>
        {symbol} now
      </span>
      <span className="heading" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatUsdNumber(spot)}
      </span>
      <span
        style={{
          fontSize: size - 2,
          fontVariantNumeric: "tabular-nums",
          // Matches how gains are coloured in Portfolio and Leaderboard —
          // there is no green in this palette, accent stands in for positive.
          color: above ? "var(--color-accent-300)" : "var(--color-negative)",
        }}
      >
        {above ? "▲" : "▼"} {formatUsdNumber(Math.abs(gap))} {above ? "above" : "below"} strike
      </span>
    </span>
  );
}
