#!/usr/bin/env bash
# Stop — before the turn ends, if packages/sim changed this session, prove it.
#
# The post-edit hook is deliberately narrow (one test file, ~0.6s) so it can run
# after every edit. This is where the full sweep happens: the whole sim suite
# plus determinism-check. Nothing escapes; it is deferred from per-edit to
# per-turn.
#
# Blocks "done" with the failure output. That is the point — "I've finished" on
# a sim change that has not been verified is the claim this exists to prevent.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
payload="$(cat)"
sid=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')

touched="$root/.claude/.state/sim-touched-$sid"
[ -f "$touched" ] || exit 0            # sim untouched: nothing to check

# Loop guard. Blocking makes the model continue and Stop fires again; if the
# check cannot be made to pass, that is an infinite loop with no way out. Two
# blocks, then let the turn end with the failure stated loudly. The work is not
# done either way — but a wedged session helps nobody.
attempts="$root/.claude/.state/stop-blocks-$sid"
n=$(cat "$attempts" 2>/dev/null || echo 0)

files=$(sort -u "$touched" | sed 's/^/    /')

det=$(cd "$root" && pnpm determinism-check 2>&1); det_ok=$?
tests=$(cd "$root/packages/sim" && npx --no-install vitest run --reporter=dot 2>&1); tests_ok=$?

if [ "$det_ok" = "0" ] && [ "$tests_ok" = "0" ]; then
  rm -f "$touched" "$attempts"
  det_line=$(printf '%s' "$det" | grep -E '^\s+PASS' | head -1 | sed 's/^ *//')
  test_line=$(printf '%s' "$tests" | grep -E 'Tests +[0-9]' | head -1 | sed 's/^ *//')
  jq -n --arg d "$det_line" --arg t "$test_line" --arg f "$files" \
    '{hookSpecificOutput:{hookEventName:"Stop",
      additionalContext:("Stop guard: packages/sim changed this session and both checks passed.\n" + $d + "\n" + $t + "\n\nChanged:\n" + $f + "\n\nNote: this does NOT cover cross-engine agreement. Run `bun run scripts/golden-jsc.ts` before shipping.")}}'
  exit 0
fi

n=$((n + 1))
printf '%s' "$n" > "$attempts"

detail=""
[ "$det_ok" != "0" ] && detail="${detail}determinism-check FAILED:"$'\n'"$(printf '%s' "$det" | tail -30)"$'\n\n'
[ "$tests_ok" != "0" ] && detail="${detail}sim tests FAILED:"$'\n'"$(printf '%s' "$tests" | tail -30)"$'\n'

if [ "$n" -ge 3 ]; then
  rm -f "$attempts"
  jq -n --arg d "$detail" --arg f "$files" '{hookSpecificOutput:{hookEventName:"Stop",
    additionalContext:("Stop guard has blocked twice and is now standing down to avoid wedging the session. THE SIM IS STILL BROKEN — do not report this work as done.\n\nChanged:\n" + $f + "\n\n" + $d)}}'
  exit 0
fi

reason="The sim changed this session and its checks do not pass. Not done yet.

Changed:
$files

$detail
Fix the failure. Do not weaken determinism-check, a test, or this hook to get past it.
If a replay legitimately broke, that goes through /rule-change with a written reason."

jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"Stop",
  permissionDecision:"deny", permissionDecisionReason:$r}}'
exit 2
