import { describe, it, expect } from 'vitest'
import {
  railWidth, usesRails, safeEdges, maxRail, RAIL_MAX, RAIL_MIN, MIN_VIEW_ASPECT, MIN_VIEW_TILES,
} from '../src/chrome'
import { DEFAULT_ROWS_IN_VIEW } from '../src/render/CameraRig'
import { LANE_WIDTH, LANE_GAP } from '@ltw/sim'

/**
 * The chrome layout rule.
 *
 * Two properties matter and neither is obvious from the code alone:
 *
 *   1. A rail must never take width the default framing needs. The camera
 *      frames DEFAULT_ROWS_IN_VIEW rows (ADR-0024); across those rows the
 *      usable view has to show your lane, the gap and a strip of the
 *      opponent's. Past that the rail is costing the view, not using slack.
 *
 *   2. A rail's width must not depend on its contents, because the camera
 *      reserves it. Everything below is a function of the viewport only.
 */

const LANDSCAPE = [
  ['ultrawide', 3440, 1440],
  ['1920x1080', 1920, 1080],
  ['1456x830', 1456, 830],
  ['1280x800', 1280, 800],
  ['1024x640', 1024, 640],
  ['short landscape', 1024, 500],
  ['small landscape', 800, 600],
] as const

describe('the view the rails must leave', () => {
  it('is derived from the lane, not tuned', () => {
    expect(MIN_VIEW_TILES).toBe(LANE_WIDTH + LANE_GAP + 4)
    expect(MIN_VIEW_ASPECT).toBeCloseTo(MIN_VIEW_TILES / DEFAULT_ROWS_IN_VIEW, 12)
  })

  it('leaves the usable area at least that wide for its height', () => {
    for (const [name, w, h] of LANDSCAPE) {
      const rail = railWidth(w, h)
      if (rail === 0) continue
      expect((w - 2 * rail) / h, name).toBeGreaterThanOrEqual(MIN_VIEW_ASPECT)
    }
  })
})

describe('railWidth', () => {
  it('gives portrait no rails at all', () => {
    // Two rails plus a readable lane does not fit across a phone, and the
    // camera frames your lane alone there, width-bound.
    expect(railWidth(390, 844)).toBe(0)
    expect(railWidth(820, 1180)).toBe(0)
  })

  it('rejects a square viewport on free space, not on orientation', () => {
    // Two rules can send a viewport to bars and it matters which one fires. The
    // orientation check (`viewH > viewW`) passes square through as landscape --
    // so `maxRail` is consulted and answers honestly that a square screen has
    // too little spare to hold a rail: at 30 rows the view's own aspect is
    // 0.83, which leaves 75px a side, under RAIL_MIN.
    expect(maxRail(900, 900)).toBeGreaterThan(0)
    expect(maxRail(900, 900)).toBeLessThan(RAIL_MIN)
    expect(railWidth(900, 900)).toBe(0)
  })

  it('sends portrait to bars before it ever consults the fit', () => {
    expect(railWidth(390, 844)).toBe(0)
  })

  it('caps at RAIL_MAX on wide screens', () => {
    expect(railWidth(3440, 1440)).toBe(RAIL_MAX)
    expect(maxRail(3440, 1440)).toBeGreaterThan(RAIL_MAX)
  })

  it('tracks the viewport ASPECT, not its width', () => {
    // Free space is the viewport's aspect minus the view's, so two screens of
    // the same width but different heights get very different answers.
    expect(maxRail(1024, 500)).toBeGreaterThan(maxRail(1024, 900))
    expect(maxRail(1024, 900)).toBeLessThan(RAIL_MIN)
  })

  it('gives a laptop rails, but not the whole RAIL_MAX', () => {
    // 1280x800 is not wide enough to spend 300px a side and still show the
    // view: the rail shrinks to what is free, and stays above RAIL_MIN. (This
    // was 1456x830 at a 20-row default; at 30 rows that laptop has the room for
    // the whole RAIL_MAX.)
    const rail = railWidth(1280, 800)
    expect(rail).toBeGreaterThan(0)
    expect(rail).toBeLessThan(RAIL_MAX)
    expect(rail).toBeGreaterThanOrEqual(RAIL_MIN)
  })

  it('never takes more than the free width', () => {
    for (const [name, w, h] of LANDSCAPE) {
      const rail = railWidth(w, h)
      if (rail === 0) continue
      expect(rail, name).toBeLessThanOrEqual(maxRail(w, h))
      expect(rail, name).toBeLessThanOrEqual(RAIL_MAX)
    }
  })

  it('leaves headroom rather than sitting on the crossover', () => {
    // Landing exactly on the boundary means any rounding flips the view.
    for (const [name, w, h] of LANDSCAPE) {
      const rail = railWidth(w, h)
      if (rail === 0 || rail === RAIL_MAX) continue
      expect(rail, name).toBeLessThan(maxRail(w, h))
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
    const a = safeEdges(280, 46, 68)
    const b = safeEdges(280, 999, 999)
    expect(a).toEqual(b)
  })

  it('puts the reservation on the vertical axis for bars', () => {
    expect(safeEdges(0, 46, 68)).toEqual({ top: 46, right: 0, bottom: 68, left: 0 })
  })

  it('reserves both bars separately, so the rig can take the taller', () => {
    const e = safeEdges(0, 20, 90)
    expect(e.top).toBe(20)
    expect(e.bottom).toBe(90)
  })
})
