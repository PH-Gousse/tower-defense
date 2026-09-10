---
name: determinism-check
description: Run the determinism check over the sim - N configurations replayed twice and compared every tick, plus the banned-API scan. On failure, locate the cause and propose a fix. Use after any change under packages/sim.
context: fork
background: false
allowed-tools: Read Grep Glob Bash(pnpm determinism-check*) Bash(pnpm banned-api-scan*) Bash(pnpm state-hash*) Bash(pnpm test*) Bash(git diff *) Bash(git log *)
---

# /determinism-check

```sh
pnpm determinism-check
```

Green: report the numbers and stop. Red: diagnose. **Never loosen the check.**

## Read the output honestly

Three numbers matter, and one of them is a trap:

- `mismatches` — configurations whose two runs parted. Any is a failure.
- `violations` — banned API uses outside the declared `dump.ts` boundary. Any is a failure.
- `distinctFinals` — how many genuinely different matches the run covered. **This is the
  trap.** If it is well below the configuration count, most runs played out identically and
  the check covered less than it appears to. Raise `--max-ticks` and say so in your report.

A green run proves nothing about **cross-engine** agreement — two runs in one process share
a libm. `bun run scripts/golden-jsc.ts` is what covers that. Never report determinism as
proven without it.

## On failure

Work through [`diagnosis.md`](diagnosis.md). It is four causes, in the order they are worth
checking, with the fix for each.

The output names the exact tick two runs parted at. Start there:

```sh
pnpm state-hash --replay <a replay> --every 100
```

## Rules

- **Never** widen a tolerance, skip a seed, lower `--seeds`, or pass `--no-scan` to get a
  pass. If the check is wrong, that is a `/rule-change` with a written reason.
- A banned-API hit inside `packages/sim/src/dump.ts` is **allowed** (ADR-0011) and the tool
  already reports it separately. A hit anywhere else is a failure even if the replay half
  passed — the arithmetic merely happens to agree on this engine today.
- If you believe the scanner produced a false positive, **the scanner is the bug**. Report
  it; do not add an exemption.

## Finish by printing

```
RESULT:   PASS/FAIL — <n> configs, <distinctFinals> distinct, <violations> banned-API
COVERAGE: <what --max-ticks and --seeds actually exercised>
CROSS-ENGINE: <ran golden-jsc / not run — this check does not cover it>
CAUSE:    <for a failure: which of the four, with file and line>
PROPOSED: <the fix — never a loosened check>
NOT DONE: <what you did not verify>
```
