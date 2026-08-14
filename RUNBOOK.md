# Flight-delay prediction market — POC runbook

End-to-end settlement (real Sepolia log trigger → CRE workflow → real
`onReport()` write, verified via on-chain state, not just CLI output) is
**proven**. `FlightMarket.sol` inherits `ReceiverTemplate` (from
smartcontractkit/cre-gcp-prediction-market-demo) for forwarder/author/name
validation instead of hand-rolled checks.

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

## Mock flight API

Public gist: https://gist.github.com/Wnbj/c0d43e5e48303654c2c5219d815495e4

**Use the commit-pinned raw URL**, not the floating one. The floating
`/raw/flight-status.json` is served with `cache-control: max-age=300`, so edits
take up to 5 minutes to appear and query params do not bust the cache. Pinned
URLs are immutable and update instantly:

```bash
SHA=$(gh api gists/c0d43e5e48303654c2c5219d815495e4 --jq '.history[0].version')
echo "https://gist.githubusercontent.com/Wnbj/c0d43e5e48303654c2c5219d815495e4/raw/$SHA/flight-status.json"
```

Then put that URL in `flight-market/flight-settlement/config.staging.json`.

### Resolution paths (market threshold = 30)

| gist content | outcome |
|---|---|
| `{"status":"landed","arrivalDelayMinutes":42}` | 1 = Yes |
| `{"status":"landed","arrivalDelayMinutes":15}` | 2 = No |
| `{"status":"airborne","arrivalDelayMinutes":null}` | 3 = Void |

All three verified (against the pre-`ReceiverTemplate` contract; the resolution
logic in `_processReport` is unchanged, so they still hold).

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
