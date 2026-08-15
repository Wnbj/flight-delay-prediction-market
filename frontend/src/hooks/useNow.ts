import { useEffect, useState } from "react";

/**
 * Wall-clock seconds, ticking at `intervalMs`.
 *
 * Deliberately local to whoever needs it rather than threaded down from App.
 * A per-second countdown re-renders its owner every second; hoisting a 1s tick
 * to the app root would re-render every card on the page once a second to
 * animate one number. App keeps its coarse 15s tick for open/closed state.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return now;
}
