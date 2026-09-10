---
name: replay-verify
description: Re-simulate every stored replay and compare final hashes, then interpret any break - which rule or constant moved, and whether the break is expected. Use after changing the sim, the constants, or anything a replay reads.
context: fork
background: false
allowed-tools: Read Grep Glob Bash(pnpm replay-verify*) Bash(pnpm state-hash*) Bash(pnpm headless-match*) Bash(git diff *) Bash(git log *)
---

# /replay-verify

```sh
pnpm replay-verify
```

Covers `fixtures/replays/` (recorded, long, messy) and `packages/sim/test/golden/`
(hand-built, reaches cases a bot never plays). Both matter; they catch different things.

Green: report and stop. Red: **interpret before anyone regenerates anything.**

## The one thing to get right

Every replay pins its own `BalanceData` and installs it for the length of the run
(ADR-0003). So:

> **A balance-only change cannot break a replay.**

If someone edited only `creeps.json` or `towers.json` and a replay went red, something
*else* moved too — find it. That is the single most useful inference this tool supports, and
it is the reason the format freezes its data.

## Interpret

Full guidance in [`interpreting.md`](interpreting.md). The short form — decide which of
three this is, and say which in your report:

1. **Expected.** A `/rule-change` deliberately altered behaviour. → regenerate, with the
   reason written down.
2. **Unexpected.** Nothing should have changed the sim. → **do not regenerate.** You have
   found a regression; that is the finding.
3. **Structural.** The replay is unreadable or has no `data`. → a format or tooling problem,
   not a sim problem.

Narrow it with:

```sh
git diff --stat HEAD~1 -- packages/sim
pnpm state-hash --replay <the broken one> --every 100
```

## Rules

- **Never regenerate a fixture to turn a test green.** Establish what moved first.
- Regenerating the golden fixtures (`GOLDEN_UPDATE=1`) is a bigger deal than regenerating a
  recorded replay. They are the keystone; say so if you propose it.
- A replay with no `data` is reported as a failure, not skipped — it would verify against
  whatever numbers happen to be checked out, passing and failing for the wrong reasons.

## Finish by printing

```
RESULT:   <n>/<n> verified
BROKEN:   <paths, with expected vs actual hash>
VERDICT:  expected / unexpected / structural — and the evidence
CAUSE:    <the commit, rule or constant that moved it>
NOT DONE: <did NOT regenerate anything unless explicitly asked>
```
