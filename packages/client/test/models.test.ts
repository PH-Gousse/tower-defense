import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { TowerKind, CreepArchetypeKind } from '@ltw/sim'
import {
  towerModel,
  creepModel,
  projectileModel,
  treeModel,
  kerbModel,
  postModel,
  muzzleHeight,
  creepHeight,
  type Model,
} from '../src/render/models'

/**
 * The procedural models.
 *
 * What a screenshot cannot check: that every model merges into geometry a
 * vertex-coloured material can draw, stands on the ground, and -- for towers
 * -- fits its tile. A tower that overhung its footprint would be clipped by
 * its neighbour in a dense maze, which is the normal state of a maze.
 */

const bounds = (g: THREE.BufferGeometry): THREE.Box3 => {
  g.computeBoundingBox()
  return g.boundingBox as THREE.Box3
}

function eachPart(m: Model, fn: (g: THREE.BufferGeometry) => void): void {
  if (m.lit) fn(m.lit)
  if (m.glow) fn(m.glow)
  expect(m.lit || m.glow).toBeTruthy()
}

const KINDS = [TowerKind.Single, TowerKind.Splash, TowerKind.Slow]
const CREEPS = [CreepArchetypeKind.Swarm, CreepArchetypeKind.Runner, CreepArchetypeKind.Tank]

describe('tower models', () => {
  it('carry a vertex colour and no uv, on every part', () => {
    for (const k of KINDS) {
      for (const level of [1, 2, 3]) {
        eachPart(towerModel(k, level), (g) => {
          expect(g.getAttribute('color')).toBeDefined()
          expect(g.getAttribute('uv')).toBeUndefined()
        })
      }
    }
  })

  it('stand on the ground and fit inside one tile', () => {
    for (const k of KINDS) {
      for (const level of [1, 2, 3]) {
        eachPart(towerModel(k, level), (g) => {
          const b = bounds(g)
          expect(b.min.y).toBeGreaterThanOrEqual(-0.01)
          expect(b.min.x).toBeGreaterThanOrEqual(-0.5)
          expect(b.max.x).toBeLessThanOrEqual(0.5)
          expect(b.min.z).toBeGreaterThanOrEqual(-0.5)
          expect(b.max.z).toBeLessThanOrEqual(0.5)
        })
      }
    }
  })

  it('grow with level, so a maze\'s strength reads from its skyline', () => {
    for (const k of KINDS) {
      const heights = [1, 2, 3].map((l) => {
        const m = towerModel(k, l)
        return Math.max(...[m.lit, m.glow].filter(Boolean).map((g) => bounds(g as THREE.BufferGeometry).max.y))
      })
      expect(heights[1]).toBeGreaterThan(heights[0] as number)
      expect(heights[2]).toBeGreaterThan(heights[1] as number)
    }
  })

  it('fire from somewhere inside the model', () => {
    for (const k of KINDS) {
      for (const level of [1, 2, 3]) {
        const m = towerModel(k, level)
        const top = Math.max(...[m.lit, m.glow].filter(Boolean).map((g) => bounds(g as THREE.BufferGeometry).max.y))
        const muzzle = muzzleHeight(k, level)
        expect(muzzle).toBeGreaterThan(0.3)
        expect(muzzle).toBeLessThanOrEqual(top + 0.05)
      }
    }
  })

  it('only the frost shrine glows', () => {
    expect(towerModel(TowerKind.Single, 1).glow).toBeNull()
    expect(towerModel(TowerKind.Splash, 1).glow).toBeNull()
    expect(towerModel(TowerKind.Slow, 1).glow).not.toBeNull()
  })
})

describe('creep models', () => {
  it('stand on the ground, face +x, and are about as tall as declared', () => {
    for (const k of CREEPS) {
      const m = creepModel(k)
      const b = bounds(m.lit as THREE.BufferGeometry)
      expect(b.min.y).toBeGreaterThanOrEqual(-0.01)
      // The eyes are the glow part, and they are ahead of the origin: that is
      // what "faces +x" means for the scene's heading rotation.
      expect(bounds(m.glow as THREE.BufferGeometry).min.x).toBeGreaterThan(0)
      expect(Math.abs(b.max.y - creepHeight(k))).toBeLessThan(0.2)
    }
  })

  it('have eyes that glow', () => {
    for (const k of CREEPS) expect(creepModel(k).glow).not.toBeNull()
  })

  it('are ordered swarm, runner, tank by size', () => {
    const h = CREEPS.map((k) => creepHeight(k))
    expect(h[0]).toBeLessThan(h[1] as number)
    expect(h[1]).toBeLessThan(h[2] as number)
  })
})

describe('projectiles and scenery', () => {
  it('every projectile kind has a drawable part', () => {
    for (const k of KINDS) eachPart(projectileModel(k), () => {})
  })

  it('the frost bolt is all glow', () => {
    const m = projectileModel(TowerKind.Slow)
    expect(m.lit).toBeNull()
    expect(m.glow).not.toBeNull()
  })

  it('scenery pieces stand on the ground', () => {
    for (const g of [treeModel(), kerbModel(), postModel(0), postModel(1)]) {
      expect(bounds(g).min.y).toBeGreaterThanOrEqual(-0.01)
    }
  })

  it('the kerb block is one tile long', () => {
    const b = bounds(kerbModel())
    expect(b.max.x - b.min.x).toBeCloseTo(1, 5)
  })
})
