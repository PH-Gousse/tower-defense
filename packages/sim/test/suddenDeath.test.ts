import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { createState } from '../src/state'
import { INCOME_EVERY_TICKS } from '../src/state'
import {
  creepSpec,
  installBalanceData,
  liveBalanceData,
  suddenDeathScale,
  SUDDEN_DEATH_TICK,
  SUDDEN_DEATH_GROWTH,
  SUDDEN_DEATH_NEVER,
  SUDDEN_DEATH_MAX_FACTOR,
  SUDDEN_DEATH_MIN_CAP,
  CREEPS,
} from '../src/data'
import { tick, send, BOG_BRUTE, SCRAPLING, withoutBuildPhase } from './helpers'

withoutBuildPhase()

describe('sudden death in the shipped data', () => {
  it('is off: a match ends only when a player reaches zero lives (user, ADR-0033)', () => {
    expect(SUDDEN_DEATH_TICK).toBe(SUDDEN_DEATH_NEVER)
    expect(suddenDeathScale(1_000_000, INCOME_EVERY_TICKS)).toBe(1)
    expect(liveBalanceData().suddenDeathTick).toBeUndefined()
  })
})

/**
 * Sudden death (ADR-0026): from SUDDEN_DEATH_TICK, the HP of every creep
 * spawned is multiplied by SUDDEN_DEATH_GROWTH once per income period,
 * compounding.
 *
 * Removed from the game by ADR-0033, and kept in the sim so a replay recorded
 * with it still replays the match it recorded. These pin the mechanism with it
 * switched on at its old sizing (15:00, x1.15), installed per file below.
 */
describe('sudden death', () => {
  let switchedOff: ReturnType<typeof installBalanceData> | null = null
  beforeAll(() => {
    switchedOff = installBalanceData({ ...liveBalanceData(), suddenDeathTick: 18000, suddenDeathGrowth: 1.15 })
  })
  afterAll(() => {
    if (switchedOff) installBalanceData(switchedOff)
  })
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
  })

  /** HP of a creep whose spawn lands on tick `at`: step advances the tick before it applies commands. */
  function spawnHpAt(at: number, creep = BOG_BRUTE): number {
    const s = createState()
    ;(s as { tick: number }).tick = at - 1
    const out = tick(s, [send(creep)])
    expect(out.tick).toBe(at)
    return out.lanes[0]!.creeps.hp[0] as number
  }

  it('runs at the sizing these cases were written for', () => {
    expect(SUDDEN_DEATH_TICK).toBe(18000)
    expect(SUDDEN_DEATH_GROWTH).toBe(1.15)
  })

  it('leaves a creep spawned before the start tick at its roster HP', () => {
    expect(spawnHpAt(SUDDEN_DEATH_TICK - 1)).toBe(creepSpec(BOG_BRUTE).hp)
    expect(suddenDeathScale(0, INCOME_EVERY_TICKS)).toBe(1)
  })

  it('multiplies once on the start tick and once more per income period, compounding', () => {
    const g = SUDDEN_DEATH_GROWTH
    expect(spawnHpAt(SUDDEN_DEATH_TICK)).toBe(Math.round(creepSpec(BOG_BRUTE).hp * g))
    expect(spawnHpAt(SUDDEN_DEATH_TICK + INCOME_EVERY_TICKS - 1)).toBe(Math.round(creepSpec(BOG_BRUTE).hp * g))
    expect(spawnHpAt(SUDDEN_DEATH_TICK + INCOME_EVERY_TICKS)).toBe(Math.round(creepSpec(BOG_BRUTE).hp * g * g))
    expect(spawnHpAt(SUDDEN_DEATH_TICK + 10 * INCOME_EVERY_TICKS, SCRAPLING)).toBe(
      Math.round(creepSpec(SCRAPLING).hp * suddenDeathScale(SUDDEN_DEATH_TICK + 10 * INCOME_EVERY_TICKS, INCOME_EVERY_TICKS)),
    )
  })

  it('does not change the HP of creeps already on the board', () => {
    const s = createState()
    ;(s as { tick: number }).tick = SUDDEN_DEATH_TICK - 2
    let out = tick(s, [send(BOG_BRUTE)])
    const before = out.lanes[0]!.creeps.hp[0] as number
    for (let t = 0; t < 3; t++) out = tick(out)
    expect(out.lanes[0]!.creeps.hp[0]).toBe(before)
  })

  it('carries the factor into the flood model, so the bot reads what it faces', () => {
    // The factor is a pure function of the tick; the model takes it as a
    // parameter and the bot passes it. Pinned here so a refactor that drops
    // the argument fails loudly.
    const late = SUDDEN_DEATH_TICK + 20 * INCOME_EVERY_TICKS
    expect(suddenDeathScale(late, INCOME_EVERY_TICKS)).toBeGreaterThan(15)
  })

  it('never overflows an Int32 HP, however long the match runs', () => {
    const far = SUDDEN_DEATH_TICK + 100_000 * INCOME_EVERY_TICKS
    const hp = spawnHpAt(far)
    expect(hp).toBeGreaterThan(0)
    expect(hp).toBeLessThan(2 ** 31)
    expect(suddenDeathScale(far, INCOME_EVERY_TICKS)).toBe(suddenDeathScale(far + 1, INCOME_EVERY_TICKS))
  })

  it('keeps the heaviest creep on the ladder under Int32 at the cap (ADR-0031)', () => {
    // The fixed x100,000 cap was sized for a 6,250-HP Tank III; the Storm Drake
    // has 2,071,000 HP, and x100,000 of that wraps negative. The cap is now
    // derived from the roster, so the worst case is exactly the heaviest creep.
    let heaviest = 0
    for (let i = 1; i < CREEPS.length; i++) if (creepSpec(i).hp > creepSpec(heaviest).hp) heaviest = i
    const far = SUDDEN_DEATH_TICK + 100_000 * INCOME_EVERY_TICKS
    expect(SUDDEN_DEATH_MAX_FACTOR).toBe(Math.floor((2 ** 31 - 1) / creepSpec(heaviest).hp))
    expect(suddenDeathScale(far, INCOME_EVERY_TICKS)).toBe(SUDDEN_DEATH_MAX_FACTOR)
    const s = createState()
    ;(s as { tick: number }).tick = far - 1
    ;(s.players[1] as { gold: number }).gold = creepSpec(heaviest).cost
    const hp = tick(s, [send(heaviest)]).lanes[0]!.creeps.hp[0] as number
    expect(hp).toBeGreaterThan(creepSpec(heaviest).hp)
    expect(hp).toBeLessThanOrEqual(2 ** 31 - 1)
  })

  it('refuses a roster so heavy that sudden death could not end a match', () => {
    const base = liveBalanceData()
    const tooHeavy = Math.floor((2 ** 31 - 1) / (SUDDEN_DEATH_MIN_CAP - 1))
    const creeps = base.creeps.map((c, i) => (i === 0 ? { ...c, hp: tooHeavy } : c))
    try {
      expect(() => installBalanceData({ ...base, creeps })).toThrow(/sudden death a cap/)
    } finally {
      installBalanceData(base)
    }
    expect(SUDDEN_DEATH_MAX_FACTOR).toBeGreaterThanOrEqual(SUDDEN_DEATH_MIN_CAP)
  })

  it('is off for balance data that predates it, so old fixtures replay the match they recorded', () => {
    const base = liveBalanceData()
    const { suddenDeathTick: _t, suddenDeathGrowth: _g, ...without } = base
    restore = (() => {
      const prev = installBalanceData(without)
      return () => { installBalanceData(prev) }
    })()
    expect(suddenDeathScale(1e9, INCOME_EVERY_TICKS)).toBe(1)
    expect(spawnHpAt(1e6)).toBe(creepSpec(BOG_BRUTE).hp)
    expect(liveBalanceData().suddenDeathTick).toBeUndefined()
  })

  it('refuses a fractional or negative start tick and a growth below one', () => {
    const base = liveBalanceData()
    expect(() => installBalanceData({ ...base, suddenDeathTick: 100.5 })).toThrow(/suddenDeathTick/)
    expect(() => installBalanceData({ ...base, suddenDeathTick: -1 })).toThrow(/suddenDeathTick/)
    expect(() => installBalanceData({ ...base, suddenDeathGrowth: 0.9 })).toThrow(/suddenDeathGrowth/)
    expect(() => installBalanceData({ ...base, suddenDeathGrowth: Infinity })).toThrow(/suddenDeathGrowth/)
    expect(SUDDEN_DEATH_NEVER).toBe(-1)
  })
})
