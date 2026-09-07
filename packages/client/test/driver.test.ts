import { describe, it, expect } from 'vitest'
import { Driver } from '../src/driver'
import { TICK_MS, TowerKind, MatchResult, DEFAULT_CONFIG, tileIndex } from '@ltw/sim'

/**
 * The driver is the only piece of the client that can be tested without a
 * browser, and it is worth testing precisely because it cannot be checked by
 * looking: the interpolation clamp only misbehaves during a stall, and a stall
 * is exactly when nobody is watching carefully.
 *
 * These matter more than they look. The client was verified for three steps by
 * reading HUD text out of a headless page — and that text turned out to be the
 * static defaults in index.html, because with no WebGL context the animation
 * loop never runs and the driver never advances. Asserting on the driver
 * directly is the check that actually holds.
 */
describe('Driver', () => {
  it('runs no ticks on the first frame — it has no elapsed time yet', () => {
    const d = new Driver()
    expect(d.advance(1000)).toBe(0)
    expect(d.current.tick).toBe(0)
  })

  it('advances exactly one tick per TICK_MS elapsed', () => {
    const d = new Driver()
    d.advance(0)
    expect(d.advance(TICK_MS)).toBe(1)
    expect(d.advance(TICK_MS * 2)).toBe(1)
    expect(d.current.tick).toBe(2)
  })

  it('runs several ticks when a frame is long', () => {
    const d = new Driver()
    d.advance(0)
    expect(d.advance(TICK_MS * 4)).toBe(4)
    expect(d.current.tick).toBe(4)
  })

  it('caps catch-up so a backgrounded tab does not replay a minute at once', () => {
    const d = new Driver()
    d.advance(0)
    // A tab hidden for a minute reports a huge delta.
    expect(d.advance(60_000)).toBe(10)
    expect(d.current.tick).toBe(10)
  })

  it('ignores time going backwards rather than running negative', () => {
    const d = new Driver()
    d.advance(1000)
    expect(d.advance(500)).toBe(0)
    expect(d.current.tick).toBe(0)
  })

  it('keeps alpha in 0..1 and never extrapolates past a tick', () => {
    // The clamp that stops a lockstep stall gliding creeps through walls.
    const d = new Driver()
    d.advance(0)
    d.advance(TICK_MS / 2)
    expect(d.alpha).toBeGreaterThan(0.4)
    expect(d.alpha).toBeLessThanOrEqual(1)

    // Simulate the sim not advancing while real time keeps passing.
    const stalled = new Driver()
    stalled.advance(0)
    stalled.advance(TICK_MS * 100)
    expect(stalled.alpha).toBeLessThanOrEqual(1)
    expect(stalled.alpha).toBeGreaterThanOrEqual(0)
  })

  it('exposes the previous tick for interpolation, one behind current', () => {
    const d = new Driver()
    d.advance(0)
    d.advance(TICK_MS * 3)
    expect(d.current.tick).toBe(3)
    expect(d.previous.tick).toBe(2)
  })

  it('actually simulates: a creep spawns and walks', () => {
    const d = new Driver({ ...DEFAULT_CONFIG, spawnTotal: 1, creepSpeed: 0.5 })
    d.advance(0)
    d.advance(TICK_MS * 10)
    for (let f = 1; f <= 20; f++) d.advance(TICK_MS * (10 + f * 10))
    expect(d.current.lane.creeps.count).toBe(1)
    expect(d.current.lane.creeps.x[0] as number).toBeGreaterThan(1)
  })

  it('queues a build that the sim then applies', () => {
    const d = new Driver()
    d.advance(0)
    d.queueBuild(6, 6, TowerKind.Single)
    d.advance(TICK_MS)
    expect(d.current.lane.towers.kind[tileIndex({ x: 6, y: 6 })]).toBe(TowerKind.Single)
    expect(d.current.gold).toBeLessThan(600)
  })

  it('queues upgrade and sell', () => {
    const d = new Driver()
    d.advance(0)
    d.queueBuild(6, 6, TowerKind.Single)
    d.advance(TICK_MS)
    d.queueUpgrade(6, 6)
    d.advance(TICK_MS * 2)
    expect(d.current.lane.towers.level[tileIndex({ x: 6, y: 6 })]).toBe(2)

    const goldBefore = d.current.gold
    d.queueSell(6, 6)
    d.advance(TICK_MS * 3)
    expect(d.current.lane.towers.kind[tileIndex({ x: 6, y: 6 })]).toBe(-1)
    expect(d.current.gold).toBeGreaterThan(goldBefore)
  })

  it('reaches defeat when creeps leak unopposed', () => {
    const d = new Driver({ ...DEFAULT_CONFIG, spawnTotal: 1, creepSpeed: 1.0, creepHp: 100000 })
    d.advance(0)
    let t = 0
    for (let f = 0; f < 4000 && d.current.result === MatchResult.Playing; f++) {
      t += TICK_MS * 10
      d.advance(t)
    }
    expect(d.current.result).toBe(MatchResult.Defeat)
    expect(d.current.lives).toBe(0)
  })
})
