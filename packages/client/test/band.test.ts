import { describe, it, expect } from 'vitest'
import { createState, insertTower, TowerKind, GRID_H, BUILD_ROW_MIN, GRID_W } from '@ltw/sim'
import { rowBand, towerSlotRange, inBand } from '../src/render/band'

/**
 * Culling by row (see render/band.ts). The tower search relies on the sim
 * keeping its list sorted by anchor index; if that ever stops being true the
 * range test below is the one that finds out.
 */
describe('rowBand', () => {
  it('widens the view by the margin and clamps to the lane', () => {
    const b = rowBand(30.2, 49.7, 3, GRID_H, { first: 0, last: 0 })
    expect(b).toEqual({ first: 27, last: 53 })
    expect(rowBand(-5, 12, 3, GRID_H, { first: 0, last: 0 })).toEqual({ first: 0, last: 15 })
    expect(rowBand(200, 400, 3, GRID_H, { first: 0, last: 0 })).toEqual({ first: 197, last: GRID_H - 1 })
  })

  it('never inverts', () => {
    const b = rowBand(500, 600, 0, GRID_H, { first: 0, last: 0 })
    expect(b.last).toBeGreaterThanOrEqual(b.first)
  })
})

describe('towerSlotRange', () => {
  function laneWithRows(rows: number[]) {
    const s = createState()
    const lane = s.lanes[0]!
    rows.forEach((r, i) => insertTower(lane, i + 1, (i * 2) % (GRID_W - 1), r, TowerKind.Single))
    return lane.towers
  }

  it('finds the contiguous run of towers inside the rows', () => {
    const towers = laneWithRows([BUILD_ROW_MIN, BUILD_ROW_MIN + 4, BUILD_ROW_MIN + 30, BUILD_ROW_MIN + 31, BUILD_ROW_MIN + 90])
    const r = towerSlotRange(towers, BUILD_ROW_MIN + 20, BUILD_ROW_MIN + 40, { start: 0, end: 0 })
    expect(r).toEqual({ start: 2, end: 4 })
    for (let i = r.start; i < r.end; i++) {
      expect(towers.anchorY[i]).toBeGreaterThanOrEqual(BUILD_ROW_MIN + 20)
      expect(towers.anchorY[i]).toBeLessThanOrEqual(BUILD_ROW_MIN + 40)
    }
  })

  it('is empty when no tower is in the band, and whole when all are', () => {
    const towers = laneWithRows([BUILD_ROW_MIN + 30, BUILD_ROW_MIN + 31])
    expect(towerSlotRange(towers, 0, 12, { start: 0, end: 0 })).toEqual({ start: 0, end: 0 })
    expect(towerSlotRange(towers, 200, 212, { start: 0, end: 0 })).toEqual({ start: 2, end: 2 })
    expect(towerSlotRange(towers, 0, GRID_H - 1, { start: 0, end: 0 })).toEqual({ start: 0, end: 2 })
  })

  it('agrees with a plain scan on a random-ish board', () => {
    const rows: number[] = []
    let x = 7
    for (let i = 0; i < 120; i++) {
      x = (x * 31 + 11) % 190
      rows.push(BUILD_ROW_MIN + x)
    }
    const towers = laneWithRows(rows)
    for (const [first, last] of [[0, 20], [40, 60], [100, 101], [150, 212], [0, 212]] as const) {
      const r = towerSlotRange(towers, first, last, { start: 0, end: 0 })
      let expected = 0
      for (let i = 0; i < towers.count; i++) {
        const y = towers.anchorY[i] as number
        if (y >= first && y <= last) expected += 1
      }
      expect(r.end - r.start, `${first}..${last}`).toBe(expected)
    }
  })
})

describe('inBand', () => {
  it('treats the band as rows, inclusive of the last row', () => {
    const band = { first: 10, last: 20 }
    expect(inBand(10, band)).toBe(true)
    expect(inBand(20.9, band)).toBe(true)
    expect(inBand(21, band)).toBe(false)
    expect(inBand(9.99, band)).toBe(false)
  })
})
