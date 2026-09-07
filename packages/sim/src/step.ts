import {
  GRID_W,
  DIR_DX,
  DIR_DY,
  Dir,
  tileIndex,
  inBounds,
  isSpawnIndex,
  isExitIndex,
} from './grid'
import { buildField, spawnsReachable, UNREACHABLE, type FlowField } from './field'
import { cloneState, spawnPointFor, type GameState } from './state'

/**
 * The tick.
 *
 * `step(prev, commands, into) -> into`. Pure in the sense that matters: the
 * result is a function of (prev, commands) alone. No clock, no randomness, no
 * network, no DOM. `into` is a caller-owned buffer so a match does not allocate
 * per tick; `prev` is never written.
 *
 *   commands ──▶ total order ──▶ apply ──▶ spawn queue ──▶ move creeps ──▶ leak
 *                 (player,kind)     │                          │
 *                                   ▼                          ▼
 *                            rebuild field              [no dir?] teleport
 *                            if blocked changed          to spawn
 *
 * Ordering is the whole determinism story now that arithmetic is restricted.
 * Two pins live here: commands sort by (player, kind, tick-arrival is not a
 * tiebreak because one command per player per tick is enforced upstream), and
 * creeps update in id order, which is their array order because ids are
 * monotonic and creeps are appended.
 */

export enum Kind {
  None = 0,
  Build = 1,
}

export type Command =
  | { readonly tick: number; readonly player: 0 | 1; readonly kind: Kind.None }
  | {
      readonly tick: number
      readonly player: 0 | 1
      readonly kind: Kind.Build
      readonly x: number
      readonly y: number
    }

export const TICK_HZ = 20
export const TICK_MS = 1000 / TICK_HZ

/** Step 2 stand-ins. Real values arrive with the economy at step 6. */
export interface SimConfig {
  readonly creepHp: number
  /** Tiles per tick. */
  readonly creepSpeed: number
  /** Ticks between releases from the spawn queue. */
  readonly spawnEveryTicks: number
  /** How many creeps to release in total. -1 for none. */
  readonly spawnTotal: number
}

export const DEFAULT_CONFIG: SimConfig = {
  creepHp: 100,
  creepSpeed: 0.08,
  spawnEveryTicks: 4,
  spawnTotal: 1,
}

/**
 * Sort key for the total order within a tick.
 *
 * Player first, then kind. One command per player per tick is enforced by the
 * relay, so this is a total order rather than a partial one. Without it, two
 * simultaneous placements apply in arrival order and the two clients diverge.
 */
function commandOrder(a: Command, b: Command): number {
  if (a.player !== b.player) return a.player - b.player
  return a.kind - b.kind
}

/** Can this tower be placed? Exported because the client predicts with it. */
export function canBuild(state: GameState, x: number, y: number): boolean {
  if (!inBounds(x, y)) return false
  const i = tileIndex({ x, y })
  if (state.lane.blocked[i] === 1) return false
  if (isSpawnIndex(i) || isExitIndex(i)) return false

  // Candidate rebuild: would this seal the lane? Note it checks the spawn
  // tiles only. Creeps stranded mid-field are handled by teleport, not by
  // refusing the placement.
  state.lane.blocked[i] = 1
  const probe = buildField(state.lane.blocked)
  state.lane.blocked[i] = 0
  return spawnsReachable(probe)
}

export function step(
  prev: GameState,
  commands: readonly Command[],
  into: GameState,
  config: SimConfig = DEFAULT_CONFIG,
): GameState {
  const s = cloneState(prev, into)
  s.tick = prev.tick + 1

  // --- commands, in total order --------------------------------------------
  // slice() first: sort mutates, and the caller's array is not ours to reorder.
  const ordered = commands.slice().sort(commandOrder)
  let blockedChanged = false
  for (const cmd of ordered) {
    if (cmd.kind !== Kind.Build) continue
    if (!canBuild(s, cmd.x, cmd.y)) continue
    s.lane.blocked[tileIndex({ x: cmd.x, y: cmd.y })] = 1
    blockedChanged = true
  }
  if (blockedChanged) buildField(s.lane.blocked, s.lane.field)

  // --- spawn queue ----------------------------------------------------------
  // One creep every `spawnEveryTicks`, alternating spawn tiles. A send never
  // releases its creeps simultaneously: identical creeps entering on the same
  // tick at the same tile never separate, so they would travel as one point and
  // a single splash hit would kill all of them.
  if (config.spawnTotal > 0 && s.tick % config.spawnEveryTicks === 0) {
    const released = s.tick / config.spawnEveryTicks - 1
    if (released < config.spawnTotal) {
      addCreepAt(s, config.creepHp, config.creepSpeed, released)
    }
  }

  // --- creeps ---------------------------------------------------------------
  moveCreeps(s)

  return s
}

function addCreepAt(s: GameState, hp: number, speed: number, release: number): void {
  const c = s.lane.creeps
  if (c.count >= c.id.length) return
  const i = c.count
  const p = spawnPointFor(release)
  c.id[i] = s.nextCreepId
  c.x[i] = p.x
  c.y[i] = p.y
  c.hp[i] = hp
  c.laps[i] = 0
  c.speed[i] = speed
  c.count = i + 1
  s.nextCreepId += 1
}

/**
 * Advance every creep one tick along the field.
 *
 * Creeps walk toward the centre of the neighbour tile their current tile's
 * `dir` points at. Arithmetic is + - * / only: no sqrt, no trig, no Math.hypot.
 * Movement along a 4-connected field is axis-aligned, so distance is a
 * subtraction and there is nothing to take a square root of.
 */
function moveCreeps(s: GameState): void {
  const c = s.lane.creeps
  const field: FlowField = s.lane.field

  for (let i = 0; i < c.count; i++) {
    let remaining = c.speed[i] as number
    // A creep can cross more than one tile boundary in a tick if it is fast,
    // so this loop follows the field rather than assuming one step.
    for (let guard = 0; guard < 8 && remaining > 0; guard++) {
      const cx = Math.floor(c.x[i] as number)
      const cy = Math.floor(c.y[i] as number)
      const idx = cy * GRID_W + cx

      if (isExitIndex(idx)) {
        // Leaking (life transfer, lap increment) lands at step 5. For now the
        // creep loops so the field keeps being exercised.
        c.laps[i] = (c.laps[i] as number) + 1
        const p = spawnPointFor(c.laps[i] as number)
        c.x[i] = p.x
        c.y[i] = p.y
        break
      }

      const d = field.dir[idx] as number
      if (d === Dir.None || (field.dist[idx] as number) === UNREACHABLE) {
        // No path from here. Teleport to the spawn rather than refusing the
        // placement that caused it: walling a creep in then costs the trapper
        // towers and achieves nothing, which is the whole requirement.
        const p = spawnPointFor(c.laps[i] as number)
        c.x[i] = p.x
        c.y[i] = p.y
        break
      }

      // Target the centre of the neighbour tile.
      const tx = cx + (DIR_DX[d] as number) + 0.5
      const ty = cy + (DIR_DY[d] as number) + 0.5
      const dx = tx - (c.x[i] as number)
      const dy = ty - (c.y[i] as number)
      // Axis-aligned: exactly one of dx, dy is non-zero at a tile centre, and
      // both shrink monotonically otherwise. abs without Math.abs to keep the
      // allowlist honest at a glance.
      const adx = dx < 0 ? -dx : dx
      const ady = dy < 0 ? -dy : dy
      const need = adx + ady

      if (need <= remaining) {
        c.x[i] = tx
        c.y[i] = ty
        remaining = remaining - need
      } else {
        const f = remaining / need
        c.x[i] = (c.x[i] as number) + dx * f
        c.y[i] = (c.y[i] as number) + dy * f
        remaining = 0
      }
    }
  }
}
