#!/usr/bin/env bash
#
# Filter `cre workflow simulate` output down to the lines worth watching.
#
#   cre workflow simulate ./settlement --target staging-settings --broadcast \
#     --trigger-index 2 --evm-tx-hash 0x... --evm-event-index 0 --non-interactive \
#     | ./readable.sh
#
# Reads stdin and never runs anything itself, so it cannot broadcast, retry or
# otherwise change what the command above did. Pass -v to see the raw output
# as well as the filtered lines.
#
# What it drops: the banner, the simulation limits, the binary/config hashes,
# and the "ready to deploy?" box. What it keeps: every line the workflow itself
# logged, the result, and anything that looks like a failure.
#
# THE TIMESTAMPS: the CLI stamps its lines `...Z`, but the clock it reads is
# the LOCAL one — measured 2026-08-17, printed 20:51:35Z while UTC was
# 17:51:53. So the `Z` is wrong, not the time. This script relabels those
# stamps as local and appends the true UTC, because a settlement is judged
# against contract times, which are UTC.

set -uo pipefail

verbose=0
[ "${1:-}" = "-v" ] || [ "${1:-}" = "--all" ] && verbose=1

# Offset between the local clock the CLI prints and real UTC.
offset_hours=$(( $(date +%z | cut -c1-3) ))

utc_of() { # HH:MM:SS local -> HH:MM:SS UTC
  local h=${1%%:*} rest=${1#*:}
  printf "%02d:%s" $(( (10#$h - offset_hours + 24) % 24 )) "$rest"
}

printf '\n'
while IFS= read -r line; do
  [ $verbose -eq 1 ] && printf '  \033[2m%s\033[0m\n' "$line"

  # Strip ANSI colour the CLI may have added before matching on content.
  clean=$(printf '%s' "$line" | sed $'s/\033\\[[0-9;]*m//g')

  case "$clean" in
    *"[USER LOG]"*)
      stamp=$(printf '%s' "$clean" | sed -n 's/.*T\([0-9:]\{8\}\)Z.*/\1/p')
      msg=${clean#*"[USER LOG] "}
      # A market voiding is the one line that must not slide past in cyan with
      # everything else — it is the workflow refusing to settle, and on a demo
      # it is the difference between "it worked" and "it refunded everyone".
      colour=36
      case "$msg" in
        *voiding*|*failed*|*Failed*|*disagree*) colour=31 ;;
      esac
      if [ -n "$stamp" ]; then
        printf '  \033[36m%s local  %s UTC\033[0m  \033[%sm%s\033[0m\n' \
          "$stamp" "$(utc_of "$stamp")" "$colour" "$msg"
      else
        printf '  \033[%sm%s\033[0m\n' "$colour" "$msg"
      fi
      ;;
    *"Workflow Simulation Result"*)
      printf '\n  \033[32m→ result:\033[0m '
      ;;
    *"Running trigger"*)
      printf '  \033[2m%s\033[0m\n' "${clean#*] }"
      ;;
    *Error*|*error*|*failed*|*Failed*|*panic*|*"✗"*)
      printf '  \033[31m%s\033[0m\n' "$clean"
      ;;
    '"'*'"'|"nothing stuck")
      # The result value, printed on the line after the header above.
      printf '%s\n' "$clean"
      ;;
  esac
done
printf '\n'
