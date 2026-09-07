import { describe, it, expect } from 'vitest'
import { buildField, UNREACHABLE } from '../src/field'
import { pathFrom } from '../src/path'
import {
  TILE_COUNT,
  GRID_W,
  GRID_H,
  SPAWN_INDICES,
  EXIT_INDICES,
  tileIndex,
} from '../src/grid'

const empty = () => new Uint8Array(TILE_COUNT)
const spawn = SPAWN_INDICES[0] as number

describe('pathFrom', () => {
  it('walks an empty lane straight to the exit', () => {
    const p = pathFrom(buildField(empty()), spawn)
    expect(p[0]).toBe(spawn)
    expect(EXIT_INDICES).toContain(p[p.length - 1])
    // 39 steps from x=0 to x=39, so 40 tiles inclusive.
    expect(p.length).toBe(GRID_W)
  })

  it('returns an empty route when the lane is sealed', () => {
    const b = empty()
    for (let y = 0; y < GRID_H; y++) b[tileIndex({ x: 20, y })] = 1
    const f = buildField(b)
    expect(f.dist[spawn]).toBe(UNREACHABLE)
    expect(pathFrom(f, spawn)).toEqual([])
  })

  it('is exactly as long as the maze score claims', () => {
    const b = empty()
    for (let y = 2; y < GRID_H; y++) b[tileIndex({ x: 12, y })] = 1
    for (let y = 0; y < GRID_H - 2; y++) b[tileIndex({ x: 24, y })] = 1
    const f = buildField(b)
    const p = pathFrom(f, spawn)
    // dist counts steps; the route counts tiles, so it is one longer.
    expect(p.length).toBe((f.dist[spawn] as number) + 1)
  })

  it('never revisits a tile — dist strictly decreases along the walk', () => {
    const b = empty()
    for (let y = 4; y < 20; y++) b[tileIndex({ x: 15, y })] = 1
    const f = buildField(b)
    const p = pathFrom(f, spawn)
    expect(new Set(p).size).toBe(p.length)
    for (let i = 1; i < p.length; i++) {
      expect(f.dist[p[i] as number] as number).toBe((f.dist[p[i - 1] as number] as number) - 1)
    }
  })

  it('reuses the caller array without leaking the previous route', () => {
    const out: number[] = []
    const long = pathFrom(buildField(empty()), spawn, out)
    const lenLong = long.length
    const b = empty()
    for (let y = 0; y < GRID_H; y++) b[tileIndex({ x: 20, y })] = 1
    const sealed = pathFrom(buildField(b), spawn, out)
    expect(lenLong).toBeGreaterThan(0)
    expect(sealed.length).toBe(0)
  })
})
