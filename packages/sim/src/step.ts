import {
  GRID_W,
  DIR_DX,
  DIR_DY,
  Dir,
  tileIndex,
  inBounds,
  isReservedIndex,
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
import {
  cloneState,
  spawnPointFor,
  opponentOf,
  MAX_CREEPS,
  MatchResult,
  PLAYER_COUNT,
  INCOME_EVERY_TICKS,
  SPAWN_EVERY_TICKS,
  type GameState,
  type Lane,
  type Player,
} from './state'
import {
  TowerKind,
  levelOf,
  investedIn,
  SELL_REFUND,
  MAX_LEVEL,
  CREEPS,
  creepSpec,
  tierUnlockTick,
} from './data'
import { createSpatialHash, rebuildHash, fireTowers, type SpatialHash } from './towers'

/**
 * The tick.
 *
 * `step(prev, commands, into) -> into`. Pure in the sense that matters: the
 * result is a function of (prev, commands) alone. No clock, no randomness, no
 * network, no DOM. `into` is a caller-owned buffer so a match does not allocate
 * per tick; `prev` is never written.
 *
 *   commands ──▶ total order ──▶ apply ──▶ income ──▶ per lane:
 *                (player,kind)                          release queue
 *                                                       fire towers
 *                                                       remove dead (bounty)
 *                                                       move creeps (leak)
 *
 * Ordering is the whole determinism story now that arithmetic is restricted.
 * The pins: commands sort by (player, kind); lanes process in index order;
 * creeps update in id order, which is array order because ids are monotonic and
 * creeps are appended; towers fire in tile order; queues release FIFO.
 */

export enum Kind {
  None = 0,
  Build = 1,
  Upgrade = 2,
  Sell = 3,
  Send = 4,
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
  | { readonly tick: number; readonly player: 0 | 1; readonly kind: Kind.Send; readonly creep: number }

export const TICK_HZ = 20
export const TICK_MS = 1000 / TICK_HZ

export enum Refusal {
  None = 0,
  OutOfBounds = 1,
  Occupied = 2,
  SpawnOrExit = 3,
  WouldSealLane = 4,
  NotEnoughGold = 5,
  NoTowerHere = 6,
  AlreadyMaxLevel = 7,
  TierLocked = 8,
}

export interface BuildCheck {
  readonly refusal: Refusal
  /** Maze length after this placement, or UNREACHABLE. Only set when allowed. */
  readonly mazeAfter: number
}

const stepScratch: FlowField = createField()
const hash: SpatialHash = createSpatialHash(MAX_CREEPS)

/**
 * Sort key for the total order within a tick.
 *
 * Player first, then kind. One command per player per tick is enforced by the
 * relay, so this is a total order. Without it, two simultaneous placements
 * apply in arrival order and clients diverge.
 */
function commandOrder(a: Command, b: Command): number {
  if (a.player !== b.player) return a.player - b.player
  return a.kind - b.kind
}

// --- checks ------------------------------------------------------------------

export function checkBuild(
  state: GameState,
  player: number,
  x: number,
  y: number,
  tower: TowerKind = TowerKind.Single,
  scratch?: FlowField,
): BuildCheck {
  if (!inBounds(x, y)) return { refusal: Refusal.OutOfBounds, mazeAfter: 0 }
  const lane = state.lanes[player] as Lane
  const i = tileIndex({ x, y })
  if (lane.blocked[i] === 1) return { refusal: Refusal.Occupied, mazeAfter: 0 }
  // The whole entrance row and the whole exit row, not just the four tiles that
  // spawn and drain. See isReservedIndex.
  if (isReservedIndex(i)) return { refusal: Refusal.SpawnOrExit, mazeAfter: 0 }
  if ((state.players[player] as Player).gold < levelOf(tower, 1).cost) {
    return { refusal: Refusal.NotEnoughGold, mazeAfter: 0 }
  }

  // Candidate rebuild: would this seal the lane? It checks the spawn tiles
  // only. Creeps stranded mid-field teleport to the spawn instead — refusing on
  // creep positions would make legality flicker as they move, and would let a
  // cheap swarm send lock tiles out of the defender's maze.
  lane.blocked[i] = 1
  const probe = buildField(lane.blocked, scratch)
  const reachable = spawnsReachable(probe)
  const after = reachable ? mazeLength(probe) : UNREACHABLE
  lane.blocked[i] = 0

  if (!reachable) return { refusal: Refusal.WouldSealLane, mazeAfter: UNREACHABLE }
  return { refusal: Refusal.None, mazeAfter: after }
}

export function canBuild(
  state: GameState,
  player: number,
  x: number,
  y: number,
  tower = TowerKind.Single,
): boolean {
  return checkBuild(state, player, x, y, tower, stepScratch).refusal === Refusal.None
}

export function checkUpgrade(state: GameState, player: number, x: number, y: number): Refusal {
  if (!inBounds(x, y)) return Refusal.OutOfBounds
  const lane = state.lanes[player] as Lane
  const i = tileIndex({ x, y })
  const kind = lane.towers.kind[i] as number
  if (kind === -1) return Refusal.NoTowerHere
  const level = lane.towers.level[i] as number
  if (level >= MAX_LEVEL) return Refusal.AlreadyMaxLevel
  if ((state.players[player] as Player).gold < levelOf(kind as TowerKind, level + 1).cost) {
    return Refusal.NotEnoughGold
  }
  return Refusal.None
}

/**
 * Selling needs a tower, and nothing else.
 *
 * Removing an obstacle can only ever open paths, never close them, so a sell
 * can never seal the lane and needs no reachability check. Build is the
 * dangerous direction; sell is free.
 */
export function checkSell(state: GameState, player: number, x: number, y: number): Refusal {
  if (!inBounds(x, y)) return Refusal.OutOfBounds
  if ((state.lanes[player] as Lane).towers.kind[tileIndex({ x, y })] === -1) {
    return Refusal.NoTowerHere
  }
  return Refusal.None
}

export function sellValue(state: GameState, player: number, x: number, y: number): number {
  const lane = state.lanes[player] as Lane
  const i = tileIndex({ x, y })
  const kind = lane.towers.kind[i] as number
  if (kind === -1) return 0
  return Math.floor(investedIn(kind as TowerKind, lane.towers.level[i] as number) * SELL_REFUND)
}

/** Can this player send this creep right now? */
export function checkSend(state: GameState, player: number, creep: number): Refusal {
  if (creep < 0 || creep >= CREEPS.length) return Refusal.OutOfBounds
  const spec = creepSpec(creep)
  if (state.tick < tierUnlockTick(spec.tier)) return Refusal.TierLocked
  if ((state.players[player] as Player).gold < spec.cost) return Refusal.NotEnoughGold
  return Refusal.None
}

// --- the tick ----------------------------------------------------------------

export function step(prev: GameState, commands: readonly Command[], into: GameState): GameState {
  const s = cloneState(prev, into)

  // A finished match is frozen: no tick, no commands, no movement. Both clients
  // show the result rather than watching creeps lap a lane already lost.
  if (prev.result !== MatchResult.Playing) return s

  s.tick = prev.tick + 1
  applyCommands(s, commands)

  // Income arrives in a lump every 15 seconds. That cadence is the game's
  // decision rhythm: roughly four times a minute you choose between towers and
  // creeps, not continuously.
  if (s.tick % INCOME_EVERY_TICKS === 0) {
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const pl = s.players[p] as Player
      pl.gold += pl.income
    }
  }

  for (let l = 0; l < s.lanes.length; l++) {
    releaseFromQueue(s, l)
    const lane = s.lanes[l] as Lane
    rebuildHash(lane, hash)
    fireTowers(s, lane, hash)
    removeDead(s, l)
    moveCreeps(s, l)
  }

  return s
}

function applyCommands(s: GameState, commands: readonly Command[]): void {
  // slice() first: sort mutates, and the caller's array is not ours to reorder.
  const ordered = commands.slice().sort(commandOrder)

  for (const cmd of ordered) {
    if (cmd.kind === Kind.None) continue
    const player = cmd.player
    const pl = s.players[player] as Player

    if (cmd.kind === Kind.Send) {
      if (checkSend(s, player, cmd.creep) !== Refusal.None) continue
      const spec = creepSpec(cmd.creep)
      pl.gold -= spec.cost
      // Income is permanent and never expires. Sending is the ONLY way it
      // grows, which is what makes turtling a losing strategy and over-sending
      // a real temptation.
      pl.income += spec.incomeBonus
      enqueueSend(s, opponentOf(player), cmd.creep, player, spec.count)
      continue
    }

    const lane = s.lanes[player] as Lane
    const i = tileIndex({ x: cmd.x, y: cmd.y })

    if (cmd.kind === Kind.Build) {
      if (checkBuild(s, player, cmd.x, cmd.y, cmd.tower, stepScratch).refusal !== Refusal.None) {
        continue
      }
      lane.blocked[i] = 1
      lane.towers.kind[i] = cmd.tower
      lane.towers.level[i] = 1
      lane.towers.cooldown[i] = 0
      pl.gold -= levelOf(cmd.tower, 1).cost
      buildField(lane.blocked, lane.field)
      continue
    }

    if (cmd.kind === Kind.Upgrade) {
      if (checkUpgrade(s, player, cmd.x, cmd.y) !== Refusal.None) continue
      const next = (lane.towers.level[i] as number) + 1
      pl.gold -= levelOf(lane.towers.kind[i] as TowerKind, next).cost
      lane.towers.level[i] = next
      // Upgrading changes range and damage, never the blocked set.
      continue
    }

    if (cmd.kind === Kind.Sell) {
      if (checkSell(s, player, cmd.x, cmd.y) !== Refusal.None) continue
      pl.gold += sellValue(s, player, cmd.x, cmd.y)
      lane.towers.kind[i] = -1
      lane.towers.level[i] = 0
      lane.towers.cooldown[i] = 0
      lane.blocked[i] = 0
      buildField(lane.blocked, lane.field)
      continue
    }
  }
}

/** A send enqueues `count` creeps into the target lane, owned by the sender. */
function enqueueSend(
  s: GameState,
  targetLane: number,
  creep: number,
  owner: number,
  count: number,
): void {
  const lane = s.lanes[targetLane] as Lane
  for (let n = 0; n < count; n++) {
    if (lane.queueTail >= lane.queueCreep.length) break
    lane.queueCreep[lane.queueTail] = creep
    lane.queueOwner[lane.queueTail] = owner
    lane.queueTail += 1
  }
}

/**
 * Release one queued creep every SPAWN_EVERY_TICKS.
 *
 * Never all at once. Identical creeps entering on the same tick at the same
 * tile would never separate — they would travel as a single point and one
 * splash hit would kill all six, which erases the Splash tower's reason to
 * exist.
 */
function releaseFromQueue(s: GameState, laneIndex: number): void {
  const lane = s.lanes[laneIndex] as Lane
  if (lane.queueHead >= lane.queueTail) {
    // Nothing pending. Reset so the next send releases promptly rather than
    // waiting out a stale countdown.
    lane.nextRelease = 0
    return
  }
  if (lane.nextRelease > 0) {
    lane.nextRelease -= 1
    return
  }

  const creep = lane.queueCreep[lane.queueHead] as number
  const owner = lane.queueOwner[lane.queueHead] as number
  lane.queueHead += 1
  lane.nextRelease = SPAWN_EVERY_TICKS

  // Reset indices once the queue drains, so head/tail cannot run off the end
  // over a long match.
  if (lane.queueHead === lane.queueTail) {
    lane.queueHead = 0
    lane.queueTail = 0
  }

  const spec = creepSpec(creep)
  const c = lane.creeps
  if (c.count >= c.id.length) return
  const i = c.count
  const p = spawnPointFor(lane.released)
  c.id[i] = s.nextCreepId
  c.owner[i] = owner
  c.spec[i] = creep
  c.x[i] = p.x
  c.y[i] = p.y
  c.hp[i] = spec.hp
  c.laps[i] = 0
  c.speed[i] = spec.speed
  c.slowPercent[i] = 0
  c.slowUntil[i] = 0
  c.count = i + 1
  s.nextCreepId += 1
  lane.released += 1
}

/**
 * Compact out dead creeps, preserving order, paying bounty to the lane owner.
 *
 * A swap-remove would be faster and would silently break the creep-id ordering
 * that targeting ties break on and that the hash walks. Order is a determinism
 * pin, so this is a stable compaction.
 */
function removeDead(s: GameState, laneIndex: number): void {
  const lane = s.lanes[laneIndex] as Lane
  const defender = s.players[laneIndex] as Player
  const c = lane.creeps
  let write = 0
  for (let read = 0; read < c.count; read++) {
    if ((c.hp[read] as number) <= 0) {
      defender.kills += 1
      // Bounty pays the DEFENDER: killing in your own lane is what earns it.
      defender.gold += creepSpec(c.spec[read] as number).bounty
      continue
    }
    if (write !== read) {
      c.id[write] = c.id[read] as number
      c.owner[write] = c.owner[read] as number
      c.spec[write] = c.spec[read] as number
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

/**
 * Advance every creep in a lane one tick along its field.
 *
 * Arithmetic is + - * / only: movement along a 4-connected field is
 * axis-aligned, so distance is a subtraction and there is nothing to root.
 */
function moveCreeps(s: GameState, laneIndex: number): void {
  const lane = s.lanes[laneIndex] as Lane
  const defender = s.players[laneIndex] as Player
  const c = lane.creeps
  const field = lane.field

  for (let i = 0; i < c.count; i++) {
    let speed = c.speed[i] as number
    if (s.tick < (c.slowUntil[i] as number)) {
      speed = (speed * (100 - (c.slowPercent[i] as number))) / 100
    } else if ((c.slowPercent[i] as number) !== 0) {
      c.slowPercent[i] = 0
    }
    let remaining = speed

    for (let guard = 0; guard < 8 && remaining > 0; guard++) {
      const cx = Math.floor(c.x[i] as number)
      const cy = Math.floor(c.y[i] as number)
      const idx = cy * GRID_W + cx

      if (isExitIndex(idx)) {
        // A leak does two things, and deliberately not a third:
        //   1. the lane owner loses a life
        //   2. the creep returns to the spawn and runs the maze again, keeping
        //      its damage and lap count
        // The sender gains nothing. Lives only ever go down, for everyone.
        // Crediting the sender would make each leak a 2-point swing, so a
        // leader would compound in lives and income at once with nothing
        // pushing back.
        //
        // No lap cap, no decay, no timeout: tower damage is the only thing that
        // removes a creep, and that is the intended pressure.
        defender.lives -= 1
        defender.leaks += 1
        c.laps[i] = (c.laps[i] as number) + 1
        lane.released += 1
        const p = spawnPointFor(lane.released)
        c.x[i] = p.x
        c.y[i] = p.y
        if (defender.lives <= 0) {
          defender.lives = 0
          endMatch(s)
        }
        break
      }

      const d = field.dir[idx] as number
      if (d === Dir.None || (field.dist[idx] as number) === UNREACHABLE) {
        // No path from here. Teleport to the spawn rather than refusing the
        // placement that caused it: walling a creep in then costs the trapper
        // towers and achieves nothing, which was always the requirement.
        lane.released += 1
        const p = spawnPointFor(lane.released)
        c.x[i] = p.x
        c.y[i] = p.y
        break
      }

      const tx = cx + (DIR_DX[d] as number) + 0.5
      const ty = cy + (DIR_DY[d] as number) + 0.5
      const dx = tx - (c.x[i] as number)
      const dy = ty - (c.y[i] as number)
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

/**
 * Decide the match once someone has run out of lives.
 *
 * Both players reaching zero on the same tick is a draw. It is genuinely
 * reachable: two leaks can resolve on the same tick in different lanes.
 */
function endMatch(s: GameState): void {
  let dead = -1
  let deadCount = 0
  for (let p = 0; p < PLAYER_COUNT; p++) {
    if ((s.players[p] as Player).lives <= 0) {
      if (dead === -1) dead = p
      deadCount += 1
    }
  }
  if (deadCount === 0) return
  if (deadCount >= PLAYER_COUNT) {
    s.result = MatchResult.Draw
    s.winner = -1
    return
  }
  s.result = MatchResult.Decided
  s.winner = opponentOf(dead)
}
