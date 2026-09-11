---
name: style-sheet
description: Apply a confirmed change to the art style sheet and propagate it to the budgets, the palette definitions and the generator defaults, then rebuild what changed and show the visual impact. The only sanctioned way to change a budget, a palette colour or a tier rule.
disable-model-invocation: true
argument-hint: "[the confirmed change]"
allowed-tools: Read Edit Write Grep Glob Bash(pnpm *) Bash(python3 *) Bash(git diff *) Bash(git log *)
---

# /style-sheet

A change to `docs/art/style-sheet.md` lives in up to four places at once, and this skill
moves them together. It is the art-side twin of `/rule-change`: a budget, a palette colour
or a tier rule changed in one place and not the others is a gate that lies.

## Preconditions

The change is **confirmed** by the owner in this conversation. A `[proposed]` value can be
implemented, but its tag flips only on confirmation. If the change is a decision with more
than one reasonable option (a new budget, a palette rebalance), `/decide` writes the ADR
first.

## Where each kind of change lives

| Change | Files that move together |
|---|---|
| A budget (triangles, texture, bones, file size, clip lengths) | `docs/art/style-sheet.md` §7 · `tools/art/lib/budgets.ts` · `packages/client/src/assets/viewerBudgets.ts` · `docs/art/animation-contract.md` for clip lengths |
| A palette colour or alias | `docs/art/style-sheet.md` §3 · `art/generators/ltw_art/palette.py` · then `python3 -m ltw_art.registry > art/generators/registry.json` |
| Tier language (size, parts, shift, trim) | `docs/art/style-sheet.md` §5 · the `evolve` rules in `.claude/skills/asset/SKILL.md` · existing tier specs under `art/specs/` |
| A generator default | `art/generators/ltw_art/<plans|parts|anims>/*.py` · `art/generators/generators.md` via `python3 -m ltw_art.docs` · `registry.json` |
| Team colour, units, naming, licences | `docs/art/style-sheet.md` · `tools/art/lib/budgets.ts` (mask coverage) · `art/spec.schema.json` (naming pattern) |

## Steps

1. State the change in one sentence: before, after, who confirmed it.
2. Edit the style sheet first. Then every file in the row above.
3. If a generator changed, bump `GENERATOR_VERSION` in `art/generators/ltw_art/__init__.py`:
   every build becomes stale on purpose.
4. Run the sync tests: `cd art/generators && python3 -m pytest tests -q` and
   `pnpm --filter @ltw/art-tools test`. They pin the style sheet's numbers to the gate's and
   the palette to the registry; a failure here is the drift this skill exists to prevent.
5. `pnpm asset-regen --changed` (or `--all` after a palette or version bump). Show the assets
   that changed visually with their before/after strips.
6. Stop for review. Anything now rejected by the gate is listed, not fixed silently.

## Finish by printing

```
CHANGE:    <before> → <after>  (confirmed by <who>)
MOVED:     <every file edited>
VERSION:   GENERATOR_VERSION <old> → <new> | unchanged
REGEN:     <n> rebuilt · <n> changed visually · <n> rejected
STILL [proposed]: <values touched but not confirmed>
```
