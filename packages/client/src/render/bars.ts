import * as THREE from 'three'
import { billboardQuad } from './effects'
import { ensureCapacity, spanningInstances, type InstanceParent } from '../instances'

/**
 * Health bars over damaged creeps.
 *
 * Two instanced quads per bar -- a dark backing and a coloured fill -- facing
 * the camera. Only creeps below full health get one, which is what Warcraft 3
 * does and which keeps a fresh wave from arriving under a hedge of green.
 *
 * The fill is scaled along x by the fraction and shifted so its left edge
 * stays put. Height is baked into the geometry rather than scaled, because the
 * quad is tilted to face the camera and a non-uniform scale in world y would
 * shear it.
 */

const W = 0.56
const H = 0.075
const c3 = new THREE.Color()
const m4 = new THREE.Matrix4()

export class HealthBars {
  private bg: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private fg: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private n = 0
  private readonly max: number
  private readonly parent: InstanceParent

  constructor(pitchDeg: number, initial: number, max: number, parent: InstanceParent) {
    this.max = max
    this.parent = parent
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x1a0c0c, depthTest: false, transparent: true, opacity: 0.85 })
    // Transparent too, not for its alpha but for its pass: three.js draws every
    // opaque object before any transparent one, so an opaque fill under a
    // transparent backing was painted first and then covered by it.
    const fgMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true })
    this.bg = new THREE.InstancedMesh(billboardQuad(pitchDeg, W + 0.04, H + 0.03), bgMat, initial)
    this.fg = new THREE.InstancedMesh(billboardQuad(pitchDeg, 1, H), fgMat, initial)
    for (const mesh of [this.bg, this.fg]) {
      mesh.count = 0
      mesh.renderOrder = mesh === this.fg ? 9 : 8
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      spanningInstances(mesh)
      parent.add(mesh)
    }
    this.fg.setColorAt(0, c3.setRGB(0, 1, 0))
  }

  /** Reserve room for at most `count` bars this frame, then start writing. */
  begin(count: number): void {
    this.bg = ensureCapacity(this.bg, count, this.max, this.parent)
    this.fg = ensureCapacity(this.fg, count, this.max, this.parent)
    this.n = 0
  }

  add(x: number, y: number, z: number, fraction: number): void {
    const i = this.n++
    this.bg.setMatrixAt(i, m4.makeTranslation(x, y, z))
    const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction
    m4.makeScale(f * W, 1, 1)
    m4.setPosition(x - ((1 - f) * W) / 2, y, z)
    this.fg.setMatrixAt(i, m4)
    // Green through amber to red, the way every RTS has done it.
    if (f > 0.5) c3.setRGB(1 - (f - 0.5) * 1.6, 0.85, 0.15)
    else c3.setRGB(0.95, f * 1.6, 0.12)
    this.fg.setColorAt(i, c3)
  }

  end(): void {
    this.bg.count = this.n
    this.fg.count = this.n
    this.bg.instanceMatrix.needsUpdate = true
    this.fg.instanceMatrix.needsUpdate = true
    if (this.fg.instanceColor) this.fg.instanceColor.needsUpdate = true
  }
}
