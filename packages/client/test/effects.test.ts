import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { SpritePool, ProjectilePool, CorpsePool, CORPSE_MS, type Locate } from '../src/render/effects'
import type { Model } from '../src/render/models'

/**
 * The effect pools.
 *
 * Each is a fixed-capacity InstancedMesh fed from typed arrays, and the two
 * properties worth pinning are the ones a screenshot cannot show: an entry
 * lives exactly as long as it should and then frees its slot, and a full pool
 * degrades by recycling rather than by growing or throwing. Growth would be a
 * GPU reallocation mid-match; a throw would take the frame loop with it.
 */

const tex = new THREE.Texture()
const box = (): Model => ({ lit: new THREE.BoxGeometry(1, 1, 1), glow: null })

describe('SpritePool', () => {
  it('shows a sprite for its duration and then frees the slot', () => {
    const pool = new SpritePool({ texture: tex, capacity: 8 })
    pool.spawn(0, 0, 0, 1, 2, 0xffffff, 100, 1000)
    pool.update(1050)
    expect(pool.mesh.count).toBe(1)
    pool.update(1100)
    expect(pool.mesh.count).toBe(0)
  })

  it('recycles the oldest entry when full rather than growing', () => {
    const pool = new SpritePool({ texture: tex, capacity: 3 })
    for (let i = 0; i < 5; i++) pool.spawn(i, 0, 0, 1, 1, 0xffffff, 1000, 0)
    pool.update(1)
    expect(pool.mesh.count).toBe(3)
    expect(pool.mesh.instanceMatrix.count).toBe(3)
  })

  it('fades through the instance colour, never through a per-frame material change', () => {
    const pool = new SpritePool({ texture: tex, capacity: 2 })
    const mat = pool.mesh.material as THREE.MeshBasicMaterial
    const version = mat.version
    pool.spawn(0, 0, 0, 1, 1, 0xffffff, 100, 0)
    pool.update(10)
    pool.update(90)
    const c = new THREE.Color()
    pool.mesh.getColorAt(0, c)
    expect(c.r).toBeLessThan(0.2)
    expect(mat.version).toBe(version)
  })
})

describe('ProjectilePool', () => {
  const still: Locate = () => false

  it('lands after its flight time and reports where', () => {
    const pool = new ProjectilePool({ model: box(), capacity: 4, speed: 10, arc: 0, orient: false })
    pool.fire(0, 7, 0, 1, 0, 5, 0.3, 0, 0)
    const hits: number[][] = []
    pool.update(100, still, (lane, x, y, z) => hits.push([lane, x, y, z]))
    expect(hits).toEqual([])
    expect(pool.lit!.count).toBe(1)
    pool.update(600, still, (lane, x, y, z) => hits.push([lane, x, y, z]))
    expect(hits).toHaveLength(1)
    const [lane, x, y, z] = hits[0] as number[]
    expect(lane).toBe(0)
    expect(x).toBeCloseTo(5, 5)
    // Float32 storage: the value comes back as the nearest single.
    expect(y).toBeCloseTo(0.3, 5)
    expect(z).toBeCloseTo(0, 5)
    expect(pool.lit!.count).toBe(0)
  })

  it('chases a target that moves, and lands on it', () => {
    const pool = new ProjectilePool({ model: box(), capacity: 4, speed: 10, arc: 0, orient: true })
    pool.fire(1, 42, 0, 1, 0, 2, 0, 0, 0)
    const moving: Locate = (lane, id, out) => {
      if (lane !== 1 || id !== 42) return false
      out.set(3, 0, 1)
      return true
    }
    const hits: number[][] = []
    pool.update(100, moving, () => {})
    pool.update(1000, moving, (lane, x, y, z) => hits.push([lane, x, y, z]))
    expect(hits).toEqual([[1, 3, 0, 1]])
  })

  it('never flies for less than a visible instant', () => {
    const pool = new ProjectilePool({ model: box(), capacity: 4, speed: 1000, arc: 0, orient: false })
    pool.fire(0, 1, 0, 0, 0, 0.1, 0, 0, 0)
    let landed = false
    pool.update(30, still, () => { landed = true })
    expect(landed).toBe(false)
  })

  it('draws a glow-only model with no lit mesh at all', () => {
    const pool = new ProjectilePool({
      model: { lit: null, glow: new THREE.OctahedronGeometry(0.1) },
      capacity: 2,
      speed: 10,
      arc: 0,
      orient: false,
    })
    expect(pool.lit).toBeNull()
    expect(pool.glow).not.toBeNull()
  })
})

describe('CorpsePool', () => {
  it('keeps a corpse for CORPSE_MS and then removes it', () => {
    const lit = new THREE.MeshLambertMaterial()
    const glow = new THREE.MeshBasicMaterial()
    const pool = new CorpsePool(box(), lit, glow, 4)
    pool.add(1, 2, 0, 1, 1, 1, 1, 0)
    pool.update(CORPSE_MS - 1)
    expect(pool.lit!.count).toBe(1)
    pool.update(CORPSE_MS)
    expect(pool.lit!.count).toBe(0)
  })

  it('shares the living creep\'s material, so the corpse is the same creature', () => {
    const lit = new THREE.MeshLambertMaterial()
    const pool = new CorpsePool(box(), lit, new THREE.MeshBasicMaterial(), 4)
    expect(pool.lit!.material).toBe(lit)
  })
})
