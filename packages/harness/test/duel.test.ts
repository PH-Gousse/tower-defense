import { describe, it, expect } from 'vitest'
import { BOT_NORMAL, BOT_HARD, BOT_EASY } from '@ltw/sim'
import { MIN_DELAY } from '@ltw/server/room'
import { runDuel } from '../src/duel'

/**
 * Two real lockstep clients, a real relay, no browser.
 *
 * This is the only test that can catch a lockstep bug. Each client owns its own
 * state, generates commands only for its own seat, and learns about its
 * opponent exclusively through the relay — so if the wire protocol drops
 * something, or the ordering rule differs, or the delay window is off by one,
 * the two hashes part and this says exactly where.
 *
 * Two browser tabs could not do this: they cannot be driven reliably, they
 * cannot be asserted on, and a divergence is invisible from the outside anyway
 * because both players just see their own game and believe it.
 */
describe('1v1 over the relay', () => {
  it('keeps two independent clients bit-identical for a whole match', () => {
    const r = runDuel({ bots: [BOT_NORMAL, BOT_HARD], maxTicks: 3000 })
    expect(r.divergedAt).toBe(-1)
    expect(r.ticks).toBeGreaterThan(2900)
    expect(r.finalHash[0]).toBe(r.finalHash[1])
    // If nothing was relayed, the test proved only that two idle sims agree.
    expect(r.commandsRelayed).toBeGreaterThan(20)
  })

  it('agrees regardless of who has the worse connection', () => {
    // The delay is negotiated from the worse link, so a lopsided pairing must
    // still produce one shared timeline.
    const r = runDuel({ bots: [BOT_EASY, BOT_HARD], maxTicks: 1500, rtt: [5, 350] })
    expect(r.delay).toBeGreaterThan(MIN_DELAY)
    expect(r.divergedAt).toBe(-1)
    expect(r.finalHash[0]).toBe(r.finalHash[1])
  })

  it('never advances a tick before both seats have accounted for it', () => {
    // Strict wait is the safety property the whole design rests on: an input
    // cannot arrive for an already-simulated tick, so the failure mode is a
    // stall rather than a desync.
    const r = runDuel({ bots: [BOT_NORMAL, BOT_NORMAL], maxTicks: 800 })
    expect(r.divergedAt).toBe(-1)
    expect(r.finalHash[0]).toBe(r.finalHash[1])
  })

  it('stalls rather than desyncs when frames go missing', () => {
    // Dropping a client's frames must never produce two different games. It may
    // legitimately produce a stalled one -- that is the trade strict wait makes,
    // and a visible stall is recoverable while a silent desync is not.
    const r = runDuel({ bots: [BOT_NORMAL, BOT_NORMAL], maxTicks: 600, dropEvery: 7 })
    expect(r.divergedAt).toBe(-1)
    expect(r.finalHash[0]).toBe(r.finalHash[1])
  })

  it('runs with no commands at all, which is the bootstrap case', () => {
    // Ticks 0..delay-1 are implicit None for both seats. Without that, strict
    // wait deadlocks at tick 0, because nobody can have sent an input for a
    // tick that predates the delay window.
    const r = runDuel({ maxTicks: 200 })
    expect(r.ticks).toBeGreaterThan(150)
    expect(r.divergedAt).toBe(-1)
  })
})
