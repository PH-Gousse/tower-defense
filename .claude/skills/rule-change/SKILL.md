---
name: rule-change
description: The only sanctioned way to change a game rule or a balance constant. Moves the GDD, the constants, the sim and the tests together, then re-verifies determinism and replays.
disable-model-invocation: true
argument-hint: "[the rule change]"
allowed-tools: Read Edit Write Grep Glob Bash(pnpm *) Bash(gh issue *) Bash(git diff *) Bash(git log *)
---

# /rule-change

A game rule lives in four places at once: `docs/gdd.md`, the constants, the sim, and the
tests that pin it. This skill is what keeps them from drifting apart, and it is the **only**
path that may edit balance constants (`docs/invariants.md` rule 12).

## Set the marker first

The constants guard blocks edits to `packages/sim/data/*.json` unless this skill is active:

```sh
pnpm rule-change:begin   # writes .claude/.rule-change-active
```

Clear it when you are done, whatever the outcome:

```sh
pnpm rule-change:end
```

If you abandon the change, still run `:end`. A marker left behind disarms the guard for
every later session, which is the one failure mode that makes the guard worse than nothing.

## Steps, in order

Work through [`checklist.md`](checklist.md). The order is load-bearing — the GDD moves
first so the rest has something to be checked against.

1. **State the change** in one sentence: the rule now, the rule after, and who asked.
2. **`docs/gdd.md`** — edit the rule. Flip `[proposed]` → `[confirmed]` only where the user
   confirmed it in this conversation. If the change resolves a ⚠️ CONFLICT, remove the
   conflict block and say so.
3. **Constants** — `packages/sim/data/*.json`, or the TypeScript constants the GDD §11 table
   names. One change at a time; note the old value in the commit body.
4. **Sim** — the smallest edit that implements the rule.
5. **Tests** — add or update the Vitest cases that pin the rule, **including the refusal
   paths**. A rule with no refusal test is a rule the client can violate silently. Consider
   delegating to the `test-author` agent.
6. **`pnpm determinism-check`** and **`pnpm replay-verify`**.
7. **If replays broke**, read [`checklist.md`](checklist.md) § "A broken replay" before
   regenerating anything. Regenerating is sometimes right and always requires a reason in
   writing.
8. **ADR** if this is a decision rather than a tweak. A number moving inside its intended
   range is a tweak; a number moving because the intent changed is a decision.

## Rules

- **Never** loosen a check, a lint rule, a hook or a test to make this pass.
- **Never** regenerate a golden fixture to turn a test green without first establishing that
  the sim change is what moved the hash.
- One rule per invocation. Two rules changed together cannot be bisected apart.
- If the user has not confirmed a `[proposed]` value, it stays `[proposed]`. Implementing it
  is fine; marking it confirmed is not.

## Finish by printing

```
RULE:      <before> → <after>
CHANGED:   docs/gdd.md <sections> · <constants> · <sim files> · <test files> · <ADR>
VERIFIED:  determinism-check <pass/fail> · replay-verify <n/n> · pnpm test <pass/fail>
REPLAYS:   <regenerated, and why — or "unchanged">
NOT DONE:  <anything the rule implies that you did not do, and why>
STILL [proposed]: <values touched but not confirmed>
```
