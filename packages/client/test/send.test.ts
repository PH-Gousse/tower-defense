import { describe, it, expect } from 'vitest'
import { createSender, type SendCard } from '../src/send'
import { holdToRepeat, HOLD_DELAY_MS, HOLD_EVERY_MS } from '../src/hold'

/**
 * The send atom.
 *
 * One click is one creep and one command. This is the file that says so, and it
 * exists because the rule used to live in two places -- `main.ts` for the
 * keyboard, `hold.ts` for the mouse -- which disagreed. The keyboard copy never
 * checked the wallet and never guarded the operating system's key auto-repeat,
 * so a single held key spent everything at about thirty purchases a second.
 *
 * The failures worth catching here are all off-by-a-multiple: one press that
 * costs two creeps, a locked card that banks a burst, a ×N button that spends
 * past an empty wallet.
 */

/** A palette card, driven by hand. */
function card(creep: number, attrs: string[] = []): SendCard & { attrs: Set<string>; creep: number } {
  const set = new Set(attrs)
  return {
    attrs: set,
    creep,
    dataset: { get creep() { return String(creep) } },
    hasAttribute: (name) => set.has(name),
  }
}

describe('createSender', () => {
  it('sends exactly one command for one click', () => {
    // The reported bug, stated as a test: a click is a creep, not a burst.
    const cards = [card(0)]
    const sent: number[] = []
    const sendN = createSender(cards, (c) => void sent.push(c))

    expect(sendN(0, 1)).toBe(1)
    expect(sent).toEqual([0])
  })

  it('emits N separate commands, never one command carrying a number', () => {
    // ×5 and ×10 are conveniences on the atom, not a bulk discount. Each is its
    // own command so the simulation refuses them one at a time.
    const cards = [card(4)]
    const sent: number[] = []
    const sendN = createSender(cards, (c) => void sent.push(c))

    expect(sendN(0, 5)).toBe(5)
    expect(sent).toEqual([4, 4, 4, 4, 4])
  })

  it('sends nothing at all while the card is locked', () => {
    // The opening build phase and an unreached tier both lock cards. Neither may
    // bank a burst that lands the instant it unlocks.
    const cards = [card(0, ['data-locked'])]
    const sent: number[] = []
    const sendN = createSender(cards, (c) => void sent.push(c))

    expect(sendN(0, 10)).toBe(0)
    expect(sent).toEqual([])
  })

  it('stops at the wallet instead of spraying refusals', () => {
    const cards = [card(2, ['data-broke'])]
    const sent: number[] = []
    const sendN = createSender(cards, (c) => void sent.push(c))

    expect(sendN(0, 10)).toBe(0)
    expect(sent).toEqual([])
  })

  it('reports how many actually went, which is what ends a hold', () => {
    // holdToRepeat stops on a false return and knows nothing else about locks
    // or wallets. If this number lied, a hold would spin forever.
    const c = card(1)
    const sendN = createSender([c], () => {})

    expect(sendN(0, 3)).toBe(3)
    c.attrs.add('data-broke')
    expect(sendN(0, 3)).toBe(0)
  })

  it('reads the creep off the card at call time, not at wiring time', () => {
    // The palette is a window on the roster: the same six buttons are re-pointed
    // at higher tiers as the ladder advances. A slot is stable, its creep is not.
    let creep = 0
    const moving: SendCard = {
      dataset: { get creep() { return String(creep) } },
      hasAttribute: () => false,
    }
    const sent: number[] = []
    const sendN = createSender([moving], (c) => void sent.push(c))

    sendN(0, 1)
    creep = 7
    sendN(0, 1)
    expect(sent).toEqual([0, 7])
  })

  it('refuses a slot that does not exist rather than sending creep NaN', () => {
    const sent: number[] = []
    const sendN = createSender([card(0)], (c) => void sent.push(c))

    expect(sendN(9, 1)).toBe(0)
    expect(sendN(-1, 1)).toBe(0)
    expect(sent).toEqual([])
  })

  it('refuses a card with no creep on it', () => {
    // Hidden slots exist: the palette hides buttons past the end of the roster.
    const blank: SendCard = { dataset: {}, hasAttribute: () => false }
    const sent: number[] = []
    const sendN = createSender([blank], (c) => void sent.push(c))

    expect(sendN(0, 1)).toBe(0)
    expect(sent).toEqual([])
  })

  it('sends nothing for a count of zero or less', () => {
    const sent: number[] = []
    const sendN = createSender([card(0)], (c) => void sent.push(c))

    expect(sendN(0, 0)).toBe(0)
    expect(sendN(0, -5)).toBe(0)
    expect(sent).toEqual([])
  })
})

/**
 * The seam `main.ts` actually uses.
 *
 * `send.ts` decides whether a send happens and `hold.ts` decides when, and both
 * are tested on their own. Nothing tested them wired together, which is the
 * shape main.ts builds: holdToRepeat(button, () => sendN(slot, 1) > 0, timers).
 * A bug that lives in the composition -- a press that sends nothing, or a
 * single click that sends twice -- passes both unit suites and reaches the
 * player, so it gets its own test.
 */
describe('the palette wiring, composed as main.ts composes it', () => {
  function palette(attrs: string[] = []) {
    const set = new Set(attrs)
    const listeners = new Map<string, Array<(ev: { button?: number; detail?: number }) => void>>()
    const button = {
      addEventListener(type: string, l: (ev: { button?: number; detail?: number }) => void) {
        const list = listeners.get(type) ?? []
        list.push(l)
        listeners.set(type, list)
      },
    }
    const card: SendCard = {
      dataset: { creep: '0' },
      hasAttribute: (n) => set.has(n),
    }
    let now = 0
    let nextId = 1
    const pending = new Map<number, { at: number; every: number; fn: () => void }>()
    const timers = {
      setTimeout(fn: () => void, ms: number) { const id = nextId++; pending.set(id, { at: now + ms, every: 0, fn }); return id },
      setInterval(fn: () => void, ms: number) { const id = nextId++; pending.set(id, { at: now + ms, every: ms, fn }); return id },
      clearTimeout: (id: number) => void pending.delete(id),
      clearInterval: (id: number) => void pending.delete(id),
    }
    const sent: number[] = []
    const sendN = createSender([card], (c) => void sent.push(c))
    holdToRepeat(button, () => sendN(0, 1) > 0, timers)
    return {
      sent,
      attrs: set,
      emit(type: string, ev: { button?: number; detail?: number } = { button: 0 }) {
        for (const l of listeners.get(type) ?? []) l(ev)
      },
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

  it('sends exactly one creep for one press and release', () => {
    // The whole report, as a test: click Swarm once, one creep goes.
    const p = palette()
    p.emit('pointerdown')
    p.emit('pointerup')
    p.advance(5000)
    expect(p.sent).toEqual([0])
  })

  it('sends nothing at all when the card is locked', () => {
    const p = palette(['data-locked'])
    p.emit('pointerdown')
    p.advance(5000)
    expect(p.sent).toEqual([])
  })

  it('sends nothing when the wallet is empty, and does not start repeating', () => {
    const p = palette(['data-broke'])
    p.emit('pointerdown')
    p.advance(5000)
    expect(p.sent).toEqual([])
  })

  it('still streams while held, one creep per repeat', () => {
    const p = palette()
    p.emit('pointerdown')
    p.advance(HOLD_DELAY_MS + HOLD_EVERY_MS * 3)
    expect(p.sent).toHaveLength(4)
    expect(p.sent.every((c) => c === 0)).toBe(true)
  })

  it('stops the stream the moment the wallet empties mid-hold', () => {
    const p = palette()
    p.emit('pointerdown')
    p.advance(HOLD_DELAY_MS + HOLD_EVERY_MS)
    const held = p.sent.length
    p.attrs.add('data-broke')
    p.advance(5000)
    expect(p.sent).toHaveLength(held)
  })
})
