#!/usr/bin/env bash
# PreToolUse on Edit|Write — the banned-API guard for packages/sim.
#
# Scans the PROPOSED content, not the file on disk. That is the whole point: by
# the time a bad line is on disk the guard has already failed, and the next
# person to notice is CI on a different engine.
#
# For an Edit it reconstructs the full file with the replacement applied, so
# reported line numbers are the ones the file WILL have. Scanning the fragment
# alone would report line 2 of a hunk, which is useless for finding anything.
#
# Blocks with permissionDecision: deny and the offending line.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
payload="$(cat)"

file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
[ -z "$file_path" ] && exit 0

# Repo-relative, which is what the exemption table is keyed on.
rel="${file_path#"$root"/}"
case "$rel" in
  packages/sim/src/*.ts) ;;
  *) exit 0 ;;   # not the sim: nothing to say
esac

tool=$(printf '%s' "$payload" | jq -r '.tool_name')
tmp="$(mktemp -t simguard).ts"
trap 'rm -f "$tmp"' EXIT

case "$tool" in
  Write)
    printf '%s' "$payload" | jq -r '.tool_input.content // ""' > "$tmp"
    ;;
  Edit)
    if [ ! -f "$file_path" ]; then exit 0; fi
    # Reconstruct the post-edit file so line numbers are real. Python rather
    # than sed: old_string and new_string are arbitrary text and routinely
    # contain characters sed would treat as syntax.
    printf '%s' "$payload" | ROOT="$file_path" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
ti = d.get("tool_input", {})
old, new = ti.get("old_string", ""), ti.get("new_string", "")
src = open(os.environ["ROOT"], encoding="utf-8").read()
count = -1 if ti.get("replace_all") else 1
sys.stdout.write(src.replace(old, new, count) if old else src)
' > "$tmp" 2>/dev/null || exit 0
    ;;
  *) exit 0 ;;
esac

[ -s "$tmp" ] || exit 0

out=$(cd "$root/packages/harness" && npx --no-install vite-node tools/banned-api-scan.ts "$tmp" --as "$rel" --quiet 2>/dev/null | tail -1)

# A guard that cannot run must not silently allow. Say so, and let the edit
# through rather than blocking work on a broken tool — but say it loudly.
if [ -z "$out" ]; then
  jq -n --arg f "$rel" '{hookSpecificOutput:{hookEventName:"PreToolUse",
    additionalContext:("banned-api-scan could not run, so " + $f + " was NOT checked. Run `pnpm banned-api-scan` by hand.")}}'
  exit 0
fi

# NOT `.ok // true`. jq's `//` returns the right-hand side when the left is null
# OR FALSE, so `{"ok": false}` would come back as "true" and this guard would
# wave through the exact thing it exists to block. It did, until this line was
# fixed. Test the field explicitly.
ok=$(printf '%s' "$out" | jq -r 'if has("ok") then .ok else true end')
[ "$ok" != "false" ] && exit 0

reason=$(printf '%s' "$out" | jq -r '
  "Blocked: this edit introduces a banned API into packages/sim.\n\n" +
  ([.violations[] | "  " + .file + ":" + (.line|tostring) + "  " + .rule + "\n      " + .text + "\n      " + .why] | join("\n")) +
  "\n\ndocs/invariants.md rule 2. The sim must reach byte-identical state on every engine.\nAllowed: + - * /, Math.sqrt, floor/ceil/round/abs/min/max/trunc/sign, Math.imul.\nDo not weaken the scanner to get past this — if the scanner is wrong, that is the bug."')

jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",
  permissionDecision:"deny", permissionDecisionReason:$r}}'
exit 0
