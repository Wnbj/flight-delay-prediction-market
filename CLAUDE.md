# Session state

Working notes for picking the project back up — **not** an overview. What the
system is and why it is built this way lives in [README.md](README.md); how to
operate it lives in [RUNBOOK.md](RUNBOOK.md). This file only holds what those
two cannot: what is unfinished right now.

Named `CLAUDE.md` so it loads automatically at the start of a session. That
makes it worth keeping current — a stale status file is more misleading than no
status file, because it is read as fact rather than skimmed as notes. The
timestamp below is the first thing to distrust.

Last updated **2026-08-16 16:03 UTC**. Working tree clean, `main` level with
`origin/main`.

---

## In flight

### The AMM strike ladder is settled — the old contract is still full

All five rungs on `AmmMarket` `0x21A26cC7f7A5035330257aA61e44549BE30f4801`
settled 2026-08-16 ~17:40 UTC at BTC **$63,095.30**:

| rung | strike | outcome |
|---|---|---|
| 0 | $62,500 | Yes |
| 1 | $62,750 | Yes |
| 2 | $63,000 | Yes |
| 3 | $63,250 | No |
| 4 | $63,500 | No |

Monotone, boundary between rungs 2 and 3, no inconsistency. Verified through
`pool()` rather than the CLI log.

**Beware the status numbering.** `AmmMarket.Status` has no `Locked`, so
`2 = Settled` and `3 = Void` — one lower than the parimutuel contracts, whose
numbers are what the RUNBOOK's settlement check quotes. Reading 2 as
"SettlementRequested" makes a settled market look stuck.

**Drained to exactly 0**, no dust — all five reserves plus the maker's residual
shares, 210 mUSDC in total. That address is now inert and kept only as history.

### Multi-LP is deployed and live, with an open ladder on it

`AmmMarket` **`0xc9961096dc98eE17eD28bB417BB726F1b64f84FF`** — takes any number
of liquidity providers and charges a per-market fee retained in the pool.
Deployed 2026-08-16. Its `getExpectedWorkflowName()` was compared byte-for-byte
against CryptoMarket's before anything was seeded; a mismatch there fails every
settlement *silently*.

Its first ladder — five rungs, 40 mUSDC each at 30 bps — is **settled**, at BTC
**$63,062.36**: Yes at $62,750 and $63,000, No at $63,250 / $63,500 / $63,750.
Boundary between rungs 1 and 2, monotone.

Read times off `terms()` rather than the UI — the app renders timestamps in the
browser's local zone, and this file has already had them written down three
hours out because of it.

**The whole multi-LP lifecycle is now proven on chain, not just in tests.** All
of it on rung 2:

- a second wallet bought 3 mUSDC of YES — the quote matched the fill exactly,
  6,340,546 shares and a 9,000 fee, which is 30 bps to the unit;
- the same wallet then deposited 5 mUSDC as a provider and the price went
  **4935 → 4935**, unchanged. That is the entire point of scaling both reserves
  by a common factor, and the thing most likely to be wrong without showing it;
- it minted 5,455,618 of 45,455,618 LP shares and kept 127,141 NO as residual,
  exactly as `quoteAddLiquidity` said;
- after settlement both providers withdrew and received **exactly** what
  `lpPosition` quoted — 35,727,272 and 4,872,858 against a 40,600,131 reserve.
  The payout ratio reproduces the share ratio to six decimals, and the sum is
  one unit UNDER the reserve: the floor-per-provider bound, holding;
- both then redeemed residual shares through the separate second claim, and the
  rung drained from 48 mUSDC to **1 unit** of dust.

Rungs 0, 1, 3 and 4 are settled but **not withdrawn** — 160 mUSDC still sits in
the contract. Nothing depends on collecting it.

### CSPX is the last unverified path

`StockMarket` market 0, "Will the S&P 500 (CSPX) be at or above $840 at
Monday's close?" — 4 mUSDC Yes vs 1 mUSDC No.

- **Closes** Mon 08:00 UTC (~15.9h), **settleable from** Mon 20:30 UTC (~28.4h).
- The feed still reads **$838.69**, unchanged since Friday, republished through
  the weekend. That is the trading-calendar problem live: the market deliberately
  spans a session so the price actually moves and the guard passes rather than
  voiding.
- **This is the one genuinely new thing left to observe** — an equity settling
  over a real trading session, exercising the "did the answer change?" rule for
  real rather than in a test.

---

## Deploy access: still not enabled

Re-checked today; `cre account access` still returns *"Deployment access is not
yet enabled for your organization."* Requested **2026-08-14**.

Everything runs through `cre workflow simulate --broadcast`, which executes the
logic locally and submits the resulting write for real. So the on-chain half is
genuine and **the consensus half is not** — no DON, no independent nodes.

This blocks the two things that would make the system autonomous:

1. Scheduled execution, so the cron sweeps run without someone typing.
2. Any short-horizon market being practical, since a 5-minute market currently
   needs a person present at expiry.

---

## Decisions taken but deliberately not acted on

Each of these is a considered "not now", not an oversight.

**The workflow name stays `flight-settlement-staging`.** Its
`bytes10(keccak256(...))` is stored in all five deployed contracts and checked
on every report. Renaming makes them reject every settlement *silently* — the
forwarder swallows a failed receiver call into an event rather than reverting,
which is the hardest failure mode here to see. Five owner calls to
`setExpectedWorkflowName` would fix it; it should ride along with the next
redeploy instead of being done for tidiness. Directories were renamed to
`cre/settlement/`; only the on-chain name was left.

**The repository URL is unchanged** while the deploy-access request citing it is
open. Renaming is the owner's call once that resolves.

**Secrets are coded but not activated.** `resolveApiKey()` uses
`runtime.getSecret()` when `apiKeySecretId` is set and falls back to config
otherwise, so the verified path is untouched. Activating it needs a **mainnet**
RPC and `cre secrets create` — a real mainnet transaction that uploads the
provider key to the Vault DON. Both are the account owner's decisions, so the
upload was deliberately not attempted. `--secrets-auth browser` looked like the
free route but failed with *"could not complete the authorization request"*;
worth retrying from an interactive terminal, possibly after access is granted.

**Multi-LP is now built but not deployed.** See "In flight" above — the
contract, tests and frontend are done; the new address is not.

**`FlightMarket` still does not inherit `ParimutuelMarket`.** It holds live
positions and is wired into the frontend by its exact ABI, so migrating means a
new address and orphaned markets. It moves whenever it is next redeployed.

---

## What was about to happen next

Nothing is half-finished. Multi-LP is built, deployed and exercised end to end,
and the naming tidy-ups are done: `lib/parimutuel.ts` is now `lib/pricing.ts`
(with `outcomeLabel`/`statusLabel` moved to `format.ts`, where display belongs),
and `StakeEvent`/`readStakeEvents` are `TradeEvent`/`readTradeEvents`.

The natural next steps, in rough order of value:

1. **Watch CSPX settle** — Monday, closes 08:00 UTC, settleable from 20:30 UTC.
   Still the last unverified path and the only qualitatively new thing left:
   an equity resolving across a real trading session, so the "did the answer
   change?" guard is exercised for real rather than in a test.
2. **Collect the remaining 160 mUSDC** from rungs 0, 1, 3 and 4 of the settled
   ladder, if you want the contract clean. Nothing depends on it.
3. **`FlightMarket` still does not inherit `ParimutuelMarket`** — it holds live
   positions and is wired to the frontend by its exact ABI, so it moves whenever
   it is next redeployed.

---

## Things that bit repeatedly

Worth knowing before touching the AMM again.

**"The AMM is not parimutuel with different words" broke four separate places
today**, each time in code that compiled, built and looked fine while quietly
missing or inventing data:

1. The app read only `Staked` events, so every AMM trade was invisible to the
   leaderboard, activity feed and sparkline.
2. Shares were labelled `mUSDC` throughout — roughly double the money involved.
3. Portfolio used `yes + no` as cost, right for a stake and wrong for shares,
   which made realised P&L come out at exactly zero on a win.
4. Asymmetric seeding gave the maker a position with no trade behind it, priced
   at zero, reported as pure profit.

Each is now covered by tests — the frontend suite went from 60 to 101 in a day
for this reason. **Any further AMM change should be followed by checking every
view that consumes positions or events**, not just the one being edited.

**Do not trust "it worked in the browser" after a route or data change.** The
scroll fix passed a first check and failed on a cold load, because the route
arrives before the data does. Re-check with a hard reload.

**Renames move `.gitignore` out from under secrets.** Moving
`flight-market/` → `cre/` silently unprotected `config.staging.json`, which
holds the provider API key. `git check-ignore -v <path>` after any directory
move.
