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
