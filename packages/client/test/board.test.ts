import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildBoard, BOARD, BOARD_THEIRS } from '../src/render/board'
import type { LaneLayout } from '../src/render/picking'

/**
 * The shared board renderer.
 *
 * Worth real tests rather than the source-text assertions the rest of this
 * suite falls back on: `board.ts` touches no DOM and no GL context once the
 * floor texture is stubbed, it just builds geometry, so it runs headlessly
 * like the picking maths does.
 *
 * The properties that matter are invisible in a screenshot. The floor must
 * cover the lane exactly, and nothing inside the footprint may rise past the
 * height the overlays start at, or it z-fights with the feedback the player is
 * reading. The kerb must leave gaps where creeps enter and leave, because the
 * gaps are the only hint the floor does not already give about direction.
 */

const LANE: LaneLayout = { originX: 0, originZ: 0, width: 8, length: 24, tile: 1 }
const ROWS = {
  entranceRow: 0,
  exitRow: 23,
  spawnTiles: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  exitTiles: [{ x: 6, y: 23 }, { x: 7, y: 23 }],
}

/** A texture that needs no canvas. */
const stub = () => new THREE.Texture()

function child<T extends THREE.Object3D>(group: THREE.Group, name: string): T {
  const c = group.getObjectByName(name)
  if (!c) throw new Error(`no child named ${name}`)
  return c as T
}

describe('buildBoard', () => {
  it('lays one floor quad over exactly the lane', () => {
    const floor = child<THREE.Mesh<THREE.PlaneGeometry>>(buildBoard(LANE, BOARD, ROWS, stub), 'floor')
    expect(floor.geometry.parameters.width).toBe(LANE.width)
    expect(floor.geometry.parameters.height).toBe(LANE.length)
    expect(floor.position.x).toBe(LANE.width / 2)
    expect(floor.position.z).toBe(LANE.length / 2)
  })

  it('keeps the floor below the overlays', () => {
    const floor = child<THREE.Mesh>(buildBoard(LANE, BOARD, ROWS, stub), 'floor')
    expect(floor.position.y).toBeLessThan(0.03)
  })

  it('bakes the entrance, exit and used tiles into the floor texture', () => {
    let seen: unknown = null
    buildBoard(LANE, BOARD, ROWS, (o) => {
      seen = o
      return new THREE.Texture()
    })
    expect(seen).toMatchObject({
      width: 8,
      length: 24,
      entranceRow: 0,
      exitRow: 23,
      spawnTiles: ROWS.spawnTiles,
      exitTiles: ROWS.exitTiles,
    })
  })

  it('rings the lane with a kerb, gapped where creeps enter and leave', () => {
    const kerb = child<THREE.InstancedMesh>(buildBoard(LANE, BOARD, ROWS, stub), 'kerb')
    const edge = 2 * LANE.width + 2 * LANE.length
    expect(kerb.count).toBe(edge - ROWS.spawnTiles.length - ROWS.exitTiles.length)
  })

  it('closes the kerb when no tiles are marked as used', () => {
    const kerb = child<THREE.InstancedMesh>(
      buildBoard(LANE, BOARD, { entranceRow: 0, exitRow: 23 }, stub),
      'kerb',
    )
    expect(kerb.count).toBe(2 * LANE.width + 2 * LANE.length)
  })

  it('keeps the kerb and posts outside the footprint', () => {
    const group = buildBoard(LANE, BOARD, ROWS, stub)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (const name of ['kerb', 'posts']) {
      const mesh = child<THREE.InstancedMesh>(group, name)
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m)
        p.setFromMatrixPosition(m)
        const inside = p.x > 0 && p.x < LANE.width && p.z > 0 && p.z < LANE.length
        expect(inside).toBe(false)
      }
    }
  })

  it('sits at the lane origin, so a second lane offsets cleanly', () => {
    const offset: LaneLayout = { ...LANE, originX: 12 }
    expect(buildBoard(offset, BOARD, ROWS, stub).position.x).toBe(12)
    expect(buildBoard(LANE, BOARD, ROWS, stub).position.x).toBe(0)
  })

  it('gives the opponent the same shapes under a different banner', () => {
    // Both boards render full size -- reading their maze is how you counter-pick
    // -- so what tells them apart is the banner and a shade of turf, not size.
    const mine = buildBoard(LANE, BOARD, ROWS, stub)
    const theirs = buildBoard(LANE, BOARD_THEIRS, ROWS, stub)
    expect(child<THREE.InstancedMesh>(theirs, 'kerb').count).toBe(child<THREE.InstancedMesh>(mine, 'kerb').count)
    expect(BOARD_THEIRS.team).not.toBe(BOARD.team)
    expect(BOARD_THEIRS.light).toBeLessThan(BOARD.light)
  })
})
