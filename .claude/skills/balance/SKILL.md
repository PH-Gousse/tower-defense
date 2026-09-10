---
name: balance
description: Run the balance batch, read the report, summarise it in ten lines and propose at most three constant changes with evidence. Proposes only - applying a change goes through /rule-change.
disable-model-invocation: true
context: fork
agent: balance-analyst
background: false
argument-hint: "[--matches N] [--max-ticks N]"
allowed-tools: Read Grep Glob Bash(pnpm balance-batch*) Bash(pnpm headless-match*) Bash(pnpm --filter @ltw/harness *) Bash(gh issue *)
---

# /balance

```sh
pnpm balance-batch          # 18 matches; --matches N to change
```

Writes `reports/balance/<date>.md` and prints the path. **Read the report file** — the
console summary is the headline, the file has the tables.

This skill runs in a subagent so the large output never enters the main context. Return the
summary and the proposals, not the tables.

## Read the limits before the numbers

Three, and every proposal has to survive them:

1. **Nothing consumes a seed** (ADR-0010). `--matches 100` is 100 runs of at most **9
   distinct configurations**. Never describe M matches as M samples.
2. **Bot-vs-bot measures what the bot does.** It catches runaway economies and dominant
   strategies. It cannot tell you the game is fun, and it cannot find a strategy the bot
   does not know how to play.
3. **The bot never sells a tower**, so every over-commitment it makes is permanent. Its
   economy is more rigid than a human's.

Also check `distinctFinals` behaviour: if the presets play identically at the tick count you
ran, difficulty is not being measured at all (see issue #13).

## What to look at

Full guidance in [`reading-the-report.md`](reading-the-report.md).

- **Head to head**, not aggregate win rate. Aggregate depends on who a preset was drawn
  against. The ladder should be monotone with mirrors drawn.
- **Degenerate flag.** One archetype being the winner's main send breaks the 3×3 counter
  structure the whole design rests on.
- **Match length.** A rising "hit the ceiling" count is issue #8 — the bounded ladder has no
  guarantee a match ends — showing up as data.
- **Income curve.** Flat means nobody is attacking, and income only grows by sending.
- **Lap gaps.** The pressure a leaked creep actually applies. A median of 0-1 ticks means
  leaks arrive in bursts, and the median is telling you nothing.

## Rules

- **At most three proposals.** More than three is not a recommendation, it is a wish list.
- Each proposal names: the constant, its file, current → proposed, the evidence line from
  the report, and what you expect to move.
- **Never apply a change.** Not one constant, not one character. `/rule-change` does that,
  and the constants guard will block you anyway.
- Cite numbers you actually ran. Do not carry figures from a previous report.

## Finish by printing

```
REPORT:   reports/balance/<date>.md  (<n> matches, <n> distinct configurations)
SUMMARY:  <ten lines, maximum>
FLAGS:    <degenerate strategy / non-monotone ladder / unfinished matches — or none>
PROPOSED: <up to 3: constant, file, current → proposed, evidence, expected effect>
NOT DONE: applied nothing — every change above needs /rule-change
```
