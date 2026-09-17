#!/usr/bin/env bash
# PostToolUse on Edit|Write — the art factory's per-edit checks.
#
#   art/specs/*.yaml        → pnpm spec-validate <id>      (well under a second)
#   art/sounds/*.yaml       → (the synth validates on run; nothing here)
#   art/generators/**/*.py  → pytest: the generator unit tests AND the
#                             registry.json / generators.md sync tests
#
# Also records that art changed this session, for the Stop guard. Cannot
# block (PostToolUse never can); it reports through additionalContext.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
payload="$(cat)"
file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
[ -z "$file_path" ] && exit 0
[ -f "$file_path" ] || exit 0
# The checkout this file belongs to, which is a worktree when the session is
# in one; CLAUDE_PROJECT_DIR stays the main checkout (lib/file-root.sh, #53).
. "$(dirname "${BASH_SOURCE[0]}")/lib/file-root.sh"
root="$(file_root "$file_path" "$root")"
rel="${file_path#"$root"/}"
sid=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')

note=""
fail=0
case "$rel" in
  art/specs/*.yaml)
    id=$(basename "$rel" .yaml)
    mkdir -p "$root/.claude/.state"
    printf '%s\n' "$rel" >> "$root/.claude/.state/art-touched-$sid"
    out=$(cd "$root" && pnpm --silent spec-validate "$id" 2>&1)
    last=$(printf '%s' "$out" | tail -1)
    ok=$(printf '%s' "$last" | jq -r 'if has("ok") then .ok else "unknown" end' 2>/dev/null)
    if [ "$ok" = "true" ]; then
      note="spec-validate $id: ok ($(printf '%s' "$last" | jq -r '.specs[0].hash' 2>/dev/null))"
    else
      fail=1
      note="spec-validate $id FAILED:"$'\n'"$(printf '%s' "$out" | grep -vE '^\{' | tail -12)"
    fi
    ;;
  art/generators/ltw_art/*.py|art/generators/ltw_art/*/*.py)
    mkdir -p "$root/.claude/.state"
    printf '%s\n' "$rel" >> "$root/.claude/.state/art-touched-$sid"
    out=$(cd "$root/art/generators" && python3 -m pytest tests -q -x 2>&1)
    if [ $? -eq 0 ]; then
      note="generator tests: $(printf '%s' "$out" | tail -1)"
    else
      fail=1
      note="generator tests FAILED (this includes the registry.json / generators.md sync tests):"$'\n'"$(printf '%s' "$out" | grep -E 'FAILED|assert|Error|run:' | head -12)"
    fi
    ;;
  assets/*|art/sounds/*.yaml)
    mkdir -p "$root/.claude/.state"
    printf '%s\n' "$rel" >> "$root/.claude/.state/art-touched-$sid"
    exit 0
    ;;
  *) exit 0 ;;
esac

if [ "$fail" = "0" ]; then
  jq -n --arg n "$note" '{hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$n}}'
  exit 0
fi
jq -n --arg n "$note" --arg f "$rel" '{hookSpecificOutput:{hookEventName:"PostToolUse",
  additionalContext:("Art post-edit check FAILED for " + $f + ":\n\n" + $n + "\n\nFix this before continuing. If a sync test failed, regenerate the file it names; never hand-edit it."),
  systemMessage:("art post-edit check failed for " + $f)}}'
exit 0
