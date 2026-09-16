import { beforeAll, afterAll } from 'vitest'
import { createState, insertTower, type GameState } from '../src/state'
import { buildField } from '../src/field'
import { step, Kind, type Command } from '../src/step'
import {
  TowerKind,
  installBalanceData,
  liveBalanceData,
  type BalanceData,
} from '../src/data'
import { BUILD_ROW_MIN, GRID_W, TOWER_SIZE, SPARE_TILES } from '../src/grid'

/**
 * Shared test rig.
 *
 * Creeps no longer appear from a config: they exist because a player sent them,
 * which is the real mechanic. Tests drive the sim the same way a player does,
 * so a test passing means the command path works, not just the internals.
 *
 * By convention throughout the suite: **player 0 defends lane 0** and is the
 * subject of most assertions; **player 1 is the aggressor** whose sends land in
 * lane 0.
 *
 * Geometry: a tower is 2x2 and anchors on its top-left tile (ADR-0019/0020).
 * `R` is the first buildable row; tests place towers at `R + n` rather than
 * at literals so the spawn zone's depth is never baked into an assertion.
 */

/** First buildable row. Anchors at `R` cover rows R and R+1. */
export const R = BUILD_ROW_MIN

/**
 * Turn off the opening build phase for one test file.
 *
 * Most of this suite is about a mechanic -- a tower's cooldown, the kill
 * bounty, the loop rule -- and reaches it by sending a creep at tick 0 because
 * sending is how creeps come to exist. The build phase is a match-opening
 * balance number and has nothing to say about any of that, so rather than
 * prefixing twenty tests with a 400-tick preamble that tests nothing and slows
 * every run, those files declare that they are not testing the opening.
 *
 * This is the same reasoning that makes the golden fixture pin its own frozen
 * `BalanceData`: a test coupled to a balance knob gets *regenerated* when the
 * knob moves rather than investigated, which is how a regression test quietly
 * becomes a rubber stamp. The build phase has its own tests, in
 * `test/opening.test.ts`, which is where moving this number should show up.
 *
 * Restores in `afterAll`, because the module state is shared by every test in
 * the file.
 */
export function withoutBuildPhase(): void {
  let restore: BalanceData | null = null
  beforeAll(() => {
    restore = installBalanceData({ ...liveBalanceData(), sendUnlockTicks: 0 })
  })
  afterAll(() => {
    if (restore) installBalanceData(restore)
  })
}

/** Creep indices into data/creeps.json, in file order. */
export const SWARM = 0
export const RUNNER = 1
export const TANK = 2
export const SWARM2 = 3
export const RUNNER2 = 4
export const TANK2 = 5

export const build = (
  x: number,
  y: number,
  tower: TowerKind = TowerKind.Single,
  player: 0 | 1 = 0,
): Command => ({ tick: 0, player, kind: Kind.Build, tower, x, y })

export const upgrade = (x: number, y: number, player: 0 | 1 = 0): Command => ({
  tick: 0, player, kind: Kind.Upgrade, x, y,
})

export const sell = (x: number, y: number, player: 0 | 1 = 0): Command => ({
  tick: 0, player, kind: Kind.Sell, x, y,
})

/** Player 1 sends by default, so the creeps arrive in lane 0. */
export const send = (creep: number, player: 0 | 1 = 1): Command => ({
  tick: 0, player, kind: Kind.Send, creep,
})

/** Run `ticks` ticks with an optional command schedule. */
export function run(ticks: number, cmdsAt: Record<number, Command[]> = {}): GameState {
  let a = createState()
  let b = createState()
  for (let t = 0; t < ticks; t++) {
    const out = step(a, cmdsAt[t] ?? [], b)
    b = a
    a = out
  }
  return a
}

/** Run until `predicate` holds, or give up after `maxTicks`. */
export function runUntil(
  predicate: (s: GameState) => boolean,
  maxTicks: number,
  cmdsAt: Record<number, Command[]> = {},
  setup: (s: GameState) => void = () => {},
): GameState {
  let a = createState()
  setup(a)
  let b = createState()
  for (let t = 0; t < maxTicks; t++) {
    const out = step(a, cmdsAt[t] ?? [], b)
    b = a
    a = out
    if (predicate(a)) return a
  }
  return a
}

/**
 * Advance `n` ticks from `s`, double-buffered, returning the final state.
 *
 * `s` is not written; the returned state is a fresh buffer the caller owns.
 * Prefer this over `tick` in a loop, which allocates a whole state per call.
 */
/**
 * A tick-at-a-time stepper that allocates nothing after its two buffers.
 *
 * `advance(s, 1)` in a loop pays for two fresh states per tick, and a state
 * is 65,536 creep slots wide: four thousand of them is tens of gigabytes
 * through the allocator and a test that times out under load. This rotates
 * three buffers instead. Only the state most recently returned is valid --
 * the one before it, and `start` itself, are reused as buffers.
 */
export function stepper(start: GameState): () => GameState {
  let a = start
  let b = createState()
  let c = createState()
  return () => {
    const out = step(a, [], b)
    b = c
    c = a
    a = out
    return out
  }
}

export function advance(s: GameState, n: number): GameState {
  let a = s
  let b = createState()
  let spare: GameState | null = null
  for (let t = 0; t < n; t++) {
    const out = step(a, [], b)
    // The first step must not reuse `s` as a buffer; after that, two buffers
    // rotate freely.
    b = spare ?? createState()
    spare = a === s ? null : a
    a = out
  }
  return a
}

/** Give a player gold without going through the economy, for setup. */
export function withGold(s: GameState, player: number, gold: number): GameState {
  ;(s.players[player] as { gold: number }).gold = gold
  return s
}

/** Advance one tick, returning the new state. Buffers rotate internally. */
export function tick(s: GameState, commands: Command[] = []): GameState {
  return step(s, commands, createState())
}

/**
 * Put a tower on the board by hand, bypassing gold and every rule.
 *
 * For setting up states the placement rules exist to prevent, which is the
 * only way to test that they prevent them. Rebuilds the field so the state is
 * consistent afterwards.
 */
export function place(
  s: GameState,
  lane: number,
  ax: number,
  ay: number,
  kind: TowerKind = TowerKind.Single,
  level = 1,
): number {
  const l = s.lanes[lane]!
  const slot = insertTower(l, s.nextTowerId, ax, ay, kind)
  s.nextTowerId += 1
  l.towers.level[slot] = level
  buildField(l.blocked, l.field)
  return slot
}

/**
 * A wall of 2x2 towers across lane `lane` at rows y..y+1, by hand.
 *
 * Anchors step across by TOWER_SIZE; any anchor whose footprint would touch a
 * column in `open` is skipped, so `open: [14, 15]` leaves a 2-wide gap at the
 * right and `open: []` seals the row.
 */
export function wall(s: GameState, lane: number, y: number, open: readonly number[]): void {
  for (let ax = 0; ax + TOWER_SIZE <= GRID_W; ax += TOWER_SIZE) {
    let skip = false
    for (let dx = 0; dx < TOWER_SIZE; dx++) if (open.includes(ax + dx)) skip = true
    if (!skip) place(s, lane, ax, y)
  }
}

/**
 * Seal the lane at rows y..y+1, by hand, past the WouldSealLane rule.
 *
 * A full row of towers leaves the spare column open (ADR-0027), so on this
 * lane a seal is the row plus a plug directly below it at the spare column,
 * sharing an edge with the row's last tower. On a lane with no spare column
 * the row alone seals and the plug is skipped.
 */
export function seal(s: GameState, lane: number, y: number): void {
  wall(s, lane, y, [])
  if (SPARE_TILES > 0) place(s, lane, GRID_W - TOWER_SIZE, y + TOWER_SIZE)
}

/** Number of ticks a creep of `speed` tiles/tick needs for one bare lap. */
export function bareLapTicks(speed: number): number {
  return Math.ceil((s0().lanes[0]!.field.dist[0] as number) / speed)
}

function s0(): GameState {
  return createState()
}
