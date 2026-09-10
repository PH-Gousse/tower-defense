---
name: decide
description: Structured decision card for any choice with more than one reasonable option. Lays out 2-4 options with trade-offs and a completeness score, recommends one, and on acceptance writes the ADR and opens follow-ups.
disable-model-invocation: true
argument-hint: "[the question]"
allowed-tools: Read Grep Glob Bash(gh issue *) Bash(gh label *) Bash(git log *) Bash(git diff *)
---

# /decide

A choice with more than one reasonable option gets a card before it gets code.

## Do this

1. **Restate the question** in one sentence. If the ask is vague, sharpen it and say you did.
2. **Read before writing.** Check `docs/gdd.md`, `docs/adr/`, `docs/invariants.md` and the
   code for a decision that already covers this. If one does, say so and stop — a decision
   made twice is a decision nobody trusts.
3. **Write the card** in the format in [`card-format.md`](card-format.md). 2-4 options, no
   more; if you have five, two of them are the same option.
4. **Stop and wait.** Do not write the ADR, edit anything, or open issues until the user
   picks. The card is the deliverable.
5. **On acceptance only:**
   - Write `docs/adr/NNNN-<kebab-title>.md` — next free number, today's date, using the
     template in [`card-format.md`](card-format.md).
   - Add the row to `docs/adr/README.md`.
   - List every GDD section and every constant the decision touches. **Do not edit them** —
     that is `/rule-change`.
   - Open a follow-up issue per piece of work the decision creates, labelled from
     `slice` / `rule` / `balance` / `netcode` / `render` / `determinism` / `bug`.

## Rules

- **A rejected option needs a reason a reader can argue with.** "Rejected: worse" is not a
  reason. "Rejected: the picking path divides by `tan(fov/2)`, so this is a rewrite of
  picking rather than a flag" is.
- **Say when you do not know.** The completeness score exists so a 40%-confidence
  recommendation is not read as a 90% one.
- **Never pick for the user by writing the code first.** The card comes before the diff.
- If the decision changes a **game rule**, the card says so and names `/rule-change` as the
  next step. `/decide` never edits `docs/gdd.md`.

## Finish by printing

```
CHANGED:  <files written, issues opened — or "nothing, awaiting a choice">
NOT DONE: <GDD sections and constants this decision touches but did not edit>
NEXT:     <the /rule-change or /slice that carries it out>
```
