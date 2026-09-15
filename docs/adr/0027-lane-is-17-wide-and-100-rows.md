# ADR-0027 — The lane is 17 tiles wide and 100 buildable rows long

- **Date:** 2026-09-15
- **Status:** Accepted — implemented 2026-09-15; both figures `[proposed]`, every §11 constant stays `[retune]`

## Context

ADR-0019 sized the lane from the Reforged map: 16 creep tiles wide (8 towers), about 200
buildable rows, the camera scrolling a lane it cannot show whole. That shipped on
2026-09-13 with a bot that fills it (320 towers of half-slot serpentine) and a first
balance pass. Two days of play on it, and the user asked for two changes to the geometry
itself: the lane is far too long, cut it in half; and add one tile to the width.

The GDD calls width the maze-richness knob and length the pace knob, and asks that they
move one at a time. They land as two commits for that reason, and one ADR because it was
one request and the reasoning is shared.

## Decision

- **`LANE_LENGTH` is 100.** Halved from 200. Nothing in the code depends on the figure,
  and it stays `[proposed]`. A bare lap is 113 rows now; every lap time, income payout
  per lap and tier clock reading taken on the 213-row lane is history, which ADR-0025
  already says of every §11 number.
- **`LANE_WIDTH` is 17.** One more than 16, and odd on purpose once it was asked for: a
  full row of `TOWERS_ACROSS = 8` towers covers 16 tiles and leaves `SPARE_TILES = 1`
  open, one creep wide. A straight wall is a half-slot by itself, with its gap on
  whichever edge the wall does not start from. Sealing needs a second row: a tower
  directly under the open column, sharing an edge with the row's last tower, is
  `WouldSealLane`; one row further down it is a corridor. A corner touch still seals
  (4-neighbour connectivity is unchanged).
- **Geometry stays in `grid.ts`.** `TOWERS_ACROSS` and `SPARE_TILES` join the constants
  there; `MAX_TOWERS` is whole footprints across times whole footprints down (400),
  because a spare column holds no tower.
- **The bot's templates handle both parities.** With a spare column the serpentine is a
  full row per wall, eight towers on three rows (two of wall, one of corridor); without
  one it is the seven-plus-plug shape ADR-0019 shipped, kept in the generator because
  the parity is one constant away. Teeth from the right sit on the right edge's grid so
  the spare column is on their open side, not a free channel down the edge they close.
  The tight serpentine fills the lane at 33 walls and 264 towers.

## Consequences

- **Mazing changed shape, not just size.** The plug-and-pocket half-slot of ADR-0019 is
  no longer the cheapest crossing; a plain row is. The 13-tile pockets that used to hold
  towers that shoot but do not maze are gone with it. Whether the width should go back to
  even, or the half-slot be re-earned some other way, is a question for play on this lane;
  the GDD's "width is the maze-richness knob" is now the thing to watch.
- **Every balance number is void again** (ADR-0025). The bot presets were swept on 16×200
  and the harness ladder test is red until they are re-swept; the sweep runs after the
  tower acquisition delay (ADR-0028) lands, so it is run once.
- Fixtures regenerated: they pin balance data, not geometry, so every hash moved by
  construction. Both golden fixtures' command logs still fit (max anchor x 13, max y 18).
- The client derives its framing from the constants: `MIN_VIEW_TILES` is 25 tiles now,
  which moved two portrait framing tests by a fraction of a row.
