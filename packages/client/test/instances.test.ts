import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { nextCapacity, ensureCapacity, INITIAL_INSTANCES } from '../src/instances'

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
