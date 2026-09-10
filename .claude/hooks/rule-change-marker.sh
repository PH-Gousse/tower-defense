#!/usr/bin/env bash
# Arm or disarm the constants guard.
#
# The guard (see .claude/hooks/constants-guard.sh) blocks edits to the balance
# constants unless this marker exists. `/rule-change` and `/balance` acceptance
# are the only sanctioned ways to set it — docs/invariants.md rule 12.
#
# The marker is a FILE rather than an environment variable on purpose: a hook
# runs in its own process and cannot see a variable the model set, but it can
# see a file. It is gitignored, so it never travels between machines.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
marker="$root/.claude/.rule-change-active"

case "${1:-}" in
  begin)
    printf '%s\n' "armed $(date -u +%Y-%m-%dT%H:%M:%SZ) by ${2:-rule-change}" > "$marker"
    echo "constants guard DISARMED — edits to packages/sim/data/*.json are now allowed."
    echo "Run 'pnpm rule-change:end' when you are done, even if you abandon the change."
    ;;
  end)
    rm -f "$marker"
    echo "constants guard ARMED — edits to the balance constants are blocked again."
    ;;
  status)
    if [ -f "$marker" ]; then
      echo "DISARMED — $(cat "$marker")"
    else
      echo "ARMED — constants are protected"
    fi
    ;;
  *)
    echo "usage: rule-change-marker.sh {begin|end|status} [reason]" >&2
    exit 2
    ;;
esac
