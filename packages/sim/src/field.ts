import {
  GRID_W,
  GRID_H,
  TILE_COUNT,
  DIR_DX,
  DIR_DY,
  Dir,
  EXIT_INDICES,
  SPAWN_INDICES,
  tileX,
  tileY,
  inBounds,
} from './grid'

/**
 * Flow field: one breadth-first sweep outward from the exit zone.
 *
 * Every creep on a field reads the same two arrays instead of owning a path.
 * That is the whole reason this is a flow field and not per-creep A*: creep
 * population is bounded only by gold, so a per-creep search would cost
 * O(creeps x search) on every placement. This costs O(tiles) = 3408, whatever
 * the population.
 *
 *   exit-zone cells (dist 0)
 *        │  expand N,E,S,W, one ring at a time
 *        ▼
 *   dist[i]  tiles remaining to the exit, or UNREACHABLE
 *   dir[i]   which neighbour to step toward, or Dir.None
 *
 * Every step costs exactly 1, so a FIFO breadth-first sweep is Dijkstra with
 * uniform weights — same result, no priority queue. Integer distances mean the
 * field is exact, with no float comparison anywhere in the path layer.
 *
 * Connectivity is 4-neighbour over EMPTY 1-tile cells. Creeps are one tile, so
 * a 1-wide gap is passable and two towers touching only at a corner seal the
 * diagonal. That is the half-slot rule (ADR-0019, ADR-0020), and this sweep is
 * where it lives: never widen the neighbourhood to make a layout pass.
 *
 * Three things fall out of this for free, which is why it earns its place:
 *   - the no-block check  (does the spawn zone still reach the exit zone?)
 *   - the maze score      (worst dist over the spawn zone)
 *   - tower targeting     (lowest dist = closest to the exit)
 */

export const UNREACHABLE = 0x7fffffff

export interface FlowField {
  /** Tiles remaining to the exit, or UNREACHABLE. */
  readonly dist: Int32Array
  /** Neighbour to step toward, or Dir.None on exits and unreachable tiles. */
  readonly dir: Int8Array
}

/**
 * Shared BFS ring. Module-level rather than per call: `buildField` runs on
 * every placement AND on every hover preview, and at 3408 tiles a fresh queue
 * per call is 13KB of garbage per mouse move. BFS visits each tile at most
 * once, so the ring never exceeds TILE_COUNT and is never re-entered -- the
 * sim is single-threaded and nothing calls buildField from inside buildField.
 */
const queue = new Int32Array(TILE_COUNT)

/**
 * Build a field over `blocked` (1 = tower, 0 = walkable).
 *
 * Allocation note: callers rebuild this on every placement and on every
 * candidate preview, so `out` lets the hot path reuse buffers instead of
 * allocating two typed arrays per hover.
 */
export function buildField(blocked: Uint8Array, out?: FlowField): FlowField {
  const dist = out?.dist ?? new Int32Array(TILE_COUNT)
  const dir = out?.dir ?? new Int8Array(TILE_COUNT)
  dist.fill(UNREACHABLE)
  dir.fill(Dir.None)

  let head = 0
  let tail = 0

  for (let k = 0; k < EXIT_INDICES.length; k++) {
    const exit = EXIT_INDICES[k] as number
    if (blocked[exit] === 1) continue
    dist[exit] = 0
    queue[tail] = exit
    tail += 1
  }

  while (head < tail) {
    const current = queue[head] as number
    head += 1
    const cd = dist[current] as number
    const cx = tileX(current)
    const cy = tileY(current)

    // N, E, S, W. Fixed order, load-bearing for determinism.
    for (let d = 0; d < 4; d++) {
      const nx = cx + (DIR_DX[d] as number)
      const ny = cy + (DIR_DY[d] as number)
      if (!inBounds(nx, ny)) continue
      const n = ny * GRID_W + nx
      if (blocked[n] === 1) continue
      if ((dist[n] as number) !== UNREACHABLE) continue
      dist[n] = cd + 1
      // The neighbour steps back toward `current`, which is the opposite of the
      // direction we just walked. N<->S and E<->W are two apart.
      dir[n] = (d + 2) % 4
      queue[tail] = n
      tail += 1
    }
  }

  return { dist, dir }
}

/**
 * Would creeps still be able to leave, given this blocked set?
 *
 * The no-block rule is "at least one spawn-zone cell has a finite distance".
 * The zone is never built on, so all of its cells are mutually connected and
 * "any" is the same question as "all" -- it is written as "any" because that
 * is the rule ADR-0019 states.
 *
 * Note what this does NOT check. An earlier design refused any placement that
 * stranded a creep mid-field; that made build legality depend on where enemy
 * creeps stood, which turned cheap swarm sends into a build-denial weapon. A
 * creep with no path goes back to the spawn zone instead -- see step.ts. The
 * separate rule that a footprint may not be placed ON a creep is checked in
 * `checkBuild`, not here (ADR-0023).
 */
export function spawnsReachable(field: FlowField): boolean {
  for (let k = 0; k < SPAWN_INDICES.length; k++) {
    if ((field.dist[SPAWN_INDICES[k] as number] as number) !== UNREACHABLE) return true
  }
  return false
}

/**
 * Maze length: how far a creep entering now has to walk, at worst.
 *
 * The worst cell of the spawn zone, because spawns are spread across it
 * (ADR-0022) and the number rendered as `Maze: 214 tiles` should be the one
 * the unluckiest creep faces. The hover preview is the difference between this
 * before and after a candidate placement, and a difference of worst cases is
 * exact for a wall (it moves every cell by the same amount).
 */
export function mazeLength(field: FlowField): number {
  let worst = 0
  for (let k = 0; k < SPAWN_INDICES.length; k++) {
    const d = field.dist[SPAWN_INDICES[k] as number] as number
    if (d === UNREACHABLE) return UNREACHABLE
    if (d > worst) worst = d
  }
  return worst
}

export function createField(): FlowField {
  return { dist: new Int32Array(TILE_COUNT), dir: new Int8Array(TILE_COUNT) }
}

export { GRID_W, GRID_H }
