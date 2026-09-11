#!/usr/bin/env bash
# PreToolUse on Edit|Write — the generated-files guard for the asset factory.
#
# Nothing lands in assets/build/ except via asset-gate; the manifest and
# LICENSES.md are written by the gate and the audio tools; and every other
# generated file has one command that regenerates it. A hand edit to any of
# them is a change that the next run of the tool will silently undo -- so it
# is refused here, with the command that makes the change properly.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
payload="$(cat)"
file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
[ -z "$file_path" ] && exit 0
rel="${file_path#"$root"/}"

fix=""
case "$rel" in
  assets/build/*)                                  fix="pnpm asset-build <id> && pnpm asset-gate <id>   (assets/build is gate output only)" ;;
  assets/manifest.json|assets/LICENSES.md)         fix="pnpm asset-gate <id>, pnpm audio-synth <id> or pnpm asset-retire <id>   (the manifest is generated)" ;;
  art/generators/registry.json)                    fix="cd art/generators && python3 -m ltw_art.registry > registry.json   (generated from the Python package)" ;;
  art/generators/generators.md)                    fix="cd art/generators && python3 -m ltw_art.docs > generators.md   (generated from the Python package)" ;;
  docs/art/spec.md|tools/art/lib/spec.generated.ts) fix="pnpm spec-types   (generated from art/spec.schema.json)" ;;
  packages/client/src/assets/manifest.generated.ts) fix="pnpm manifest-types   (generated from assets/manifest.json)" ;;
esac
[ -z "$fix" ] && exit 0

# The tools themselves write these files through node/python, not through the
# Edit tool, so this only ever fires on a hand edit.
reason="Blocked: $rel is generated, and a hand edit here is undone by the next tool run.

Make the change at its source and regenerate:
  $fix

docs/art/pipeline.md §4: assets/build/ is a cache of the specs and generators, never a source."

jq -n --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",
  permissionDecision:"deny", permissionDecisionReason:$r}}'
exit 0
