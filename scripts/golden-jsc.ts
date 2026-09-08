/**
 * Replay the golden fixture under whatever engine runs this file.
 *
 * CI runs it under bun (JavaScriptCore) while vitest runs the same fixture
 * under node (V8). Two engines, one committed hash. If they disagree, something
 * in the sim is not bit-exact and the arithmetic allowlist has a hole — the bug
 * class premise 3 exists to prevent, and the one that is otherwise invisible
 * until a friend's browser desyncs mid-match.
 *
 * This file deliberately re-implements the fixture replay rather than importing
 * the vitest helper, so the two engines are exercised by independent code paths
 * and a mistake in one does not silently mask the other. The cost is that it
 * can drift from the fixture format — it did exactly that at step 6, still
 * treating every command as a Build after sends were added, and reported a
 * desync that was really its own staleness. The shape assertions below exist so
 * that drift fails loudly as a format error rather than quietly as a fake
 * desync.
 */
import { readFileSync } from 'node:fs'
import { createState, step, Kind, hashHex, MatchResult, installBalanceData } from '../packages/sim/src/index'
import type { BalanceData } from '../packages/sim/src/data'
import type { Command, GameState } from '../packages/sim/src/step'
import type { TowerKind } from '../packages/sim/src/data'

interface FixtureCommand {
  at: number
  player: 0 | 1
  kind: 'build' | 'upgrade' | 'sell' | 'send'
  tower?: number
  creep?: number
  x?: number
  y?: number
}

interface Fixture {
  ticks: number
  commands: FixtureCommand[]
  expectedHash: string
  /** Frozen balance data. Installed below, so tuning never moves this hash. */
  data: BalanceData
}

const fixture = JSON.parse(
  readFileSync(new URL('../packages/sim/test/golden/match-01.json', import.meta.url), 'utf8'),
) as Fixture

function toCommand(c: FixtureCommand): Command {
  switch (c.kind) {
    case 'build':
      if (c.tower === undefined || c.x === undefined || c.y === undefined) {
        throw new Error(`fixture: build at tick ${c.at} is missing tower/x/y`)
      }
      return { tick: c.at, player: c.player, kind: Kind.Build, tower: c.tower as TowerKind, x: c.x, y: c.y }
    case 'upgrade':
      if (c.x === undefined || c.y === undefined) throw new Error(`fixture: upgrade at tick ${c.at} is missing x/y`)
      return { tick: c.at, player: c.player, kind: Kind.Upgrade, x: c.x, y: c.y }
    case 'sell':
      if (c.x === undefined || c.y === undefined) throw new Error(`fixture: sell at tick ${c.at} is missing x/y`)
      return { tick: c.at, player: c.player, kind: Kind.Sell, x: c.x, y: c.y }
    case 'send':
      if (c.creep === undefined) throw new Error(`fixture: send at tick ${c.at} is missing creep`)
      return { tick: c.at, player: c.player, kind: Kind.Send, creep: c.creep }
    default:
      throw new Error(`fixture: unknown command kind "${(c as FixtureCommand).kind}"`)
  }
}

const byTick = new Map<number, Command[]>()
for (const c of fixture.commands) {
  const list = byTick.get(c.at) ?? []
  list.push(toCommand(c))
  byTick.set(c.at, list)
}

installBalanceData(fixture.data)

let a: GameState = createState()
let b: GameState = createState()
for (let t = 0; t < fixture.ticks; t++) {
  const out = step(a, byTick.get(t) ?? [], b)
  b = a
  a = out
}

const actual = hashHex(a)
const engine = typeof Bun === 'undefined' ? 'unknown' : `bun ${Bun.version} (JavaScriptCore)`
console.log(`engine:   ${engine}`)
console.log(`expected: ${fixture.expectedHash}`)
console.log(`actual:   ${actual}`)
console.log(
  `state:    tick=${a.tick} result=${MatchResult[a.result]} ` +
    `p0(lives=${a.players[0]!.lives} kills=${a.players[0]!.kills} income=${a.players[0]!.income}) ` +
    `p1(lives=${a.players[1]!.lives} kills=${a.players[1]!.kills} income=${a.players[1]!.income})`,
)

if (actual !== fixture.expectedHash) {
  console.error(
    '\nCROSS-ENGINE DESYNC. The same command log produced a different state on a\n' +
      'different engine. Do not regenerate the fixture — find what diverged.\n' +
      'Check in this order:\n' +
      '  1. Is this script reading the fixture correctly? It has drifted before.\n' +
      '  2. A banned Math call that slipped past lint.\n' +
      '  3. An unordered iteration — Object.keys, for...in, a comparator-less sort.\n' +
      '  4. A field added to state but not to hashState.',
  )
  process.exit(1)
}
console.log('\nOK — identical state on two engines.')
