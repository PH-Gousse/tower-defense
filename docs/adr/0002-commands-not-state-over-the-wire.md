# ADR-0002 — Commands, not state, over the wire

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

Two ways to keep two clients showing the same match: send state, or send inputs. Sending
state is simpler to get right and scales with the size of the world; sending inputs is
harder to get right and scales with how much the players *do*.

This game's state is large and its input is tiny. A lane is 192 tiles, and a match can hold
hundreds of creeps with ten fields each — but a player produces a handful of commands a
second, each of which is a tick, a player index, a kind and at most three small numbers.

## Decision

Only **commands** cross the network. The relay never sends game state.

A command is the atom of the whole system: `{ tick, player, kind, … }`. The client, the
server and the AI opponent are all just command *sources*, and none is privileged.

The relay's job is to order commands, stamp them onto a tick, fan them out, and **record the
log**. It does not simulate to decide outcomes; it validates shape and applies the same
`Refusal` predicates the client does.

Within a tick, commands are given a total order by `(player, kind)` before being applied, so
two simultaneous placements cannot apply in arrival order and diverge.

## Consequences

- Bandwidth is proportional to actions, not to world size. A busy match is still a few
  hundred bytes a second.
- A recorded command log **is** a replay (ADR-0003), for free.
- Spectators are just another fan-out target (ADR-0004), for free.
- The cost is that determinism becomes load-bearing rather than nice-to-have: one divergence
  and the two clients are watching different matches with no mechanism to notice. That is
  what the per-tick hash exchange and desync dump exist for.
- Server-side refusal logic must match client-side exactly, or a command accepted locally
  and rejected remotely desyncs. This is a permanent review obligation — `/netcode-review`.
