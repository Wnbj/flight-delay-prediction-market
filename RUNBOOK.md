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
| `Canceled`, `CanceledUncertain`, `Diverted` | `cancelled` | Yes (per contract rules) |
| `Arrived` | `landed` | Yes/No by `arrival.revisedTime - arrival.scheduledTime` vs threshold |
| anything else (`Expected`, `EnRoute`, `Delayed`, …) | `airborne` | Void — no final delay yet |

Only `Arrived` computes a real delay; everything short of landing voids
rather than guessing, same as before.

### Not yet verified

The AeroDataBox call itself has **not** been run against a live key — no key
was available while building this. Before relying on it:
run `cre workflow simulate` (no `--broadcast`) against a market created with
a **real** flight number and a date AeroDataBox actually covers (its free
tier's historical lookback is limited — check current coverage before
picking a date), and confirm `fetchFlight` parses a real response rather
than throwing.

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
- **AeroDataBox is wired in but untested against a live key** — see "Not yet
  verified" above. The gist mock it replaced no longer matches the response
  shape `fetchFlight` expects, so deterministic on-demand testing (pick any
  outcome at will) isn't available until either a real flight with known
  timing is used, or a shim reviving the mock is built.
- **Single data source.** `ConsensusAggregationByFields` already runs
  per-node, but every node calls the same AeroDataBox endpoint — it protects
  against a dishonest/broken *node*, not a wrong *source*. A second
  independent provider feeding the same `median` aggregation would close
  that gap; not built, since it's a straightforward extension of the
  existing pattern rather than a new mechanism.
