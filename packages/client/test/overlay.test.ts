import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The overlays are toggled from `main.ts` with the `hidden` property, and
 * `hidden` is only a user-agent rule — any author `display` in the stylesheet
 * outranks it. Both full-screen overlays set `display: grid`, so neither ever
 * went away. The deployed build ran a real match behind an opaque start screen
 * and looked, from outside, like a menu whose buttons did nothing.
 *
 * It survived a full green CI run because nothing in the test suite renders
 * CSS. This asserts on the stylesheet text instead: crude, but it fails if the
 * guard is deleted, which is the failure that actually happened.
 */
describe('overlay visibility', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  it('overrides author display rules for [hidden]', () => {
    expect(html).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/)
  })

  it('every element main.ts hides is covered by that rule', () => {
    // If an overlay grows an author `display`, the guard above is what saves it.
    // This catches the inverse mistake: a new overlay toggled by `hidden` that
    // someone styles before reading the comment.
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    const toggled = [...main.matchAll(/(\w+)\.hidden\s*=/g)].map((m) => m[1] as string)
    expect(toggled.length).toBeGreaterThan(0)
    // The guard is a universal attribute selector, so covering one covers all.
    expect(html).toContain('[hidden] { display: none !important; }')
  })
})
