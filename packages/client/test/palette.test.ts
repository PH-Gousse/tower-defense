import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SEND_UNLOCK_TICKS, TICK_HZ } from '@ltw/sim'

/**
 * The build-phase palette wiring, asserted on source text.
 *
 * Same trick as `overlay.test.ts`, and for the same reason: `main.ts` cannot be
 * imported here. It calls `createScene` at module scope, which builds a
 * WebGLRenderer, and the client suite runs in node with no GL context — the
 * page's own animation loop never starts under a headless browser either, which
 * is how three steps of this project were "verified" against index.html's static
 * defaults before anyone noticed.
 *
 * So these assert on the text instead. Crude, and they only catch deletion
 * rather than misbehaviour, but deletion is the realistic failure: the countdown
 * is one element and one CSS class, and nothing else in the suite would notice
 * if either went missing. The rule itself is tested properly in the sim's
 * `opening.test.ts`; this guards the wiring that shows it to a player.
 */
describe('the build-phase palette', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  it('gates the send cards on the sim rule, not on a copied constant', () => {
    // A hardcoded 400 here would silently disagree with the balance data the
    // moment the opening is retuned.
    expect(main).toContain('SEND_UNLOCK_TICKS')
    expect(main).not.toMatch(/tick\s*<\s*400/)
  })

  it('has a label element for the countdown, and styles it', () => {
    expect(html).toContain('id="sendLabel"')
    expect(html).toMatch(/#sendLabel\.counting\s*\{/)
    expect(main).toContain("classList.toggle('counting'")
  })

  it('counts down in seconds rather than ticks', () => {
    // 400 ticks would read as "Build · 400s" without the divide.
    expect(main).toMatch(/SEND_UNLOCK_TICKS\s*-\s*s\.tick/)
    expect(main).toContain('TICK_HZ')
  })

  it('distinguishes the opening from a tier lock in the card captions', () => {
    // Both dim a card; only one of them is about that specific card. Losing the
    // distinction puts "unlocks in 8s" on a tier the player already owns.
    expect(main).toContain('tierLocked')
    expect(main).toMatch(/unlocks in/)
  })

  it('agrees with the sim about how long the opening is', () => {
    // The one number a player reads off the screen. If the balance data moves,
    // this is the test that says the UI still tells the truth.
    expect(SEND_UNLOCK_TICKS / TICK_HZ).toBe(20)
  })
})
