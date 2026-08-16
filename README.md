# PredictSafe

On-chain prediction markets on Ethereum Sepolia, settled by a **Chainlink CRE**
workflow that fetches real-world data, reaches consensus across nodes and writes
a signed report back to the contract.

Five live market categories, two different pricing models, one settlement
mechanism. Everything on screen is read from chain — there is no seeded or
placeholder data anywhere in the app.

> **Proof of concept. Not audited.** MockUSDC is freely mintable and nothing
> here holds real value. See [Limitations](#limitations) for what is genuinely
> unfinished, including the one thing that stops it running unattended.

---

## What it does

A market asks a yes/no question about the world — *will this flight arrive 30+
minutes late? will BTC be above $63,000 in an hour? will stETH reserves stay
above 9 million?* — takes money on both sides, and pays out when a Chainlink
DON agrees on the answer.

The interesting part is not the betting. It is that **the resolution rules live
on chain and the oracle has no discretion**: the workflow reports a number, the
contract compares it to a strike, and everything ambiguous refunds rather than
guessing.

| Category | Question | Settled from |
|---|---|---|
| **Flights** | arrival delay vs a threshold | AeroDataBox, via HTTPS |
| **Crypto** | BTC/ETH vs a strike, 5 min to 1 hour | median of Coinbase, Kraken, Bitstamp |
| **Stocks** | S&P 500 (CSPX), gold, treasury ETFs | Chainlink Data Feeds |
| **Reserves** | Proof-of-Reserve and fund NAV levels | Chainlink PoR feeds |
| **AMM** | same crypto questions, priced by a market maker | same as Crypto |

---

## Architecture

```
                    ┌──────────────────────────────────────┐
   real world ──▶   │  CRE workflow  (TypeScript → WASM)   │
   APIs, feeds      │                                      │
                    │  4 log triggers + 3 cron sweeps      │
                    │  DON consensus on every value        │
                    └──────────────┬───────────────────────┘
                                   │ signed report
                                   ▼
                    ┌──────────────────────────────────────┐
   Sepolia          │  KeystoneForwarder → onReport()      │
                    │  forwarder + author + name checks    │
                    └──────────────┬───────────────────────┘
                                   ▼
        ┌────────────────────┬─────────────┬────────────────┐
        │ ParimutuelMarket   │ AmmMarket   │  MockUSDC      │
        │  ├ FlightMarket    │ (constant   │  (shared stake │
        │  ├ CryptoMarket    │  product)   │   token)       │
        │  ├ StockMarket     │             │                │
        │  └ ReserveMarket   │             │                │
        └────────────────────┴─────────────┴────────────────┘
                                   ▲
                                   │ viem, EIP-6963
                    ┌──────────────┴───────────────────────┐
                    │  React + Vite frontend               │
                    └──────────────────────────────────────┘
```

**Deployed on Sepolia:**

| | |
|---|---|
| FlightMarket | `0x09068efb21fabeac59694e01428cf438cf38e2b3` |
| CryptoMarket | `0x8DA11eb17D5F3f4427aA3017E95e50b132A210be` |
| StockMarket | `0x451bcdB90EC6f6F5f40B5B2578aef641e36b71ca` |
| ReserveMarket | `0xa768Be2741A0464b81606649eCa45bfF7aD4d939` |
| AmmMarket | `0x21A26cC7f7A5035330257aA61e44549BE30f4801` |
| MockUSDC | `0xcd123a8d74ef062dddd2287e87bc88eb3b208b54` |

---

## Decisions worth explaining

Most of this repo is ordinary. These are the parts that were not, and each one
came out of something measured rather than assumed.

### Chainlink Data Feeds are right for stocks and wrong for crypto

The obvious way to settle a BTC price market is a Data Feed. Measured directly
on Sepolia, BTC/USD updates on a **flat 60-minute heartbeat with no deviation
trigger** — six consecutive rounds exactly 60 minutes apart. A 5-minute market
read from it compares a price against *itself* about 92% of the time and always
resolves No: rigged by data cadence rather than by anyone's intent.

So crypto settles from exchange candles, and stocks — where the natural horizon
is a session, not five minutes — settle from feeds. Same product, opposite
verdict, because the question is on a different timescale.

### The hard part of an equity market is the calendar, not the price

A feed keeps publishing while the exchange behind it is shut, republishing the
last price with a fresh timestamp. Measured over a week: CSPX/USD changed on
every weekday round and **not once from Friday to Saturday**; XAU/USD sat at
exactly 4,377.25 for twelve consecutive hourly rounds across a Saturday.

A market expiring while the exchange is closed is decided the moment the bell
rings. The chain cannot know an exchange calendar — but it can notice that
nothing happened, so `StockMarket` voids unless the answer actually *changed*
between the book closing and expiry.

`ReserveMarket` is a separate contract precisely because that rule is wrong for
reserves, which can legitimately sit still for a day. It does not even emit
`closeTime`, so the workflow cannot apply the check by accident.

### Sources must agree on the outcome, not on the number

Two venues forty cents apart either side of a strike are numerically
near-identical and disagree completely about who gets paid. Averaging them
invents an answer neither venue gave, so disagreement on the *outcome* voids
the market instead.

### Feeds do not agree on decimals

CSPX publishes 8, USTB NAV publishes 6, stETH Proof of Reserves publishes 18.
Read as 8, USTB's $11.177748 becomes $0.11 — and stETH's raw answer,
`9505650857465828722927470`, does not fit in a `uint64` strike at all. The
workflow reads `decimals()` and normalises, but checks *movement* on the raw
answers, because rescaling can truncate a real move into "nothing happened".

### Reads are pinned to a block

Every DON node runs the workflow independently. Reading a feed at `latest`
gives each node whichever chain head it happened to see, so the report bytes
differ and consensus fails. Log-triggered settlements pin to the block their
own trigger event was mined in; the cron sweeps pin to the last finalized
block. Same reason the crypto path uses closed one-minute candles rather than
spot quotes.

### The AMM is a different product, not a tuning

In a parimutuel market you do not buy at a price, you join a pool — every later
stake on your own side dilutes you through nothing you did. `AmmMarket` gives
you a fixed number of shares at a price that later trades cannot touch, and
lets you sell out before expiry.

Solvency is structural rather than tested-for: collateral only enters by
minting **complete sets**, one unit in minting one YES and one NO, so
`totalYes == totalNo == collateral` always holds and every share is backed by
its own unit. Rounding always favours the pool — and the sell path asserts the
constant product outright, because getting that rounding backwards drained the
pool a little on every single trade.

### Strike ladders are derived, not stored

A ladder is N markets sharing an asset and an expiry and differing only in
strike, so the UI groups them from exactly that. No contract change was needed,
and it works retroactively on ladders created before the code existed.

---

## Running it

Nothing is on the default PATH:

```bash
export PATH="$HOME/.local/share/cre/bin:$HOME/.bun/bin:$HOME/.foundry/bin:$PATH"
```

```bash
cd contracts && forge test                     # 140 tests
cd frontend  && bun install && bun run test    # 97 tests
cd frontend  && bun run dev                    # the app, against live Sepolia
cd cre/settlement && bun test # 35 tests
```

Settling a market end to end, deploying the contracts, and every operational
detail lives in **[RUNBOOK.md](RUNBOOK.md)** — including the two settings
(`FORWARDER`, `WORKFLOW_AUTHOR`) that are not what the CLI's own output
suggests, and which cost an afternoon to find.

---

## Limitations

Stated plainly, because a POC that hides these is worse than one that does not
have them.

- **Deploy access is not enabled for this account.** The workflow has never run
  on a real DON. Everything is exercised through `cre workflow simulate
  --broadcast`, which runs the logic locally and submits the resulting write for
  real — so the on-chain half is genuine and the *consensus* half is not.
  Requested 2026-08-14, still pending.
- **Nothing settles unattended.** A CRE workflow's only on-chain write is a
  signed report, so it cannot call `requestSettlement()` itself. Full autonomy
  needs `_processReport` to accept any market past its settle-after time,
  dropping the request step.
- **The provider API key sits in workflow config in the clear.** Config is
  handed to the DON, so node operators can read it. The code path for
  `runtime.getSecret()` is written but not activated: the secrets registry is a
  **mainnet** contract, so using it costs real gas.
- **One flight data provider.** The two-source disagreement logic is built and
  tested, but the second slot was only ever exercised with a mock.
- **The AMM has a single liquidity provider per market**, deliberately —
  multi-LP means LP tokens, proportional withdrawal and impermanent loss, a
  large surface where mistakes are silent.
- **`FlightMarket` predates `ParimutuelMarket`** and does not inherit it. It is
  deployed with live positions, so the parimutuel logic exists in two places
  until it is next redeployed.
- Not audited. Not for real money.

---

## A note on names

`cre/settlement/` used to be `flight-market/flight-settlement/`, from when
flights were the only category. The directories are renamed; the **workflow
name is not**, and deliberately.

`workflow-name: "flight-settlement-staging"` is not a label. Its
`bytes10(keccak256(...))` is stored in every deployed contract and checked on
every report, so renaming it makes all five contracts reject every settlement —
silently, because the forwarder swallows a failed receiver call into an event
rather than reverting. It can be changed with five owner calls to
`setExpectedWorkflowName`, and will be whenever the contracts are next
redeployed. Doing it for tidiness alone would risk the one failure mode in this
system that is hardest to see.

The repository URL is likewise unchanged while the deploy-access request that
cites it is still open.
