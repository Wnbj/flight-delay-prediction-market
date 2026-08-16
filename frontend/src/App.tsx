import { useEffect, useMemo, useState } from "react";
import { Nav } from "./components/Nav";
import { SpotProvider } from "./hooks/useSpot";
import { useWallet } from "./hooks/useWallet";
import { useChainData } from "./hooks/useChainData";
import { useRouter } from "./lib/router";
import { Landing } from "./views/Landing";
import { Markets } from "./views/Markets";
import { Detail } from "./views/Detail";
import { Portfolio } from "./views/Portfolio";
import { Leaderboard } from "./views/Leaderboard";
import type { View } from "./lib/view";
import { MarketStatus } from "./lib/types";

export default function App() {
  const wallet = useWallet();
  const data = useChainData(wallet.account);
  const router = useRouter();
  const { view, selectedKey, categoryFilter } = router;

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Countdowns and open/closed state depend on wall-clock time.
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, selectedKey]);

  // Real navigation (switching views, opening a market) pushes a history
  // entry, so the browser's Back button steps back through the app instead
  // of leaving it.
  const navigate = (v: View) => {
    router.navigate({ view: v, selectedKey: v === "detail" ? selectedKey : null });
  };

  const openMarket = (key: string) => {
    router.navigate({ view: "detail", selectedKey: key });
  };

  const selected = data.markets.find((m) => m.key === selectedKey) ?? null;

  // Only poll for assets that still have an unresolved market — a settled
  // market shows the price the oracle used, not a live one.
  const liveSymbols = useMemo(
    () =>
      data.markets.flatMap((m) =>
        (m.categoryId === "crypto" || m.categoryId === "amm") &&
        m.status === MarketStatus.Open
          ? [m.asset]
          : [],
      ),
    [data.markets],
  );

  return (
    <SpotProvider symbols={liveSymbols}>
      <Nav view={view} onNavigate={navigate} wallet={wallet} balance={data.balance} />

      {data.error && (
        <div
          style={{
            padding: "10px var(--page-x)",
            fontSize: 13,
            color: "var(--color-negative)",
            background: "color-mix(in srgb, var(--color-negative) 12%, transparent)",
          }}
        >
          Could not load chain data: {data.error}
        </div>
      )}

      {!data.error && data.historyDegraded && (
        <div
          style={{
            padding: "10px var(--page-x)",
            fontSize: 13,
            color: "var(--color-accent-200)",
            background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
          }}
        >
          Trade history is unavailable from the RPC right now — charts, activity and the
          leaderboard may be incomplete. Market figures are unaffected.
        </div>
      )}

      {data.loading ? (
        <div className="page muted">Loading markets from Sepolia…</div>
      ) : (
        <>
          {view === "landing" && (
            <Landing
              markets={data.markets}
              stakeEvents={data.stakeEvents}
              onNavigate={navigate}
              onOpenMarket={openMarket}
              onPickCategory={(c) => router.navigate({ view: "markets", categoryFilter: c })}
            />
          )}

          {view === "markets" && (
            <Markets
              markets={data.markets}
              stakeEvents={data.stakeEvents}
              categoryFilter={categoryFilter}
              // Filter-pill clicks rewrite the current entry rather than
              // pushing a new one — Back should undo "left this page", not
              // undo every filter click made while on it.
              onCategoryFilter={(c) => router.replace({ categoryFilter: c })}
              onOpenMarket={openMarket}
            />
          )}

          {view === "detail" &&
            (selected ? (
              <Detail
                market={selected}
                markets={data.markets}
                stakeEvents={data.stakeEvents}
                settledEvents={data.settledEvents}
                positions={data.positions}
                wallet={wallet}
                balance={data.balance}
                allowances={data.allowances}
                now={now}
                onBack={() => navigate("markets")}
                onOpenMarket={openMarket}
                onRefresh={data.refresh}
              />
            ) : (
              <div className="page muted">Market not found.</div>
            ))}

          {view === "portfolio" && (
            <Portfolio
              positions={data.positions}
              wallet={wallet}
              onOpenMarket={openMarket}
              onRefresh={data.refresh}
            />
          )}

          {view === "leaderboard" && (
            <Leaderboard
              markets={data.markets}
              stakeEvents={data.stakeEvents}
              account={wallet.account}
            />
          )}
        </>
      )}
    </SpotProvider>
  );
}
