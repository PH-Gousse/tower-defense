# ADR-0030 — Spawn cells are handed out in a fixed scrambled order

- **Date:** 2026-09-15
- **Status:** Accepted — implemented 2026-09-15. Supersedes the cell-ordering half of ADR-0022; its fractional setback stands.

## Context

ADR-0022 spread spawns across the whole spawn zone and asked for consecutive releases to
"land far apart". The code took the release counter straight to a cell (column
`release % LANE_WIDTH`, then the next row), so the zone filled left to right and row by row,
and a burst arrived as a tidy line. Played, it read as a queue, not a spawn. The user asked
for creeps to appear at random points in the zone.

Two constraints limit what "random" can mean here:

- **No two creeps may share a starting point.** Creeps do not collide (ADR-0021), steer
  centre-to-centre, and two identical creeps on one point are welded for the rest of the
  match; one splash shot clears the lot. Independent random draws repeat a cell long before
  170 releases (birthday bound: about 50% by the 16th) and a cell plus setback slot well
  before 1870, so they are ruled out.
- **The sim reads no seed.** `createState()` takes none; the server's seed goes to the client
  and stops there (ADR-0010). A different order per match needs the seed plumbed through
  `createState`, the start path, every harness entry point and the golden fixtures.

## Decision

The cell is `scramble(release % 170)`, a fixed bijection on the 170 cells: a four-round,
8-bit Feistel network of integer operations, cycle-walked into range (at most four walks for
the shipped keys). Every cell is used once per 170 releases, a burst lands scattered, and the
fractional setback is untouched, so the 1870 distinct points and the anti-weld guarantee
carry over exactly.

- **Fixed scramble — CHOSEN.** Looks random on screen, keeps every point distinct, touches
  only `spawnPointFor`. The order is the same every match; nobody reads a 170-cell order off
  a moving board.
- **Seeded per match — rejected for now.** The only version with real match-to-match
  variation, but it reverses ADR-0010 and moves every `createState` caller for a difference a
  player cannot see. Revisit alongside ADR-0010 if the sim ever consumes the seed anyway.
- **Independent random draws — rejected.** Repeats points; see the weld above.
- **Coprime stride over the cells — rejected.** A bijection too, but it lays a burst out on
  a visible diagonal lattice, which reads as a pattern rather than as random.

## Consequences

- Every replay and golden fixture diverges from the first send: an intended behaviour change,
  regenerated with that reason.
- The row-fill test in `step.test.ts` is replaced by one pinning scatter: a 17-creep burst
  touches several rows, which the old rule (one row) fails.
- The permutation is built from `Math.imul`, `^`, `&` and shifts only, inside the arithmetic
  allowlist.
