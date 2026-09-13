import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  groundToTile,
  groundUnderNdc,
  ndcFromClient,
  screenToGround,
  type LaneLayout,
} from '../src/render/picking'

/**
 * Picking, against a camera pose held still by hand.
 *
 * The point of testing this headlessly is that a half-tile picking error is
 * nearly invisible in a screenshot and completely infuriating to play. These
 * tests pin the two properties that matter -- the centre of the screen lands on
 * the target, and the corners bracket it -- plus the boundary cases that decide
 * which tile a click on an edge belongs to.
 */

const VIEW = { left: 0, top: 0, width: 1920, height: 1080 }

/**
 * A camera posed the way `CameraRig` poses one: pitch below horizontal, looking
 * toward -z, no roll. Built here rather than through the rig so the test does
 * not depend on the rig being right.
 */
function poseCamera(
  targetX: number,
  targetZ: number,
  distance: number,
  pitchDeg = 56,
  fovDeg = 45,
  aspect = VIEW.width / VIEW.height,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.5, 500)
  const p = (pitchDeg * Math.PI) / 180
  camera.up.set(0, 1, 0)
  camera.position.set(targetX, Math.sin(p) * distance, targetZ + Math.cos(p) * distance)
  camera.lookAt(targetX, 0, targetZ)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

const out = new THREE.Vector3()
const ndc = new THREE.Vector2()

describe('screenToGround', () => {
  it('maps the centre of the screen to the camera target', () => {
    const camera = poseCamera(10, 12, 32)
    const hit = screenToGround(camera, VIEW.width / 2, VIEW.height / 2, VIEW, out, ndc)
    expect(hit).not.toBeNull()
    expect(hit!.x).toBeCloseTo(10, 6)
    expect(hit!.y).toBeCloseTo(0, 12)
    expect(hit!.z).toBeCloseTo(12, 6)
  })

  it('maps the centre to the target at any distance and pitch', () => {
    for (const [distance, pitch] of [[14, 40], [32, 56], [58, 75]] as const) {
      const camera = poseCamera(4, 20, distance, pitch)
      const hit = screenToGround(camera, VIEW.width / 2, VIEW.height / 2, VIEW, out, ndc)
      expect(hit).not.toBeNull()
      expect(hit!.x).toBeCloseTo(4, 6)
      expect(hit!.z).toBeCloseTo(20, 6)
    }
  })

  it('maps the four viewport corners to points that enclose the target', () => {
    const camera = poseCamera(10, 12, 32)
    const corners = [
      [0, 0],
      [VIEW.width, 0],
      [0, VIEW.height],
      [VIEW.width, VIEW.height],
    ] as const

    const xs: number[] = []
    const zs: number[] = []
    for (const [cx, cy] of corners) {
      const hit = screenToGround(camera, cx, cy, VIEW, out, ndc)
      expect(hit).not.toBeNull()
      xs.push(hit!.x)
      zs.push(hit!.z)
    }

    expect(Math.min(...xs)).toBeLessThan(10)
    expect(Math.max(...xs)).toBeGreaterThan(10)
    expect(Math.min(...zs)).toBeLessThan(12)
    expect(Math.max(...zs)).toBeGreaterThan(12)
  })

  it('puts the top of the screen farther from the camera than the bottom', () => {
    // This is the whole "entrance at the top" claim, as an assertion. The
    // camera sits at high z looking toward -z, so smaller z draws higher.
    const camera = poseCamera(10, 12, 32)
    const top = screenToGround(camera, VIEW.width / 2, 1, VIEW, out, ndc)!.z
    const bottom = screenToGround(camera, VIEW.width / 2, VIEW.height - 1, VIEW, out, ndc)!.z
    expect(top).toBeLessThan(bottom)
  })

  it('returns null for a ray that never reaches the plane', () => {
    // Pitched far enough down that the top of the frustum clears the horizon.
    const camera = poseCamera(0, 0, 30, 12, 70)
    expect(groundUnderNdc(camera, 0, 1, out)).toBeNull()
  })

  it('returns null when the ground is behind the camera', () => {
    // Underground and looking down: the plane is behind the near plane.
    const camera = new THREE.PerspectiveCamera(45, 1.777, 0.5, 500)
    camera.position.set(0, -20, 0)
    camera.lookAt(0, -40, -10)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    expect(groundUnderNdc(camera, 0, 0, out)).toBeNull()
  })

  it('accounts for a canvas that does not start at the window origin', () => {
    const camera = poseCamera(0, 0, 30)
    const inset = { left: 100, top: 50, width: 800, height: 600 }
    const hit = screenToGround(camera, 100 + 400, 50 + 300, inset, out, ndc)
    expect(hit!.x).toBeCloseTo(0, 6)
    expect(hit!.z).toBeCloseTo(0, 6)
  })
})

describe('ndcFromClient', () => {
  it('puts the centre at the origin and flips y', () => {
    ndcFromClient(960, 540, VIEW, ndc)
    expect(ndc.x).toBeCloseTo(0, 12)
    expect(ndc.y).toBeCloseTo(0, 12)

    ndcFromClient(0, 0, VIEW, ndc)
    expect(ndc.x).toBeCloseTo(-1, 12)
    expect(ndc.y).toBeCloseTo(1, 12)
  })
})

describe('groundToTile', () => {
  const lane: LaneLayout = { originX: 0, originZ: 0, width: 8, length: 24, tile: 1 }
  const offset: LaneLayout = { originX: 12, originZ: 0, width: 8, length: 24, tile: 1 }
  const tile = { x: 0, y: 0 }

  it('floors a point into its tile', () => {
    expect(groundToTile({ x: 0.1, z: 0.9 }, lane, tile)).toEqual({ x: 0, y: 0 })
    expect(groundToTile({ x: 3.5, z: 11.5 }, lane, tile)).toEqual({ x: 3, y: 11 })
    expect(groundToTile({ x: 7.99, z: 23.99 }, lane, tile)).toEqual({ x: 7, y: 23 })
  })

  it('treats a tile as half-open, so a boundary belongs to the higher tile', () => {
    expect(groundToTile({ x: 1, z: 1 }, lane, tile)).toEqual({ x: 1, y: 1 })
    expect(groundToTile({ x: 0.999999, z: 1 }, lane, tile)).toEqual({ x: 0, y: 1 })
  })

  it('rejects points outside the lane, including the far edge exactly', () => {
    expect(groundToTile({ x: -0.001, z: 5 }, lane, tile)).toBeNull()
    expect(groundToTile({ x: 5, z: -0.001 }, lane, tile)).toBeNull()
    expect(groundToTile({ x: 8, z: 5 }, lane, tile)).toBeNull()
    expect(groundToTile({ x: 5, z: 24 }, lane, tile)).toBeNull()
  })

  it('resolves the second lane against its own origin', () => {
    expect(groundToTile({ x: 12.5, z: 0.5 }, offset, tile)).toEqual({ x: 0, y: 0 })
    expect(groundToTile({ x: 19.5, z: 23.5 }, offset, tile)).toEqual({ x: 7, y: 23 })
    // The gap between the lanes belongs to neither.
    expect(groundToTile({ x: 9.5, z: 5 }, offset, tile)).toBeNull()
    expect(groundToTile({ x: 9.5, z: 5 }, lane, tile)).toBeNull()
  })

  it('round-trips: a tile centre picks back to the same tile at every zoom', () => {
    // The end-to-end property the acceptance criteria ask for -- correct at
    // every zoom level and at the lane edges.
    for (const distance of [12, 20, 32, 45, 62]) {
      const camera = poseCamera(4, 12, distance)
      for (const [tx, ty] of [[0, 0], [7, 0], [0, 23], [7, 23], [3, 11]] as const) {
        const world = new THREE.Vector3(tx + 0.5, 0, ty + 0.5)
        const projected = world.clone().project(camera)
        // Skip tiles the frustum genuinely does not contain at this zoom.
        if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) continue
        const back = groundUnderNdc(camera, projected.x, projected.y, out)
        expect(back).not.toBeNull()
        expect(groundToTile(back!, lane, tile)).toEqual({ x: tx, y: ty })
      }
    }
  })
})

/**
 * Anchor picking for a 2x2 footprint (ADR-0020, `[proposed]` vertex snap).
 *
 * The footprint's centre is a grid vertex, so the pick snaps to the nearest
 * vertex and the anchor is that vertex less half the size. Two things have to
 * hold at every zoom: the centre of the screen picks the anchor whose centre
 * is nearest the camera target, and the snap flips exactly at the half-tile.
 */
import { groundToAnchor } from '../src/render/picking'

describe('groundToAnchor', () => {
  const LANE16: LaneLayout = { originX: 0, originZ: 0, width: 16, length: 213, tile: 1 }
  const a = { x: 0, y: 0 }

  it('snaps to the nearest vertex and steps back half the footprint', () => {
    // A cursor at (4.1, 20.2) is nearest vertex (4, 20): anchor (3, 19), so
    // the footprint covers 3..4 x 19..20 and is centred on the vertex.
    expect(groundToAnchor({ x: 4.1, z: 20.2 }, LANE16, 2, a)).toEqual({ x: 3, y: 19 })
    // Past the half tile the vertex flips.
    expect(groundToAnchor({ x: 4.6, z: 20.2 }, LANE16, 2, a)).toEqual({ x: 4, y: 19 })
    expect(groundToAnchor({ x: 4.1, z: 20.6 }, LANE16, 2, a)).toEqual({ x: 3, y: 20 })
  })

  it('differs from the hovered tile by the half-size step', () => {
    // The hovered-tile rule would anchor at (4, 20) here; the snap anchors at
    // (3, 19) so the pointer sits at the footprint's centre, not its corner.
    const t = { x: 0, y: 0 }
    groundToTile({ x: 4.1, z: 20.2 }, LANE16, t)
    expect(t).toEqual({ x: 4, y: 20 })
    groundToAnchor({ x: 4.1, z: 20.2 }, LANE16, 2, a)
    expect(a).toEqual({ x: 3, y: 19 })
  })

  it('clamps at the lane edges so the last footprint is still reachable', () => {
    expect(groundToAnchor({ x: 0.2, z: 20 }, LANE16, 2, a)).toEqual({ x: 0, y: 19 })
    expect(groundToAnchor({ x: 15.9, z: 20 }, LANE16, 2, a)).toEqual({ x: 14, y: 19 })
    expect(groundToAnchor({ x: 8, z: 212.9 }, LANE16, 2, a)).toEqual({ x: 7, y: 211 })
    expect(groundToAnchor({ x: 8, z: 0.1 }, LANE16, 2, a)).toEqual({ x: 7, y: 0 })
  })

  it('returns null outside the lane, even where a footprint could overlap the edge', () => {
    expect(groundToAnchor({ x: -0.3, z: 20 }, LANE16, 2, a)).toBeNull()
    expect(groundToAnchor({ x: 16.2, z: 20 }, LANE16, 2, a)).toBeNull()
    expect(groundToAnchor({ x: 8, z: -0.1 }, LANE16, 2, a)).toBeNull()
    expect(groundToAnchor({ x: 8, z: 213 }, LANE16, 2, a)).toBeNull()
  })

  it('honours the lane origin and tile size', () => {
    const shifted: LaneLayout = { originX: 20, originZ: 0, width: 16, length: 213, tile: 1 }
    expect(groundToAnchor({ x: 24.1, z: 20.2 }, shifted, 2, a)).toEqual({ x: 3, y: 19 })
    const scaled: LaneLayout = { originX: 0, originZ: 0, width: 16, length: 213, tile: 2 }
    expect(groundToAnchor({ x: 8.2, z: 40.4 }, scaled, 2, a)).toEqual({ x: 3, y: 19 })
  })

  it('picks the same anchor from the screen centre at every zoom level', () => {
    // The centre pixel lands on the camera target regardless of distance, so
    // the anchor it picks must not change as the player zooms: a footprint
    // that jumped a tile on zoom would be a misplaced 600g tower.
    const want = { x: 0, y: 0 }
    groundToAnchor({ x: 7.3, z: 40.6 }, LANE16, 2, want)
    for (const [distance, pitch] of [[16, 70], [40, 70], [59, 70], [118, 70], [32, 56]] as const) {
      const camera = poseCamera(7.3, 40.6, distance, pitch, 18)
      const hit = screenToGround(camera, VIEW.width / 2, VIEW.height / 2, VIEW, out, ndc)
      expect(hit).not.toBeNull()
      expect(groundToAnchor(hit!, LANE16, 2, a), `distance ${distance}`).toEqual(want)
    }
  })
})
