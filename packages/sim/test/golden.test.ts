import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createState, MatchResult, type GameState } from '../src/state'
import { TowerKind, installBalanceData, type BalanceData } from '../src/data'
import { step, Kind, type Command } from '../src/step'
import { hashHex } from '../src/hash'

/**
 * The golden fixture: the keystone determinism test.
 *
 * A committed command log plus its expected final hash. If this goes red, two
 * runs of the same match produced different states — which is the one bug class
 * the whole arithmetic allowlist exists to prevent.
 *
 * Two things make it trustworthy rather than decorative:
 *
 *   1. **It pins its own frozen data set.** Tuning is hundreds of edits to the
 *      balance files, and every one would change the final hash. A fixture that
 *      reads live data gets regenerated rather than investigated, which turns
 *      the keystone regression test into a rubber stamp. `match-01.json` owns
 *      its config and never changes.
 *
 *      This was claimed here for six steps before it was true. Step 8 changed a
 *      creep's HP, watched the hash move, and found the fixture reading live
 *      data the whole time. It installs `fixture.data` now, so a red golden
 *      test means the arithmetic diverged and nothing else.
 *
 *   2. **CI runs it on two genuinely different engines.** Node and headless
 *      Chrome are both V8 and would test one engine while claiming two, so the
 *      second target has to be non-V8 — see .github/workflows.
 *
 * Regenerating the hash is a deliberate act: run with GOLDEN_UPDATE=1 and
 * commit the change with a reason. If you find yourself doing that to make a
 * red test green, stop and find out what diverged instead.
 */

interface FixtureCommand {
  readonly at: number
  readonly player: 0 | 1
  readonly kind: 'build' | 'upgrade' | 'sell' | 'send'
  readonly tower?: number
  readonly creep?: number
  readonly x?: number
  readonly y?: number
}

interface Fixture {
  readonly ticks: number
  readonly commands: readonly FixtureCommand[]
  readonly expectedHash: string
  /** The balance numbers this hash was recorded under. */
  readonly data: BalanceData
}

const fixturePath = fileURLToPath(new URL('./golden/match-01.json', import.meta.url))
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture

function toCommand(c: FixtureCommand): Command {
  switch (c.kind) {
    case 'build':
      return { tick: c.at, player: c.player, kind: Kind.Build, tower: c.tower as TowerKind, x: c.x!, y: c.y! }
    case 'upgrade':
      return { tick: c.at, player: c.player, kind: Kind.Upgrade, x: c.x!, y: c.y! }
    case 'sell':
      return { tick: c.at, player: c.player, kind: Kind.Sell, x: c.x!, y: c.y! }
    case 'send':
      return { tick: c.at, player: c.player, kind: Kind.Send, creep: c.creep! }
  }
}

function replayState(f: Fixture): GameState {
  const byTick = new Map<number, Command[]>()
  for (const c of f.commands) {
    const list = byTick.get(c.at) ?? []
    list.push(toCommand(c))
    byTick.set(c.at, list)
  }

  // Install the frozen balance data for the length of the replay, and put the
  // live data back whatever happens. Skipping the restore would silently retune
  // every other test that shares this module.
  const previous = installBalanceData(f.data)
  try {
    let a: GameState = createState()
    let b: GameState = createState()
    for (let t = 0; t < f.ticks; t++) {
      const out = step(a, byTick.get(t) ?? [], b)
      b = a
      a = out
    }
    return a
  } finally {
    installBalanceData(previous)
  }
}

function replay(f: Fixture): string {
  return hashHex(replayState(f))
}

describe('golden fixture', () => {
  it('replays match-01 to its committed hash', () => {
    const actual = replay(fixture)
    if (process.env.GOLDEN_UPDATE === '1') {
      console.log(`GOLDEN_HASH=${actual}`)
      return
    }
    expect(actual).toBe(fixture.expectedHash)
  })

  it('is stable across repeated replays in one process', () => {
    expect(replay(fixture)).toBe(replay(fixture))
  })

  it('exercises the whole game in one match', () => {
    // A fixture where nothing happens passes forever without testing anything,
    // and this one has drifted twice already: first it was too short for any
    // creep to lap, then towers got teeth and killed everything before any
    // creep lapped. Assert each behaviour explicitly rather than trusting the
    // hash to notice.
    const final = replayState(fixture)

    // Both lanes are live, so the two-lane wiring is genuinely exercised.
    expect(final.lanes[0]!.creeps.count + final.players[0]!.kills).toBeGreaterThan(0)
    expect(final.lanes[1]!.creeps.count + final.players[1]!.kills).toBeGreaterThan(0)

    // Towers shoot.
    expect(final.players[0]!.kills).toBeGreaterThan(0)

    // Leaks cost lives, without either side reaching zero — a finished match
    // freezes, and everything after that tick would stop being exercised.
    expect(final.players[0]!.leaks + final.players[1]!.leaks).toBeGreaterThan(0)
    expect(final.result).toBe(MatchResult.Playing)

    // Sending raised income above the starting value on both sides.
    expect(final.players[0]!.income).toBeGreaterThan(25)
    expect(final.players[1]!.income).toBeGreaterThan(25)
  })
})
