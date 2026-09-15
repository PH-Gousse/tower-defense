import {
  GRID_W,
  GRID_H,
  HASH_CELL,
  footprintCentreX,
  footprintCentreY,
} from './grid'
import { UNREACHABLE } from './field'
import { TowerKind, levelOf, ARCHETYPES, ACQUIRE_TICKS, type TowerArchetype } from './data'
import type { GameState, Lane } from './state'

/**
 * Tower firing, and the spatial hash that makes it affordable.
 *
 * Naive targeting is "every tower scans every creep": O(towers x creeps) every
 * tick, and both are bounded only by gold -- up to 800 towers a lane on this
 * board. The hash buckets creeps by HASH_CELL x HASH_CELL tiles so a tower only
 * looks at the cells its range actually covers.
 *
 *   creeps ──▶ counting sort by hash cell ──▶ bucketStart[] + bucketItems[]
 *                                                   │
 *   tower centre, range r ──▶ bounding box ─────────┘──▶ candidates ──▶ nearest exit
 *
 * Why HASH_CELL rather than per-tile buckets, which is what this was: a bucket
 * per tile is 3408 buckets, and a range-r query walks (2r)^2 of them whether or
 * not any creep is inside. At 4 tiles a cell the walk is (2r/4)^2 -- 36 cells
 * for a range-10 tower against 440 -- and a cell holds only the creeps that are
 * actually there, so the work tracks the population rather than the board.
 *
 * Three ordered operations live in this file, and every one is a determinism
 * pin rather than a preference:
 *
 *   1. Towers fire in anchor tile-index order, which is slot order because
 *      the tower list is kept sorted (see state.ts).
 *   2. Bucket contents are in creep-array order, which is ascending id,
 *      because the counting sort fills them by walking creeps in order.
 *   3. Targeting picks the lowest `dist` — the creep nearest the exit —
 *      breaking ties on ascending creep id.
 *
 * Two clients disagreeing on any of the three is a desync, and it would show up
 * as "a tower shot a different creep", which is invisible until the hash
 * diverges.
 */

/** Hash cells across and down. Ceiling division, written without a transcendental. */
export const HASH_W = Math.ceil(GRID_W / HASH_CELL)
export const HASH_H = Math.ceil(GRID_H / HASH_CELL)
export const HASH_COUNT = HASH_W * HASH_H

/** Rebuilt every tick by counting sort. No allocation after construction. */
export interface SpatialHash {
  /** bucketStart[c] .. bucketStart[c+1] indexes into bucketItems for cell c. */
  readonly bucketStart: Int32Array
  /** Creep indices, grouped by cell, ascending within each bucket. */
  readonly bucketItems: Int32Array
  readonly counts: Int32Array
}

export function createSpatialHash(maxCreeps: number): SpatialHash {
  return {
    bucketStart: new Int32Array(HASH_COUNT + 1),
    bucketItems: new Int32Array(maxCreeps),
    counts: new Int32Array(HASH_COUNT),
  }
}

/** The hash cell a position falls in, clamped to the board. */
function cellOf(x: number, y: number): number {
  let cx = Math.floor(x / HASH_CELL)
  let cy = Math.floor(y / HASH_CELL)
  if (cx < 0) cx = 0
  if (cx >= HASH_W) cx = HASH_W - 1
  if (cy < 0) cy = 0
  if (cy >= HASH_H) cy = HASH_H - 1
  return cy * HASH_W + cx
}

/**
 * Counting sort creeps into per-cell buckets.
 *
 * O(cells + creeps), no allocation, and stable: creeps land in each bucket in
 * array order, which is ascending id. That stability is what gives targeting
 * its tiebreak for free.
 */
export function rebuildHash(lane: Lane, hash: SpatialHash): void {
  const c = lane.creeps
  const { bucketStart, bucketItems, counts } = hash
  counts.fill(0)

  for (let i = 0; i < c.count; i++) {
    const t = cellOf(c.x[i] as number, c.y[i] as number)
    counts[t] = (counts[t] as number) + 1
  }

  let running = 0
  for (let t = 0; t < HASH_COUNT; t++) {
    bucketStart[t] = running
    running += counts[t] as number
  }
  bucketStart[HASH_COUNT] = running

  // Reuse counts as a per-bucket write cursor.
  counts.fill(0)
  for (let i = 0; i < c.count; i++) {
    const t = cellOf(c.x[i] as number, c.y[i] as number)
    const at = (bucketStart[t] as number) + (counts[t] as number)
    bucketItems[at] = i
    counts[t] = (counts[t] as number) + 1
  }
}

/** The tile a creep position falls in, clamped to the board. */
export function tileOf(x: number, y: number): number {
  let tx = Math.floor(x)
  let ty = Math.floor(y)
  if (tx < 0) tx = 0
  if (tx >= GRID_W) tx = GRID_W - 1
  if (ty < 0) ty = 0
  if (ty >= GRID_H) ty = GRID_H - 1
  return ty * GRID_W + tx
}

/**
 * Fire every tower that is off cooldown and locked on.
 *
 * Towers are walked in slot order, which is anchor tile-index order. Damage is
 * instant with no projectile travel, so a shot resolves in the tick it is
 * fired.
 *
 * Acquisition (ADR-0028): a tower with nothing in range resets its `acquire`
 * counter to ACQUIRE_TICKS; while it has a target it counts down, and it fires
 * only at zero. So the first shot lands ACQUIRE_TICKS ticks after a creep
 * first appears, and a tower that keeps finding targets fires on every
 * cooldown with no second wait. The counter is not touched during cooldown:
 * a tower is either winding up or cooling down, never both, which keeps the
 * two states one integer each and the hash honest.
 */
export function fireTowers(state: GameState, lane: Lane, hash: SpatialHash): void {
  const t = lane.towers
  const c = lane.creeps

  for (let i = 0; i < t.count; i++) {
    const cd = t.cooldown[i] as number
    if (cd > 0) {
      t.cooldown[i] = cd - 1
      continue
    }

    const kind = t.kind[i] as TowerKind
    const level = t.level[i] as number
    const spec = levelOf(kind, level)
    const target = findTarget(lane, hash, i, spec.range)
    if (target === -1) {
      t.acquire[i] = ACQUIRE_TICKS
      continue
    }
    const aim = t.acquire[i] as number
    if (aim > 0) {
      t.acquire[i] = aim - 1
      continue
    }

    t.cooldown[i] = spec.cooldownTicks

    if (kind === TowerKind.Splash) {
      const arch = ARCHETYPES[TowerKind.Splash] as TowerArchetype
      const radius = arch.splashRadius ?? 1
      damageAround(lane, hash, target, radius, spec.damage)
    } else {
      c.hp[target] = (c.hp[target] as number) - spec.damage
      if (kind === TowerKind.Slow) {
        const arch = ARCHETYPES[TowerKind.Slow] as TowerArchetype
        const pct = spec.slowPercent ?? 0
        // Strongest slow wins rather than stacking; stacking would let three
        // cheap towers stop a creep dead, which is a different game.
        if (pct >= (c.slowPercent[target] as number)) {
          c.slowPercent[target] = pct
          c.slowUntil[target] = state.tick + (arch.slowTicks ?? 0)
        }
      }
    }
  }
}

/**
 * The in-range creep nearest the exit, tiebroken by ascending creep id.
 *
 * Range is measured from the tower's footprint centre (ADR-0019). "Nearest the
 * exit" is the flow field's `dist`, already computed — one integer lookup
 * rather than a geometric comparison. Note the consequence, which is real and
 * unresolved: towers permanently focus whichever creep is furthest along, so a
 * long-lived tank soaks every shot while fresh creeps walk behind it. Whether
 * that is a feature or degenerate is a tuning question for the harness.
 *
 * Exported so a test can hold it against a brute-force scan of every creep on
 * random boards: the hash must never change the answer, only the cost.
 */
export function findTarget(
  lane: Lane,
  hash: SpatialHash,
  slot: number,
  range: number,
): number {
  const c = lane.creeps
  const field = lane.field
  const tx = footprintCentreX(lane.towers.anchorX[slot] as number)
  const ty = footprintCentreY(lane.towers.anchorY[slot] as number)
  const r2 = range * range

  let best = -1
  let bestDist = UNREACHABLE
  let bestId = 0

  const minX = clampCellX(Math.floor((tx - range) / HASH_CELL))
  const maxX = clampCellX(Math.floor((tx + range) / HASH_CELL))
  const minY = clampCellY(Math.floor((ty - range) / HASH_CELL))
  const maxY = clampCellY(Math.floor((ty + range) / HASH_CELL))

  // Row-major over the bounding box: another fixed iteration order.
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = y * HASH_W + x
      const from = hash.bucketStart[cell] as number
      const to = hash.bucketStart[cell + 1] as number
      for (let k = from; k < to; k++) {
        const ci = hash.bucketItems[k] as number
        if ((c.hp[ci] as number) <= 0) continue
        const dx = (c.x[ci] as number) - tx
        const dy = (c.y[ci] as number) - ty
        if (dx * dx + dy * dy > r2) continue

        const d = field.dist[tileOf(c.x[ci] as number, c.y[ci] as number)] as number
        const id = c.id[ci] as number
        if (d < bestDist || (d === bestDist && id < bestId)) {
          best = ci
          bestDist = d
          bestId = id
        }
      }
    }
  }
  return best
}

/** Splash: everything within `radius` of the target takes full damage. */
function damageAround(
  lane: Lane,
  hash: SpatialHash,
  target: number,
  radius: number,
  damage: number,
): void {
  const c = lane.creeps
  const cx = c.x[target] as number
  const cy = c.y[target] as number
  const r2 = radius * radius

  const minX = clampCellX(Math.floor((cx - radius) / HASH_CELL))
  const maxX = clampCellX(Math.floor((cx + radius) / HASH_CELL))
  const minY = clampCellY(Math.floor((cy - radius) / HASH_CELL))
  const maxY = clampCellY(Math.floor((cy + radius) / HASH_CELL))

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cell = y * HASH_W + x
      const from = hash.bucketStart[cell] as number
      const to = hash.bucketStart[cell + 1] as number
      for (let k = from; k < to; k++) {
        const ci = hash.bucketItems[k] as number
        if ((c.hp[ci] as number) <= 0) continue
        const dx = (c.x[ci] as number) - cx
        const dy = (c.y[ci] as number) - cy
        if (dx * dx + dy * dy > r2) continue
        c.hp[ci] = (c.hp[ci] as number) - damage
      }
    }
  }
}

function clampCellX(v: number): number {
  if (v < 0) return 0
  if (v >= HASH_W) return HASH_W - 1
  return v
}

function clampCellY(v: number): number {
  if (v < 0) return 0
  if (v >= HASH_H) return HASH_H - 1
  return v
}
