import * as THREE from 'three'
import type { GroundBounds } from './CameraRig'
import type { LaneLayout } from './picking'
import { grassTexture, seeded } from './textures'
import { treeModel, broadleafModel, rockModel } from './models'

/**
 * The world the lanes sit in: a grass field, a treeline, some rocks.
 *
 * None of it is interactive and none of it moves, so it is built once and
 * costs three draw calls for the whole forest. Its job is to stop the boards
 * floating in a void, which is what made the old renderer read as a debug
 * view however carefully the tiles were coloured.
 *
 * Trees keep clear of the lanes by a margin that depends on which side they
 * stand. The camera looks down the lane from the exit end, so a tree just past
 * the entrance leans INTO the board on screen by `height * tan(90 - pitch)`;
 * the entrance margin is wider than the others to absorb that.
 */

export interface TerrainOptions {
  readonly bounds: GroundBounds
  readonly lanes: readonly LaneLayout[]
  readonly seed?: number
}

const FIELD = 240

export function buildTerrain(o: TerrainOptions): THREE.Group {
  const group = new THREE.Group()
  const cx = (o.bounds.minX + o.bounds.maxX) / 2
  const cz = (o.bounds.minZ + o.bounds.maxZ) / 2

  const grass = grassTexture(5)
  grass.repeat.set(FIELD / 4, FIELD / 4)
  const groundGeo = new THREE.PlaneGeometry(FIELD, FIELD)
  groundGeo.rotateX(-Math.PI / 2)
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: grass }))
  ground.position.set(cx, -0.02, cz)
  ground.receiveShadow = true
  group.add(ground)

  const rnd = seeded(o.seed ?? 42)

  /** Is a point on ground any lane, kerb or approach would rather keep? */
  const nearLane = (x: number, z: number): boolean => {
    for (const lane of o.lanes) {
      const x0 = lane.originX - 1.4
      const x1 = lane.originX + lane.width * lane.tile + 1.4
      const z0 = lane.originZ - 2.6
      const z1 = lane.originZ + lane.length * lane.tile + 1.6
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true
    }
    return false
  }

  const spread = 30
  const scatter = (
    geo: THREE.BufferGeometry,
    count: number,
    minScale: number,
    maxScale: number,
    tries: number,
  ): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), count)
    mesh.castShadow = true
    mesh.receiveShadow = true
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    let n = 0
    for (let i = 0; i < tries && n < count; i++) {
      const x = cx + (rnd() - 0.5) * (o.bounds.maxX - o.bounds.minX + spread * 2)
      const z = cz + (rnd() - 0.5) * (o.bounds.maxZ - o.bounds.minZ + spread * 2)
      if (nearLane(x, z)) continue
      const sc = minScale + rnd() * (maxScale - minScale)
      p.set(x, 0, z)
      q.setFromAxisAngle(up, rnd() * Math.PI * 2)
      s.set(sc, sc * (0.9 + rnd() * 0.25), sc)
      mesh.setMatrixAt(n++, m.compose(p, q, s))
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    return mesh
  }

  group.add(scatter(treeModel(), 160, 0.8, 1.35, 4000))
  group.add(scatter(broadleafModel(), 70, 0.8, 1.2, 3000))
  group.add(scatter(rockModel(), 40, 0.6, 1.4, 2000))
  return group
}
