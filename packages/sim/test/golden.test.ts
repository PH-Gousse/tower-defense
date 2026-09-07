import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createState, type GameState } from '../src/state'
import { step, Kind, type Command, type SimConfig } from '../src/step'
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
 *   2. **CI runs it on two genuinely different engines.** Node and headless
 *      Chrome are both V8 and would test one engine while claiming two, so the
 *      second target has to be non-V8 — see .github/workflows.
 *
 * Regenerating the hash is a deliberate act: run with GOLDEN_UPDATE=1 and
 * commit the change with a reason. If you find yourself doing that to make a
 * red test green, stop and find out what diverged instead.
 */

interface Fixture {
  readonly seed: number
  readonly ticks: number
  readonly config: SimConfig
  readonly commands: readonly {
    readonly at: number
    readonly player: 0 | 1
    readonly tower: number
    readonly x: number
    readonly y: number
  }[]
  readonly expectedHash: string
}

const fixturePath = fileURLToPath(new URL('./golden/match-01.json', import.meta.url))
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture

function replayState(f: Fixture): GameState {
  const byTick = new Map<number, Command[]>()
  for (const c of f.commands) {
    const list = byTick.get(c.at) ?? []
    list.push({ tick: c.at, player: c.player, kind: Kind.Build, tower: c.tower, x: c.x, y: c.y })
    byTick.set(c.at, list)
  }

  let a: GameState = createState()
  let b: GameState = createState()
  for (let t = 0; t < f.ticks; t++) {
    const out = step(a, byTick.get(t) ?? [], b, f.config)
    b = a
    a = out
  }
  return a
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

  it('exercises death, survival and looping in one match', () => {
    // A fixture where nothing happens passes forever without testing anything,
    // and this one has drifted twice already. First draft: 240 ticks, so every
    // creep was still walking and the loop was never reached. Then step 4 gave
    // towers teeth and they killed all 12 before any creep lapped, so the loop
    // went untested again. Assert all four behaviours explicitly rather than
    // trusting the hash to notice.
    expect(fixture.commands.length).toBeGreaterThan(4)
    const final = replayState(fixture)

    // Some died: towers actually shoot.
    expect(final.kills).toBeGreaterThan(0)
    // Some lived: the match is not a rout that ends early.
    expect(final.lane.creeps.count).toBeGreaterThan(0)
    // Survivors looped: the leak-and-loop path ran.
    const laps = Array.from(final.lane.creeps.laps.slice(0, final.lane.creeps.count))
    expect(Math.min(...laps)).toBeGreaterThanOrEqual(1)
    // Leaks cost lives, and the match runs close to the edge without ending.
    // If it ended, the sim would freeze and everything after that tick would
    // stop being exercised.
    expect(final.leaks).toBeGreaterThan(0)
    expect(final.lives).toBeLessThan(20)
    expect(final.lives).toBeGreaterThan(0)

    // At least one survivor carries damage: HP persists across laps rather
    // than resetting at the exit.
    //
    // Deliberately the MINIMUM, not the maximum. One survivor finishes at full
    // health despite two complete laps past ten towers, because targeting picks
    // the creep nearest the exit and in a tight pack that is always the leader.
    // That is the aggro-soak question the design doc leaves open, and asserting
    // on the max would turn the evidence for it into a test failure.
    const hp = Array.from(final.lane.creeps.hp.slice(0, final.lane.creeps.count))
    expect(Math.min(...hp)).toBeLessThan(fixture.config.creepHp)
  })
})
