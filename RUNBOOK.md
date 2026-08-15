# Flight-delay prediction market — POC runbook

End-to-end settlement (real Sepolia log trigger → CRE workflow → real
`onReport()` write → real `claim()` payout, all verified via on-chain state,
not just CLI output) is **proven**. `FlightMarket.sol` inherits
`ReceiverTemplate` (from smartcontractkit/cre-gcp-prediction-market-demo) for
forwarder/author/name validation instead of hand-rolled checks.

The full money flow was exercised on real Sepolia across three markets (Yes,
No, Void) with two independent stakers, then both claimed:

| staker | market 0 (Yes) | market 1 (No) | market 2 (Void) | total received |
|---|---|---|---|---|
| alice (staked YES: 1e6/1e6/1e6) | wins: 4e6 | loses: reverts `NothingToClaim` | refund: 1e6 | 5e6 |
| bob (staked NO: 3e6/3e6/3e6) | loses: reverts `NothingToClaim` | wins: 4e6 | refund: 3e6 | 7e6 |

Contract's MockUSDC balance after all four claims: **0** — fully drained, no
dust. Numbers match the parimutuel math exactly.

## Toolchain

None of these are on the default PATH:

```bash
export PATH="$HOME/.cre/bin:$HOME/.bun/bin:$HOME/.foundry/bin:$PATH"
```

## 1. Contract tests

```bash
cd contracts && forge test
```

24 tests, incl. a 256-run fuzz on payout solvency. `via_ir = true` is required —
the 12-field `Market` struct blows the stack otherwise.

## 2. Deploy to Sepolia

```bash
cd contracts
export DEPLOYER_PK=<funded Sepolia key>
export FORWARDER=0x15fC6ae953E024d975e77382eEeC56A9101f9F88
export WORKFLOW_NAME=flight-settlement-staging
export WORKFLOW_AUTHOR=0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa
forge script script/Deploy.s.sol:Deploy --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast
```

**`FORWARDER` and `WORKFLOW_AUTHOR` are not obvious — both were found by tracing
a failed delivery, not by reading a flag description:**

- `FORWARDER` must be `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` — the actual
  `MockKeystoneForwarder` contract (verified on Sourcify) that
  `cre workflow simulate --broadcast` calls `report()`/`route()` on, which becomes
  `msg.sender` inside `onReport()`. This is **different** from the address
  `cre workflow supported-chains` prints as "MOCK FORWARDER" for
  `ethereum-testnet-sepolia` (`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`) — that
  one is not the caller in the local `--broadcast` path. Using it makes every
  report revert with `InvalidSender`, silently: the outer CLI tx still succeeds
  and logs "Settled", because `MockKeystoneForwarder.route()` swallows the
  receiver-call failure into a `ReportProcessed(..., success)` event and never
  reverts the outer transaction.
- `WORKFLOW_AUTHOR` must be `0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa` — a fixed
  placeholder the CLI uses for the metadata's `workflowOwner` field when there is
  no linked owner key (`cre account list-key` → "No linked owners found"). Swap
  this for the real linked owner address once one exists.

## 3. Create market, stake both sides, fire the trigger

Both sides **must** be staked — a one-sided book voids in `_processReport`
regardless of the outcome the DON agrees on, which would mask a working
settlement path. Amounts are MockUSDC (freely minted) — they don't affect real
ETH spend, only the number of broadcast transactions does (~0.002 ETH for this
whole step at ~2 gwei).

```bash
export MARKET=<from step 2>
export TOKEN=<from step 2>
export YES_PK=<funded Sepolia key>
export NO_PK=<second funded Sepolia key>
export THRESHOLD=30
forge script script/CreateAndStake.s.sol:CreateAndStake --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast
```

Grab the `requestSettlement` tx hash from the broadcast JSON:

```bash
python3 -c "
import json
d = json.load(open('broadcast/CreateAndStake.s.sol/11155111/run-latest.json'))
print([tx['hash'] for tx in d['transactions'] if tx['function'] == 'requestSettlement(uint256)'][0])
"
```

## 4. Simulate the workflow, with a real on-chain write

```bash
cd flight-market
cre workflow simulate ./flight-settlement --target staging-settings --broadcast \
  --trigger-index 0 --evm-tx-hash <hash> --evm-event-index 0 --non-interactive
```

**Do not trust the CLI's "Settled market N in tx ..." log line as proof of
success.** That log fires whenever the *outer* transaction's receipt status is
`1`, which happens even when `onReport()` itself reverted — `route()` catches
the failure and just records it. Verify against chain state directly:

```bash
cast call $MARKET \
  "markets(uint256)(string,string,uint32,uint16,uint64,uint64,uint8,uint8,bytes32,int32,uint256,uint256)" \
  0 --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

Status `3` = Settled (or `4` = Void). Status `2` = still `SettlementRequested`,
meaning the write never actually landed — check the `ReportProcessed` event on
the forwarder (`0x15fC6ae9...`) for its `result` bool.

## Flight data source

`main.ts` calls **AeroDataBox** (`GET /flights/number/{iata}/{YYYY-MM-DD}`)
via RapidAPI. Schema (the `FlightContract`/`FlightStatus` shapes in
`fetchFlight`) is pulled verbatim from the live OpenAPI spec at
doc.aerodatabox.com, not guessed — see the comment above `fetchFlight` in
`main.ts` for the exact source.

### Setup

1. Sign up at RapidAPI and subscribe to AeroDataBox
   (https://rapidapi.com/aedbx-aedbx/api/aerodatabox) — free tier exists.
2. `cp flight-market/flight-settlement/config.staging.example.json flight-market/flight-settlement/config.staging.json`
3. Fill in `apiKey` with your RapidAPI key.

`config.staging.json` is **gitignored**, not committed — same treatment as
`.env`. Config JSON values are passed through to the workflow verbatim (no
`${VAR_NAME}` substitution like `project.yaml`'s RPC urls get — confirmed by
running a real `cre workflow simulate` and reading back the literal string),
so there is no way to keep the key in a tracked file without it leaking into
git history. `config.staging.example.json` is the tracked template.

### Status mapping

AeroDataBox's `FlightStatus` enum collapses to the three states
`_processReport` already understands:

| AeroDataBox status | bucketed | outcome |
|---|---|---|
| `Canceled`, `Diverted` | `cancelled` | Yes (per contract rules) |
| `Arrived` | `landed` | Yes/No by `arrival.revisedTime - arrival.scheduledTime` vs threshold |
| `CanceledUncertain` and anything else (`Expected`, `EnRoute`, `Delayed`, …) | `airborne` | Void — no confirmed result |

Only `Arrived` computes a real delay; everything short of a confirmed
landing or cancellation voids rather than guessing.

**`CanceledUncertain` deliberately does not pay out.** AeroDataBox defines it
as "status of the flight is uncertain, may be cancelled" — a maybe, not a
fact — while the UI promises Yes for "cancelled or diverted". It originally
sat in the same branch as a confirmed cancellation and resolved markets to
Yes, paying real money on an unconfirmed signal. It now voids and refunds.
Not an edge case: **75 of 565 arrivals sampled at ORD (13%)** carried this
status.

### Verified against live data — three real bugs found this way

Tested with `cre workflow simulate` (no `--broadcast`, free) against real
flights. Cancelled ones were found by scanning airport schedules with
`withCancelled=true` — one call returns hundreds of flights, so finding a
genuine cancellation costs one request rather than dozens of guesses:

```bash
curl -s "https://aerodatabox.p.rapidapi.com/flights/airports/iata/LHR/2026-08-14T06:00/2026-08-14T18:00?direction=Departure&withCancelled=true" \
  -H "X-RapidAPI-Key: $KEY" -H "X-RapidAPI-Host: aerodatabox.p.rapidapi.com"
```

| market | flight | AeroDataBox status | result |
|---|---|---|---|
| 5 | BA286, 2026-08-13 | `Arrived`, 33 min early | `outcome=2 (No) delay=-33m` |
| 6 | BA286, 2026-08-14 | `EnRoute` | `outcome=3 (Void)` |
| 7 | BA143, 2026-08-14 | `Canceled` | `outcome=1 (Yes)` |
| 8 | DL1880, 2026-08-14 | `CanceledUncertain` | `outcome=3 (Void)` |

`Diverted` remains untested — none found across ~800 flights sampled at JFK
and ORD; genuine diversions are rare. It shares the `Canceled` branch
exactly, so the logic is covered even though that specific enum value has not
been seen live.

Three bugs showed up only against real data — the mock never exercised any of
these paths:

1. **AeroDataBox timestamps aren't RFC 3339** — `"2026-08-14 12:55Z"` (space,
   no seconds). `Date.parse` on this is implementation-defined: V8 (bun, used
   for local typechecking) accepts it; the workflow's actual WASM/QuickJS
   runtime returned `NaN`. Replaced with a small regex parser feeding
   `Date.UTC`'s numeric-argument form, which has no string-format ambiguity
   to disagree about.
2. **A genuine QuickJS runtime bug in mixed `number`/`bigint` comparison for
   negatives.** Once market 5 fixed #1, encoding the report threw
   `IntegerOutOfRangeError` for `delayMinutes = -33` on an `int32` field —
   comfortably in range. Traced into viem's `encodeAbiParameters` and
   confirmed directly in the real runtime: `-33 < -2147483648n` evaluated to
   `true`. `delayMinutes` is now passed as a `BigInt` (typed around with a
   documented cast, since viem's type-level ABI mapping expects `number` for
   int32) so the comparison is bigint-vs-bigint on both sides.

3. **`CanceledUncertain` was paying markets out** — see "Status mapping"
   above. Found while hunting for a real cancelled flight to test the
   disrupted branch.

All three fixes are in `main.ts`, with comments at the fix site pointing back
to this.

## Two independent sources

`ConsensusAggregationByFields` runs per node and protects against a dishonest
or broken *node*. It cannot protect against a wrong *source*, since every
node queries the same one. Setting `secondaryUrl` in the config adds a second
provider; empty string runs single-source.

**Sources are compared by outcome, not by value.** Two sources reporting 44
and 46 minutes against a 45-minute threshold are barely two minutes apart,
but they disagree about who gets paid — averaging them would manufacture an
answer neither source gave. `outcomeFor` is applied per source and the
results must match; if they don't, the workflow throws and the market voids,
refunding everyone. Only once the outcomes agree is the median taken, and any
remaining spread is noise within one side of the threshold.

Verified against market 5 (BA286, AeroDataBox reports `Arrived` 33 min
early), using the mock gist as a controllable second provider:

| secondary says | result |
|---|---|
| `landed`, −33 min (agrees) | `outcome=2 (No)` — settles normally |
| `landed`, +90 min (Yes vs No) | **Void** — `Sources disagree on outcome ... landed/-33m->2 vs landed/90m->1` |
| `airborne` vs a `Canceled` flight | **Void** — disagreement on status, not just delay |

A real second provider needs its own key and a `readAeroDataBox`-sized
adapter function; nothing below that layer changes. The secondary contract is
deliberately minimal (`{ status, arrivalDelayMinutes }`) so the existing mock
gist can serve as a controllable stand-in for testing — which also restores
the deterministic on-demand testing the AeroDataBox switch had cost.

## Crypto markets

`CryptoMarket.sol` — "will BTC/ETH be at or above $X at time T?", parimutuel,
settled by the same workflow through a second log trigger. Deployed at
`0x8DA11eb17D5F3f4427aA3017E95e50b132A210be`, sharing MockUSDC with the flight
market so one balance covers both.

Prices carry **8 decimals**, matching the Chainlink convention: a $63,000.00
strike is `6300000000000`.

### Why not Chainlink Price Feeds

The obvious answer for a crypto price is a Data Feed, and it is the wrong one
here. Measured directly on Sepolia, BTC/USD and ETH/USD update on a **flat
60-minute heartbeat** with no deviation trigger — six consecutive rounds, all
exactly 60 minutes apart:

```bash
cast call 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43 \
  "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" <roundId> \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
```

A 5-minute market read from that feed would compare a price against *itself*
roughly 92% of the time, always resolving No. The market would be rigged by
data cadence rather than by anyone's intent. Sub-hour horizons need real-time
exchange data, which is what the workflow fetches.

### Three USD venues, and why not Binance

Coinbase, Kraken and Bitstamp — all keyless, HTTPS, all quoting **USD**.
Binance is deliberately excluded: its liquid pair is BTC/**USDT**, and pricing
a USD market off a Tether pair adds a systematic basis rather than independent
signal. Measured on one minute of live data, Binance sat ~$70 (0.11%) away
while the three USD venues agreed within ~$8 (0.013%).

### One-minute candles, not spot quotes

Each venue is asked for the **close of the one-minute candle containing
expiry**, never a live quote. Spot would hand each DON node a different number
depending on the millisecond it asked, so consensus could never be exact. A
closed historical candle is the same value for every node however far apart
they run.

That is also why `CryptoMarket` holds settlement back `SETTLEMENT_DELAY` (60s)
past expiry: the candle does not exist until its minute is over, and settling
at expiry itself would send the workflow looking for unpublished data and void
the market for no reason.

Venues are reconciled by **outcome versus the strike**, not numeric closeness
— the same rule as the flight path, for the same reason: two venues a few
cents apart either side of the strike disagree about who gets paid.

### Never ask a venue for exactly the candle you want

Market 4 voided in production with `Coinbase has no candle for minute
1786816800` — a minute that had traded 1.04 BTC and that a wider request
returns without complaint. The request was for exactly `[T, T+60]`, and
Coinbase returns an **empty array** for that shape, reproducibly.

Measured over 114 requests across both products:

| window | candle missing |
|---|---|
| `[T, T+60]` | always |
| `[T-60, T+60]` | 8% |
| `[T-300, T+300]` | never |

So every venue is now asked for a **span** and searched for the exact minute,
never trusted to return the bucket requested. The wide Coinbase response is
~650 bytes, far inside the 250kb simulation limit, so the margin is free.
Bitstamp's `limit=1` anchored on `T` was the same bet and was widened too —
it had not failed, but its failure mode is identical: a market voided on data
that exists.

Kraken looks flaky if you loop over it quickly; that is its public rate limit,
not missing data. One call per settlement is fine.

### Verified end to end

Two markets created with the same expiry, one struck below spot and one above,
both sides staked, settled together against live venue data:

| market | strike | result | on chain |
|---|---|---|---|
| 2 | $50,000 | `outcome=1 (Yes)` | status 3, observedValue `6297370000000` |
| 3 | $80,000 | `outcome=2 (No)` | status 3, same observed price |

Both confirmed by reading `core(id)` directly and by `ReportProcessed = true`
on the forwarder — not from CLI output.

```bash
# create + stake both sides of both markets
forge script script/CreateCryptoMarkets.s.sol:CreateCryptoMarkets \
  --rpc-url $SEPOLIA_RPC_URL --broadcast
# then, once SETTLEABLE_AT passes, requestSettlement and:
cre workflow simulate ./flight-settlement --target staging-settings --broadcast \
  --trigger-index 1 --evm-tx-hash <hash> --evm-event-index 0 --non-interactive
```

`--trigger-index 1` selects the crypto handler; `0` is still the flight one.

Keep `EXPIRY_IN` generous (default 300s). `block.timestamp` in the script is
read during forge's simulation pass, but its ten transactions then broadcast
one per block — roughly two minutes. Too short a window and the stakes land
after `closeTime` and revert with `TooLate`, leaving empty markets that can
only void. That happened on the first run at 90 seconds.

### The standing slate

`CreateCryptoSlate.s.sol` creates the product slate rather than a settlement
test: BTC and ETH at **5 minutes, 15 minutes and 1 hour**, one strike per asset
set just off spot so the questions are genuinely open, the same strike across
all three horizons so the implied odds fan out with *time* rather than level.

```bash
BTC_STRIKE=63000 ETH_STRIKE=1882 STAKE_WINDOW=480 \
forge script script/CreateCryptoSlate.s.sol:CreateCryptoSlate \
  --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
```

Staking closes for every market at one shared `closeTime`, well before the
shortest expiry. That is the whole point of `closeTime` being separate from
`expiryTime`: with the book open right up to expiry, anyone could stake a
second before the price is read and take the pot off people who committed
early. `STAKE_WINDOW` must clear how long the script takes to land — 22
transactions at one per block is about four and a half minutes.

Settled against live venue data:

| market | asset | horizon | strike | observed | outcome |
|---|---|---|---|---|---|
| 4  | BTC | 5 min  | $63,000 | — | **Void** — the Coinbase window bug above |
| 10 | BTC | 5 min  | $63,000 | $63,020.26 | Yes — same path, after the fix |
| 5  | BTC | 15 min | $63,000 | $63,023.01 | Yes |
| 6  | BTC | 1 hour | $63,000 | $62,981.00 | No |
| 7  | ETH | 5 min  | $1,882  | $1,882.40  | Yes |
| 8  | ETH | 15 min | $1,882  | $1,883.25  | Yes |
| 9  | ETH | 1 hour | $1,882  | $1,881.13  | No |

Market 10 exists because market 4 died of the Coinbase bug; it re-ran the exact
5-minute BTC path that failed, and settled.

The slate did the thing it was shaped to do: with one strike per asset held
across all three horizons, both assets resolved Yes at 5 and 15 minutes and No
at an hour. Same question, same strike, opposite answer purely from how far out
it was asked — which is the property a single-horizon slate cannot show.

A strike set *exactly* at spot is the one place venues are most likely to
straddle the line and void the market — at one sampled minute the three venues
were $0.40 apart but sat either side of $1,882. Genuine behaviour, not a fault,
but worth knowing when choosing a strike for a demo.

### Mock gist (kept for deterministic testing)

The original mock is still useful for exercising all three outcomes on
demand, without depending on a real flight's timing. It no longer matches
`main.ts`'s expected response shape (`fetchFlight` now parses AeroDataBox's
`FlightContract`, not `{status, arrivalDelayMinutes}`) — reviving it would
mean pointing `apiUrl` at a small shim that returns AeroDataBox-shaped JSON,
or keeping a second workflow variant around. Not done, since it wasn't asked
for; noting the option here in case deterministic on-demand testing is
needed again later.

Public gist: https://gist.github.com/Wnbj/c0d43e5e48303654c2c5219d815495e4

Historical results, from when `main.ts` still spoke the mock's shape — all
three re-verified end-to-end on the `ReceiverTemplate`-based contract on real
Sepolia (contract `0x09068efb21fabeac59694e01428cf438cf38e2b3`), confirmed
via direct `cast call` on-chain state:

| market | outcome | on-chain status | on-chain outcome |
|---|---|---|---|
| 0 | Yes (delay 42) | 3 (Settled) | 1 |
| 1 | No (delay 15)  | 3 (Settled) | 2 |
| 2 | Void (airborne) | 4 (Void)   | 3 |

## Stock and commodity markets

`StockMarket.sol` — "will CSPX be at or above $X at time T?", settled from a
**Chainlink Data Feed** instead of exchange APIs. Deployed at
`0x451bcdB90EC6f6F5f40B5B2578aef641e36b71ca`, same MockUSDC as the others.

### Why a feed here, when the crypto market refuses one

The objection was never feeds, it was cadence. BTC/USD on Sepolia publishes on
a flat 60-minute heartbeat, so a 5-minute market read from it compares a price
against itself. CSPX/USD publishes about daily, and an equity market's natural
horizon is a session. Same instrument, opposite verdict, because the question
is on a different timescale.

There are **no single-stock feeds on Sepolia** — no AAPL, no TSLA. What exists
(all verified live before being registered):

| symbol | what it is | heartbeat |
|---|---|---|
| CSPX | iShares Core S&P 500 UCITS ETF, USD | ~daily |
| XAU | gold, USD | hourly |
| IB01 | iShares $ Treasury Bond 0-1yr ETF, USD | ~daily |

CSPX is the closest honest thing to an equity market there: the S&P 500 in one
number.

### Reads are pinned to a block

Every DON node runs the workflow independently. Reading `latestRoundData()` at
"latest" gives each node whichever chain head it happened to see, the report
bytes differ, and consensus fails — the same problem that ruled out spot quotes
for crypto. The trigger log carries its own block number, so every node already
shares one agreed reference point; all feed reads pin to it.

### The trading calendar is the hard part, not the price

A feed keeps publishing when the exchange behind it is shut. It simply repeats
the last price with a fresh timestamp. Measured on Sepolia:

| feed | observation |
|---|---|
| CSPX/USD | answer changed on **every** weekday round; **unchanged** Friday → Saturday |
| XAU/USD | **4,377.25 for twelve consecutive hourly rounds** across a Saturday |

So a market expiring while the exchange is closed is decided the moment the
bell rings, and anyone staking afterwards is betting on a known result. The
chain cannot know an exchange calendar — but it can notice that nothing
happened. The workflow therefore **voids unless the answer actually changed
between `closeTime` and `expiryTime`**, which is why `SettlementRequested`
carries both. It also voids on a round older than the market's own
`maxStaleness`, which is per market because a daily feed and an hourly one
cannot share a threshold.

### Feeds are allowlisted

`newMarket` is permissionless. If the feed address came from the caller, anyone
could create a real-looking market pointing at a contract they control and hand
themselves the settlement price. The owner registers feeds; callers pick one by
symbol, and that symbol is what labels the market in the UI.

```bash
forge script script/DeployStock.s.sol:DeployStock \
  --rpc-url $SEPOLIA_RPC_URL --broadcast
# then, once settleAfter passes, requestSettlement and:
cre workflow simulate ./flight-settlement --target staging-settings --broadcast \
  --trigger-index 2 --evm-tx-hash <hash> --evm-event-index 0 --non-interactive
```

`--trigger-index 2` selects the stock handler; 0 is flights, 1 is crypto.

### Verified against historical feed rounds

`newMarket` does not require future timestamps, which makes a backtest possible:
create a market whose close and expiry are already in the past and it is
settleable immediately, against feed rounds that really happened. Staking
reverts with `TooLate`, so the book stays empty and the contract voids on
payout grounds — but `outcome` and `observedValue` are still written, which is
exactly the part being tested. Far better than waiting an hour to discover the
round walk was wrong.

Market 2, close `1786814870`, expiry `1786818470`, strike $62,000:

| what | value |
|---|---|
| pinned block | 11496208 (the settlement-request block) |
| round in force at close | 16:46:24 → `6302552471078` |
| round in force at expiry | 17:46:48 → `6299976883013` |
| moved between the two? | yes, so not voided |
| on chain | `outcome=1 (Yes)`, `observedValue=6299976883013` |

The observed value matches the 17:46:48 round exactly — the last one published
at or before expiry — confirming the walk landed on the right round rather than
on `latest`.

### Verified live, not just backtested

Market 1 — the same BTC feed, real future expiry, both sides staked — settled
an hour later against a round that had not been published when the market was
created: `outcome=1 (Yes)`, `observedValue=6304701036297` ($63,047.01) vs a
$63,000 strike, in tx
`0x1743badf35a3fe29175c78527311d20194e4fa21792178db0910e0115e490ecf`.

## The reconciliation sweep (cron trigger)

The log-trigger design has a hole that has nothing to do with the code: **it
needs someone to emit the log**. Every settlement in this project began with a
human calling `requestSettlement()`. If the workflow was down when the event
fired, or the settlement reverted, the market simply stays stuck — no second
log is coming.

`onSweep` is a fourth handler on a **cron trigger** (`cron-trigger@1.0.0`,
already in the SDK). It reads the three market contracts directly and settles
anything sitting in `SettlementRequested`, through the *same* settle functions
the log handlers call — so a market settled by the sweep can never resolve
differently from one settled by the trigger.

```bash
cre workflow simulate ./flight-settlement --target staging-settings --broadcast \
  --trigger-index 3 --non-interactive
```

It paid for itself on the first run, finding three flight markets (6, 7, 8)
left stuck in `SettlementRequested` by earlier sessions and settling all three.

### Pinned to finalized, and why that sets the schedule

A cron tick has no log to take a block from, and reading at `latest` would hand
every DON node a different chain head — different report bytes, failed
consensus. So every sweep read pins to the **last finalized block**, the one
view of the chain nodes converge on without coordinating.

That has a cost, and the first run demonstrated it. Finalized state lags:

```bash
cast block finalized --rpc-url $SEPOLIA_RPC_URL   # measured: 86 blocks / 17m12s behind latest
```

Run the sweep again a minute later and it sees the markets it just settled as
still stuck, and settles them again. The contract rejects the duplicate —
`ReportProcessed = false` on the forwarder, verified on the receipt — so
nothing corrupts, but each retry burns a transaction.

**The sweep period must therefore exceed the chain's finality lag.** At the
initial five minutes that was three wasted writes per market; the schedule is
now every 30 minutes, comfortably above the measured 17. Going faster would
mean reading unfinalized state, trading determinism for latency — the wrong
trade for a safety net, when the log trigger is already the fast path.

Measured concretely on the run that exposed this: the settlements landed in
blocks `11497177`–`11497180`, and eight minutes later `finalized` was still at
`11497135` — 42 blocks short. Re-running the sweep in that window found and
re-settled the same three markets, and the contract rejected all three. Do not
judge whether a sweep worked by re-running it; read the contract.

### What it does not fix

The sweep removes the human from *running the workflow*. It does not remove the
human from *calling `requestSettlement()`* — a CRE workflow's only on-chain
write is a signed report to `onReport()`, so it cannot make that call. Full
autonomy needs `_processReport` to accept a report for any market past
`settleAfter`, dropping the request step entirely. That is a change to
`ParimutuelMarket`, so it lands whenever the contracts are next redeployed;
`requestSettlement` exists only to give a log trigger something to listen to,
and adds nothing to authorisation, which is already forwarder + author +
workflow name.

## Secrets: the API key is currently in the clear

`config.staging.json` carries the RapidAPI key as plaintext. That file is
gitignored, but the config is **handed to the DON**, so every node operator
running this workflow can read the key. Fine for a POC on a free tier; not
fine for anything with a bill attached.

The SDK has the fix: `runtime.getSecret({ id, namespace })` resolves a value
from the Vault DON, so it never appears in config. `resolveApiKey` in `main.ts`
uses it when `apiKeySecretId` is set and falls back to `apiKey` otherwise, so
the existing verified path is untouched until the secret exists.

**It has not been exercised, and activating it is not free.** `cre secrets list`
fails with:

```
failed to create workflow registry client: failed to create client for chain
"ethereum-mainnet": rpc url not found for chain ethereum-mainnet
```

The workflow/secrets registry lives on **Ethereum mainnet**. Using it needs a
mainnet RPC in `project.yaml`, and `cre secrets create` is a real mainnet
transaction that uploads the key to the Vault DON — real gas, and a credential
leaving this machine. Both are decisions for the account owner, so the code
path is in place and the upload is deliberately not done.

A further step after that is the **confidential HTTP** capability
(`networking/confidentialhttp`), which templates the secret into the request on
the node rather than passing it through workflow memory as a string.

## Appendix: free local rehearsal via anvil fork

Before spending real Sepolia ETH, the same flow can run against a local anvil
fork of Sepolia (same chain id 11155111, so the CRE simulator treats it as
Sepolia). Useful for iterating on `main.ts` without gas cost, but **cannot**
exercise the real `onReport` path — anvil has no `MockKeystoneForwarder`
deployed at `0x15fC6ae9...` unless you deploy one yourself, and
`simulate --broadcast` against a fork you don't control the forwarder on will
just fail to route.

```bash
anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com --port 8545
# then run Deploy.s.sol / CreateAndStake.s.sol against --rpc-url http://localhost:8545
# with any anvil default private key, and cre workflow simulate (no --broadcast)
# against the resulting requestSettlement tx hash.
```

## Known gaps

- **Deploy access is not enabled for this account**, so the workflow itself has
  never been registered with a real Chainlink DON via `cre workflow deploy`.
  Everything above runs through `cre workflow simulate`, which executes the
  workflow logic locally and (with `--broadcast`) submits the resulting write
  for real — but there is no live DON reaching consensus across independent
  nodes. The `FORWARDER`/`WORKFLOW_AUTHOR` values above are specific to this
  local-CLI-broadcast path and will need to change once a real DON is involved.
- `project.yaml` staging RPC points at `https://ethereum-sepolia-rpc.publicnode.com`
  (real Sepolia). Swap to a local anvil fork URL if rehearsing for free (see
  Appendix).
- **`Diverted` is the one status never seen live** — none across ~800 flights
  sampled at JFK and ORD. It shares the `Canceled` branch exactly, so the
  logic is exercised, but that specific enum value has not come back from the
  API in testing.
- **Only one real provider is wired.** The two-source mechanism and its
  disagreement handling are built and tested (see "Two independent sources"),
  but the second slot was tested with the mock gist standing in. A genuinely
  independent second provider still needs its own subscription — free,
  HTTPS-capable flight APIs with actual arrival times are scarce (AviationStack's
  free tier is HTTP-only, which CRE rejects; FlightLabs' free allowance is ~50
  requests; FlightAware is paid).
- **Rate limits are per-second on the free plan**, and a real DON multiplies
  every settlement by its node count. A production deployment would need a
  paid tier sized to the DON, or a caching layer in front of the provider.
- **Short-horizon crypto markets are impractical without deploy access.** A
  5-minute market wants settling seconds after expiry; every settlement is
  currently a hand-run command. Longer horizons are the usable ones until the
  workflow runs on a real DON.
- **FlightMarket does not inherit `ParimutuelMarket`.** The shared base was
  extracted from it, and `CryptoMarket` uses it, but the flight contract is
  already deployed with live positions and is wired into the frontend by its
  exact ABI — migrating it would mean a new address and orphaned markets for
  no functional gain. It should move onto the base whenever it is next
  redeployed. Until then the parimutuel logic exists in two places, and the
  `Settled` event differs between them (`int32` there, `int256` in the base),
  which the frontend has to decode separately.
- **Two dead crypto markets (ids 0 and 1)** exist from the first
  `CreateCryptoMarkets` run, whose stakes reverted with `TooLate`. They have
  empty pools and can only ever void.
