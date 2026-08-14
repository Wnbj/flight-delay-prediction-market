import { formatUnits, parseUnits } from "viem";
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";

/** Token amount → "12.5 mUSDC". Trims trailing zeros; keeps small values readable. */
export function formatToken(v: bigint, opts: { symbol?: boolean } = {}): string {
  const withSymbol = opts.symbol !== false;
  const raw = formatUnits(v, TOKEN_DECIMALS);
  const n = Number(raw);
  let body: string;
  if (n === 0) body = "0";
  else if (Math.abs(n) < 0.01) body = raw.replace(/0+$/, "").replace(/\.$/, "");
  else if (Math.abs(n) >= 1000) body = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  else body = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return withSymbol ? `${body} ${TOKEN_SYMBOL}` : body;
}

export function formatSigned(v: bigint): string {
  const sign = v > 0n ? "+" : "";
  return `${sign}${formatToken(v)}`;
}

export function parseToken(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  try {
    return parseUnits(trimmed, TOKEN_DECIMALS);
  } catch {
    return null;
  }
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function initials(a: string): string {
  return a.slice(2, 4).toUpperCase();
}

/** YYYYMMDD int (as stored on-chain) → "15 Jan 2024". */
export function formatDepartureDate(yyyymmdd: number): string {
  const s = String(yyyymmdd);
  if (s.length !== 8) return s;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return s;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatTimestamp(seconds: number): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human "closes in" / "closed" phrasing relative to now. */
export function formatRelative(targetSeconds: number, nowSeconds: number): string {
  const delta = targetSeconds - nowSeconds;
  const past = delta < 0;
  const abs = Math.abs(delta);
  const mins = Math.floor(abs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  let body: string;
  if (days > 0) body = `${days}d`;
  else if (hours > 0) body = `${hours}h`;
  else if (mins > 0) body = `${mins}m`;
  else body = "<1m";

  return past ? `${body} ago` : `in ${body}`;
}

export function formatPercent(p: number | null): string {
  return p === null ? "—" : `${p.toFixed(0)}%`;
}
