#!/usr/bin/env bash
# Stop — if anything under assets/ or art/specs/ changed this session, the
# catalogue must be consistent before the turn ends:
#
#   pnpm asset-gate all --changed   every spec with a raw build is admitted
#                                   at its current hash (nothing stale slips
#                                   into the manifest), rejections block
#   pnpm asset-report               the catalogue page, and LICENSES.md
#                                   regenerated from the manifest
#
# "Changed this session" is the post-edit hook's record plus git's view of
# assets/ and art/specs/, so a tool-written file counts too. Same loop guard
# as stop-guard.sh: two blocks, then stand down loudly.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
payload="$(cat)"
sid=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')
touched="$root/.claude/.state/art-touched-$sid"

changed=$(cd "$root" && git status --porcelain -- assets art/specs art/sounds 2>/dev/null)
[ -f "$touched" ] || [ -n "$changed" ] || exit 0

attempts="$root/.claude/.state/art-stop-blocks-$sid"
n=$(cat "$attempts" 2>/dev/null || echo 0)

gate=$(cd "$root" && pnpm --silent asset-gate all --changed 2>&1); gate_ok=$?
report=$(cd "$root" && pnpm --silent asset-report 2>&1); report_ok=$?
lic=$(cd "$root" && git status --porcelain -- assets/LICENSES.md)

if [ "$gate_ok" = "0" ] && [ "$report_ok" = "0" ]; then
  rm -f "$touched" "$attempts"
  gline=$(printf '%s' "$gate" | grep -E 'admitted' | tail -1)
  rline=$(printf '%s' "$report" | grep -E '^report:' | tail -1)
  jq -n --arg g "$gline" --arg r "$rline" --arg l "${lic:-unchanged}" \
    '{hookSpecificOutput:{hookEventName:"Stop",
      additionalContext:("Art stop guard: the catalogue changed this session and is consistent.\n" + $g + "\n" + $r + "\nLICENSES.md: " + $l + "\n\nRemember the previews: nothing is done until the owner has seen them.")}}'
  exit 0
fi

n=$((n + 1)); printf '%s' "$n" > "$attempts"
detail=""
[ "$gate_ok" != "0" ] && detail="${detail}asset-gate FAILED:"$'\n'"$(printf '%s' "$gate" | grep -vE '^\{' | tail -20)"$'\n\n'
[ "$report_ok" != "0" ] && detail="${detail}asset-report FAILED:"$'\n'"$(printf '%s' "$report" | tail -10)"$'\n'

if [ "$n" -ge 3 ]; then
  rm -f "$attempts"
  jq -n --arg d "$detail" '{hookSpecificOutput:{hookEventName:"Stop",
    additionalContext:("Art stop guard has blocked twice and is standing down to avoid wedging the session. THE CATALOGUE IS STILL INCONSISTENT — do not report this work as done.\n\n" + $d)}}'
  exit 0
fi
reason="The asset catalogue changed this session and is not consistent. Not done yet.

$detail
Fix the rejection in the spec (never the budget), rebuild, and let the gate admit it.
Nothing may be presented as done without its previews."
jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"Stop",
  permissionDecision:"deny", permissionDecisionReason:$r}}'
exit 2
