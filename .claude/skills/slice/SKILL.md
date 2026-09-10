---
name: slice
description: Build a vertical slice from an issue - read the issue and the GDD sections it touches, write the test list first, then sim, server, client, then run every check and summarise for the pull request.
disable-model-invocation: true
argument-hint: "[issue number]"
allowed-tools: Read Edit Write Grep Glob Bash(gh issue *) Bash(gh pr *) Bash(git *) Bash(pnpm *)
---

# /slice

One issue, all the way through: sim → server → client, with the tests written first.

The order is the point. It is the sequencing decision the project already made (ADR-0001):
the rules live in one place, and everything else is a consumer of them. A slice that starts
in the client discovers the rule it needed halfway through and puts it in the wrong package.

## Steps

Detail in [`steps.md`](steps.md).

1. **Read the issue.** `gh issue view <n>`. If it is not clear enough to write a test list
   from, say so and ask — do not guess at scope.
2. **Read the rules it touches.** Every `docs/gdd.md` section, and the ADRs they cite.
   Quote the rule you are implementing back, so a mismatch shows up now rather than in
   review.
3. **Write the test list first** — before any implementation. Names and assertions, not
   code. Include **every refusal path**: a rule with no refusal test is a rule the client
   can violate silently. Consider the `test-author` agent.
4. **Sim.** The rule, and nothing else. Constants go in the constants file. If this changes
   a game rule rather than adding a feature, **stop and use `/rule-change`**.
5. **Server.** Only if commands or refusals changed. Check `protocol.ts` against `Refusal`
   (issue #9).
6. **Client.** Rendering and input. The renderer derives from sim state and never mutates
   it.
7. **Every check**, in `/ship`'s order: test, typecheck, lint, determinism-check,
   replay-verify.
8. **Summarise for the PR.**

## Rules

- **Tests before implementation.** Not "tests in the same commit" — the list exists before
  the code so it describes the rule rather than the implementation.
- A slice that only touches the sim is fine. A slice that only touches the client is
  suspicious — where did the rule go?
- Do not edit balance constants. That is `/rule-change`, and the hook will block you.
- Stop and ask if the issue turns out to contain a decision. Building it makes the decision
  by default.

## Finish by printing

```
ISSUE:    #<n> <title>
RULES:    <GDD sections read, and what they said>
TESTS:    <list written first — n added, n updated>
CHANGED:  sim <files> · server <files> · client <files>
CHECKS:   test · typecheck · lint · determinism-check · replay-verify
NOT DONE: <in-scope work left, and why>
PR:       <the summary, ready to paste>
```
