/**
 * Replay the golden fixture under whatever engine runs this file.
 *
 * CI runs it under bun (JavaScriptCore) while vitest runs the same fixture
 * under node (V8). Two engines, one committed hash. If they ever disagree,
 * something in the sim is not bit-exact and the arithmetic allowlist has a
 * hole — which is exactly the bug class premise 3 exists to prevent, and
 * exactly the one that is otherwise invisible until a friend's browser
 * desyncs mid-match.
 */
import { readFileSync } from 'node:fs'
import { createState, step, Kind, hashHex } from '../packages/sim/src/index'
import type { Command, GameState } from '../packages/sim/src/step'

const fixture = JSON.parse(
  readFileSync(new URL('../packages/sim/test/golden/match-01.json', import.meta.url), 'utf8'),
) as {
  ticks: number
  config: Parameters<typeof step>[3]
  commands: { at: number; player: 0 | 1; tower: number; x: number; y: number }[]
  expectedHash: string
}

const byTick = new Map<number, Command[]>()
for (const c of fixture.commands) {
  const list = byTick.get(c.at) ?? []
  list.push({ tick: c.at, player: c.player, kind: Kind.Build, tower: c.tower, x: c.x, y: c.y })
  byTick.set(c.at, list)
}

let a: GameState = createState()
let b: GameState = createState()
for (let t = 0; t < fixture.ticks; t++) {
  const out = step(a, byTick.get(t) ?? [], b, fixture.config)
  b = a
  a = out
}

const actual = hashHex(a)
const engine = typeof Bun === 'undefined' ? 'unknown' : `bun ${Bun.version} (JavaScriptCore)`
console.log(`engine:   ${engine}`)
console.log(`expected: ${fixture.expectedHash}`)
console.log(`actual:   ${actual}`)

if (actual !== fixture.expectedHash) {
  console.error(
    '\nCROSS-ENGINE DESYNC. The same command log produced a different state on a\n' +
      'different engine. Do not regenerate the fixture — find what diverged.\n' +
      'Most likely: a banned Math call slipped past lint, or an unordered iteration.',
  )
  process.exit(1)
}
console.log('\nOK — identical state on two engines.')
