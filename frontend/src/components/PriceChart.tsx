import { useMemo, useState } from "react";
import { formatUsdNumber, toUsdNumber } from "../lib/format";
import { isPriceMarket, priceAssetLabel, type Market } from "../lib/types";
import {
  RANGE_SECONDS,
  useCandleHistory,
  useFeedRoundHistory,
  type RangeKey,
} from "../hooks/usePriceHistory";

const RANGES: RangeKey[] = ["1H", "4H", "1D", "1W", "1M"];

/**
 * The underlying asset's own price history, with the strike marked — distinct
 * from Sparkline, which plots this market's implied Yes probability rather
 * than what the market is actually about.
 *
 * Crypto renders real candlesticks, read from the same Coinbase endpoint the
 * settlement workflow reads. A Data Feed round is a single answer with no
 * open/high/low inside it, so stock markets render a line through round
 * values instead — inventing wicks nobody published would misrepresent what
 * the oracle actually saw.
 */
export function PriceChart({ market }: { market: Market }) {
  const [range, setRange] = useState<RangeKey>(
    market.categoryId === "crypto" || market.categoryId === "amm" ? "1H" : "1W",
  );

  // An AMM market names a crypto asset and settles from the same exchange
  // data, so it charts candles — the AMM is how it is PRICED, not what it is
  // about. Only the feed-settled categories chart feed rounds.
  const symbol =
    market.categoryId === "crypto" || market.categoryId === "amm" ? market.asset : null;
  // Both feed-settled categories, not just stocks — reserves are read the
  // same way and were silently getting no chart at all.
  const feed =
    market.categoryId === "stocks" || market.categoryId === "reserves" ? market.feed : null;

  const { candles, loading: candlesLoading } = useCandleHistory(symbol, range);
  const { points, loading: pointsLoading } = useFeedRoundHistory(feed, range);

  // Type-narrowed without being a hook, so it can sit after the hooks above
  // without breaking the rule that every hook runs on every render.
  const strike = isPriceMarket(market) ? toUsdNumber(market.strikePrice) : 0;

  // A reserve level is a token count, not a dollar amount.
  const formatScaled = (v: number) =>
    market.categoryId === "reserves"
      ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : formatUsdNumber(v);
  const last = symbol ? candles.at(-1)?.close : points.at(-1)?.value;
  const first = symbol ? candles[0]?.open : points[0]?.value;
  const changePct = last !== undefined && first ? ((last - first) / first) * 100 : null;

  /**
   * Scaled to the PRICE ACTION only — the strike is deliberately not part of
   * the range.
   *
   * Every rung of a strike ladder plots the same asset over the same window, so
   * the chart should not move when you switch between them; only the strike
   * line should. Including the strike in the range made a far out-of-the-money
   * rung stretch the axis and squash the candles, so switching strikes appeared
   * to change the price history itself.
   */
  const { min, max } = useMemo(() => {
    const values = symbol
      ? candles.flatMap((c) => [c.high, c.low])
      : points.map((p) => p.value);
    if (values.length === 0) return { min: strike * 0.99, max: strike * 1.01 };
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.1 || hi * 0.01 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [candles, points, symbol, strike]);

  if (!isPriceMarket(market)) return null;

  // A strike outside the window simply is not drawn. Pinning it to the edge
  // would read as "the strike is here", and the header already states the
  // strike a line away.
  const strikeInView = strike >= min && strike <= max;

  const y = (v: number) => (max === min ? 150 : 300 - ((v - min) / (max - min)) * 300);
  const loading = symbol ? candlesLoading : pointsLoading;
  const hasData = symbol ? candles.length > 0 : points.length > 0;

  return (
    <div className="card" style={{ padding: "var(--space-4)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "var(--space-3)",
        }}
      >
        <div>
          <div
            className="muted"
            style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            {priceAssetLabel(market)} · strike {formatScaled(strike)}
          </div>
          {last !== undefined ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="heading" style={{ fontSize: 26 }}>
                {formatScaled(last)}
              </span>
              {changePct !== null && (
                <span
                  style={{
                    fontSize: 13,
                    fontVariantNumeric: "tabular-nums",
                    color: changePct >= 0 ? "var(--color-accent-300)" : "var(--color-negative)",
                  }}
                >
                  {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
                </span>
              )}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>
              {loading ? "Loading price history…" : "No price data for this range"}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              className={`pill${range === r ? " active" : ""}`}
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox="0 0 1000 300"
        width="100%"
        height={220}
        preserveAspectRatio="none"
        style={{ marginTop: "var(--space-3)" }}
        aria-hidden="true"
      >
        {strikeInView && (
          <line
            x1={0}
            x2={1000}
            y1={y(strike)}
            y2={y(strike)}
            stroke="var(--color-neutral-500)"
            strokeWidth={1}
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {symbol
          ? candles.map((c, i) => {
              const w = 1000 / candles.length;
              const cx = i * w + w / 2;
              const bodyW = Math.max(w * 0.55, 1);
              const up = c.close >= c.open;
              const color = up ? "var(--color-accent-300)" : "var(--color-negative)";
              const yOpen = y(c.open);
              const yClose = y(c.close);
              return (
                <g key={c.time}>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={y(c.high)}
                    y2={y(c.low)}
                    stroke={color}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect
                    x={cx - bodyW / 2}
                    y={Math.min(yOpen, yClose)}
                    width={bodyW}
                    height={Math.max(Math.abs(yClose - yOpen), 1)}
                    fill={color}
                  />
                </g>
              );
            })
          : points.length > 1 && (
              <polyline
                points={points
                  .map((p, i) => `${(i / (points.length - 1)) * 1000},${y(p.value)}`)
                  .join(" ")}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
      </svg>

      {!hasData && !loading && (
        <div className="muted" style={{ fontSize: 11 }}>
          {symbol
            ? "Coinbase has no candles in this window yet."
            : `No feed rounds published in the last ${Math.round(RANGE_SECONDS[range] / 3600)}h — try a wider range.`}
        </div>
      )}
    </div>
  );
}
