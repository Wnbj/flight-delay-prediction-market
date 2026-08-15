import { createContext, createElement, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** Live price per asset symbol, in whole USD. Absent means "not known yet". */
export type SpotMap = Map<string, number>;

const POLL_MS = 5_000;

/**
 * Live spot prices for the assets currently on screen.
 *
 * This is display only and is never used to settle anything — settlement reads
 * a closed one-minute candle through the oracle, precisely because a live quote
 * differs for every observer. Showing spot next to the strike answers the one
 * question a countdown provokes ("is it going to make it?"), and it is honest
 * to show it as long as it is not what decides the market.
 *
 * Polled rather than streamed over a websocket: at one request per asset per
 * five seconds the traffic is trivial, and a socket would add reconnect and
 * backoff handling for a number that is decoration.
 */
function usePolledSpot(symbols: string[]): SpotMap {
  const [prices, setPrices] = useState<SpotMap>(() => new Map());

  // The array identity changes on every render; the joined key does not, so
  // effects re-run when the set of assets actually changes.
  const key = [...new Set(symbols)].sort().join(",");
  const stale = useRef(false);

  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    if (wanted.length === 0) return;

    stale.current = false;
    const controller = new AbortController();

    const poll = async () => {
      // A backgrounded tab cannot be read, so stop asking until it is visible.
      if (document.hidden) return;

      const results = await Promise.all(
        wanted.map(async (symbol) => {
          try {
            const r = await fetch(
              `https://api.exchange.coinbase.com/products/${symbol}-USD/ticker`,
              { signal: controller.signal },
            );
            if (!r.ok) return null;
            const price = Number((await r.json()).price);
            return Number.isFinite(price) ? ([symbol, price] as const) : null;
          } catch {
            // A missed poll is not worth surfacing — the previous price stays
            // on screen and the next tick corrects it.
            return null;
          }
        }),
      );

      if (stale.current) return;
      const fresh = results.filter((r): r is readonly [string, number] => r !== null);
      if (fresh.length > 0) {
        setPrices((prev) => {
          const next = new Map(prev);
          for (const [symbol, price] of fresh) next.set(symbol, price);
          return next;
        });
      }
    };

    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      stale.current = true;
      controller.abort();
      clearInterval(t);
    };
  }, [key]);

  return prices;
}

/**
 * Shared through context rather than passed down as a prop: the cards that
 * want a price sit three views deep, and every view in between would otherwise
 * have to carry a prop it has no use for. One provider also means one poller —
 * threading it per card would have each of a dozen cards asking Coinbase for
 * the same BTC price.
 */
const SpotContext = createContext<SpotMap>(new Map());

export function SpotProvider({
  symbols,
  children,
}: {
  symbols: string[];
  children: ReactNode;
}) {
  const prices = usePolledSpot(symbols);
  return createElement(SpotContext.Provider, { value: prices }, children);
}

export function useSpotPrice(symbol: string | null): number | null {
  const prices = useContext(SpotContext);
  return symbol === null ? null : (prices.get(symbol) ?? null);
}
