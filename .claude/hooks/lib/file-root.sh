#!/usr/bin/env bash
# Sourced by the Edit/Write hooks. Defines file_root.
#
# file_root FILE FALLBACK
#   Print the root of the checkout FILE belongs to: the git toplevel of its
#   nearest existing directory. A git worktree is its own checkout, so an edit
#   under .claude/worktrees/<name>/ resolves to that worktree, not to the main
#   checkout. Prints FALLBACK when FILE is in no git checkout at all.
#
# Why this exists (issue #53): every hook used to take its root from
# CLAUDE_PROJECT_DIR, which stays the main checkout when a session works in a
# worktree. An edit to .claude/worktrees/<name>/packages/sim/data/towers.json
# then became the relative path ".claude/worktrees/<name>/packages/sim/data/
# towers.json", matched none of the guarded patterns, and was allowed without
# the rule-change marker. The guards did not fail; they silently stopped
# applying. Resolving the root from the file itself is what makes the same
# patterns mean the same thing in any checkout.
file_root() {
  local file="$1" fallback="$2" dir top
  dir="$(dirname "$file")"
  # A Write may create the file's directory, so walk up to one that exists.
  while [ ! -d "$dir" ] && [ "$dir" != "/" ] && [ "$dir" != "." ]; do
    dir="$(dirname "$dir")"
  done
  if top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" && [ -n "$top" ]; then
    printf '%s' "$top"
  else
    printf '%s' "$fallback"
  fi
}
