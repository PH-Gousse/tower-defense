import { GRID_W, DIR_DX, DIR_DY, Dir, TILE_COUNT, tileX, tileY } from './grid'
import { UNREACHABLE, type FlowField } from './field'

/**
 * Walk the flow field from a tile to the exit, collecting the route.
 *
 * This is what the renderer draws so the player can see what their maze
 * actually does. Free-form mazing is the mechanic the whole game is about, and
 * a maze whose effect you cannot see is a maze you cannot learn to build — the
 * `+54 tiles` number says how much longer, the line says *where*.
 *
 *   spawn ──▶ dir[tile] ──▶ next tile ──▶ ... ──▶ exit (dist 0)
 *
 * The same routine serves the leak trail at step 5: when a creep loops, the
 * route it took is exactly this walk from wherever it entered.
 *
 * Termination is guaranteed by the field itself: `dir` always points to a tile
 * with strictly smaller `dist`, so the walk is monotonically decreasing and
 * cannot cycle. The step ceiling is a belt-and-braces guard against a
 * malformed field rather than an expected case.
 */
export function pathFrom(
  field: FlowField,
  startIndex: number,
  out: number[] = [],
): number[] {
  out.length = 0
  if ((field.dist[startIndex] as number) === UNREACHABLE) return out

  let current = startIndex
  out.push(current)

  for (let guard = 0; guard < TILE_COUNT; guard++) {
    const d = field.dir[current] as number
    if (d === Dir.None) break
    const nx = tileX(current) + (DIR_DX[d] as number)
    const ny = tileY(current) + (DIR_DY[d] as number)
    current = ny * GRID_W + nx
    out.push(current)
    if ((field.dist[current] as number) === 0) break
  }

  return out
}
