import { describe, it, expect } from 'vitest'
import { CREEPS, CreepArchetypeKind, MAX_TIER } from '@ltw/sim'
import { artBand, creepScale, creepArtName, CREEP_VIEW_SCALE, MAX_ART_BAND, MAX_CREEP_SCALE } from '../src/render/creepBand'

/**
 * Placeholder look for the fourteen-rung ladder (ADR-0031) until issue #51
 * lands real art: each rung borrows its shape's old t1/t2/t3 model by band.
 */
describe('creep band placeholder', () => {
  it('draws rungs 1-5 as t1, 6-10 as t2 and 11-14 as t3', () => {
    const bands = CREEPS.map((c) => artBand(c.tier))
    expect(bands).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2])
  })

  it('never asks the catalogue for a band it has no model for, whatever the roster grows to', () => {
    expect(artBand(MAX_TIER)).toBe(MAX_ART_BAND)
    expect(artBand(1000)).toBe(MAX_ART_BAND)
    expect(artBand(-1)).toBe(0)
  })

  it('never draws a creep past the scale cap, where sizing by tier drew the top rung at 3.86x', () => {
    // The cap is on the band, which the view scale then multiplies (#51, and
    // the user's "make the units much bigger" on 2026-09-18).
    for (let tier = 0; tier <= 1000; tier++) {
      expect(creepScale(tier)).toBeLessThanOrEqual(MAX_CREEP_SCALE * CREEP_VIEW_SCALE)
    }
    expect(creepScale(0)).toBe(CREEP_VIEW_SCALE)
    expect(creepScale(MAX_TIER)).toBeGreaterThan(creepScale(0))
  })

  it('gives every ladder creep its own catalogue name, one design each (#51)', () => {
    const names = CREEPS.map((c) => creepArtName(c.key))
    expect(new Set(names).size).toBe(CREEPS.length)
    for (const n of names) expect(n).toMatch(/^[a-z0-9]+$/)
    expect(creepArtName('storm_drake')).toBe('stormdrake')
  })
})
