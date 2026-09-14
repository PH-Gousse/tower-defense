import { describe, it, expect, afterEach } from 'vitest'
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
} from '../src/data'
import { tick, send, TANK, SWARM, withoutBuildPhase } from './helpers'

withoutBuildPhase()

/**
 * Sudden death (ADR-0026): from SUDDEN_DEATH_TICK, the HP of every creep
 * spawned is multiplied by SUDDEN_DEATH_GROWTH once per income period,
 * compounding. The match-ender the bounded ladder lost.
 */
describe('sudden death', () => {
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
  })

  /** HP of a creep whose spawn lands on tick `at`: step advances the tick before it applies commands. */
  function spawnHpAt(at: number, creep = TANK): number {
    const s = createState()
    ;(s as { tick: number }).tick = at - 1
    const out = tick(s, [send(creep)])
    expect(out.tick).toBe(at)
    return out.lanes[0]!.creeps.hp[0] as number
  }

  it('is on in the shipped data, one unlock interval after the last tier', () => {
    expect(SUDDEN_DEATH_TICK).toBe(18000)
    expect(SUDDEN_DEATH_GROWTH).toBe(1.15)
  })

  it('leaves a creep spawned before the start tick at its roster HP', () => {
    expect(spawnHpAt(SUDDEN_DEATH_TICK - 1)).toBe(creepSpec(TANK).hp)
    expect(suddenDeathScale(0, INCOME_EVERY_TICKS)).toBe(1)
  })

  it('multiplies once on the start tick and once more per income period, compounding', () => {
    const g = SUDDEN_DEATH_GROWTH
    expect(spawnHpAt(SUDDEN_DEATH_TICK)).toBe(Math.round(creepSpec(TANK).hp * g))
    expect(spawnHpAt(SUDDEN_DEATH_TICK + INCOME_EVERY_TICKS - 1)).toBe(Math.round(creepSpec(TANK).hp * g))
    expect(spawnHpAt(SUDDEN_DEATH_TICK + INCOME_EVERY_TICKS)).toBe(Math.round(creepSpec(TANK).hp * g * g))
    expect(spawnHpAt(SUDDEN_DEATH_TICK + 10 * INCOME_EVERY_TICKS, SWARM)).toBe(
      Math.round(creepSpec(SWARM).hp * suddenDeathScale(SUDDEN_DEATH_TICK + 10 * INCOME_EVERY_TICKS, INCOME_EVERY_TICKS)),
    )
  })

  it('does not change the HP of creeps already on the board', () => {
    const s = createState()
    ;(s as { tick: number }).tick = SUDDEN_DEATH_TICK - 2
    let out = tick(s, [send(TANK)])
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

  it('is off for balance data that predates it, so old fixtures replay the match they recorded', () => {
    const base = liveBalanceData()
    const { suddenDeathTick: _t, suddenDeathGrowth: _g, ...without } = base
    restore = (() => {
      const prev = installBalanceData(without)
      return () => { installBalanceData(prev) }
    })()
    expect(suddenDeathScale(1e9, INCOME_EVERY_TICKS)).toBe(1)
    expect(spawnHpAt(1e6)).toBe(creepSpec(TANK).hp)
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
