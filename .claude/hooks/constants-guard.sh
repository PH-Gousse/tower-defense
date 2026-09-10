#!/usr/bin/env bash
# PreToolUse on Edit|Write — the balance-constants guard.
#
# docs/invariants.md rule 12: constants change only through /rule-change or
# /balance acceptance. This is what enforces it.
#
# The mechanism is a MARKER FILE, .claude/.rule-change-active, set by
# `pnpm rule-change:begin` and cleared by `pnpm rule-change:end`. A file rather
# than an environment variable because a hook runs in its own process and cannot
# see a variable the model set — but it can see a file. It is gitignored, so it
# never travels between machines or into a commit.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
payload="$(cat)"

file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
[ -z "$file_path" ] && exit 0
rel="${file_path#"$root"/}"

guarded=""
case "$rel" in
  packages/sim/data/*.json) guarded="the balance data" ;;
  packages/sim/src/data.ts|packages/sim/src/state.ts)
    # These two hold STARTING_GOLD, STARTING_INCOME and STARTING_LIVES among
    # ordinary code, so the whole file cannot be blocked without blocking real
    # work. Block only an edit that touches one of those declarations.
    if printf '%s' "$payload" | jq -r '[.tool_input.new_string?, .tool_input.old_string?, .tool_input.content?] | map(select(. != null)) | join("\n")' \
       | grep -qE '^\s*export (let|const) (STARTING_GOLD|STARTING_INCOME|STARTING_LIVES)'; then
      guarded="a starting-value constant"
    fi
    ;;
esac
[ -z "$guarded" ] && exit 0

if [ -f "$root/.claude/.rule-change-active" ]; then
  # Disarmed. Say so on every edit rather than staying silent — a guard that is
  # off and quiet is how a marker gets left behind for a week.
  jq -n --arg f "$rel" --arg m "$(cat "$root/.claude/.rule-change-active" 2>/dev/null)" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",
      additionalContext:("Constants guard is DISARMED (" + $m + "), so the edit to " + $f + " is allowed. Run `pnpm rule-change:end` when finished — a marker left behind disarms the guard for every later session.")}}'
  exit 0
fi

reason="Blocked: $rel holds $guarded, and balance constants change only through /rule-change.

docs/invariants.md rule 12 — the GDD, the constants and the tests move together, or they drift apart.

If this IS a rule change:
  pnpm rule-change:begin      then make the edit, then pnpm rule-change:end

If you are only reading a number, you do not need to edit the file.
If /balance proposed this, it must still go through /rule-change — proposing and applying are deliberately separate."

jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",
  permissionDecision:"deny", permissionDecisionReason:$r}}'
exit 0
