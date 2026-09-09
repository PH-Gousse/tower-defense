import { describe, it, expect } from 'vitest'
import {
  railWidth, usesRails, safeEdges, maxHeightBoundRail, RAIL_MAX, RAIL_MIN,
} from '../src/chrome'

/**
 * The chrome layout rule.
 *
 * Two properties matter and neither is obvious from the code alone:
 *
 *   1. A rail must never exceed the width that is FREE to the camera fit.
 *      Past it the fit flips from height-bound to width-bound and the board
 *      shrinks -- the change makes things worse while looking like more UI room.
 *      `camera.test.ts` owns that proof against real `fitGround` maths; here we
 *      hold the width rule that feeds it.
 *
 *   2. A rail's width must not depend on its contents, because the camera
 *      reserves it. Everything below is a function of the viewport only.
 */

const LANDSCAPE = [
  ['ultrawide', 3440, 1440],
  ['1456x830', 1456, 830],
  ['1280x800', 1280, 800],
  ['1024x640', 1024, 640],
  ['short landscape', 1024, 500],
  ['small landscape', 800, 600],
] as const

describe('railWidth', () => {
  it('gives portrait no rails at all', () => {
    // Two rails plus a readable 8-wide lane does not fit across a phone, and
    // scene.ts already frames a single lane in portrait for the same reason.
    expect(railWidth(390, 844)).toBe(0)
    expect(railWidth(820, 1180)).toBe(0)
  })

  it('rejects a square viewport on free space, not on orientation', () => {
    // Two rules can send a viewport to bars and it matters which one fires. The
    // orientation check (`viewH > viewW`) passes square through as landscape --
    // so `maxHeightBoundRail` is consulted and answers honestly that a square
    // screen has almost nothing spare, because its aspect is barely above the
    // board's own 0.835.
    expect(maxHeightBoundRail(900, 900)).toBeGreaterThan(0)
    expect(maxHeightBoundRail(900, 900)).toBeLessThan(RAIL_MIN)
    expect(railWidth(900, 900)).toBe(0)
  })

  it('sends portrait to bars before it ever consults the fit', () => {
    // The other rule. A phone is refused on orientation, and the distinction
    // matters: portrait also reframes to a single lane, so its fit is a
    // different rectangle entirely and asking about rails there is meaningless.
    expect(railWidth(390, 844)).toBe(0)
  })

  it('caps at RAIL_MAX on wide screens', () => {
    expect(railWidth(3440, 1440)).toBe(RAIL_MAX)
    expect(railWidth(1456, 830)).toBe(RAIL_MAX)
  })

  it('tracks the viewport ASPECT, not its width', () => {
    // The bug the first version of this module shipped: a constant fraction of
    // width. Free space is the viewport's aspect minus the board's (~0.835), so
    // two screens of the same width but different heights get very different
    // answers. 1024x500 is far roomier than 1024x900 despite being narrower.
    expect(maxHeightBoundRail(1024, 500)).toBeGreaterThan(maxHeightBoundRail(1024, 900))
  })

  it('gives a near-square viewport almost no rail, and says so by using bars', () => {
    // 900x900 has ~2.8% free per side. A 25%-of-width rule would have taken
    // 225px there and quietly shrunk the board.
    expect(maxHeightBoundRail(900, 900)).toBeLessThan(RAIL_MIN)
    expect(railWidth(900, 900)).toBe(0)
  })

  it('never takes more than the fit maths says is free', () => {
    for (const [name, w, h] of LANDSCAPE) {
      const rail = railWidth(w, h)
      if (rail === 0) continue
      expect(rail, name).toBeLessThanOrEqual(maxHeightBoundRail(w, h))
      expect(rail, name).toBeLessThanOrEqual(RAIL_MAX)
    }
  })

  it('leaves headroom rather than sitting on the crossover', () => {
    // Landing exactly on the boundary means any rounding flips the fit.
    for (const [name, w, h] of LANDSCAPE) {
      const rail = railWidth(w, h)
      if (rail === 0 || rail === RAIL_MAX) continue
      expect(rail, name).toBeLessThan(maxHeightBoundRail(w, h))
    }
  })

  it('falls back to bars when a rail would be too narrow to hold a card', () => {
    // A tower card is min-width 132px. Below RAIL_MIN the cards would shrink or
    // wrap, and a wrapping rail changes its own width -- the one thing the safe
    // area cannot tolerate.
    expect(railWidth(560, 400)).toBe(0)
  })

  it('either returns 0 or something a card actually fits in', () => {
    // No in-between: a 40px rail is worse than no rail.
    for (let w = 400; w <= 3440; w += 37) {
      const rail = railWidth(w, Math.round(w / 1.6))
      if (rail !== 0) expect(rail, `${w}px wide`).toBeGreaterThanOrEqual(RAIL_MIN)
    }
  })

  it('is a whole number of pixels', () => {
    // A fractional rail rounds differently in CSS than in the safe-area maths,
    // and the camera would reserve a slightly different box than the one drawn.
    for (const [name, w, h] of LANDSCAPE) {
      expect(Number.isInteger(railWidth(w, h)), name).toBe(true)
    }
  })

  it('does not depend on anything but the viewport', () => {
    // Same input, same answer -- no content, no state, nothing to drift.
    expect(railWidth(1280, 800)).toBe(railWidth(1280, 800))
  })
})

describe('usesRails', () => {
  it('agrees with railWidth on every case', () => {
    const cases: Array<[number, number]> = [
      [390, 844], [820, 1180], [1456, 830], [560, 400], [3440, 1440], [900, 900],
    ]
    for (const [w, h] of cases) {
      expect(usesRails(w, h)).toBe(railWidth(w, h) > 0)
    }
  })
})

describe('safeEdges', () => {
  it('puts the reservation on the horizontal axis for rails', () => {
    // `CameraRig` reduces these to safeV = max(top, bottom) and safeH =
    // max(left, right). Rails must leave safeV at 0 or they pay the vertical
    // cost they exist to avoid.
    expect(safeEdges(300, 46, 68)).toEqual({ top: 0, right: 300, bottom: 0, left: 300 })
  })

  it('ignores the measured bar heights while in rails', () => {
    // The bars do not exist in this layout; passing their last-known heights
    // must not leak into the vertical reservation.
    const a = safeEdges(280, 46, 68)
    const b = safeEdges(280, 999, 999)
    expect(a).toEqual(b)
  })

  it('puts the reservation on the vertical axis for bars', () => {
    expect(safeEdges(0, 46, 68)).toEqual({ top: 46, right: 0, bottom: 68, left: 0 })
  })

  it('reserves both bars separately, so the rig can take the taller', () => {
    // main.ts used to collapse these itself. Handing both through keeps the
    // "only the taller bar costs anything" property visible where it is decided.
    const e = safeEdges(0, 20, 90)
    expect(e.top).toBe(20)
    expect(e.bottom).toBe(90)
  })
})
