import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  nextCapacity, ensureCapacity, spanningInstances, INITIAL_INSTANCES,
} from '../src/instances'
import { fitGround, DEFAULT_FOV_DEG, DEFAULT_PITCH_DEG, DEFAULT_MAX_DISTANCE } from '../src/render/CameraRig'
import { railWidth } from '../src/chrome'

/**
 * Buffers that grow with the match rather than with the rule book.
 *
 * The simulation's creep cap is sized past anything gold can buy, so a player
 * never meets it. Handing that number to the GPU at page load is tens of
 * megabytes of empty buffers on every device, for creeps that will never exist.
 * The failure this guards is quiet in both directions: allocate too eagerly and
 * a phone pays for a ceiling it will never approach; grow too late and a creep
 * that exists is not drawn, which is the worst thing a game can hide.
 */

describe('nextCapacity', () => {
  it('leaves capacity alone when it already fits', () => {
    // The overwhelmingly common tick. The caller compares identity to skip the
    // reallocation entirely, so returning the same number matters.
    expect(nextCapacity(4096, 0, 65536)).toBe(4096)
    expect(nextCapacity(4096, 4096, 65536)).toBe(4096)
    expect(nextCapacity(4096, 4095, 65536)).toBe(4096)
  })

  it('doubles until it fits, rather than growing to exactly what was asked', () => {
    // One creep over the line must not mean a reallocation on the next creep
    // too. Doubling makes the number of reallocations logarithmic in the match.
    expect(nextCapacity(4096, 4097, 65536)).toBe(8192)
    expect(nextCapacity(4096, 8192, 65536)).toBe(8192)
    expect(nextCapacity(4096, 8193, 65536)).toBe(16384)
    expect(nextCapacity(4096, 40000, 65536)).toBe(65536)
  })

  it('never exceeds the cap, however much is asked for', () => {
    expect(nextCapacity(4096, 999_999, 65536)).toBe(65536)
    expect(nextCapacity(65536, 999_999, 65536)).toBe(65536)
  })

  it('grows from nothing without looping forever', () => {
    // A zero start would make the doubling loop stand still if it multiplied.
    expect(nextCapacity(0, 1, 65536)).toBe(1)
    expect(nextCapacity(0, 100, 65536)).toBe(128)
  })

  it('starts below anything an ordinary match reaches', () => {
    // The whole point of the default: a normal match never reallocates at all.
    expect(nextCapacity(INITIAL_INSTANCES, 500, 65536)).toBe(INITIAL_INSTANCES)
  })
})

/** A parent that records what was attached and detached, without a scene. */
function parent() {
  const children: THREE.Object3D[] = []
  return {
    children,
    add(c: THREE.Object3D) { children.push(c) },
    remove(c: THREE.Object3D) {
      const i = children.indexOf(c)
      if (i >= 0) children.splice(i, 1)
    },
  }
}

function mesh(capacity: number) {
  const m = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.3, 6, 5),
    new THREE.MeshBasicMaterial(),
    capacity,
  )
  m.count = 0
  return m
}

describe('ensureCapacity', () => {
  it('returns the same mesh when it already fits, allocating nothing', () => {
    const p = parent()
    const m = mesh(4096)
    p.add(m)
    expect(ensureCapacity(m, 4096, 65536, p)).toBe(m)
    expect(p.children).toEqual([m])
  })

  it('swaps in a bigger mesh and detaches the old one', () => {
    const p = parent()
    const m = mesh(4096)
    p.add(m)
    const grown = ensureCapacity(m, 5000, 65536, p)

    expect(grown).not.toBe(m)
    expect(grown.instanceMatrix.count).toBe(8192)
    // Exactly one mesh attached: a grow that forgot to detach would leave the
    // old buffer in the scene, drawing stale creeps over the live ones.
    expect(p.children).toEqual([grown])
  })

  it('keeps the geometry and material, which the caller still owns', () => {
    // They are shared with the replacement on purpose, so disposing the old
    // mesh must not take them with it.
    const p = parent()
    const m = mesh(4096)
    p.add(m)
    const grown = ensureCapacity(m, 9000, 65536, p)

    expect(grown.geometry).toBe(m.geometry)
    expect(grown.material).toBe(m.material)
    // Still usable: a disposed geometry has no attributes left to draw.
    expect(grown.geometry.getAttribute('position')).toBeDefined()
  })

  it('starts the new mesh empty rather than drawing uninitialised slots', () => {
    const p = parent()
    const m = mesh(4096)
    m.count = 4096
    p.add(m)
    const grown = ensureCapacity(m, 5000, 65536, p)
    // The caller rewrites every instance from the sim on the same frame, so a
    // non-zero count here would draw one frame of garbage before it did.
    expect(grown.count).toBe(0)
  })

  it('stops at the cap instead of growing without bound', () => {
    const p = parent()
    const m = mesh(65536)
    p.add(m)
    expect(ensureCapacity(m, 999_999, 65536, p)).toBe(m)
  })
})

/**
 * Frustum culling, and why every instanced mesh here opts out of it.
 *
 * This is a regression test for a bug that made every tower, creep, ghost and
 * lap pip disappear at once while the board and the overlays kept drawing --
 * and, worse, for a latent version of it that had been present the whole time
 * and was being held off by an accident of the layout.
 *
 * three.js fills `InstancedMesh.boundingSphere` lazily, on the first frustum
 * test, and `computeBoundingSphere` unions one sphere per instance over
 * `this.count`. On frame one `count` is 0, so the loop never runs, the sphere is
 * left empty -- centre (0,0,0), radius **-1** -- and the null check never fires
 * again, so it is cached that way for the life of the mesh.
 *
 * `intersectsSphere` uses `negRadius = -sphere.radius`, so radius -1 turns the
 * question into "is the mesh's LOCAL ORIGIN at least one world unit inside every
 * frustum plane?". That is not a fact about where the instances are. It happened
 * to hold while the HUD and palette were horizontal bars, because reserving
 * their height pushed the camera back and left the lane corner ~2.8 units inside
 * the frustum. Moving the chrome into side rails removed the vertical
 * reservation, tightened the fit, and cut that to ~0.5.
 */
describe('instanced meshes are not frustum culled', () => {
  const DEG = Math.PI / 180
  const VW = 1456
  const VH = 830
  const MARGIN = 1.06
  /** The content rectangle `frame()` fits in landscape: both lanes. */
  const RECT = { minX: 0, maxX: 20, minZ: 0, maxZ: 24 }

  /** `fitBounds` then `applyPose`, reproduced exactly enough to build a frustum. */
  function frustumFor(safeV: number, safeH: number, fovDeg: number, pitchDeg: number): THREE.Frustum {
    const cx = (RECT.minX + RECT.maxX) / 2
    const cz = (RECT.minZ + RECT.maxZ) / 2
    const halfW = ((RECT.maxX - RECT.minX) / 2) * MARGIN
    const halfD = ((RECT.maxZ - RECT.minZ) / 2) * MARGIN
    const usableY = Math.max(0.2, (VH - 2 * safeV) / VH)
    const usableX = Math.max(0.2, (VW - 2 * safeH) / VW)
    const t = Math.tan((fovDeg * DEG) / 2)
    const fovEff = 2 * Math.atan(t * usableY)
    const aspectEff = ((VW / VH) * usableX) / usableY
    const fit = fitGround(halfW, halfD, pitchDeg * DEG, fovEff, aspectEff)
    const d = Math.min(fit.distance, DEFAULT_MAX_DISTANCE)
    // Forward is -z at yaw 0, so the target sits back from the rect centre.
    const tz = cz + fit.shift
    const p = pitchDeg * DEG
    const cam = new THREE.PerspectiveCamera(fovDeg, VW / VH, 0.5, 500)
    cam.position.set(cx, Math.sin(p) * d, tz + Math.cos(p) * d)
    cam.lookAt(cx, 0, tz)
    cam.updateMatrixWorld()
    cam.updateProjectionMatrix()
    return new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    )
  }

  /** A tower mesh as `scene.ts` builds one: sphere computed while empty, then filled. */
  function towerMesh(): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.82, 1.1, 0.82),
      new THREE.MeshLambertMaterial(),
      192,
    )
    mesh.count = 0
    // What the renderer does on the first frame, before any tower is placed.
    mesh.computeBoundingSphere()
    const m = new THREE.Matrix4()
    for (let i = 0; i < 6; i++) {
      m.setPosition(3 + i, 0.55, 12)
      mesh.setMatrixAt(i, m)
    }
    mesh.count = 6
    return mesh
  }

  const RAIL = railWidth(VW, VH)

  it('caches an EMPTY bounding sphere, because count is 0 on the first frame', () => {
    // The root cause, stated as a fact about three.js rather than a suspicion.
    const mesh = towerMesh()
    expect(mesh.boundingSphere).not.toBeNull()
    expect(mesh.boundingSphere!.radius).toBe(-1)
    expect(mesh.boundingSphere!.center.equals(new THREE.Vector3(0, 0, 0))).toBe(true)
  })

  it('WOULD be culled in the rail layout if culling were left on', () => {
    // The bug, reproduced. Without this failing first, the fix below proves
    // nothing -- it would pass on a mesh that was never at risk.
    const mesh = towerMesh()
    expect(mesh.frustumCulled).toBe(true)
    const f = frustumFor(0, RAIL, DEFAULT_FOV_DEG, DEFAULT_PITCH_DEG)
    expect(f.intersectsObject(mesh)).toBe(false)
  })

  it('survives the rail layout once culling is off', () => {
    const mesh = towerMesh()
    spanningInstances(mesh)
    expect(mesh.frustumCulled).toBe(false)
  })

  it('was only ever safe by accident: the bars left the lane corner far enough in', () => {
    // Why this shipped undetected. The horizontal bars reserved ~68px of height,
    // which pushed the camera back and bought margin the rails do not.
    const origin = new THREE.Vector3(0, 0, 0)
    const inset = (f: THREE.Frustum): number =>
      Math.min(...f.planes.map((pl) => pl.distanceToPoint(origin)))

    const bars = inset(frustumFor(68, 0, DEFAULT_FOV_DEG, DEFAULT_PITCH_DEG))
    const rails = inset(frustumFor(0, RAIL, DEFAULT_FOV_DEG, DEFAULT_PITCH_DEG))
    // An empty sphere needs one full unit of clearance to pass.
    expect(bars).toBeGreaterThan(1)
    expect(rails).toBeLessThan(1)
  })

  it('was equally fragile at the old camera pose -- the chrome was the variable', () => {
    // Worth pinning: reverting the field of view would NOT have fixed this, so
    // nobody chases the camera when it resurfaces.
    const origin = new THREE.Vector3(0, 0, 0)
    const inset = (f: THREE.Frustum): number =>
      Math.min(...f.planes.map((pl) => pl.distanceToPoint(origin)))
    expect(inset(frustumFor(0, RAIL, 35, 56))).toBeLessThan(1)
    expect(inset(frustumFor(68, 0, 35, 56))).toBeGreaterThan(1)
  })

  it('keeps culling off across a capacity growth', () => {
    // `ensureCapacity` builds a replacement mesh; the opt-out has to come with
    // it or creeps vanish the first time the buffer doubles.
    const parent = new THREE.Group()
    let mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.3, 10, 8),
      new THREE.MeshLambertMaterial(),
      4,
    )
    spanningInstances(mesh)
    parent.add(mesh)
    mesh = ensureCapacity(mesh, 9, INITIAL_INSTANCES, parent)
    expect(mesh.instanceMatrix.count).toBeGreaterThanOrEqual(9)
    expect(mesh.frustumCulled).toBe(false)
  })
})
