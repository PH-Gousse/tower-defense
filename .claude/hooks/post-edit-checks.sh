#!/usr/bin/env bash
# PostToolUse on Edit|Write — format, typecheck, and run the tests for this file.
#
# Budget: a few seconds. It fires after EVERY edit, so anything slower stops
# being a safety net and starts being a tax somebody disables.
#
# Which tests: the file's OWN test file when one exists (~0.6s), falling back to
# `vitest related` (~4.9s) only when it does not. That is a restriction rather
# than a skip — `vitest related` on step.ts pulls in nine files because nearly
# everything imports it, and paying five seconds per keystroke-sized edit is how
# a hook gets turned off. The Stop guard runs the FULL sim suite plus
# determinism-check before the turn ends, so nothing escapes; it is only
# deferred from per-edit to per-turn.
#
# Cannot block (PostToolUse never can). It reports through additionalContext.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
payload="$(cat)"

file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
[ -z "$file_path" ] && exit 0
[ -f "$file_path" ] || exit 0
case "$file_path" in *.ts|*.tsx) ;; *) exit 0 ;; esac

rel="${file_path#"$root"/}"
pkg="" ; name=""
case "$rel" in
  packages/sim/*)     pkg="packages/sim"     ; name="@ltw/sim" ;;
  packages/client/*)  pkg="packages/client"  ; name="@ltw/client" ;;
  packages/server/*)  pkg="packages/server"  ; name="@ltw/server" ;;
  packages/harness/*) pkg="packages/harness" ; name="@ltw/harness" ;;
  *) exit 0 ;;
esac

# Record that the sim was touched this session, for the Stop guard. Keyed on
# session id so two sessions in one checkout do not see each other's work.
if [[ "$rel" == packages/sim/* ]]; then
  sid=$(printf '%s' "$payload" | jq -r '.session_id // "unknown"')
  mkdir -p "$root/.claude/.state"
  printf '%s\n' "$rel" >> "$root/.claude/.state/sim-touched-$sid"
fi

notes=""
fail=0

# --- format ------------------------------------------------------------------
# There is no formatter in this repo — no prettier, no dprint (issue #11). All
# `eslint --fix` can do is fix rule violations, and stylistic rules are not
# configured, so it does not reformat. Saying "formatted" here would be a lie;
# this reports what it actually did.
if npx --no-install eslint --fix "$file_path" >/tmp/ltw-eslint.$$ 2>&1; then
  :
else
  notes="${notes}eslint: $(head -c 600 /tmp/ltw-eslint.$$)"$'\n'
  fail=1
fi
rm -f /tmp/ltw-eslint.$$

# --- typecheck ---------------------------------------------------------------
# Package-scoped: ~0.6s against ~1.7s for the whole workspace.
if ! tc=$(cd "$root/$pkg" && npx --no-install tsc --noEmit 2>&1); then
  notes="${notes}typecheck (${name}):"$'\n'"$(printf '%s' "$tc" | head -20)"$'\n'
  fail=1
fi

# --- the tests for this file -------------------------------------------------
base="$(basename "$file_path")"; base="${base%.ts}"; base="${base%.tsx}"
direct=""
for cand in "$root/$pkg/test/$base.test.ts" "$root/$pkg/test/$base.test.tsx"; do
  [ -f "$cand" ] && direct="$cand" && break
done

if [ -n "$direct" ]; then
  target="test/$(basename "$direct")"
  if ! out=$(cd "$root/$pkg" && npx --no-install vitest run "$target" --reporter=dot 2>&1); then
    notes="${notes}tests (${target}):"$'\n'"$(printf '%s' "$out" | tail -25)"$'\n'
    fail=1
  fi
elif [[ "$rel" == *"/src/"* ]]; then
  # No test file of its own. Fall back to the broader related run rather than
  # checking nothing.
  if ! out=$(cd "$root/$pkg" && npx --no-install vitest related "${rel#"$pkg"/}" --run --bail=1 --reporter=dot 2>&1); then
    notes="${notes}related tests:"$'\n'"$(printf '%s' "$out" | tail -25)"$'\n'
    fail=1
  fi
fi

[ "$fail" = "0" ] && exit 0

jq -n --arg n "$notes" --arg f "$rel" '{hookSpecificOutput:{hookEventName:"PostToolUse",
  additionalContext:("Post-edit checks FAILED for " + $f + ":\n\n" + $n + "\nFix these before continuing. Do not weaken a check to make it pass."),
  systemMessage:("post-edit checks failed for " + $f)}}'
exit 0
