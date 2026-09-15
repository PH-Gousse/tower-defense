import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  clampWindow, fitGround, groundWindow, OVERSCROLL,
  DEFAULT_FOV_DEG, DEFAULT_PITCH_DEG, DEFAULT_MAX_DISTANCE,
  MAX_ROWS_IN_VIEW, DEFAULT_ROWS_IN_VIEW, distanceForRows, halfWidthAt,
} from '../src/render/CameraRig'
import { groundUnderNdc } from '../src/render/picking'
import { railWidth, safeEdges, CONTENT_W, MIN_VIEW_TILES } from '../src/chrome'
import { GRID_W, GRID_H, LANE_GAP } from '@ltw/sim'

/**
 * The framing maths, without a DOM.
 *
 * `CameraRig` itself binds pointer and keyboard listeners in its constructor,
 * so it needs a browser. Its two decisions that can actually be wrong -- how far
 * back to sit to fit a rectangle, and how much ground that leaves visible --
 * are pure functions, and they are what these tests hold down. The acceptance
 * criteria are stated in viewport sizes, so the viewport sizes appear here too.
 *
 * The `groundWindow` block below exists because the first version of this rig
 * built its clamp on the near row's half-width. A tilted camera sees a
 * trapezoid whose FAR row is the wide one, so the clamp let the lane walk off
 * the side of the screen at every zoom level. These tests assert containment
 * against real projected corners rather than against the formula that produced
 * them, which is the only version of this test that would have caught it.
 */

const DEG = Math.PI / 180

const DESKTOP = 1920 / 1080
const PHONE = 390 / 844

/**
 * The lane, and the pair, from the sim's own constants. `fitGround` no longer
 * frames the whole lane in the game -- it is 213 rows and the camera scrolls
 * (ADR-0024) -- but the camera demo still fits rectangles with it and the
 * maths must stay right, so these tests keep it honest on the real shapes.
 */
const LANE = { halfW: GRID_W / 2, halfD: GRID_H / 2 }
const BOTH = { halfW: (GRID_W * 2 + LANE_GAP) / 2, halfD: GRID_H / 2 }

/**
 * The pose under test is the pose that SHIPS.
 *
 * These were local copies (`PITCH_DEG = 56`, `FOV_DEG = 35`) until the field of
 * view narrowed. Local copies make this whole file dishonest the moment the rig
 * is retuned: every assertion below stays green while describing a camera the
 * game no longer builds. Import them, and a retune either keeps these
 * properties or fails here.
 */
const PITCH_DEG = DEFAULT_PITCH_DEG
const FOV_DEG = DEFAULT_FOV_DEG
const PITCH = PITCH_DEG * DEG
const FOV = FOV_DEG * DEG
const MARGIN = 1.06

/**
 * Pose a camera exactly the way `CameraRig.applyPose` does, at yaw 0: the
 * target on the ground, the camera up and back along +z.
 */
function pose(
  targetX: number,
  targetZ: number,
  distance: number,
  aspect: number,
  fovDeg = FOV_DEG,
  pitchDeg = PITCH_DEG,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.5, 500)
  const p = pitchDeg * DEG
  camera.up.set(0, 1, 0)
  camera.position.set(targetX, Math.sin(p) * distance, targetZ + Math.cos(p) * distance)
  camera.lookAt(targetX, 0, targetZ)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

/** Where the four screen corners land on the ground. */
function viewCorners(camera: THREE.PerspectiveCamera): Array<{ x: number; z: number }> {
  const out = new THREE.Vector3()
  const pts: Array<{ x: number; z: number }> = []
  for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const hit = groundUnderNdc(camera, nx, ny, out)
    expect(hit).not.toBeNull()
    pts.push({ x: hit!.x, z: hit!.z })
  }
  return pts
}

/**
 * Frame a rectangle the way `fitBounds` does, then report how close each corner
 * sits to the edge of the screen. 1.0 means exactly on the edge.
 */
function frame(
  halfW: number,
  halfD: number,
  aspect: number,
): { maxAbsX: number; maxAbsY: number; camera: THREE.PerspectiveCamera } {
  const fit = fitGround(halfW * MARGIN, halfD * MARGIN, PITCH, FOV, aspect)
  // rectCentre = target + forward * shift, and forward is -z at yaw 0.
  const camera = pose(0, fit.shift, fit.distance, aspect)
  let maxAbsX = 0
  let maxAbsY = 0
  const v = new THREE.Vector3()
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      v.set(sx * halfW, 0, sz * halfD).project(camera)
      maxAbsX = Math.max(maxAbsX, Math.abs(v.x))
      maxAbsY = Math.max(maxAbsY, Math.abs(v.y))
    }
  }
  return { maxAbsX, maxAbsY, camera }
}

describe('fitGround', () => {
  it('frames both lanes inside the screen, at whatever distance that takes', () => {
    // The fit is correct even though the game never uses it at this size: the
    // whole 213-row lane needs about 630 units of distance, far past the
    // readability cap, which is the reason the camera scrolls (ADR-0024).
    const { maxAbsX, maxAbsY } = frame(BOTH.halfW, BOTH.halfD, DESKTOP)
    expect(maxAbsX).toBeLessThan(1)
    expect(maxAbsY).toBeLessThan(1)
    expect(fitGround(BOTH.halfW, BOTH.halfD, PITCH, FOV, DESKTOP).distance).toBeGreaterThan(DEFAULT_MAX_DISTANCE)
  })

  it('frames one lane inside a 390x844 viewport', () => {
    const { maxAbsX, maxAbsY } = frame(LANE.halfW, LANE.halfD, PHONE)
    expect(maxAbsX).toBeLessThan(1)
    expect(maxAbsY).toBeLessThan(1)
  })

  it('fills the screen -- the fit is tight, not merely safe', () => {
    for (const [halfW, halfD, aspect] of [
      [BOTH.halfW, BOTH.halfD, DESKTOP],
      [LANE.halfW, LANE.halfD, PHONE],
      [LANE.halfW, LANE.halfD, DESKTOP],
      [BOTH.halfW, BOTH.halfD, 1],
    ] as const) {
      const { maxAbsX, maxAbsY } = frame(halfW, halfD, aspect)
      // One axis or the other has to be hard against the edge, bar the margin.
      expect(Math.max(maxAbsX, maxAbsY)).toBeGreaterThan(0.9)
    }
  })

  it('makes both lane ends bind at once, instead of only the near one', () => {
    // The bug this replaces: pinning the target to the rectangle's centre left
    // the near edge hard against the bottom of the screen and a band of dead
    // space above the far edge. Measured on the margined rectangle, which is
    // what was actually fitted -- equal NDC slack on an unmargined rectangle
    // would be the wrong assertion, because the perspective divide makes equal
    // ground distances above and below the target unequal on screen.
    const fit = fitGround(LANE.halfW * MARGIN, LANE.halfD * MARGIN, PITCH, FOV, DESKTOP)
    const camera = pose(0, fit.shift, fit.distance, DESKTOP)
    const v = new THREE.Vector3()
    const top = v.set(0, 0, -LANE.halfD * MARGIN).project(camera).y
    const bottom = v.set(0, 0, LANE.halfD * MARGIN).project(camera).y
    expect(top).toBeCloseTo(1, 6)
    expect(bottom).toBeCloseTo(-1, 6)
  })

  it('shifts the target forward of the rectangle centre', () => {
    // Positive shift means the target sits nearer the camera than the middle
    // of the rectangle, which is what the asymmetric window requires.
    const fit = fitGround(LANE.halfW, LANE.halfD, PITCH, FOV, DESKTOP)
    expect(fit.shift).toBeGreaterThan(0)
  })

  it('is closer than a centre-pinned fit would be', () => {
    // The whole point of solving for the shift: both edges bind at once.
    //
    // This asserted `< centrePinned * 0.9` while the file carried its own
    // FOV_DEG = 35. The 10% was not a property of the fit, it was a measurement
    // of one pose: the saving comes from the window's ASYMMETRY, and a narrow
    // lens at a high pitch has a more symmetric window, so there is less to
    // win. At fov 35 the shift saved about 20%; at the shipped 18 it saves
    // about 6%. Baking either number in makes the test a tripwire on retuning
    // rather than a statement about the maths.
    const centre = (halfD: number, fov: number): number =>
      halfD * (Math.sin(PITCH) / Math.tan(fov / 2) + Math.cos(PITCH))
    const fit = fitGround(LANE.halfW, LANE.halfD, PITCH, FOV, DESKTOP)
    expect(fit.distance).toBeLessThan(centre(LANE.halfD, FOV))
  })

  it('saves more by shifting the wider the field of view gets', () => {
    // The relationship behind the number the test above used to hardcode. A
    // wider lens sees a more lopsided trapezoid, so freeing the target to slide
    // along the gaze is worth more. Stated as a trend, it survives any retune.
    const saving = (fov: number): number => {
      const pinned = LANE.halfD * (Math.sin(PITCH) / Math.tan(fov / 2) + Math.cos(PITCH))
      return 1 - fitGround(LANE.halfW, LANE.halfD, PITCH, fov, DESKTOP).distance / pinned
    }
    expect(saving(45 * DEG)).toBeGreaterThan(saving(35 * DEG))
    expect(saving(35 * DEG)).toBeGreaterThan(saving(18 * DEG))
    expect(saving(FOV)).toBeGreaterThan(0)
  })

  it('needs more distance as the field of view narrows', () => {
    const wide = fitGround(LANE.halfW, LANE.halfD, PITCH, 60 * DEG, DESKTOP).distance
    const narrow = fitGround(LANE.halfW, LANE.halfD, PITCH, 20 * DEG, DESKTOP).distance
    expect(narrow).toBeGreaterThan(wide)
  })

  it('takes the horizontal constraint on a narrow viewport', () => {
    // On a very tall, very narrow viewport the width is what forces the camera
    // back. Asserted against the vertical-only distance rather than by
    // comparing projected corners, which only measures the margin.
    // A twenty-row slab of both lanes, the shape the default framing shows:
    // the full 213-row lane is so deep that the vertical constraint wins on
    // any aspect, which would make this a test of depth rather than of width.
    const SLAB = { halfW: BOTH.halfW, halfD: DEFAULT_ROWS_IN_VIEW / 2 }
    const verticalOnly = fitGround(0, SLAB.halfD, PITCH, FOV, 0.3).distance
    const both = fitGround(SLAB.halfW, SLAB.halfD, PITCH, FOV, 0.3).distance
    expect(both).toBeGreaterThan(verticalOnly * 2)

    const { maxAbsX, maxAbsY } = frame(SLAB.halfW, SLAB.halfD, 0.3)
    expect(maxAbsX).toBeLessThan(1)
    expect(maxAbsY).toBeLessThan(1)
  })

  it('stays finite when the horizon enters frame', () => {
    // Pitch below half the field of view: the far edge is unbounded. The cap
    // has to keep this arithmetic real rather than returning NaN.
    const fit = fitGround(LANE.halfW, LANE.halfD, 10 * DEG, 70 * DEG, DESKTOP)
    expect(Number.isFinite(fit.distance)).toBe(true)
    expect(Number.isFinite(fit.shift)).toBe(true)
  })
})

describe('groundWindow', () => {
  it('reaches farther above the target than below it', () => {
    const w = groundWindow(32, PITCH, FOV, DESKTOP)
    expect(w.far).toBeGreaterThan(w.near)
  })

  it('matches the ground the camera actually sees', () => {
    for (const distance of [14, 20, 32, 45, 70]) {
      for (const aspect of [DESKTOP, PHONE]) {
        const w = groundWindow(distance, PITCH, FOV, aspect)
        const camera = pose(0, 0, distance, aspect)
        const corners = viewCorners(camera)

        const zs = corners.map((c) => c.z)
        const xs = corners.map((c) => c.x)
        // Top of screen is smaller z; bottom is larger.
        expect(Math.min(...zs)).toBeCloseTo(-w.far, 6)
        expect(Math.max(...zs)).toBeCloseTo(w.near, 6)
        // The reported half-width is the widest row, which is the far one.
        expect(Math.max(...xs)).toBeCloseTo(w.halfW, 6)
        expect(Math.min(...xs)).toBeCloseTo(-w.halfW, 6)
      }
    }
  })

  it('grows with distance on every axis', () => {
    const near = groundWindow(20, PITCH, FOV, DESKTOP)
    const far = groundWindow(40, PITCH, FOV, DESKTOP)
    expect(far.halfW).toBeGreaterThan(near.halfW)
    expect(far.near).toBeGreaterThan(near.near)
    expect(far.far).toBeGreaterThan(near.far)
  })

  it('stays finite when the horizon enters frame', () => {
    const w = groundWindow(30, 10 * DEG, 70 * DEG, DESKTOP)
    expect(Number.isFinite(w.far)).toBe(true)
    expect(Number.isFinite(w.halfW)).toBe(true)
  })
})

/**
 * The pan clamp.
 *
 * Tested against the real `clampWindow` rather than a copy of it, because the
 * bug this replaced was invisible to a test that only asked whether the clamp
 * was self-consistent. It was perfectly consistent. There was just nowhere to
 * go: the default framing shows the content plus its margin, so the strict
 * "the whole view must fit inside the bounds" rule left no travel at all.
 *
 * So the first test here measures travel in tiles, which is the thing a player
 * feels, and the second bounds it -- an overscroll large enough to fix the
 * first complaint and unbounded would park both boards in a corner of the
 * screen.
 */
describe('the pan clamp', () => {
  /** The game's own content rectangle: two lanes, the gap, 1 tile of margin. */
  const BOUNDS = { minX: -1, minZ: -1, maxX: CONTENT_W + 1, maxZ: GRID_H + 1 }
  /** The distances the game opens on and stops at. */
  const OPEN = distanceForRows(DEFAULT_ROWS_IN_VIEW, PITCH, FOV)
  const FAR = DEFAULT_MAX_DISTANCE

  /** At yaw 0 the gaze runs along -z, so the view's extent is (-far, +near). */
  function travel(distance: number, aspect: number): { x: number; z: number } {
    const w = groundWindow(distance, PITCH, FOV, aspect)
    const span = (lo: number, hi: number, offLo: number, offHi: number): number =>
      clampWindow(9999, lo, hi, offLo, offHi) - clampWindow(-9999, lo, hi, offLo, offHi)
    return {
      x: span(BOUNDS.minX, BOUNDS.maxX, -w.halfW, w.halfW),
      z: span(BOUNDS.minZ, BOUNDS.maxZ, -w.far, w.near),
    }
  }

  it('leaves the whole lane reachable at the framing the game opens on', () => {
    // Twenty rows in view of two hundred and thirteen: the travel along the
    // lane is most of the lane, at every aspect. Sideways travel is small on a
    // wide screen -- the view is nearly as wide as both lanes -- and that is
    // correct; it is the lane axis the player scrolls.
    for (const aspect of [DESKTOP, 1440 / 900, 1000 / 800, PHONE]) {
      const t = travel(OPEN, aspect)
      expect(t.z).toBeGreaterThan(GRID_H - DEFAULT_ROWS_IN_VIEW - 2)
    }
  })

  it('reaches every part of both lanes, zoomed in and zoomed out', () => {
    // Every tile has to be visible from somewhere, or a corner of your own maze
    // is a place the camera cannot be pointed. What covers the content is the
    // travel plus the view's own span, not the travel alone -- the view carries
    // its width with it.
    for (const aspect of [DESKTOP, PHONE]) {
      for (const distance of [16, OPEN, FAR]) {
        const t = travel(distance, aspect)
        const w = groundWindow(distance, PITCH, FOV, aspect)
        expect(t.x + 2 * w.halfW, `x at ${distance}`).toBeGreaterThanOrEqual(BOUNDS.maxX - BOUNDS.minX)
        expect(t.z + w.near + w.far, `z at ${distance}`).toBeGreaterThanOrEqual(BOUNDS.maxZ - BOUNDS.minZ)
      }
    }
  })

  it('bounds the overscroll, so the boards cannot slide into a corner', () => {
    // The failure at the other end. Clamping the target into the bounds with no
    // view term at all gave travel everywhere and let the default framing pan
    // both lanes into the corner of a screen that is twice as wide as they are.
    for (const distance of [8, 14, 24, OPEN, 55, FAR]) {
      for (const aspect of [DESKTOP, PHONE]) {
        const w = groundWindow(distance, PITCH, FOV, aspect)
        const axes = [
          { lo: BOUNDS.minX, hi: BOUNDS.maxX, offLo: -w.halfW, offHi: w.halfW },
          { lo: BOUNDS.minZ, hi: BOUNDS.maxZ, offLo: -w.far, offHi: w.near },
        ]
        for (const a of axes) {
          const half = (a.offHi - a.offLo) / 2
          const slack = OVERSCROLL * half
          // Strict range, per the rule the overscroll widens.
          let lo = a.lo - a.offLo
          let hi = a.hi - a.offHi
          if (lo > hi) { const mid = (lo + hi) / 2; lo = mid; hi = mid }
          expect(clampWindow(9999, a.lo, a.hi, a.offLo, a.offHi)).toBeCloseTo(hi + slack, 9)
          expect(clampWindow(-9999, a.lo, a.hi, a.offLo, a.offHi)).toBeCloseTo(lo - slack, 9)
        }
      }
    }
  })

  it('does not jump as the zoom crosses the point where the strict range dies', () => {
    // Either side of the distance at which the bounds stop being satisfiable
    // the clamped target has to be continuous, or the view lurches mid-scroll.
    // Along the lane that point is far past the zoom cap now -- 213 rows never
    // fit -- so the axis that still crosses it inside the rig's range is x, on
    // a wide screen, where both lanes fit in view somewhere between 16 and 40
    // rows. Scan that.
    let locked = 0
    for (let d = 1; d < DEFAULT_MAX_DISTANCE; d += 0.25) {
      const w = groundWindow(d, PITCH, FOV, DESKTOP)
      if (BOUNDS.minX + w.halfW >= BOUNDS.maxX - w.halfW) { locked = d; break }
    }
    expect(locked).toBeGreaterThan(1)
    expect(locked).toBeLessThan(DEFAULT_MAX_DISTANCE)
    const at = (d: number): number => {
      const w = groundWindow(d, PITCH, FOV, DESKTOP)
      return clampWindow(9999, BOUNDS.minX, BOUNDS.maxX, -w.halfW, w.halfW)
    }
    expect(at(locked + 0.01)).toBeCloseTo(at(locked - 0.01), 1)
  })

  it('stays centred on the content when the view is bigger than it', () => {
    // Zoomed all the way out on a wide screen the strict x range collapses,
    // and the midpoint it collapses to must be the middle of the bounds.
    const w = groundWindow(FAR, PITCH, FOV, DESKTOP)
    expect(2 * w.halfW).toBeGreaterThan(BOUNDS.maxX - BOUNDS.minX)
    const lo = clampWindow(-9999, BOUNDS.minX, BOUNDS.maxX, -w.halfW, w.halfW)
    const hi = clampWindow(9999, BOUNDS.minX, BOUNDS.maxX, -w.halfW, w.halfW)
    expect((lo + hi) / 2).toBeCloseTo((BOUNDS.minX + BOUNDS.maxX) / 2, 9)
  })
})

describe('the derived pose', () => {
  function poseYaw(
    targetX: number,
    targetZ: number,
    distance: number,
    pitchDeg: number,
    yawDeg: number,
  ): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(FOV_DEG, DESKTOP, 0.5, 500)
    const p = pitchDeg * DEG
    const y = yawDeg * DEG
    const fx = Math.sin(y)
    const fz = -Math.cos(y)
    const h = Math.cos(p) * distance
    camera.up.set(0, 1, 0)
    camera.position.set(targetX - fx * h, Math.sin(p) * distance, targetZ - fz * h)
    camera.lookAt(targetX, 0, targetZ)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    return camera
  }

  it('has zero roll at every yaw', () => {
    for (const yaw of [-180, -90, -37, 0, 45, 90, 180]) {
      const camera = poseYaw(3, 9, 30, 56, yaw)
      // With up = +y and a non-vertical gaze, the camera's own right axis must
      // stay horizontal. Any roll tips it out of the ground plane.
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      expect(right.y).toBeCloseTo(0, 12)
    }
  })

  it('sits at the requested pitch above the ground', () => {
    for (const pitch of [35, 56, 75]) {
      const camera = poseYaw(0, 0, 40, pitch, 0)
      expect(camera.position.y).toBeCloseTo(Math.sin(pitch * DEG) * 40, 9)
      const horizontal = Math.hypot(camera.position.x, camera.position.z)
      expect(Math.atan2(camera.position.y, horizontal) / DEG).toBeCloseTo(pitch, 9)
    }
  })

  it('keeps the target under the centre of the screen at every yaw', () => {
    const out = new THREE.Vector3()
    for (const yaw of [-90, 0, 30, 180]) {
      const camera = poseYaw(10, 12, 32, 56, yaw)
      const hit = groundUnderNdc(camera, 0, 0, out)
      expect(hit!.x).toBeCloseTo(10, 6)
      expect(hit!.z).toBeCloseTo(12, 6)
    }
  })

  it('places the camera at higher z than the target, so low z draws high', () => {
    // The entrance row is z = 0 and must appear at the top of the screen.
    const camera = poseYaw(4, 12, 32, 56, 0)
    expect(camera.position.z).toBeGreaterThan(12)
  })
})

/**
 * Rows in frame (ADR-0024).
 *
 * The game no longer fits the board; it frames DEFAULT_ROWS_IN_VIEW rows and
 * caps the zoom at MAX_ROWS_IN_VIEW. `frameRows` on the rig is DOM-bound, so
 * these reproduce its arithmetic -- the same reduction of the safe area to an
 * effective fov and aspect that `fitBounds` uses -- and assert the acceptance
 * criteria in the viewports they were stated for.
 */
describe('rows in frame', () => {
  /** The bars' measured heights, for the viewports that fall back to them. */
  const HUD_PX = 46
  const PALETTE_PX = 68

  const VIEWPORTS: ReadonlyArray<readonly [string, number, number]> = [
    ['ultrawide 3440x1440', 3440, 1440],
    ['iPad portrait 820x1180', 820, 1180],
    ['iPhone portrait 390x844', 390, 844],
    ['desktop 1920x1080', 1920, 1080],
    ['laptop 1456x830', 1456, 830],
    ['laptop 1280x800', 1280, 800],
    ['small 1024x640', 1024, 640],
    ['short landscape 1024x500', 1024, 500],
  ]

  /** The safe area for a viewport, exactly as `syncSafeArea` would report it. */
  function safeFor(viewW: number, viewH: number): { v: number; h: number; rail: number } {
    const rail = railWidth(viewW, viewH)
    const e = safeEdges(rail, HUD_PX, PALETTE_PX)
    return { v: Math.max(e.top, e.bottom), h: Math.max(e.left, e.right), rail }
  }

  /** `CameraRig.frameRows`, reduced to the arithmetic that picks the distance. */
  function frameAs(viewW: number, viewH: number, rows: number, halfW: number) {
    const { v, h } = safeFor(viewW, viewH)
    const usableY = Math.max(0.2, (viewH - 2 * v) / viewH)
    const usableX = Math.max(0.2, (viewW - 2 * h) / viewW)
    const t = Math.tan(FOV / 2)
    const fovEff = 2 * Math.atan(t * usableY)
    const aspectEff = ((viewW / viewH) * usableX) / usableY
    let d = distanceForRows(rows, PITCH, fovEff)
    const need = halfW + 1
    let bound: 'rows' | 'width' = 'rows'
    if (halfWidthAt(d, PITCH, fovEff, aspectEff) < need) {
      d = need / halfWidthAt(1, PITCH, fovEff, aspectEff)
      bound = 'width'
    }
    const clamped = Math.min(d, DEFAULT_MAX_DISTANCE)
    const w = groundWindow(clamped, PITCH, fovEff, aspectEff)
    return { distance: clamped, bound, rows: w.near + w.far, tilesAcross: 2 * w.halfW }
  }

  it('derives the zoom cap from the row limit, not from a fitted board', () => {
    expect(DEFAULT_MAX_DISTANCE).toBeCloseTo(distanceForRows(MAX_ROWS_IN_VIEW, PITCH, FOV), 9)
    // The number reasoned about in ADR-0024: about 118 at fov 18, pitch 70.
    expect(DEFAULT_MAX_DISTANCE).toBeGreaterThan(110)
    expect(DEFAULT_MAX_DISTANCE).toBeLessThan(125)
    expect(MAX_ROWS_IN_VIEW).toBe(40)
    expect(DEFAULT_ROWS_IN_VIEW).toBe(20)
  })

  it('is linear in rows, so half the rows is half the distance', () => {
    expect(distanceForRows(20, PITCH, FOV)).toBeCloseTo(distanceForRows(40, PITCH, FOV) / 2, 9)
  })

  it('agrees with the ground window it inverts', () => {
    for (const rows of [5, 20, 40]) {
      const d = distanceForRows(rows, PITCH, FOV)
      const w = groundWindow(d, PITCH, FOV, DESKTOP)
      expect(w.near + w.far).toBeCloseTo(rows, 9)
      expect(halfWidthAt(d, PITCH, FOV, DESKTOP)).toBeCloseTo(w.halfW, 9)
    }
  })

  it('opens on the default rows on every landscape viewport', () => {
    for (const [name, w, h] of VIEWPORTS) {
      if (h > w) continue
      const f = frameAs(w, h, DEFAULT_ROWS_IN_VIEW, GRID_W / 2)
      expect(f.bound, name).toBe('rows')
      expect(f.rows, name).toBeCloseTo(DEFAULT_ROWS_IN_VIEW, 6)
      expect(f.distance, name).toBeLessThan(DEFAULT_MAX_DISTANCE)
    }
  })

  it('shows your whole lane across, with margin, wherever it opens', () => {
    // The chrome rule (`MIN_VIEW_TILES`) exists to make this true in rails.
    // The one exception is a phone at the zoom cap: 40 rows on 390x844 is
    // about 18 tiles across, which holds the 17-wide lane (ADR-0027) but not
    // its margin. There the lane itself must still fit.
    for (const [name, w, h] of VIEWPORTS) {
      const f = frameAs(w, h, DEFAULT_ROWS_IN_VIEW, GRID_W / 2)
      const atCap = f.distance >= DEFAULT_MAX_DISTANCE - 1e-9
      expect(f.tilesAcross, name).toBeGreaterThanOrEqual((atCap ? GRID_W : GRID_W + 2) - 0.01)
      if (h <= w && railWidth(w, h) > 0) expect(f.tilesAcross, name).toBeGreaterThanOrEqual(MIN_VIEW_TILES - 0.01)
    }
  })

  it('is width-bound in portrait, and still inside the zoom cap', () => {
    // 20 rows on a phone shows nine tiles of a seventeen-wide lane, so the
    // framing backs off until the lane fits; ADR-0024 said that lands near
    // 35 rows for 16 wide, and at 17 wide (ADR-0027) a 390-wide phone runs
    // into the 40-row cap with the lane in frame and its margin not.
    for (const [name, w, h] of VIEWPORTS) {
      if (h <= w) continue
      const f = frameAs(w, h, DEFAULT_ROWS_IN_VIEW, GRID_W / 2)
      expect(f.bound, name).toBe('width')
      const atCap = f.distance >= DEFAULT_MAX_DISTANCE - 1e-9
      expect(f.tilesAcross, name).toBeGreaterThanOrEqual((atCap ? GRID_W : GRID_W + 2) - 0.01)
      expect(f.rows, name).toBeLessThanOrEqual(MAX_ROWS_IN_VIEW)
      expect(f.rows, name).toBeGreaterThan(DEFAULT_ROWS_IN_VIEW)
    }
  })

  it('shows at least one lane at the zoom cap on a phone', () => {
    // ADR-0024's arithmetic: 40 rows on 390x844 is about 18 tiles across.
    const w = groundWindow(DEFAULT_MAX_DISTANCE, PITCH, FOV, PHONE)
    expect(2 * w.halfW).toBeGreaterThan(GRID_W)
    expect(2 * w.halfW).toBeLessThan(CONTENT_W)
  })

  it('shows both lanes at the zoom cap on a desktop', () => {
    const w = groundWindow(DEFAULT_MAX_DISTANCE, PITCH, FOV, DESKTOP)
    expect(2 * w.halfW).toBeGreaterThan(CONTENT_W + 2)
  })

  it('keeps a tower readable at the cap: at least 24px per row on 1080p', () => {
    // Forty rows in 1080 pixels is 27px a row; ADR-0024 rejected 60 rows at
    // 18px. This is the readability floor the cap was chosen against.
    const perRow = 1080 / MAX_ROWS_IN_VIEW
    expect(perRow).toBeGreaterThanOrEqual(24)
  })
})
