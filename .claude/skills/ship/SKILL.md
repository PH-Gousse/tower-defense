---
name: ship
description: Release checklist - tests, typecheck, lint, determinism, replay-verify, client build, server image, deploy (asks first), WebSocket smoke test against the deployed relay, tag. Stops at the first failure.
disable-model-invocation: true
allowed-tools: Read Grep Glob Bash(pnpm *) Bash(bun run *) Bash(git *) Bash(gh *) Bash(npx wrangler *)
---

# /ship

Work through [`checklist.md`](checklist.md) **in order**. Every gate is there because
something got past the one before it.

## Stop at the first failure

Not "note it and continue". **Stop.** Report the failure, what it blocks, and what you did
not run. A checklist that continues past a red gate is a list, not a checklist.

## Ask before deploying

Deploying is outward-facing and hard to reverse. **Ask, and wait for a clear yes**, before:

- `wrangler deploy` (the relay — a deploy kills live matches, and there is no reconnect)
- anything that publishes the client
- pushing a tag

Approval for one deploy is not approval for the next.

## The order, and why

1. `pnpm test` — 366 tests
2. `pnpm typecheck`
3. `pnpm lint` — this **is** the arithmetic and ordering determinism guard
4. `pnpm determinism-check` — replay halves plus the banned-API scan
5. `pnpm replay-verify` — 5 stored replays
6. `bun run scripts/golden-jsc.ts` — the **only** cross-engine check. Steps 4 and 5 run two
   V8 processes and prove nothing about JavaScriptCore.
7. `pnpm build` — client, `tsc --noEmit` then vite
8. relay build — `npx wrangler deploy --dry-run`
9. **ask** → deploy
10. WebSocket smoke test against the **deployed** relay, not a local one
11. tag

Determinism before build, because a client that builds and desyncs is worse than one that
does not build.

## Known blockers to state up front

- `pnpm bench-scene` is a stub and exits non-zero (issue #15). It is **not** a ship gate
  today. Say so rather than letting it look like a skipped step.
- No reconnect: a relay deploy ends every live match. That is the reason step 9 asks.

## Finish by printing

```
GATES:    <each step — pass/fail/skipped, with timings>
STOPPED:  <the first failure, or "all gates passed">
DEPLOYED: <what, where, when — or "not deployed; not asked / declined">
SMOKE:    <result against the deployed URL, or "not run">
TAG:      <tag, or "not tagged">
NOT DONE: <every step after the stop, listed explicitly>
```
