import { describe, it, expect } from 'vitest'
import { Driver } from '../src/driver'
import { TICK_MS, TowerKind, MatchResult, tileIndex, creepSpec, STARTING_INCOME } from '@ltw/sim'

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

  it('actually simulates: a sent creep appears and walks', () => {
    // Player 0 sends, so the creeps land in lane 1 — a creep never appears in
    // its own sender's lane.
    const d = new Driver(0)
    d.advance(0)
    d.queueSend(1)
    let t = 0
    for (let f = 1; f <= 40; f++) { t += TICK_MS * 10; d.advance(t) }
    expect(d.current.lanes[1]!.creeps.count).toBe(1)
    expect(d.current.lanes[1]!.creeps.x[0] as number).toBeGreaterThan(1)
    expect(d.current.lanes[0]!.creeps.count).toBe(0)
  })

  it('raises income permanently when you send', () => {
    const d = new Driver(0)
    d.advance(0)
    d.queueSend(0)
    d.advance(TICK_MS)
    expect(d.mySide.income).toBe(STARTING_INCOME + creepSpec(0).incomeBonus)
  })

  it('queues a build that the sim then applies', () => {
    const d = new Driver()
    d.advance(0)
    d.queueBuild(6, 6, TowerKind.Single)
    d.advance(TICK_MS)
    expect(d.current.lanes[0]!.towers.kind[tileIndex({ x: 6, y: 6 })]).toBe(TowerKind.Single)
    expect(d.current.players[0]!.gold).toBeLessThan(600)
  })

  it('queues upgrade and sell', () => {
    const d = new Driver()
    d.advance(0)
    d.queueBuild(6, 6, TowerKind.Single)
    d.advance(TICK_MS)
    d.queueUpgrade(6, 6)
    d.advance(TICK_MS * 2)
    expect(d.current.lanes[0]!.towers.level[tileIndex({ x: 6, y: 6 })]).toBe(2)

    const goldBefore = d.current.players[0]!.gold
    d.queueSell(6, 6)
    d.advance(TICK_MS * 3)
    expect(d.current.lanes[0]!.towers.kind[tileIndex({ x: 6, y: 6 })]).toBe(-1)
    expect(d.current.players[0]!.gold).toBeGreaterThan(goldBefore)
  })

  it('reaches a decided match when creeps leak unopposed', () => {
    const d = new Driver(0)
    d.advance(0)
    let t = 0
    for (let f = 0; f < 20000 && d.current.result === MatchResult.Playing; f++) {
      // Keep feeding the opponent's lane; nothing defends it.
      if (f % 400 === 0) d.queueSend(1)
      t += TICK_MS * 10
      d.advance(t)
    }
    expect(d.current.result).toBe(MatchResult.Decided)
    // Player 0 sent, so player 1 is the one who ran out.
    expect(d.current.winner).toBe(0)
    expect(d.current.players[1]!.lives).toBe(0)
  })
})
