import { describe, it, expect } from 'vitest'
import {
  GRID_W, GRID_H, SPAWN_ROWS, EXIT_ROW_MIN, EXIT_ROWS, LANE_GAP, BUILD_ROW_MIN,
  createState, insertTower, buildField, TowerKind,
} from '@ltw/sim'
import {
  spawnZoneCentre, exitZoneCentre, mirrorAcross, deepestCreep, highestLappers, nextLapper, clampToLane,
} from '../src/navigation'

/**
 * Where the jump hotkeys go (ADR-0024), without a camera.
 */
describe('landmarks', () => {
  it('centre on the zones', () => {
    expect(spawnZoneCentre({ x: 0, z: 0 })).toEqual({ x: GRID_W / 2, z: SPAWN_ROWS / 2 })
    expect(exitZoneCentre({ x: 0, z: 0 })).toEqual({ x: GRID_W / 2, z: EXIT_ROW_MIN + EXIT_ROWS / 2 })
  })

  it('mirror across to the other lane and back, keeping the row', () => {
    const x0 = 0
    const x1 = GRID_W + LANE_GAP
    // From inside your lane, across by the lane pitch.
    expect(mirrorAcross(5, x0, x1)).toBe(5 + x1)
    // From inside theirs, back.
    expect(mirrorAcross(x1 + 5, x0, x1)).toBe(5)
    // Twice is the identity.
    expect(mirrorAcross(mirrorAcross(11.5, x0, x1), x0, x1)).toBe(11.5)
    // The gap belongs to whichever lane is nearer.
    expect(mirrorAcross(GRID_W + 1, x0, x1)).toBe(GRID_W + 1 + x1)
  })
})

describe('the deepest creep', () => {
  function laneWith(creeps: Array<{ id: number; x: number; y: number; laps: number }>) {
    const s = createState()
    const lane = s.lanes[0]!
    // A wall with its gap on the right, so "nearest the exit" is not just "largest y".
    for (let ax = 0; ax + 2 <= GRID_W - 2; ax += 2) insertTower(lane, ax + 1, ax, BUILD_ROW_MIN + 20, TowerKind.Single)
    buildField(lane.blocked, lane.field)
    const c = lane.creeps
    c.count = creeps.length
    creeps.forEach((k, i) => {
      c.id[i] = k.id
      c.x[i] = k.x
      c.y[i] = k.y
      c.laps[i] = k.laps
    })
    return lane
  }

  it('is -1 in an empty lane', () => {
    expect(deepestCreep(createState().lanes[0]!)).toBe(-1)
    expect(highestLappers(createState().lanes[0]!)).toEqual([])
    expect(nextLapper(createState().lanes[0]!, [], -1)).toBe(-1)
  })

  it('prefers the highest lap over the furthest position', () => {
    const lane = laneWith([
      { id: 1, x: 3.5, y: 150.5, laps: 0 },
      { id: 2, x: 3.5, y: 12.5, laps: 1 },
    ])
    expect(deepestCreep(lane)).toBe(1)
  })

  it('among equal laps, takes the one nearest the exit by the field, not by row', () => {
    // Both above the wall. The one at the open right edge has the shorter walk.
    const lane = laneWith([
      { id: 1, x: 1.5, y: BUILD_ROW_MIN + 19.5, laps: 0 },
      { id: 2, x: GRID_W - 1.5, y: BUILD_ROW_MIN + 15.5, laps: 0 },
    ])
    expect(deepestCreep(lane)).toBe(1)
  })

  it('breaks a full tie on the lowest id', () => {
    const lane = laneWith([
      { id: 7, x: 3.5, y: 100.5, laps: 2 },
      { id: 4, x: 3.5, y: 100.5, laps: 2 },
    ])
    expect(deepestCreep(lane)).toBe(1)
  })

  it('cycles the highest lap in id order and wraps, by id rather than by slot', () => {
    const lane = laneWith([
      { id: 3, x: 1.5, y: 30.5, laps: 1 },
      { id: 5, x: 1.5, y: 40.5, laps: 1 },
      { id: 8, x: 1.5, y: 50.5, laps: 0 },
      { id: 9, x: 1.5, y: 60.5, laps: 1 },
    ])
    const lappers = highestLappers(lane)
    expect(lappers).toEqual([0, 1, 3])
    expect(nextLapper(lane, lappers, -1)).toBe(0)
    expect(nextLapper(lane, lappers, 3)).toBe(1)
    expect(nextLapper(lane, lappers, 5)).toBe(3)
    expect(nextLapper(lane, lappers, 9)).toBe(0)
    // The visited creep died: the cycle skips to the next id above it.
    expect(nextLapper(lane, lappers, 4)).toBe(1)
  })

  it('clamps a jump into the lane', () => {
    expect(clampToLane({ x: -2, z: 5 })).toEqual({ x: 0, z: 5 })
    expect(clampToLane({ x: 40, z: 500 })).toEqual({ x: GRID_W, z: GRID_H })
  })
})
