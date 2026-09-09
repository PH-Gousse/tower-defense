import { describe, it, expect } from 'vitest'
import {
  holdToRepeat,
  HOLD_DELAY_MS,
  HOLD_EVERY_MS,
  type HoldButton,
  type HoldTimers,
} from '../src/hold'

/**
 * Press-and-hold on the send palette.
 *
 * All timing, which is why it was worth pulling out of `main.ts` and giving its
 * own timers. The failure that matters is silent in both directions: a repeat
 * that starts too early turns every ordinary click into two sends and quietly
 * doubles what the player spends, and one that never stops keeps sending after
 * the finger is off the button.
 */

/** A button and a clock, driven by hand. */
function harness(attrs: Set<string> = new Set()) {
  const listeners = new Map<string, Array<(ev: { button?: number; detail?: number }) => void>>()
  const button: HoldButton = {
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
  }

  let now = 0
  let nextId = 1
  const pending = new Map<number, { at: number; every: number; fn: () => void }>()
  const timers: HoldTimers = {
    setTimeout(fn, ms) {
      const id = nextId++
      pending.set(id, { at: now + ms, every: 0, fn })
      return id
    },
    setInterval(fn, ms) {
      const id = nextId++
      pending.set(id, { at: now + ms, every: ms, fn })
      return id
    },
    clearTimeout: (id) => void pending.delete(id),
    clearInterval: (id) => void pending.delete(id),
  }

  // The real sender refuses a locked card and an empty wallet and reports it as
  // a boolean; the fake one answers the same two questions off `attrs`, so
  // these tests stay about timing, which is all this file decides.
  const sends: number[] = []
  const stop = holdToRepeat(
    button,
    () => {
      if (attrs.has('data-locked') || attrs.has('data-broke')) return false
      sends.push(now)
      return true
    },
    timers,
  )

  return {
    sends,
    attrs,
    stop,
    emit(type: string, ev: { button?: number; detail?: number } = { button: 0 }) {
      for (const l of listeners.get(type) ?? []) l(ev)
    },
    /** Run the clock forward, firing whatever is due. */
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        let soonest = -1
        let at = Infinity
        for (const [id, t] of pending) if (t.at < at) { at = t.at; soonest = id }
        if (soonest === -1 || at > end) break
        const t = pending.get(soonest)!
        now = t.at
        if (t.every > 0) t.at = now + t.every
        else pending.delete(soonest)
        t.fn()
      }
      now = end
    },
  }
}

describe('holdToRepeat', () => {
  it('sends once on a press, and not again until the hold delay', () => {
    const h = harness()
    h.emit('pointerdown')
    expect(h.sends).toHaveLength(1)
    // The whole point of the delay: an ordinary click must cost one send, not
    // two. A player who clicks Tank twice has bought two tanks, not four.
    h.advance(HOLD_DELAY_MS - 1)
    expect(h.sends).toHaveLength(1)
    h.emit('pointerup')
    h.advance(5000)
    expect(h.sends).toHaveLength(1)
  })

  it('repeats at the cadence once held', () => {
    const h = harness()
    h.emit('pointerdown')
    h.advance(HOLD_DELAY_MS + HOLD_EVERY_MS * 5)
    expect(h.sends).toHaveLength(6)
  })

  it('stops on release, cancel, and leave alike', () => {
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      const h = harness()
      h.emit('pointerdown')
      h.advance(HOLD_DELAY_MS + HOLD_EVERY_MS * 2)
      const held = h.sends.length
      h.emit(type)
      h.advance(5000)
      expect(h.sends).toHaveLength(held)
    }
  })

  it('stops at the wallet instead of spraying refusals', () => {
    // Every repeat is a real command on the wire, and the simulation would drop
    // these. Gold is repainted every tick and the cadence is slower than a tick.
    const h = harness()
    h.emit('pointerdown')
    h.advance(HOLD_DELAY_MS + HOLD_EVERY_MS)
    expect(h.sends).toHaveLength(2)
    h.attrs.add('data-broke')
    h.advance(5000)
    expect(h.sends).toHaveLength(2)
  })

  it('sends nothing at all while the card is locked', () => {
    // The opening build phase and an unreached tier both lock cards. Holding one
    // must not bank up a burst that lands the instant it unlocks.
    const h = harness(new Set(['data-locked']))
    h.emit('pointerdown')
    h.advance(5000)
    expect(h.sends).toHaveLength(0)
  })

  it('ignores the middle and right buttons, which pan the camera', () => {
    const h = harness()
    h.emit('pointerdown', { button: 1 })
    h.emit('pointerdown', { button: 2 })
    h.advance(5000)
    expect(h.sends).toHaveLength(0)
  })

  it('serves keyboard activation without double-sending the mouse', () => {
    // Tab-then-Enter arrives as a click with detail 0. A mouse click carries
    // detail >= 1 and was already served on pointerdown.
    const h = harness()
    h.emit('click', { detail: 0 })
    expect(h.sends).toHaveLength(1)

    const m = harness()
    m.emit('pointerdown', { button: 0 })
    m.emit('click', { detail: 1 })
    expect(m.sends).toHaveLength(1)
  })

  it('drops a held repeat when the caller cuts it off', () => {
    // main.ts calls this on window blur, so a press held while the tab goes away
    // is not still repeating on return.
    const h = harness()
    h.emit('pointerdown')
    h.advance(HOLD_DELAY_MS + HOLD_EVERY_MS)
    const held = h.sends.length
    h.stop()
    h.advance(5000)
    expect(h.sends).toHaveLength(held)
  })

  it('restarts cleanly on a second press', () => {
    // Two presses must not leave two intervals running: the second would double
    // the cadence and outrun the wallet check.
    const h = harness()
    h.emit('pointerdown')
    h.advance(HOLD_DELAY_MS + HOLD_EVERY_MS * 2)
    h.emit('pointerdown')
    const after = h.sends.length
    h.advance(HOLD_DELAY_MS + HOLD_EVERY_MS * 3)
    expect(h.sends).toHaveLength(after + 3)
  })
})
