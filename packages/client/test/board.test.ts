import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildBoard, laneChunks, BOARD, BOARD_THEIRS, CHUNK_ROWS } from '../src/render/board'
import type { LaneLayout } from '../src/render/picking'
import type { LaneTextureOptions } from '../src/render/textures'
import { GRID_W, GRID_H, SPAWN_ROWS, EXIT_ROWS, TOWER_SIZE } from '@ltw/sim'

/**
 * The shared board renderer.
 *
 * Worth real tests rather than the source-text assertions the rest of this
 * suite falls back on: `board.ts` touches no DOM and no GL context once the
 * floor texture is stubbed, it just builds geometry, so it runs headlessly
 * like the picking maths does.
 *
 * The properties that matter are invisible in a screenshot. The floor slabs
 * must tile the lane exactly with no gap and no overlap, or a seam shows as
 * a line of sky; nothing inside the footprint may rise past the height the
 * overlays start at; the zones must be their own slabs so they can be their
 * own floors; and every build slab must share one texture, or the lane costs
 * eleven bakes instead of three.
 */

const LANE: LaneLayout = { originX: 0, originZ: 0, width: GRID_W, length: GRID_H, tile: 1 }
const ROWS = { spawnRows: SPAWN_ROWS, exitRows: EXIT_ROWS, towerSize: TOWER_SIZE }

/** A texture that needs no canvas, one per call so sharing is observable. */
const stub = () => new THREE.Texture()

function child<T extends THREE.Object3D>(group: THREE.Group, name: string): T {
  const c = group.getObjectByName(name)
  if (!c) throw new Error(`no child named ${name}`)
  return c as T
}

function floors(group: THREE.Group): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>[] {
  return group.children.filter((c) => c.name.startsWith('floor')) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>[]
}

describe('laneChunks', () => {
  it('tiles the lane exactly: zones whole, the build area in CHUNK_ROWS slabs', () => {
    const chunks = laneChunks(GRID_H, ROWS)
    expect(chunks[0]).toEqual({ zone: 'spawn', row: 0, rows: SPAWN_ROWS })
    expect(chunks[chunks.length - 1]).toEqual({ zone: 'exit', row: GRID_H - EXIT_ROWS, rows: EXIT_ROWS })
    let row = 0
    for (const c of chunks) {
      expect(c.row).toBe(row)
      expect(c.rows).toBeGreaterThan(0)
      if (c.zone === 'build') expect(c.rows).toBeLessThanOrEqual(CHUNK_ROWS)
      row += c.rows
    }
    expect(row).toBe(GRID_H)
  })

  it('keeps the checker parity across seams: full build slabs are an even number of rows', () => {
    expect(CHUNK_ROWS % 2).toBe(0)
    expect(CHUNK_ROWS % TOWER_SIZE).toBe(0)
  })

  it('handles a lane whose build area is not a multiple of the slab', () => {
    const chunks = laneChunks(10 + 45 + 3, ROWS)
    const build = chunks.filter((c) => c.zone === 'build')
    expect(build.map((c) => c.rows)).toEqual([20, 20, 5])
  })

  it('omits a zone of zero rows', () => {
    const chunks = laneChunks(40, { spawnRows: 0, exitRows: 0, towerSize: 2 })
    expect(chunks.every((c) => c.zone === 'build')).toBe(true)
  })
})

describe('buildBoard', () => {
  it('lays one floor slab per chunk, each over exactly its rows', () => {
    const group = buildBoard(LANE, BOARD, ROWS, stub)
    const chunks = laneChunks(GRID_H, ROWS)
    const slabs = floors(group)
    expect(slabs).toHaveLength(chunks.length)
    slabs.forEach((slab, i) => {
      const c = chunks[i]!
      expect(slab.geometry.parameters.width).toBe(LANE.width)
      expect(slab.geometry.parameters.height).toBe(c.rows)
      expect(slab.position.x).toBe(LANE.width / 2)
      expect(slab.position.z).toBeCloseTo(c.row + c.rows / 2, 9)
      expect(slab.userData).toEqual(c)
    })
  })

  it('leaves the slabs to cull themselves', () => {
    // The point of slabs: three.js can skip the ones off-screen. An instanced
    // mesh has that turned off for a good reason (instances.ts); a plain mesh
    // with a real bounding box must keep it.
    for (const slab of floors(buildBoard(LANE, BOARD, ROWS, stub))) {
      expect(slab.frustumCulled).toBe(true)
    }
  })

  it('keeps every floor below the overlays', () => {
    for (const slab of floors(buildBoard(LANE, BOARD, ROWS, stub))) {
      expect(slab.position.y).toBeLessThan(0.03)
    }
  })

  it('bakes each zone its own floor and shares one texture across the build slabs', () => {
    const seen: LaneTextureOptions[] = []
    const group = buildBoard(LANE, BOARD, ROWS, (o) => {
      seen.push(o)
      return new THREE.Texture()
    })
    // Spawn, one full build slab, and exit: three bakes for eleven slabs.
    expect(seen.map((o) => o.zone)).toEqual(['spawn', 'build', 'exit'])
    expect(seen[0]).toMatchObject({ width: GRID_W, rows: SPAWN_ROWS, zone: 'spawn', towerSize: TOWER_SIZE })
    expect(seen[1]).toMatchObject({ rows: CHUNK_ROWS, zone: 'build' })
    expect(seen[2]).toMatchObject({ rows: EXIT_ROWS, zone: 'exit' })
    const build = floors(group).filter((f) => f.userData.zone === 'build')
    const textures = new Set(build.map((f) => f.material.map))
    expect(build.length).toBeGreaterThan(1)
    expect(textures.size).toBe(1)
  })

  it('bakes a second texture only for a build remainder of a different size', () => {
    const seen: LaneTextureOptions[] = []
    buildBoard({ ...LANE, length: 10 + 45 + 3 }, BOARD, ROWS, (o) => {
      seen.push(o)
      return new THREE.Texture()
    })
    expect(seen.filter((o) => o.zone === 'build').map((o) => o.rows)).toEqual([20, 5])
  })

  it('kerbs the two long sides and leaves both ends open', () => {
    // The zones are where creeps arrive and leave; a wall across either end
    // would say the opposite.
    const kerb = child<THREE.InstancedMesh>(buildBoard(LANE, BOARD, ROWS, stub), 'kerb')
    expect(kerb.count).toBe(2 * LANE.length)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (let i = 0; i < kerb.count; i++) {
      kerb.getMatrixAt(i, m)
      p.setFromMatrixPosition(m)
      expect(p.x < 0 || p.x > LANE.width).toBe(true)
    }
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

  it('gives the kerb and posts a real bounding sphere, so they cull honestly', () => {
    const group = buildBoard(LANE, BOARD, ROWS, stub)
    for (const name of ['kerb', 'posts']) {
      const mesh = child<THREE.InstancedMesh>(group, name)
      expect(mesh.boundingSphere).not.toBeNull()
      expect(mesh.boundingSphere!.radius).toBeGreaterThan(0)
    }
  })

  it('sits at the lane origin, so a second lane offsets cleanly', () => {
    const offset: LaneLayout = { ...LANE, originX: 20 }
    expect(buildBoard(offset, BOARD, ROWS, stub).position.x).toBe(20)
    expect(buildBoard(LANE, BOARD, ROWS, stub).position.x).toBe(0)
  })

  it('gives the opponent the same shapes under a different banner', () => {
    const mine = buildBoard(LANE, BOARD, ROWS, stub)
    const theirs = buildBoard(LANE, BOARD_THEIRS, ROWS, stub)
    expect(child<THREE.InstancedMesh>(theirs, 'kerb').count).toBe(child<THREE.InstancedMesh>(mine, 'kerb').count)
    expect(floors(theirs)).toHaveLength(floors(mine).length)
    expect(BOARD_THEIRS.team).not.toBe(BOARD.team)
    expect(BOARD_THEIRS.light).toBeLessThan(BOARD.light)
  })
})
