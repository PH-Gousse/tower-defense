---
name: netcode-review
description: Checklist review of relay, protocol, lockstep and desync code - command serialisation and versioning, tick alignment and input delay, desync hash exchange, reconnection, server/client refusal parity, spectator stream, and state sent where commands would do. Use when reviewing a diff touching the server or transport.
context: fork
agent: netcode-reviewer
background: false
paths: "packages/server/**, packages/sim/src/wire.ts, packages/sim/src/lockstep.ts, packages/sim/src/desync.ts, packages/sim/src/dump.ts, packages/client/src/net.ts, packages/client/src/driver.ts"
allowed-tools: Read Grep Glob Bash(git diff *) Bash(git log *) Bash(pnpm --filter @ltw/server test*) Bash(pnpm --filter @ltw/harness test*)
---

# /netcode-review

Read-only review. **Propose, never edit.**

The premise this whole area rests on: only **commands** cross the wire (ADR-0002), and the
relay orders them, stamps them, fans them out and records the log. Any finding that ends
"…so we should send state instead" is a finding about the architecture, and belongs in
`/decide`, not here.

## Scope

```sh
git diff --stat HEAD~1 -- packages/server packages/sim/src/wire.ts packages/sim/src/lockstep.ts packages/sim/src/desync.ts packages/client/src/net.ts packages/client/src/driver.ts
```

Review the diff if there is one; review the whole surface if asked.

## The checklist

Work through [`checklist.md`](checklist.md) — seven sections, each with the specific failure
it exists to catch. Do not skip a section because it looks untouched: the point of a
checklist is the item you would not have thought of.

## Known open items — check these have not got worse

- **Issue #9** — `Refusal` (sim) and `RefusalReason` (server) are two enums with nothing
  keeping them in sync. A command accepted locally and refused remotely is a desync wearing
  a network feature's clothes.
- **Issue #16** — `packages/harness/scripts/live-duel.mts` is the only thing exercising the
  Durable Object adapter against a real `wrangler dev`. It is not in CI and not typechecked.
- **No reconnect.** A dropped connection ends the match. Confirm any diff has not made this
  quietly worse (e.g. by adding partial state that a reconnect would need).

## Severity

| | Means |
|---|---|
| **desync** | the two clients can end up simulating different matches. Nothing outranks this. |
| **high** | a match can break or a player be locked out, but both sides agree on what happened. |
| **medium** | correct but fragile — works until latency, ordering or a reconnect changes. |
| **low** | clarity, naming, a missing comment on something load-bearing. |

A **desync** finding must name the sequence of events that produces it, not just the risky
line.

## Finish by printing

```
REVIEWED: <files, and the diff range>
FINDINGS: <file:line — severity — what breaks, and the sequence that breaks it>
CLEAN:    <checklist sections that passed, so absence of a finding is visible>
NOT DONE: <sections you could not check, and why — e.g. no test covers it>
CHANGED:  nothing — this review is read-only
```
