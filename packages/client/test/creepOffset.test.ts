import { describe, it, expect } from 'vitest'
import { creepOffset, CREEP_OFFSET_RADIUS } from '../src/render/creepOffset'

/**
 * ADR-0021: separation is visual only and a pure function of the creep id.
 */
describe('creepOffset', () => {
  it('is a pure function of the id, so two clients draw the same crowd', () => {
    const a = creepOffset(4242, { x: 0, z: 0 })
    const b = creepOffset(4242, { x: 9, z: 9 })
    expect(b).toEqual(a)
  })

  it('stays inside the disc, so a creep in a one-wide slot never draws inside a tower', () => {
    for (let id = 1; id < 5000; id++) {
      const o = creepOffset(id, { x: 0, z: 0 })
      expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(CREEP_OFFSET_RADIUS + 1e-9)
    }
    expect(CREEP_OFFSET_RADIUS).toBeLessThan(0.5)
  })

  it('separates consecutive ids, which is what a burst of sends gets', () => {
    // Twenty-two creeps spawned by one decision get ids in a run. None of
    // them should land on another: twenty-two points in a disc of radius
    // 0.22 spread evenly sit about 0.02 apart at the closest.
    const pts = []
    for (let id = 100; id < 122; id++) pts.push(creepOffset(id, { x: 0, z: 0 }))
    let minGap = Infinity
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const g = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)
        if (g < minGap) minGap = g
      }
    }
    expect(minGap).toBeGreaterThan(0.015)
  })

  it('uses the whole disc rather than a ring or a spoke', () => {
    let inner = 0
    let quadrants = new Set<string>()
    for (let id = 1; id <= 400; id++) {
      const o = creepOffset(id, { x: 0, z: 0 })
      if (Math.hypot(o.x, o.z) < CREEP_OFFSET_RADIUS / 2) inner += 1
      quadrants.add(`${o.x >= 0}:${o.z >= 0}`)
    }
    // A quarter of the area is inside half the radius.
    expect(inner).toBeGreaterThan(60)
    expect(inner).toBeLessThan(140)
    expect(quadrants.size).toBe(4)
  })
})
