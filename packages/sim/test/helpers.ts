import { beforeAll, afterAll } from 'vitest'
import { createState, type GameState } from '../src/state'
import { step, Kind, type Command } from '../src/step'
import {
  TowerKind,
  installBalanceData,
  liveBalanceData,
  type BalanceData,
} from '../src/data'

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
 */

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
): GameState {
  let a = createState()
  let b = createState()
  for (let t = 0; t < maxTicks; t++) {
    const out = step(a, cmdsAt[t] ?? [], b)
    b = a
    a = out
    if (predicate(a)) return a
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
