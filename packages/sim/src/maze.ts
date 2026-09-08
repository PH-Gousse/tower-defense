import { GRID_W, GRID_H, type Tile } from './grid'

/**
 * Maze templates: an ordered wish-list of tiles.
 *
 * The bot walks its template and builds the first tile that is currently legal.
 * Order is the whole design — the early entries have to produce a usable maze
 * on their own, because the bot will often only afford the first handful.
 *
 * A serpentine works by forcing the walk up and down between staggered walls:
 *
 *      x=6      x=10     x=14
 *   ┌───┬────────┬────────┬───
 *   │   █        █        █      gap at the BOTTOM of wall 1,
 *   │   █        █        █      the TOP of wall 2, and so on,
 *   IN  █   ->   █   ->   █      so the path zigzags instead of
 *   │   █        █        █      running straight through
 *   │            █
 *   └────────────┴────────────
 *
 * Templates are generated rather than stored as data because the shape is a
 * rule, not a set of numbers, and a rule stays correct if the grid is resized.
 */

/**
 * Build a serpentine template.
 *
 * `gapAtTop` alternates per wall so the route has to climb and drop. Tiles are
 * emitted wall by wall, and within a wall from the lane rows outward, so a bot
 * that can only afford part of a wall still gets the part that matters — the
 * tiles nearest the creeps' path.
 */
function serpentine(startX: number, spacing: number, walls: number): Tile[] {
  const out: Tile[] = []
  for (let w = 0; w < walls; w++) {
    const x = startX + w * spacing
    if (x >= GRID_W - 2) break
    const gapAtTop = w % 2 === 0

    // Emit from the lane rows outward: those tiles are the ones the path
    // actually has to negotiate, so a half-built wall is still a real detour.
    const order: number[] = []
    for (let d = 0; d < GRID_H; d++) {
      const up = 11 - d
      const down = 12 + d
      if (up >= 0) order.push(up)
      if (down < GRID_H) order.push(down)
    }

    for (const y of order) {
      // Leave the gap open, or the placement is refused and the bot stalls
      // retrying the same tile every decision.
      if (gapAtTop && y <= 1) continue
      if (!gapAtTop && y >= GRID_H - 2) continue
      out.push({ x, y })
    }
  }
  return out
}

/**
 * Posts: short walls centred on the lane rows, alternating anchor.
 *
 * A tooth has to cross BOTH lane rows or it does nothing at all. The first
 * draft anchored teeth at the top and bottom edges and stopped short of the
 * middle, which left rows 11 and 12 clear from spawn to exit — creeps walked
 * straight through and the maze length was identical to an empty lane. The test
 * that measures path length caught it.
 *
 *       gap
 *      ┌───┐
 *      │   █  <- post crosses the lane rows
 *   IN ┤   █      leaving one side open
 *      │   █
 *      └───┘
 *       gap
 *
 * Cheaper per tower than a full serpentine wall and it never risks sealing,
 * which suits a bot that spends most of its gold on sending.
 */
function posts(startX: number, spacing: number, count: number, reach: number): Tile[] {
  const out: Tile[] = []
  for (let p = 0; p < count; p++) {
    const x = startX + p * spacing
    if (x >= GRID_W - 2) break
    const fromTop = p % 2 === 0
    // Span from one side across the lane rows, leaving the other side open.
    const from = fromTop ? Math.max(1, 12 - reach) : 11
    const to = fromTop ? 12 : Math.min(GRID_H - 2, 11 + reach)
    for (let y = from; y <= to; y++) out.push({ x, y })
  }
  return out
}

export interface MazeTemplate {
  readonly name: string
  readonly tiles: readonly Tile[]
}

export const MAZE_TEMPLATES: readonly MazeTemplate[] = [
  { name: 'serpentine', tiles: serpentine(6, 5, 6) },
  { name: 'tight serpentine', tiles: serpentine(5, 4, 8) },
  { name: 'posts', tiles: posts(6, 4, 8, 8) },
]

export function templateAt(index: number): MazeTemplate {
  return MAZE_TEMPLATES[index % MAZE_TEMPLATES.length] as MazeTemplate
}
