import { useEffect, useState } from "react";
import { Nav } from "./components/Nav";
import { useWallet } from "./hooks/useWallet";
import { useChainData } from "./hooks/useChainData";
import { Landing } from "./views/Landing";
import { Markets } from "./views/Markets";
import { Detail } from "./views/Detail";
import { Portfolio } from "./views/Portfolio";
import { Leaderboard } from "./views/Leaderboard";
import type { CategoryId } from "./lib/types";
import type { View } from "./lib/view";

export default function App() {
  const wallet = useWallet();
  const data = useChainData(wallet.account);

  const [view, setView] = useState<View>("landing");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryId | "all">("all");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Countdowns and open/closed state depend on wall-clock time.
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, selectedId]);

  const navigate = (v: View) => {
    setView(v);
    if (v !== "detail") setSelectedId(null);
  };

  const openMarket = (id: number) => {
    setSelectedId(id);
    setView("detail");
  };

  const selected = data.markets.find((m) => m.id === selectedId) ?? null;

  return (
    <>
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
              now={now}
              onNavigate={navigate}
              onOpenMarket={openMarket}
              onPickCategory={(c) => {
                setCategoryFilter(c);
                setView("markets");
              }}
            />
          )}

          {view === "markets" && (
            <Markets
              markets={data.markets}
              stakeEvents={data.stakeEvents}
              now={now}
              categoryFilter={categoryFilter}
              onCategoryFilter={setCategoryFilter}
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
                allowance={data.allowance}
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
    </>
  );
}
