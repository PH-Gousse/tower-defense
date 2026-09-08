import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildBoard, BOARD, BOARD_DIM } from '../src/render/board'
import type { LaneLayout } from '../src/render/picking'

/**
 * The shared board renderer.
 *
 * Worth real tests rather than the source-text assertions the rest of this
 * suite falls back on: `board.ts` touches no DOM and no GL context, it just
 * builds geometry, so it runs headlessly like the picking maths does.
 *
 * The two properties that matter are both invisible in a screenshot. Tile
 * counts prove no row is silently dropped when the checkerboard parity or the
 * reserved rows change. The height ordering is the one that would rot quietly:
 * everything the player reads on top of the board -- hover, the selection and
 * range rings, the route lines -- sits at y >= 0.03, so a board element that
 * crept past that would z-fight with the feedback rather than with scenery.
 */

const LANE: LaneLayout = { originX: 0, originZ: 0, width: 8, length: 24, tile: 1 }
const ROWS = {
  entranceRow: 0,
  exitRow: 23,
  spawnTiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  exitTiles: [{ x: 6, y: 23 }, { x: 7, y: 23 }],
}

/** Instanced meshes in the group, keyed by their material colour. */
function meshesByColour(group: THREE.Group): Map<number, THREE.InstancedMesh> {
  const out = new Map<number, THREE.InstancedMesh>()
  for (const child of group.children) {
    if (!(child instanceof THREE.InstancedMesh)) continue
    const mat = child.material as THREE.MeshBasicMaterial
    out.set(mat.color.getHex(), child)
  }
  return out
}

describe('buildBoard', () => {
  it('covers every tile exactly once', () => {
    const m = meshesByColour(buildBoard(LANE, BOARD, ROWS))
    const light = m.get(BOARD.tileLight)!.count
    const dark = m.get(BOARD.tileDark)!.count
    const entrance = m.get(BOARD.entrance)!.count
    const exit = m.get(BOARD.exit)!.count
    expect(entrance).toBe(LANE.width)
    expect(exit).toBe(LANE.width)
    // The two reserved rows are whole rows; everything else is checkerboard.
    expect(light + dark).toBe(LANE.width * (LANE.length - 2))
    expect(light + dark + entrance + exit).toBe(LANE.width * LANE.length)
  })

  it('splits the checkerboard evenly on an even-width lane', () => {
    const m = meshesByColour(buildBoard(LANE, BOARD, ROWS))
    expect(m.get(BOARD.tileLight)!.count).toBe(m.get(BOARD.tileDark)!.count)
  })

  it('marks the tiles creeps actually use, on top of their row', () => {
    // The reserved rows span the full width, but only two tiles at each end
    // spawn and drain. Losing this would hide which corner creeps walk in from,
    // which is the whole reason a bare lane is 29 steps rather than 23.
    const m = meshesByColour(buildBoard(LANE, BOARD, ROWS))
    expect(m.get(BOARD.spawnMark)!.count).toBe(2)
    expect(m.get(BOARD.exitMark)!.count).toBe(2)
    expect(m.get(BOARD.spawnMark)!.position.y).toBeGreaterThan(m.get(BOARD.entrance)!.position.y)
    expect(m.get(BOARD.exitMark)!.position.y).toBeGreaterThan(m.get(BOARD.exit)!.position.y)
  })

  it('draws no marks when none are given -- the demo has no simulation', () => {
    const m = meshesByColour(buildBoard(LANE, BOARD, { entranceRow: 0, exitRow: 23 }))
    expect(m.has(BOARD.spawnMark)).toBe(false)
    expect(m.has(BOARD.exitMark)).toBe(false)
  })

  it('keeps every layer below the overlays that sit at 0.03', () => {
    const group = buildBoard(LANE, BOARD, ROWS)
    for (const child of group.children) {
      // LineSegments carries its height in the geometry, not the transform.
      if (child instanceof THREE.LineSegments) {
        const pos = child.geometry.getAttribute('position')
        for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeLessThan(0.03)
        continue
      }
      expect(child.position.y).toBeLessThan(0.03)
    }
  })

  it('sits at the lane origin, so a second lane offsets cleanly', () => {
    const offset: LaneLayout = { ...LANE, originX: 12 }
    expect(buildBoard(offset, BOARD, ROWS).position.x).toBe(12)
    expect(buildBoard(LANE, BOARD, ROWS).position.x).toBe(0)
  })

  it('gives the opponent the same shapes in a lower key', () => {
    // Both boards render full size -- reading their maze is how you counter-pick
    // -- so the only thing telling them apart is tone. Same counts, darker.
    const mine = meshesByColour(buildBoard(LANE, BOARD, ROWS))
    const theirs = meshesByColour(buildBoard(LANE, BOARD_DIM, ROWS))
    expect(theirs.get(BOARD_DIM.tileLight)!.count).toBe(mine.get(BOARD.tileLight)!.count)
    const lum = (hex: number) => (hex >> 16) + ((hex >> 8) & 255) + (hex & 255)
    for (const k of ['tileLight', 'tileDark', 'entrance', 'exit', 'border'] as const) {
      expect(lum(BOARD_DIM[k])).toBeLessThan(lum(BOARD[k]))
    }
  })
})
