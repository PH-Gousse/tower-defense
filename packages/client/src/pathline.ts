import * as THREE from 'three'
import { GRID_W, TILE_COUNT, tileX, tileY } from '@ltw/sim'

/**
 * A route drawn along tile centres.
 *
 * Two of these exist: the dim one showing what creeps do now, and the bright
 * one showing what they would do if you built on the tile under the cursor.
 * The difference between them is the whole skill of mazing made visible — the
 * `+54 tiles` number says how much longer, this says where.
 *
 * Geometry is allocated once at full capacity and re-filled per update, because
 * this changes on every hovered tile and reallocating a BufferGeometry that
 * often is how you get a stuttering pointer.
 */
export class PathLine {
  readonly object: THREE.Line
  private readonly positions: Float32Array
  private readonly geometry: THREE.BufferGeometry

  constructor(color: number, opacity: number, height: number) {
    this.positions = new Float32Array(TILE_COUNT * 3)
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setDrawRange(0, 0)
    this.object = new THREE.Line(
      this.geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    )
    this.object.position.y = height
    this.object.visible = false
    this.object.renderOrder = 2
  }

  set(route: readonly number[]): void {
    if (route.length < 2) {
      this.object.visible = false
      this.geometry.setDrawRange(0, 0)
      return
    }
    for (let i = 0; i < route.length; i++) {
      const t = route[i] as number
      this.positions[i * 3] = tileX(t) + 0.5
      this.positions[i * 3 + 1] = 0
      this.positions[i * 3 + 2] = tileY(t) + 0.5
    }
    this.geometry.setDrawRange(0, route.length)
    const attr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    attr.needsUpdate = true
    this.geometry.computeBoundingSphere()
    this.object.visible = true
  }

  hide(): void {
    this.object.visible = false
  }
}

export { GRID_W }
