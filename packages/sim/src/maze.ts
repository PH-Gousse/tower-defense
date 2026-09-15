import {
  GRID_W,
  TOWER_SIZE,
  CREEP_SIZE,
  TOWERS_ACROSS,
  SPARE_TILES,
  BUILD_ROW_MIN,
  BUILD_ROW_MAX,
  type Tile,
} from './grid'

/**
 * Maze templates: an ordered wish-list of tower ANCHORS.
 *
 * The bot walks its template and builds the first anchor that is currently
 * legal. Order is the whole design — the early entries have to produce a
 * usable maze on their own, because the bot will often only afford the first
 * handful.
 *
 * Towers are 2x2 (ADR-0019) on a 1-tile grid (ADR-0020). How a wall gets
 * its one-creep slot depends on whether the width divides by the footprint:
 *
 * **A spare column (the 17-wide lane, ADR-0027).** Eight towers cover 16 of
 * the 17 tiles and the column left over IS the slot. Which side it lands on
 * is which side the wall starts from:
 *
 *        x=0                            x=16
 *   y    ████████████████████████████████ .     8 towers from x=0: slot at 16
 *   y+1  ████████████████████████████████ .
 *   y+2   . . . . . . . . . . . . . . . . .     one open row: the corridor
 *   y+3   . ████████████████████████████████    8 towers from x=1: slot at 0
 *   y+4   . ████████████████████████████████
 *
 * Eight towers per crossing, three rows per crossing with a one-row corridor.
 *
 * **No spare column (the 16-wide lane it replaced).** A wall of seven towers
 * covers 14 of the 16 tiles and leaves a 2-wide gap, and a 2-wide gap cannot
 * be narrowed by another tower in the same rows -- 15 is odd. So the eighth
 * tower sits in the rows BELOW the wall, offset by one tile from the wall's
 * grid, and it is that offset that turns the 2-wide gap into a 1-wide slot:
 *
 *        x=0                          x=15
 *   y    ██████████████████████████████  ..    7 towers at even x: gap at 14-15
 *   y+1  ██████████████████████████████  ..
 *   y+2   . . . . . . . . . . . . .  ██  .     the plug at x=13: slot at 15, one creep wide
 *   y+3   . . . . . . . . . . . . .  ██  .
 *   y+4   . . . . . . . . . . . . . . . .     one open row: the corridor
 *   y+5   ..  ██████████████████████████████  gap at 0-1, plug at x=1, slot at 0
 *   y+6   ..  ██████████████████████████████
 *
 * The plug's other side leaves a 13-tile pocket that is reachable only from
 * the corridor and leads nowhere; it is free real estate for towers that
 * shoot but do not maze. Eight towers per crossing, five rows per crossing.
 *
 * Both shapes are kept because the parity is one constant away, and the
 * generator has to build the maze the rules are for (issue #41) on either.
 * There is no collision in the sim (ADR-0021), so a 1-wide slot does not
 * queue creeps: the half-slot buys the game its shape, not the bot a stronger
 * maze.
 *
 * Templates are generated rather than stored as data because the shape is a
 * rule, not a set of numbers, and a rule stays correct if the grid is resized.
 *
 * Every generator stays inside the buildable rows. An anchor in a zone would
 * be refused on every attempt, which the bot reads as "keep trying" rather
 * than "skip".
 */

/** A spare column at least a creep wide is a slot on its own; no plug needed. */
const SPARE_IS_SLOT = SPARE_TILES >= CREEP_SIZE

/** Rows one half-slot wall occupies: the wall alone, or the wall and its plug. */
export const HALF_SLOT_ROWS = SPARE_IS_SLOT ? TOWER_SIZE : 2 * TOWER_SIZE

/**
 * Build a half-slot serpentine.
 *
 * `gapAtRight` alternates per wall so the route has to cross the lane and
 * cross back. Anchors within a wall are emitted from the CLOSED end toward
 * the gap -- that is, starting from the side the previous wall's slot dumped
 * the creeps onto. A half-built wall then still blocks the tiles the route is
 * actually using; emitting from the gap end instead would leave the current
 * route wide open until the very last tower, so the bot would pay for most of
 * a wall and get nothing for it. The plug comes last: it narrows a gap that
 * has to exist first.
 *
 * `spacing` is rows from one wall's anchor row to the next; HALF_SLOT_ROWS + 1
 * is the tightest that leaves a corridor.
 */
function halfSlotSerpentine(startY: number, spacing: number, walls: number): Tile[] {
  const out: Tile[] = []
  for (let w = 0; w < walls; w++) {
    const y = startY + w * spacing
    if (y + HALF_SLOT_ROWS - 1 > BUILD_ROW_MAX) break
    const gapAtRight = w % 2 === 0
    if (SPARE_IS_SLOT) {
      // A full row from one edge leaves the spare column at the other edge.
      if (gapAtRight) {
        for (let a = 0; a < TOWERS_ACROSS; a++) out.push({ x: a * TOWER_SIZE, y })
      } else {
        for (let a = TOWERS_ACROSS - 1; a >= 0; a--) out.push({ x: SPARE_TILES + a * TOWER_SIZE, y })
      }
    } else if (gapAtRight) {
      // Wall covers x 0..13; the plug covers 13..14 two rows down, leaving 15.
      for (let a = 0; a < TOWERS_ACROSS - 1; a++) out.push({ x: a * TOWER_SIZE, y })
      out.push({ x: GRID_W - TOWER_SIZE - 1, y: y + TOWER_SIZE })
    } else {
      // Wall covers x 2..15; the plug covers 1..2 two rows down, leaving 0.
      for (let a = TOWERS_ACROSS - 1; a >= 1; a--) out.push({ x: a * TOWER_SIZE, y })
      out.push({ x: 1, y: y + TOWER_SIZE })
    }
  }
  return out
}

/**
 * Posts: short walls that cross the middle of the lane, alternating anchor.
 *
 * A tooth has to cross the CENTRE or it does nothing at all: a tooth from the
 * left that stops short of the middle leaves a clear channel from spawn to
 * exit and makes the maze exactly as long as an empty lane. `reach` is in
 * towers back from the centre line, so TOWERS_ACROSS / 2 starts at the edge.
 *
 *   ████████░░░░    from the left, past centre, right side open
 *   ░░░░████████    from the right, past centre, left side open
 *
 * Cheaper per tower than a full wall and it never risks sealing, which suits
 * a bot that spends most of its gold on sending. No half-slot: a tooth's open
 * side is the whole other half of the lane.
 */
function posts(startY: number, spacing: number, count: number, reach: number): Tile[] {
  const out: Tile[] = []
  const mid = Math.floor(TOWERS_ACROSS / 2)
  for (let p = 0; p < count; p++) {
    const y = startY + p * spacing
    if (y + TOWER_SIZE - 1 > BUILD_ROW_MAX) break
    const fromLeft = p % 2 === 0
    const from = fromLeft ? Math.max(0, mid - reach) : mid - 1
    const to = fromLeft ? mid : Math.min(TOWERS_ACROSS - 1, mid - 1 + reach)
    // A tooth from the right sits on the right edge's grid, so the spare
    // column (if any) is on its open side, not left as a free channel down
    // the edge it is meant to close.
    const shift = fromLeft ? 0 : SPARE_TILES
    for (let a = from; a <= to; a++) out.push({ x: shift + a * TOWER_SIZE, y })
  }
  return out
}

export interface MazeTemplate {
  readonly name: string
  readonly tiles: readonly Tile[]
}

/**
 * Spacings are in rows. A half-slot wall is HALF_SLOT_ROWS tall, so
 * HALF_SLOT_ROWS + 1 is a wall every fifth row with a one-row corridor, and
 * HALF_SLOT_ROWS + 2 leaves a two-row corridor. Wall counts are ceilings; the
 * generators stop at the exit zone. The tight serpentine fills the lane: on
 * 17 x 100 that is 33 walls and 264 towers.
 *
 * Index 1 is what the presets build (bot.ts). Nothing here has been measured
 * against the pre-ADR-0019 templates' figures; the numbers in bot.ts that
 * compare "template 0" with "template 1" were taken on an 8-wide lane and are
 * history until `/balance` runs on this one (ADR-0025).
 */
export const MAZE_TEMPLATES: readonly MazeTemplate[] = [
  { name: 'half-slot serpentine', tiles: halfSlotSerpentine(BUILD_ROW_MIN + 1, HALF_SLOT_ROWS + 2, 64) },
  { name: 'tight half-slot serpentine', tiles: halfSlotSerpentine(BUILD_ROW_MIN, HALF_SLOT_ROWS + 1, 80) },
  { name: 'posts', tiles: posts(BUILD_ROW_MIN + 1, TOWER_SIZE + 1, 80, Math.floor(TOWERS_ACROSS / 2)) },
]

export function templateAt(index: number): MazeTemplate {
  return MAZE_TEMPLATES[index % MAZE_TEMPLATES.length] as MazeTemplate
}
