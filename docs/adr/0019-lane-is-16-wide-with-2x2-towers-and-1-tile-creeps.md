# ADR-0019 — The lane is 16 tiles wide and Warcraft 3-length, towers are 2×2, creeps are 1×1

- **Date:** 2026-09-13
- **Status:** Accepted — sim implemented 2026-09-13 (issue #38); client, art and balance follow in issues #44–#47, #42

## Context

The lane shipped at 8 × 24 tiles with one-tile towers (ADR-0014's camera fits all 24 rows in
frame; `grid.ts` records the reasoning: "width is the maze-richness knob and length is the
pace knob"). That board was chosen so a whole match could be read at a glance, and it worked
for the tower and creep archetypes. It does not reproduce the thing this project exists to
remake. In the original Line Tower Wars map the mazing skill is the **half-slot**: a tower
is twice the size of a creep, so two towers offset by one creep-width leave a corridor one
creep wide, and a maze is a long sequence of those. With towers and creeps the same size
there is no half-slot, and the 24-row lane is short enough that a maze is a handful of
walls rather than a route you build for twenty minutes.

Two forces made this a decision now rather than later. Every replay, golden fixture, bot
template, camera constant and art budget assumes 8 × 24 and one size of thing, so the
longer the change waits the more of them it invalidates. And the balance work (issues #12,
#13, #14, #26) is tuning a board that is about to be replaced.

Units. The **tile** is the creep tile and the only unit the sim speaks. Derivation of the
length from the original: the Reforged map is 160 × 128 terrain tiles; one terrain tile
holds one tower, so a tower is 2 × 2 creep tiles, a lane is 8 terrain tiles = 16 creep tiles
wide, and the map is 256 creep tiles tall. After the map border and the spawn and exit
areas, a lane has on the order of 200 creep tiles of buildable length.

## Decision

- A creep occupies **1 × 1** tile. A tower occupies **2 × 2** tiles. No code path may assume
  the two are the same size; `TOWER_SIZE` and `CREEP_SIZE` are constants, not literals.
- **Lane width is 16 tiles.** A full row is 8 towers.
- The lane has three zones along its length, in order from where creeps arrive: a **spawn
  zone** of `SPAWN_ROWS = 10` rows, a **buildable area** of `LANE_LENGTH` rows, an **exit
  zone** of `EXIT_ROWS = 3` rows. Neither zone is buildable. A creep whose position enters
  an exit-zone cell has leaked.
- `LANE_LENGTH` is a single constant. It is **200 `[proposed]`**; nothing in the code
  depends on it being exactly that, but every lap time scales with it (ADR-0025).
- Two lanes side by side, `LANE_GAP = 4 [proposed]` tiles apart.
- **The camera cannot show the whole lane.** The player scrolls (ADR-0024).
- All of `LANE_WIDTH`, `TOWER_SIZE`, `CREEP_SIZE`, `SPAWN_ROWS`, `EXIT_ROWS`, `LANE_LENGTH`
  and `LANE_GAP` live in the sim's constants module. Every hard-coded 8 and 24 goes.
- A tower is stored as `{ id, anchorX, anchorZ }` and its footprint is **derived** as the 2×2
  block from the anchor. The per-cell occupancy grid is a cache of that, never the source of
  truth.
- Placement refusals, in this order and all before any gold moves: not enough gold, out of
  bounds, in the spawn zone, in the exit zone, overlaps a tower, a creep is on the footprint
  (ADR-0023), would block the lane. Sell and upgrade keep their refusals.
- The block check asks whether, with the footprint occupied, at least one path of empty
  cells still connects a spawn-zone cell to an exit-zone cell under **4-neighbour**
  connectivity. Creeps are one tile, so a 1-wide gap is passable and a diagonal
  corner-touch is not. Never weaken this to make a layout pass; the half-slot rule *is* the
  game.

Rejected alternatives:

- **Keep 8 × 24 and make towers 2×2 anyway.** A 4-tower-wide lane cannot hold a maze; the
  half-slot needs room to be a choice rather than the only legal placement.
- **16 wide but short (e.g. 48 rows) so the camera still fits it.** Rejected because the
  length is what makes a maze a twenty-minute build and a leak a long walk; a scrolling
  camera is the cost of the original's pacing and was judged worth paying. If lap times
  prove unacceptable, `LANE_LENGTH` is the lever, not the width.
- **Tower-sized tiles with half-tile creep positions.** The same geometry written the other
  way up, with every creep coordinate a fraction. The creep tile is the smaller unit and the
  one connectivity is measured in, so it is the unit.

## Consequences

- **Every replay and golden fixture breaks.** `hashState` walks tile-indexed arrays whose
  length changes, and the command coordinates mean something else. The fixtures under
  `fixtures/replays/` and `packages/sim/test/golden/` are regenerated once the sim is stable
  on the new geometry, and only then. Regenerating them is expected here and must be stated
  in the commit.
- The bot's maze templates (`maze.ts`) emit single tiles and are void. Regenerating them for
  16-wide, 2×2, half-slot mazing is its own issue.
- The camera's fit-the-board model (ADR-0014's "fit all 24 tiles") is superseded by a
  scrolling model with a zoom cap, ADR-0024. Fixed yaw, pitch and fov stay.
- The art style sheet's "1 unit = 1 tile, a tower's tile is 1 × 1" becomes "a tower is
  2 × 2 with its origin at the footprint centre; a creep fits inside 1 × 1 with a visible
  margin so a 1-wide gap reads as passable". Every tower asset is rebuilt through the
  factory.
- Targeting with up to 8 towers a row and hundreds a lane must stay near-linear; the spatial
  hash gains a cell size (`[proposed]` 4 tiles) and tower range is measured from the
  footprint centre.
- All balance constants are void until `/balance` runs on the new board (ADR-0025).
- ADR-0012's teleport rule is superseded by ADR-0023, because the longer lane turned it into
  an exploit.
