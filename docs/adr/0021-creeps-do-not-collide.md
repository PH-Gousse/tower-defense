# ADR-0021 — Creeps do not collide with each other

- **Date:** 2026-09-13
- **Status:** Accepted — implemented 2026-09-15: the client draws each creep offset inside its tile by a pure function of its id (`packages/client/src/render/creepOffset.ts`, issue #49)

## Context

The sim has never had creep–creep collision: creeps share cells freely, and the code
accepts that creeps at the same point "weld" into one stack (`spawnPointFor` in `state.ts`
exists to keep simultaneous arrivals apart for exactly that reason). The new geometry
reopens the question, because a 1-wide half-slot corridor is where collision would matter
most, and because the original map has it: creeps jam in a maze, and the jam is part of why
splash towers are good.

## Decision

**No collision in the sim.** Creeps overlap freely. Separation is **visual only**: the
client offsets each creep inside its tile by a deterministic function of its id, and that
offset never reaches the sim.

- **No collision — CHOSEN.** A 1-wide gap passes any number of creeps, so 4-connectivity of
  empty cells is the whole passability story and the block check stays exact. Movement is
  O(creeps) with no pairwise pass; peak populations already reach 880–1099 (issue #14).
  Determinism is trivial.
- **Soft separation in the sim — rejected.** A per-tick neighbour pass whose float summation
  order is a desync surface; in a 1-wide corridor there is nowhere to push, so it degrades to
  no-collision with jitter; and it changes which creeps a splash hits, which makes it a
  balance input rather than a cosmetic one. Never measured, and not worth measuring until
  the visual-only version has been seen to fail.
- **Hard collision, creeps queue — rejected.** Gap throughput becomes a rule (N creeps a
  second through a half-slot) that interacts with slow towers and with the block check, and
  deterministic queueing would be the largest piece of new sim code in the project.

## Consequences

- Creeps that share a point keep sharing it, and one splash hits the stack. The code has
  called this the intended counter to a mass send since ADR-0006, and it still is.
- The spawn spread (ADR-0022) carries the whole burden of keeping simultaneous arrivals
  distinct; its fractional setback is load-bearing and must survive.
- The client's jitter is render-only and must be derived from creep id, never from
  anything time-varying, so two clients draw the same crowd.
- Revisit trigger: playtests where a mass send reads as a single dot with the jitter on.
