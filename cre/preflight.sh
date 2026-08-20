#!/usr/bin/env bash
#
# Read-only check of the three things that fail SILENTLY on this project.
#
#   ./preflight.sh [staging|production]
#
# Runs before a settlement, or after any redeploy. Sends no transaction, holds
# no key, changes nothing — every line below is an `eth_call`.
#
# What it checks, and why each one is here rather than trusted:
#
#   1. The expected workflow NAME on every contract. A mismatch makes the
#      receiver reject every report while the forwarder swallows the failure
#      into an event, so the CLI still prints "Settled" and the market never
#      moves. This is the hardest failure in the system to see, and the
#      derivation is easy to get wrong: it is sha256(name), hex-encoded, first
#      ten characters, stored as the ASCII of those characters. The notes in
#      this repo said keccak256 until 2026-08-19.
#
#   2. The expected AUTHOR. `simulate --broadcast` has no linked owner, so the
#      CLI fills in a fixed placeholder; the contracts must expect that exact
#      address or every report is refused, silently, the same way.
#
#   3. The FORWARDER each contract trusts, against the address that actually
#      calls `onReport` in the simulate path. The one the CLI advertises as
#      "MOCK FORWARDER" is NOT that address — see RUNBOOK.
#
# Exit status is 0 only when every row passes.

set -uo pipefail

TARGET="${1:-staging}"
RPC="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"

# The address that becomes msg.sender inside onReport under
# `cre workflow simulate --broadcast`. Traced from a failed delivery, not read
# off a flag description.
EXPECT_FORWARDER="0x15fC6ae953E024d975e77382eEeC56A9101f9F88"

# The placeholder owner the CLI stamps when no owner key is linked.
EXPECT_AUTHOR="0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"

CONFIG="$(dirname "$0")/settlement/config.${TARGET}.json"
WORKFLOW_NAME="flight-settlement-${TARGET}"

command -v cast >/dev/null || { echo "cast not on PATH — export \$HOME/.foundry/bin"; exit 2; }
[ -f "$CONFIG" ] || { echo "no config at $CONFIG"; exit 2; }

# sha256(name) -> hex -> first 10 chars -> those chars as bytes10.
expected_name=$(python3 -c "
import hashlib
print('0x' + hashlib.sha256('$WORKFLOW_NAME'.encode()).hexdigest()[:10].encode().hex())
")

echo
echo "  target        $TARGET"
echo "  workflow      $WORKFLOW_NAME"
echo "  name digest   $expected_name  (sha256, first 10 hex chars, as ASCII)"
echo "  forwarder     $EXPECT_FORWARDER"
echo

fail=0
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

check() { # label, actual, expected
  if [ "$(lower "$2")" = "$(lower "$3")" ]; then
    printf '    \033[32mok\033[0m    %s\n' "$1"
  else
    printf '    \033[31mFAIL\033[0m  %s\n          got      %s\n          expected %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

# Every contract address the workflow is configured to talk to.
while IFS='=' read -r label address; do
  [ -z "$address" ] && continue
  [ "$address" = "null" ] && continue
  [ "$address" = "" ] && continue
  echo "  $label  $address"
  check "workflow name" "$(cast call "$address" 'getExpectedWorkflowName()(bytes10)' --rpc-url "$RPC" 2>&1)" "$expected_name"
  check "author"        "$(cast call "$address" 'getExpectedAuthor()(address)'      --rpc-url "$RPC" 2>&1)" "$EXPECT_AUTHOR"
  check "forwarder"     "$(cast call "$address" 'getForwarderAddress()(address)'    --rpc-url "$RPC" 2>&1)" "$EXPECT_FORWARDER"
  echo
done < <(python3 -c "
import json
c = json.load(open('$CONFIG'))
for key, label in (
    ('flightContractAddress',  'flight '),
    ('cryptoContractAddress',  'crypto '),
    ('stockContractAddress',   'stock  '),
    ('reserveContractAddress', 'reserve'),
    ('ammContractAddress',     'amm    '),
):
    v = c.get(key) or ''
    if v:
        print(f'{label}={v}')
")

# The frontend keeps its own copy of every address, defaulted in config.ts and
# overridable per environment. Nothing sits between the two files, so a
# redeploy that updates one and not the other leaves the app showing markets
# nobody settles, or the workflow settling markets nobody can see. Neither
# side errors; they simply describe different systems.
echo "  frontend vs workflow config"
frontend_diff=$(python3 - "$CONFIG" <<'PYEOF'
import json, re, sys, pathlib

config = json.load(open(sys.argv[1]))
source = pathlib.Path(__file__).resolve().parent if False else None
ts = pathlib.Path("frontend/src/lib/config.ts")
if not ts.exists():
    ts = pathlib.Path(__file__).resolve().parents[1] / "frontend/src/lib/config.ts"
text = ts.read_text()

pairs = {
    "FLIGHT": "flightContractAddress",
    "CRYPTO": "cryptoContractAddress",
    "STOCK": "stockContractAddress",
    "RESERVE": "reserveContractAddress",
    "AMM": "ammContractAddress",
}

bad = 0
for name, key in pairs.items():
    m = re.search(rf'{name}_MARKET_ADDRESS = \(import\.meta\.env\.\w+ \?\?\s*"(0x[0-9a-fA-F]{{40}})"', text)
    app = m.group(1).lower() if m else None
    flow = (config.get(key) or "").lower()
    if app is None:
        print(f"    MISSING  {name}_MARKET_ADDRESS not found in config.ts"); bad += 1
    elif not flow:
        print(f"    skip     {name}: not configured for the workflow")
    elif app != flow:
        print(f"    MISMATCH {name}\n             app  {app}\n             flow {flow}"); bad += 1
    else:
        print(f"    ok       {name}")
sys.exit(1 if bad else 0)
PYEOF
)
echo "$frontend_diff" | sed 's/    MISMATCH/    \x1b[31mMISMATCH\x1b[0m/; s/    MISSING/    \x1b[31mMISSING\x1b[0m/; s/    ok  /    \x1b[32mok\x1b[0m  /'
case "$frontend_diff" in *MISMATCH*|*MISSING*) fail=1 ;; esac
echo "  (frontend values are the config.ts defaults — a VITE_ override in the"
echo "   environment that serves the app would win over them)"
echo

if [ $fail -eq 0 ]; then
  printf '  \033[32mAll contracts agree with %s.\033[0m\n\n' "$WORKFLOW_NAME"
else
  printf '  \033[31mSomething above does not agree.\033[0m A contract row means that\n'
  printf '  receiver would refuse a report, silently. A config row means the app and\n'
  printf '  the workflow are pointed at different markets, also silently.\n\n'
fi
exit $fail
