import { useMemo } from "react";
import type { Market, StakeEvent } from "../lib/types";
import { impliedYesPercent } from "../lib/parimutuel";

/**
 * Implied-probability history, reconstructed by replaying this market's Staked
 * events in block order. The mockup showed a smooth price curve; a parimutuel
 * market only moves when someone stakes, so this is a step series and will look
 * sparse until a market has real activity. That sparseness is the truth — it is
 * not padded with synthetic points.
 */
export function Sparkline({
  market,
  events,
  height = 36,
  strokeWidth = 2,
}: {
  market: Market;
  events: StakeEvent[];
  height?: number;
  strokeWidth?: number;
}) {
  const points = useMemo(() => {
    const mine = events
      .filter((e) => e.marketId === market.id)
      .sort((a, b) => Number(a.blockNumber - b.blockNumber));

    const series: number[] = [];
    let yes = 0n;
    let no = 0n;
    for (const e of mine) {
      if (e.isYes) yes += e.amount;
      else no += e.amount;
      const total = yes + no;
      series.push(total === 0n ? 50 : Number((yes * 10000n) / total) / 100);
    }

    if (series.length === 0) {
      const current = impliedYesPercent(market);
      return current === null ? [] : [current, current];
    }
    if (series.length === 1) return [series[0], series[0]];
    return series;
  }, [market, events]);

  if (points.length === 0) {
    return (
      <div
        style={{ height, display: "flex", alignItems: "center", fontSize: 11 }}
        className="muted-strong"
      >
        No trades yet
      </div>
    );
  }

  // SVG y grows downward: a higher probability should sit higher on screen.
  const coords = points
    .map((p, i) => {
      const x = points.length === 1 ? 0 : (i / (points.length - 1)) * 100;
      const y = 29 - (Math.max(0, Math.min(100, p)) / 100) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 30"
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={coords}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
