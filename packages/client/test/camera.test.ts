import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { fitGround, groundWindow } from '../src/render/CameraRig'
import { groundUnderNdc } from '../src/render/picking'

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

/** The lane, and the pair, as `cameraDemo` lays them out. */
const LANE = { halfW: 8 / 2, halfD: 24 / 2 }
const BOTH = { halfW: (8 * 2 + 4) / 2, halfD: 24 / 2 }

const PITCH_DEG = 56
const FOV_DEG = 35
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
  it('fits both lanes on a 1920x1080 viewport', () => {
    const { maxAbsX, maxAbsY } = frame(BOTH.halfW, BOTH.halfD, DESKTOP)
    expect(maxAbsX).toBeLessThan(1)
    expect(maxAbsY).toBeLessThan(1)
  })

  it('fits one lane on a 390x844 viewport', () => {
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
    const fit = fitGround(LANE.halfW, LANE.halfD, PITCH, FOV, DESKTOP)
    const centrePinned = LANE.halfD * (Math.sin(PITCH) / Math.tan(FOV / 2) + Math.cos(PITCH))
    expect(fit.distance).toBeLessThan(centrePinned * 0.9)
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
    const verticalOnly = fitGround(0, BOTH.halfD, PITCH, FOV, 0.3).distance
    const both = fitGround(BOTH.halfW, BOTH.halfD, PITCH, FOV, 0.3).distance
    expect(both).toBeGreaterThan(verticalOnly * 2)

    const { maxAbsX, maxAbsY } = frame(BOTH.halfW, BOTH.halfD, 0.3)
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
 * The acceptance criterion, as arithmetic: with the target clamped, no corner
 * of the screen may fall outside the bounds rectangle.
 */
describe('the pan clamp', () => {
  /** Reimplements `CameraRig.clampTarget` at yaw 0, where forward is -z. */
  function clampAt(
    targetX: number,
    targetZ: number,
    distance: number,
    aspect: number,
    b: { minX: number; minZ: number; maxX: number; maxZ: number },
  ): { x: number; z: number } {
    const w = groundWindow(distance, PITCH, FOV, aspect)
    const fit = (v: number, lo: number, hi: number, offLo: number, offHi: number): number => {
      const a = lo - offLo
      const c = hi - offHi
      if (a >= c) return (a + c) / 2
      return Math.min(Math.max(v, a), c)
    }
    return {
      x: fit(targetX, b.minX, b.maxX, -w.halfW, w.halfW),
      z: fit(targetZ, b.minZ, b.maxZ, -w.far, w.near),
    }
  }

  const BOUNDS = { minX: -1, minZ: -1, maxX: 21, maxZ: 25 }

  const PANS = [
    [-9999, 0], [9999, 0], [0, -9999], [0, 9999],
    [9999, 9999], [-9999, -9999], [9999, -9999], [-9999, 9999],
  ] as const

  /**
   * The invariant, per axis: either the view sits inside the bounds, or the
   * bounds sit inside the view. Never partly off one side.
   *
   * It has to be stated per axis and both ways round. Zoomed in, the view is
   * the smaller rectangle and containment runs one way; zoomed out past the
   * lanes it is the larger, and containment runs the other. Demanding the first
   * everywhere is what the earlier version of this test got wrong -- it is
   * unsatisfiable once the view is bigger than the content.
   */
  it('never lets the bounds fall partly off an edge, at any zoom or pan', () => {
    const violations: string[] = []
    for (const distance of [14, 18, 24, 32, 40, 55, 70]) {
      for (const aspect of [DESKTOP, PHONE]) {
        for (const [px, pz] of PANS) {
          const t = clampAt(px, pz, distance, aspect, BOUNDS)
          const w = groundWindow(distance, PITCH, FOV, aspect)
          const axes = [
            { name: 'x', lo: t.x - w.halfW, hi: t.x + w.halfW, bLo: BOUNDS.minX, bHi: BOUNDS.maxX },
            { name: 'z', lo: t.z - w.far, hi: t.z + w.near, bLo: BOUNDS.minZ, bHi: BOUNDS.maxZ },
          ]
          for (const a of axes) {
            const viewInside = a.lo >= a.bLo - 1e-6 && a.hi <= a.bHi + 1e-6
            const boundsInside = a.lo <= a.bLo + 1e-6 && a.hi >= a.bHi - 1e-6
            if (!viewInside && !boundsInside) {
              violations.push(
                `d=${distance} aspect=${aspect.toFixed(2)} pan=${px},${pz} axis=${a.name} ` +
                  `view=[${a.lo.toFixed(2)},${a.hi.toFixed(2)}]`,
              )
            }
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps every screen corner inside the bounds while the view still fits', () => {
    // The strict form of the guarantee, asserted on real projected corners
    // wherever it is satisfiable -- which is the zoom range a player pans in.
    let checked = 0
    const violations: string[] = []
    for (let distance = 14; distance <= 70; distance += 0.5) {
      for (const aspect of [DESKTOP, PHONE]) {
        const w = groundWindow(distance, PITCH, FOV, aspect)
        const fits =
          2 * w.halfW <= BOUNDS.maxX - BOUNDS.minX && w.near + w.far <= BOUNDS.maxZ - BOUNDS.minZ
        if (!fits) continue
        for (const [px, pz] of PANS) {
          const t = clampAt(px, pz, distance, aspect, BOUNDS)
          const camera = pose(t.x, t.z, distance, aspect)
          checked += 1
          for (const c of viewCorners(camera)) {
            if (
              c.x < BOUNDS.minX - 1e-6 || c.x > BOUNDS.maxX + 1e-6 ||
              c.z < BOUNDS.minZ - 1e-6 || c.z > BOUNDS.maxZ + 1e-6
            ) {
              violations.push(
                `d=${distance} aspect=${aspect.toFixed(2)} pan=${px},${pz} ` +
                  `corner=(${c.x.toFixed(2)},${c.z.toFixed(2)})`,
              )
            }
          }
        }
      }
    }
    expect(violations).toEqual([])
    // Guard against the loop above silently skipping everything.
    expect(checked).toBeGreaterThan(50)
  })

  it('does not jump as the zoom crosses the point where panning locks', () => {
    // Either side of the distance at which the bounds stop being satisfiable,
    // the clamped target has to be continuous -- otherwise the view lurches
    // mid-scroll.
    let locked = 0
    for (let d = 14; d < 70; d += 0.25) {
      const w = groundWindow(d, PITCH, FOV, DESKTOP)
      if (BOUNDS.minZ + w.far >= BOUNDS.maxZ - w.near) {
        locked = d
        break
      }
    }
    expect(locked).toBeGreaterThan(14)

    const before = clampAt(0, 9999, locked - 0.01, DESKTOP, BOUNDS)
    const after = clampAt(0, 9999, locked + 0.01, DESKTOP, BOUNDS)
    expect(after.z).toBeCloseTo(before.z, 1)
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
