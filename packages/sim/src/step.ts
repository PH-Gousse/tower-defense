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
import {
  buildField,
  spawnsReachable,
  mazeLength,
  createField,
  UNREACHABLE,
  type FlowField,
} from './field'
import { cloneState, spawnPointFor, MAX_CREEPS, type GameState } from './state'
import { TowerKind, levelOf, investedIn, SELL_REFUND, MAX_LEVEL } from './data'
import { createSpatialHash, rebuildHash, fireTowers, type SpatialHash } from './towers'

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
  Upgrade = 2,
  Sell = 3,
}

export type Command =
  | { readonly tick: number; readonly player: 0 | 1; readonly kind: Kind.None }
  | {
      readonly tick: number
      readonly player: 0 | 1
      readonly kind: Kind.Build
      readonly tower: TowerKind
      readonly x: number
      readonly y: number
    }
  | {
      readonly tick: number
      readonly player: 0 | 1
      readonly kind: Kind.Upgrade
      readonly x: number
      readonly y: number
    }
  | {
      readonly tick: number
      readonly player: 0 | 1
      readonly kind: Kind.Sell
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

/**
 * Why a placement was refused.
 *
 * A bare boolean was not enough. The no-block rule is invisible until you hit
 * it, and "the click did nothing" teaches the player nothing — so the refusal
 * has to name itself. This enum is what the renderer turns into the red ghost
 * and its one-line explanation.
 */
export enum Refusal {
  None = 0,
  OutOfBounds = 1,
  Occupied = 2,
  SpawnOrExit = 3,
  WouldSealLane = 4,
  NotEnoughGold = 5,
  NoTowerHere = 6,
  AlreadyMaxLevel = 7,
}

export interface BuildCheck {
  readonly refusal: Refusal
  /** Maze length after this placement, or UNREACHABLE. Only set when allowed. */
  readonly mazeAfter: number
}

const ALLOWED: BuildCheck = { refusal: Refusal.None, mazeAfter: 0 }

/**
 * Full placement check, with a reason and the resulting maze length.
 *
 * `scratch` lets a caller reuse field buffers. The client hovers across tiles
 * many times a second and each check is a candidate rebuild, so without it this
 * allocates two typed arrays per tile crossed.
 */
export function checkBuild(
  state: GameState,
  x: number,
  y: number,
  tower: TowerKind = TowerKind.Single,
  scratch?: FlowField,
): BuildCheck {
  if (!inBounds(x, y)) return { refusal: Refusal.OutOfBounds, mazeAfter: 0 }
  const i = tileIndex({ x, y })
  if (state.lane.blocked[i] === 1) return { refusal: Refusal.Occupied, mazeAfter: 0 }
  if (isSpawnIndex(i) || isExitIndex(i)) {
    return { refusal: Refusal.SpawnOrExit, mazeAfter: 0 }
  }
  if (state.gold < levelOf(tower, 1).cost) {
    return { refusal: Refusal.NotEnoughGold, mazeAfter: 0 }
  }

  // Candidate rebuild: would this seal the lane? Note it checks the spawn tiles
  // only. Creeps stranded mid-field are handled by teleport, not by refusing
  // the placement — refusing on creep positions would make legality flicker as
  // they move, and would let a cheap swarm send lock tiles out of your maze.
  state.lane.blocked[i] = 1
  const probe = buildField(state.lane.blocked, scratch)
  const reachable = spawnsReachable(probe)
  const after = reachable ? mazeLength(probe) : UNREACHABLE
  state.lane.blocked[i] = 0

  if (!reachable) return { refusal: Refusal.WouldSealLane, mazeAfter: UNREACHABLE }
  return { refusal: Refusal.None, mazeAfter: after }
}

/** Can this tower be placed? Thin wrapper; `step()` needs only the verdict. */
export function canBuild(state: GameState, x: number, y: number, tower = TowerKind.Single): boolean {
  return checkBuild(state, x, y, tower, stepScratch).refusal === Refusal.None
}

/** Upgrading needs a tower, headroom, and the gold for the next level. */
export function checkUpgrade(state: GameState, x: number, y: number): Refusal {
  if (!inBounds(x, y)) return Refusal.OutOfBounds
  const i = tileIndex({ x, y })
  const kind = state.lane.towers.kind[i] as number
  if (kind === -1) return Refusal.NoTowerHere
  const level = state.lane.towers.level[i] as number
  if (level >= MAX_LEVEL) return Refusal.AlreadyMaxLevel
  if (state.gold < levelOf(kind as TowerKind, level + 1).cost) return Refusal.NotEnoughGold
  return Refusal.None
}

/**
 * Selling needs a tower, and nothing else.
 *
 * Removing an obstacle can only ever open paths, never close them, so a sell
 * can never seal the lane and needs no reachability check. That asymmetry is
 * worth stating: it is why sell is the safe direction and build is not.
 */
export function checkSell(state: GameState, x: number, y: number): Refusal {
  if (!inBounds(x, y)) return Refusal.OutOfBounds
  if (state.lane.towers.kind[tileIndex({ x, y })] === -1) return Refusal.NoTowerHere
  return Refusal.None
}

/** What selling this tower pays back. */
export function sellValue(state: GameState, x: number, y: number): number {
  const i = tileIndex({ x, y })
  const kind = state.lane.towers.kind[i] as number
  if (kind === -1) return 0
  const invested = investedIn(kind as TowerKind, state.lane.towers.level[i] as number)
  return Math.floor(invested * SELL_REFUND)
}

/**
 * Scratch field for `canBuild` inside `step()`.
 *
 * Safe because `step()` is synchronous and single-threaded, and nothing reads
 * this between calls. It exists so a tick that applies commands does not
 * allocate. Callers outside the sim should pass their own.
 */
const stepScratch: FlowField = createField()

/** Rebuilt every tick. Module-scoped for the same reason as stepScratch. */
const hash: SpatialHash = createSpatialHash(MAX_CREEPS)

export { ALLOWED }

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
    if (cmd.kind === Kind.None) continue
    const i = tileIndex({ x: cmd.x, y: cmd.y })

    if (cmd.kind === Kind.Build) {
      if (checkBuild(s, cmd.x, cmd.y, cmd.tower, stepScratch).refusal !== Refusal.None) continue
      s.lane.blocked[i] = 1
      s.lane.towers.kind[i] = cmd.tower
      s.lane.towers.level[i] = 1
      s.lane.towers.cooldown[i] = 0
      s.gold -= levelOf(cmd.tower, 1).cost
      blockedChanged = true
      continue
    }

    if (cmd.kind === Kind.Upgrade) {
      if (checkUpgrade(s, cmd.x, cmd.y) !== Refusal.None) continue
      const next = (s.lane.towers.level[i] as number) + 1
      s.gold -= levelOf(s.lane.towers.kind[i] as TowerKind, next).cost
      s.lane.towers.level[i] = next
      // Upgrading changes range and damage, never the blocked set, so the
      // field is untouched.
      continue
    }

    if (cmd.kind === Kind.Sell) {
      if (checkSell(s, cmd.x, cmd.y) !== Refusal.None) continue
      s.gold += sellValue(s, cmd.x, cmd.y)
      s.lane.towers.kind[i] = -1
      s.lane.towers.level[i] = 0
      s.lane.towers.cooldown[i] = 0
      s.lane.blocked[i] = 0
      blockedChanged = true
      continue
    }
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

  // --- towers ---------------------------------------------------------------
  // Fire before moving: a creep that would have left range this tick still gets
  // shot at the position both clients agree it occupied at the start of it.
  rebuildHash(s, hash)
  fireTowers(s, hash)
  removeDead(s)

  // --- creeps ---------------------------------------------------------------
  moveCreeps(s)

  return s
}

/**
 * Compact out dead creeps, preserving order.
 *
 * A swap-remove would be faster and would silently break the creep-id ordering
 * that targeting ties break on, and that the hash walks. Order is a determinism
 * pin here, so this is a stable compaction: O(n), no allocation, ids stay
 * ascending.
 */
function removeDead(s: GameState): void {
  const c = s.lane.creeps
  let write = 0
  for (let read = 0; read < c.count; read++) {
    if ((c.hp[read] as number) <= 0) {
      s.kills += 1
      continue
    }
    if (write !== read) {
      c.id[write] = c.id[read] as number
      c.x[write] = c.x[read] as number
      c.y[write] = c.y[read] as number
      c.hp[write] = c.hp[read] as number
      c.laps[write] = c.laps[read] as number
      c.speed[write] = c.speed[read] as number
      c.slowPercent[write] = c.slowPercent[read] as number
      c.slowUntil[write] = c.slowUntil[read] as number
    }
    write += 1
  }
  c.count = write
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
    // Slow is an integer percent with an expiry tick. Integer division keeps
    // the reduction exact rather than accumulating float error over a match.
    let speed = c.speed[i] as number
    if (s.tick < (c.slowUntil[i] as number)) {
      const pct = c.slowPercent[i] as number
      speed = (speed * (100 - pct)) / 100
    } else if ((c.slowPercent[i] as number) !== 0) {
      c.slowPercent[i] = 0
    }
    let remaining = speed
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
