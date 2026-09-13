import {
  GRID_W,
  GRID_H,
  SPAWN_ROWS,
  EXIT_ROW_MIN,
  EXIT_ROWS,
  tileOf,
  type Lane,
} from '@ltw/sim'

/**
 * Where the jump hotkeys go (ADR-0024).
 *
 * Pure functions from the sim snapshot to a world point, so each can be pinned
 * without a camera. The scene centres the camera on the answer.
 *
 *   Home   my spawn zone          End    my exit zone
 *   Tab    the opponent's lane at the same row
 *   Space  the deepest creep in my lane; pressed again, the next one on the
 *          same lap
 *
 * `[proposed]` bindings. The letter keys are taken: q w e r t y send, 1 2 3
 * pick a tower, m mutes, d saves a match file -- which is also why the camera
 * pans on the arrows and not WASD.
 */

export interface Point {
  x: number
  z: number
}

/** The middle of a lane's spawn zone, in lane-local tiles. */
export function spawnZoneCentre(out: Point): Point {
  out.x = GRID_W / 2
  out.z = SPAWN_ROWS / 2
  return out
}

/** The middle of a lane's exit zone, in lane-local tiles. */
export function exitZoneCentre(out: Point): Point {
  out.x = GRID_W / 2
  out.z = EXIT_ROW_MIN + EXIT_ROWS / 2
  return out
}

/**
 * The same row in the other lane: the target's x moved across by the lane
 * pitch, its z kept. `laneX(0)` and `laneX(1)` are where the two lanes are
 * drawn; whichever the target is nearer is the one it leaves.
 */
export function mirrorAcross(targetX: number, laneX0: number, laneX1: number): number {
  const mid = (laneX0 + laneX1 + GRID_W) / 2
  const pitch = laneX1 - laneX0
  return targetX < mid ? targetX + pitch : targetX - pitch
}

/**
 * The creep furthest along in a lane: highest lap first, then nearest the
 * exit by the flow field, then lowest id. Returns its array index or -1.
 *
 * Laps first because a creep on its second lap is the one costing lives; among
 * equals, the one about to leak. Ties by id so two clients agree, though this
 * is read-only and a disagreement would only move a camera.
 */
export function deepestCreep(lane: Lane): number {
  const c = lane.creeps
  let best = -1
  let bestLaps = -1
  let bestDist = Number.MAX_SAFE_INTEGER
  let bestId = Number.MAX_SAFE_INTEGER
  for (let i = 0; i < c.count; i++) {
    const laps = c.laps[i] as number
    if (laps < bestLaps) continue
    const d = lane.field.dist[tileOf(c.x[i] as number, c.y[i] as number)] as number
    const id = c.id[i] as number
    if (laps > bestLaps || d < bestDist || (d === bestDist && id < bestId)) {
      best = i
      bestLaps = laps
      bestDist = d
      bestId = id
    }
  }
  return best
}

/**
 * The creeps on the highest lap in a lane, as array indices in ascending id,
 * for Space to cycle through. Empty when the lane is empty.
 */
export function highestLappers(lane: Lane, out: number[] = []): number[] {
  out.length = 0
  const c = lane.creeps
  let top = -1
  for (let i = 0; i < c.count; i++) if ((c.laps[i] as number) > top) top = c.laps[i] as number
  if (top < 0) return out
  for (let i = 0; i < c.count; i++) if ((c.laps[i] as number) === top) out.push(i)
  return out
}

/**
 * The next creep in a cycle over `lappers`, by id, after the one last visited.
 *
 * Creeps move between array slots as others die, so the cycle remembers the
 * ID it visited, not the slot: the next press goes to the smallest id larger
 * than the last one, wrapping to the smallest. A creep that died is simply
 * skipped past.
 */
export function nextLapper(lane: Lane, lappers: readonly number[], lastId: number): number {
  if (lappers.length === 0) return -1
  const c = lane.creeps
  let best = -1
  let bestId = Number.MAX_SAFE_INTEGER
  let first = -1
  let firstId = Number.MAX_SAFE_INTEGER
  for (const i of lappers) {
    const id = c.id[i] as number
    if (id < firstId) {
      first = i
      firstId = id
    }
    if (id > lastId && id < bestId) {
      best = i
      bestId = id
    }
  }
  return best === -1 ? first : best
}

/** Clamp a jump target into the lane so a creep half off the edge still frames. */
export function clampToLane(p: Point): Point {
  if (p.x < 0) p.x = 0
  if (p.x > GRID_W) p.x = GRID_W
  if (p.z < 0) p.z = 0
  if (p.z > GRID_H) p.z = GRID_H
  return p
}
