import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The camera demo's safe-area wiring, asserted on source text.
 *
 * Same trick as `palette.test.ts` and `overlay.test.ts`, and the same reason:
 * `cameraDemo.ts` calls `startCameraDemo()` at module scope, which builds a
 * WebGLRenderer, and this suite runs in node with no GL context.
 *
 * Worth guarding because the failure is silent and it defeats the tool. The
 * demo exists to pick pitch and fov; the game insets its framing by ~12% of the
 * viewport height to clear the HUD and palette. Delete these bands and the demo
 * goes back to framing edge to edge, still looks fine, and every number tuned
 * on it lands tighter in the game. Nothing else in the suite would notice.
 */
describe('the camera demo reserves the game\'s chrome', () => {
  const html = readFileSync(new URL('../camera.html', import.meta.url), 'utf8')
  const demo = readFileSync(new URL('../src/demo/cameraDemo.ts', import.meta.url), 'utf8')

  it('declares both bands with explicit heights', () => {
    expect(html).toMatch(/#chromeTop\s*\{[^}]*height:\s*\d+px/)
    expect(html).toMatch(/#chromeBottom\s*\{[^}]*height:\s*\d+px/)
  })

  it('reserves top and bottom, matching the game HUD and palette', () => {
    // The game measures ~49px of HUD and ~68px of palette. These stand in for
    // them; if the game's bars move, these are what drift.
    const top = /#chromeTop\s*\{[^}]*height:\s*(\d+)px/.exec(html)?.[1]
    const bottom = /#chromeBottom\s*\{[^}]*height:\s*(\d+)px/.exec(html)?.[1]
    expect(Number(top)).toBeGreaterThan(30)
    expect(Number(bottom)).toBeGreaterThan(50)
  })

  it('feeds the rig from what the bands MEASURE, not from a literal', () => {
    // A hardcoded setSafeArea(49, 0, 68, 0) would silently disagree with the
    // bands the moment either moves, and the on-screen occlusion would stop
    // matching the framing it produced.
    //
    // Asserted on intent, not on the call's shape: an earlier version of this
    // pinned the exact `setSafeArea(chromeHeight('chromeTop'), ...)` expression
    // and went red the moment those reads were hoisted into cached variables --
    // a refactor that changed nothing this test cares about.
    expect(demo).toMatch(/chromeHeight[\s\S]{0,120}getBoundingClientRect\(\)\.height/)
    expect(demo).toMatch(/=\s*chromeHeight\('chromeTop'\)/)
    expect(demo).toMatch(/=\s*chromeHeight\('chromeBottom'\)/)
    expect(demo).not.toMatch(/setSafeArea\(\s*\d+\s*,/)
  })

  it('re-measures on resize, so a rotation does not keep a stale inset', () => {
    expect(demo).toMatch(/onResize\([\s\S]{0,200}syncSafeArea\(\)/)
  })

  it('prints the measured inset, so a drift from the game is readable', () => {
    expect(demo).toMatch(/safe area/)
  })
})
