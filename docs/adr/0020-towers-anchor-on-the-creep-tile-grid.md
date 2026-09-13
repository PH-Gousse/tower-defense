# ADR-0020 — Towers anchor on the 1-tile creep grid, not a 2-tile tower grid

- **Date:** 2026-09-13
- **Status:** Accepted — implemented 2026-09-13

## Context

With 2×2 towers (ADR-0019) a footprint can be allowed at any creep tile, or only at even
coordinates. The choice fixes the shape of the occupancy model, the block check, the bot's
templates and the picking code, so it comes before any of them.

## Decision

**A tower's anchor is any tile such that the 2×2 footprint lies inside the buildable area.**
Occupancy stays per creep tile in `Lane.blocked`; a footprint is the four cells
`(ax..ax+1, az..az+1)`.

- **1-tile grid — CHOSEN.** Two towers offset by one tile leave a corridor one creep wide.
  That half-slot is the mazing skill of the original, and the reason for the whole
  restructure. Corner-touching towers seal the diagonal under the 4-neighbour block check,
  so "leave a real gap" is enforced rather than hoped for.
- **2-tile grid, 8 × 100 slots — rejected.** Trivially non-overlapping and a smaller data
  model, but gaps are then 0 or 2 tiles wide: every corridor is two abreast, a serpentine
  wall costs 7 towers for 2 tiles of corridor, and the half-slot cannot exist by
  construction. It is a different game.

Picking: the sim receives an anchor. For a 2×2 footprint the natural snap on the client is
the **nearest grid vertex** (the footprint's centre), i.e. `anchor = round(cursor) − 1`,
rather than the hovered tile, which would hang the footprint off the cursor's corner. This
is a client choice and `[proposed]`; the sim is indifferent.

## Consequences

- Overlap, bounds and zone checks are four-cell loops. Cheap, but every one of them is a
  place a single-tile assumption can hide; the tests cover every anchor along every edge.
- Upgrade and sell commands still address a tower by a tile; any of its four cells resolves
  to the tower's id.
- The bot's templates must speak in anchors and can express staggered walls, which the
  2-tile grid could not. That is the issue opened alongside ADR-0019.
- Instanced rendering does not get the free row alignment the 2-tile grid would have given
  it; per-instance transforms carry the anchor, which they had to anyway.
