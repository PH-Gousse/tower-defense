# ADR-0005 — The AI opponent is a command source

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

An AI opponent could be given privileged access to the simulation — mutating state directly,
reading things a player cannot, acting between ticks. That is the easy implementation and it
is a trap: it makes the bot untestable against real play, makes bot matches unrecordable,
and means offline play and online play run different code.

## Decision

The bot is `botCommand(state, player, config) -> readonly Command[]`. It lives inside
`packages/sim` and emits commands exactly as a player does. It has no privileged mutation
path and no privileged information beyond what `GameState` holds.

It runs **fully client-side offline** — a single-player match needs no server at all — and
the identical function backs the headless harness.

`botCommand` is pure: a function of `(state, player, config)` plus the deterministic tick
counter. Roster and template scans are ordered, so ties break by index rather than by
chance.

## Consequences

- Offline play works with no network. This is the whole distribution story: the game is
  playable the moment the page loads.
- Bot-vs-bot matches are recordable and replayable like any other match, which is what makes
  headless balance runs possible at all (`balance-batch`).
- Difficulty must be expressed as *play*, not as cheating. It is `sendRatio` — how much of
  its economy the bot commits to attacking — because that is what a stronger opponent
  actually does in a game about sending. It was reaction latency once, and that was a
  symptom of a broken economy rather than a design.
- The bot is measured, not asserted. A round-robin in the harness verifies the ladder is
  transitive and that every mirror is a draw, which also proves the sim gives neither seat
  an edge. More than one "obviously better" change to the bot measured backwards.
- Because the bot is inside the sim package, it is bound by the same arithmetic and ordering
  restrictions. No `Math.random` tie-breaks without threading a seed through.
