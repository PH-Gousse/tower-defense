import { describe, it, expect } from 'vitest'
import { edgeFor, ALERT_TTL } from '../src/alerts'

/**
 * Off-screen alert classification (ADR-0024). The DOM half is a browser
 * matter; which edge an event is beyond is arithmetic, and it is the part
 * that would point the player the wrong way.
 */
describe('edgeFor', () => {
  const view = { minX: 2, minZ: 30, maxX: 20, maxZ: 50 }

  it('is null for a point inside the view, edges included', () => {
    expect(edgeFor(8, 40, view)).toBeNull()
    expect(edgeFor(2, 30, view)).toBeNull()
    expect(edgeFor(20, 50, view)).toBeNull()
  })

  it('points up the lane for an event above the view, down for one below', () => {
    // Above is toward the spawn (smaller z), which is the top of the screen.
    expect(edgeFor(8, 10, view)).toEqual({ dx: 0, dz: -1 })
    expect(edgeFor(8, 200, view)).toEqual({ dx: 0, dz: 1 })
  })

  it('points across for an event in the other lane at the same rows', () => {
    expect(edgeFor(30, 40, view)).toEqual({ dx: 1, dz: 0 })
    expect(edgeFor(-5, 40, view)).toEqual({ dx: -1, dz: 0 })
  })

  it('carries both axes when the event is off in both', () => {
    expect(edgeFor(30, 200, view)).toEqual({ dx: 1, dz: 1 })
    expect(edgeFor(-1, 0, view)).toEqual({ dx: -1, dz: -1 })
  })

  it('lets a leak linger longer than fire', () => {
    // Fire is refreshed while it lasts; a leak has to be noticed after the fact.
    expect(ALERT_TTL.leak).toBeGreaterThan(ALERT_TTL.fire * 2)
  })
})
