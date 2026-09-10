#!/usr/bin/env bash
# SessionStart and PreCompact — put docs/invariants.md into context.
#
# Two events, one script, for two different failure modes:
#
#   SessionStart — a fresh session does not know the sim has an arithmetic
#     allowlist until it reads a file nobody told it to read. The rules have to
#     arrive before the first edit, not after the first mistake.
#
#   PreCompact — compaction summarises, and a summary of a rule list is a list
#     of rules that no longer says what is banned. These are the rules most
#     worth surviving a long session and the least able to survive being
#     paraphrased, which is why the file is kept under ~40 lines.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
inv="$root/docs/invariants.md"
event=$(printf '%s' "$(cat)" | jq -r '.hook_event_name // "SessionStart"')

[ -f "$inv" ] || exit 0

guard="ARMED (constants protected)"
[ -f "$root/.claude/.rule-change-active" ] && guard="DISARMED — a /rule-change is open. Run \`pnpm rule-change:end\` when finished."

header="These are the project's non-negotiable engineering rules, injected verbatim from docs/invariants.md so they survive compaction. Read them before editing packages/sim.

Constants guard: $guard
"

jq -n --arg e "$event" --arg c "$header
$(cat "$inv")" \
  '{hookSpecificOutput:{hookEventName:$e, additionalContext:$c}}'
