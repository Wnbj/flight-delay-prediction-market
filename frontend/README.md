# PredictSafe frontend

React + Vite + viem UI for the flight-delay prediction market, implementing the
`PredictSafe.dc.html` mockup against the real contracts on Sepolia.

```bash
bun install
bun run dev      # http://localhost:5173
bun run build    # typecheck + production build
```

Wallet actions need MetaMask (or any injected EIP-1193 wallet) on Sepolia.
Reads work without a wallet.

## Configuration

Defaults point at the deployed POC. Override in `.env.local`:

```
VITE_MARKET_ADDRESS=0x...
VITE_TOKEN_ADDRESS=0x...
VITE_RPC_URL=https://...
VITE_DEPLOY_BLOCK=11489414
```

`VITE_DEPLOY_BLOCK` is where event scans start — set it to the block the market
contract was deployed in, or `getLogs` will crawl the whole chain.

## Regenerating the ABI

`src/lib/abi.ts` is generated from the Foundry artifacts, trimmed to the
functions and events this app actually uses. After changing the contracts:

```bash
cd ../contracts && forge build
```

then re-run the extraction snippet documented at the top of `src/lib/abi.ts`'s
git history, or hand-copy the new entries.

## What is real

Everything on screen is read from chain — there is no seeded or placeholder
market data:

| Surface | Source |
|---|---|
| Markets, pools, status, outcome | `markets(i)` on FlightMarket |
| Implied Yes % | `yesPool / (yesPool + noPool)` |
| Probability sparkline | replay of `Staked` events in block order |
| Landing stats, avg. odds | aggregated from the above |
| Activity feed | `Staked` events |
| Settlement panel | `Settled` event + evidence hash |
| Portfolio | `yesStake` / `noStake` / `claimed` for the connected wallet |
| Leaderboard | `Staked` events scored against resolved outcomes |

Sparse data (two wallets, three markets) is shown as-is rather than padded.

## Deliberate departures from the mockup

The mockup describes an order-book product; this contract is **parimutuel**.
Three changes follow from that, and they are about not misleading the user
regarding their own money:

1. **No "¢ price" or "entry price".** You do not buy shares at a locked-in
   price. A percentage here is a *current implied probability*; your payout is
   your share of the winning pool times the whole pot, fixed only at settlement.
   The portfolio table shows *Staked* and *Claimable* instead of Entry/Current.
2. **Payout is labelled an estimate** and recomputed from live pools, because it
   moves whenever anyone else stakes. `estimatePayout` mirrors the contract's
   integer maths so the figure matches what `claim()` transfers.
3. **One-sided books are called out.** A market with nothing on the other side
   voids and refunds rather than paying out; the UI warns before you stake into
   one, which the mockup had no concept of.

Two smaller ones:

- The mockup's **$ / Pts currency toggle** is gone. There is one token
  (MockUSDC) and no second denomination or price feed, so the toggle could only
  have shown a made-up number. Its slot in the nav is now the wallet connection.
- **Leaderboard columns** are Staked / Resolved / Won / Profit rather than
  win-rate and streak, which cannot be derived honestly from three markets.

## Adding a category

`src/lib/categories.tsx` is the extension point. Non-live categories already
render as "coming soon" so the shape of the product is visible. To light one up:

1. Set `live: true` on its entry.
2. Point `readMarkets` in `src/lib/chain.ts` at that category's contract and map
   its markets into the shared `Market` shape.

Nothing else in the UI needs to change — cards, filters, detail, portfolio and
leaderboard all read from `Market.categoryId`.
