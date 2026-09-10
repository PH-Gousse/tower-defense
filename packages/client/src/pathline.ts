import * as THREE from 'three'
import { GRID_W, TILE_COUNT, tileX, tileY } from '@ltw/sim'
import { groundQuad } from './render/effects'
import { spanningInstances } from './instances'

/**
 * A route drawn as chevrons marching along tile centres.
 *
 * Three of these exist: the dim one showing what creeps do now, the bright
 * one showing what they would do if you built on the tile under the cursor,
 * and the red one that appears where a creep just leaked. The difference
 * between the first two is the whole skill of mazing made visible -- the
 * `+54 tiles` number says how much longer, this says where.
 *
 * Chevrons rather than a line because a one-pixel `THREE.Line` vanished
 * against turf, and because the march says which WAY without an arrowhead.
 * Each chevron slides from its tile centre to the next over `MARCH_MS` and
 * wraps, so the whole route flows and the loop is seamless: where chevron i
 * ends is exactly where chevron i+1 started.
 *
 * Geometry is allocated once at full capacity and re-filled per update,
 * because this changes on every hovered tile and reallocating a buffer that
 * often is how you get a stuttering pointer.
 */
const MARCH_MS = 900
const m4 = new THREE.Matrix4()
const q4 = new THREE.Quaternion()
const v3 = new THREE.Vector3()
const s3 = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

export class PathLine {
  readonly object: THREE.InstancedMesh
  private readonly route = new Int32Array(TILE_COUNT)
  private len = 0
  private readonly size: number
  private readonly height: number

  constructor(texture: THREE.Texture, color: number, opacity: number, height: number, size = 0.5) {
    this.object = new THREE.InstancedMesh(
      groundQuad(),
      new THREE.MeshBasicMaterial({
        map: texture,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
      TILE_COUNT,
    )
    this.object.count = 0
    this.object.visible = false
    this.object.renderOrder = 3
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    spanningInstances(this.object)
    this.size = size
    this.height = height
  }

  set(route: readonly number[]): void {
    if (route.length < 2) {
      this.hide()
      return
    }
    this.len = Math.min(route.length, TILE_COUNT)
    for (let i = 0; i < this.len; i++) this.route[i] = route[i] as number
    this.object.visible = true
    this.update(0)
  }

  hide(): void {
    this.object.visible = false
    this.len = 0
    this.object.count = 0
  }

  /** Advance the march. Cheap enough to run every frame for every route. */
  update(nowMs: number): void {
    if (!this.object.visible || this.len < 2) return
    const phase = (nowMs % MARCH_MS) / MARCH_MS
    const n = this.len - 1
    for (let i = 0; i < n; i++) {
      const a = this.route[i] as number
      const b = this.route[i + 1] as number
      const ax = tileX(a) + 0.5
      const az = tileY(a) + 0.5
      const dx = tileX(b) + 0.5 - ax
      const dz = tileY(b) + 0.5 - az
      v3.set(ax + dx * phase, this.height, az + dz * phase)
      q4.setFromAxisAngle(UP, Math.atan2(-dz, dx))
      s3.set(this.size, 1, this.size)
      this.object.setMatrixAt(i, m4.compose(v3, q4, s3))
    }
    this.object.count = n
    this.object.instanceMatrix.needsUpdate = true
  }
}

export { GRID_W }
