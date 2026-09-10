import * as THREE from 'three'
import type { Model } from './models'
import { spanningInstances } from '../instances'

/**
 * Everything that happens for a moment and then is gone: projectiles, hits,
 * puffs, corpses.
 *
 * The sim has none of these. Damage is instant and a dead creep is simply
 * absent from the next tick, which is right for a deterministic rule set and
 * wrong for a player, who needs to see the shot that killed the thing. So the
 * renderer infers events by comparing two ticks -- a cooldown that jumped back
 * up is a shot, an id that vanished is a death -- and plays them out here over
 * a few hundred milliseconds of wall time.
 *
 * Every pool is a fixed-capacity InstancedMesh with its state in typed arrays,
 * updated in place. Nothing here allocates after construction; when a pool is
 * full the oldest entry is overwritten, which under a mass send is invisible
 * and under normal play never happens.
 */

const DEG = Math.PI / 180
const X_AXIS = new THREE.Vector3(1, 0, 0)
const m4 = new THREE.Matrix4()
const q4 = new THREE.Quaternion()
const v3 = new THREE.Vector3()
const s3 = new THREE.Vector3()
const c3 = new THREE.Color()

/**
 * A unit quad that faces the camera.
 *
 * The rig's pitch and yaw are fixed during play, so a billboard is a plane
 * rotated once at construction rather than a per-instance `lookAt`. Rotating
 * the geometry about x by `-pitch` turns the plane's +z normal into
 * `(0, sin pitch, cos pitch)`, which points straight back up the gaze.
 */
export function billboardQuad(pitchDeg: number, w = 1, h = 1): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h)
  g.rotateX(-pitchDeg * DEG)
  return g
}

/** A unit quad lying flat on the ground, +x along the texture's +x. */
export function groundQuad(w = 1, h = 1): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h)
  g.rotateX(-Math.PI / 2)
  return g
}

export interface SpriteOptions {
  readonly texture: THREE.Texture
  readonly capacity: number
  /** Face the camera at this pitch, or lie on the ground when omitted. */
  readonly pitchDeg?: number
  readonly blending?: THREE.Blending
  readonly opacity?: number
}

/**
 * Short-lived textured quads: hits, flashes, dust, shockwaves.
 *
 * Fade is done through `instanceColor`. Under additive blending a colour
 * scaled toward black IS a fade, so no per-instance opacity is needed; under
 * normal blending the material carries a fixed opacity and the colour fades
 * toward the ground's own tone, which reads as settling rather than vanishing.
 */
export class SpritePool {
  readonly mesh: THREE.InstancedMesh
  private readonly cap: number
  private n = 0
  private next = 0
  private readonly t0: Float64Array
  private readonly dur: Float32Array
  private readonly px: Float32Array
  private readonly py: Float32Array
  private readonly pz: Float32Array
  private readonly size0: Float32Array
  private readonly size1: Float32Array
  private readonly cr: Float32Array
  private readonly cg: Float32Array
  private readonly cb: Float32Array
  private readonly rise: Float32Array

  constructor(o: SpriteOptions) {
    this.cap = o.capacity
    const geo = o.pitchDeg === undefined ? groundQuad() : billboardQuad(o.pitchDeg)
    const mat = new THREE.MeshBasicMaterial({
      map: o.texture,
      transparent: true,
      depthWrite: false,
      blending: o.blending ?? THREE.AdditiveBlending,
      opacity: o.opacity ?? 1,
    })
    this.mesh = new THREE.InstancedMesh(geo, mat, o.capacity)
    this.mesh.count = 0
    this.mesh.renderOrder = 4
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    spanningInstances(this.mesh)
    // Touch the colour buffer once so it exists before the first frame reads it.
    this.mesh.setColorAt(0, c3.setRGB(0, 0, 0))
    const n = o.capacity
    this.t0 = new Float64Array(n)
    this.dur = new Float32Array(n)
    this.px = new Float32Array(n)
    this.py = new Float32Array(n)
    this.pz = new Float32Array(n)
    this.size0 = new Float32Array(n)
    this.size1 = new Float32Array(n)
    this.cr = new Float32Array(n)
    this.cg = new Float32Array(n)
    this.cb = new Float32Array(n)
    this.rise = new Float32Array(n)
  }

  spawn(
    x: number,
    y: number,
    z: number,
    size0: number,
    size1: number,
    colour: number,
    durationMs: number,
    nowMs: number,
    rise = 0,
  ): void {
    let i: number
    if (this.n < this.cap) {
      i = this.n++
    } else {
      i = this.next
      this.next = (this.next + 1) % this.cap
    }
    c3.setHex(colour)
    this.t0[i] = nowMs
    this.dur[i] = durationMs
    this.px[i] = x
    this.py[i] = y
    this.pz[i] = z
    this.size0[i] = size0
    this.size1[i] = size1
    this.cr[i] = c3.r
    this.cg[i] = c3.g
    this.cb[i] = c3.b
    this.rise[i] = rise
  }

  update(nowMs: number): void {
    let i = 0
    while (i < this.n) {
      const t = (nowMs - (this.t0[i] as number)) / (this.dur[i] as number)
      if (t >= 1) {
        this.remove(i)
        continue
      }
      // Quick in, slow out: bright on the first frame, then a long tail.
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85
      const size = (this.size0[i] as number) + ((this.size1[i] as number) - (this.size0[i] as number)) * t
      v3.set(this.px[i] as number, (this.py[i] as number) + (this.rise[i] as number) * t, this.pz[i] as number)
      s3.set(size, size, size)
      q4.identity()
      this.mesh.setMatrixAt(i, m4.compose(v3, q4, s3))
      this.mesh.setColorAt(i, c3.setRGB((this.cr[i] as number) * fade, (this.cg[i] as number) * fade, (this.cb[i] as number) * fade))
      i++
    }
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  private remove(i: number): void {
    const last = this.n - 1
    if (i !== last) {
      this.t0[i] = this.t0[last] as number
      this.dur[i] = this.dur[last] as number
      this.px[i] = this.px[last] as number
      this.py[i] = this.py[last] as number
      this.pz[i] = this.pz[last] as number
      this.size0[i] = this.size0[last] as number
      this.size1[i] = this.size1[last] as number
      this.cr[i] = this.cr[last] as number
      this.cg[i] = this.cg[last] as number
      this.cb[i] = this.cb[last] as number
      this.rise[i] = this.rise[last] as number
    }
    this.n = last
    if (this.next > this.n) this.next = 0
  }
}

/** Where a creep is being drawn right now, by lane and id. False if it is gone. */
export type Locate = (lane: number, id: number, out: THREE.Vector3) => boolean

export interface ProjectileOptions {
  readonly model: Model
  readonly capacity: number
  /** Tiles per second. */
  readonly speed: number
  /** Peak height of the lob, as a fraction of the distance. 0 flies straight. */
  readonly arc: number
  /** Turn the model along its flight. Arrows do; cannonballs need not. */
  readonly orient: boolean
}

/**
 * Projectiles that chase their target.
 *
 * Homing rather than ballistic, because the sim already resolved the hit: the
 * shot lands, whatever the creep does in the meantime. A projectile that could
 * miss would be lying about the rules. If the target dies before arrival --
 * from this shot, usually -- the projectile finishes its flight to the last
 * place the creep was drawn, which is where its corpse is.
 */
export class ProjectilePool {
  readonly lit: THREE.InstancedMesh | null
  readonly glow: THREE.InstancedMesh | null
  private readonly cap: number
  private readonly speed: number
  private readonly arc: number
  private readonly orient: boolean
  private n = 0
  private next = 0
  private readonly t0: Float64Array
  private readonly dur: Float32Array
  private readonly sx: Float32Array
  private readonly sy: Float32Array
  private readonly sz: Float32Array
  private readonly tx: Float32Array
  private readonly ty: Float32Array
  private readonly tz: Float32Array
  private readonly lx: Float32Array
  private readonly ly: Float32Array
  private readonly lz: Float32Array
  private readonly lane: Int8Array
  private readonly target: Int32Array

  constructor(o: ProjectileOptions) {
    this.cap = o.capacity
    this.speed = o.speed
    this.arc = o.arc
    this.orient = o.orient
    const make = (g: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(g, mat, o.capacity)
      mesh.count = 0
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      spanningInstances(mesh)
      return mesh
    }
    this.lit = o.model.lit
      ? make(o.model.lit, new THREE.MeshLambertMaterial({ vertexColors: true }))
      : null
    this.glow = o.model.glow
      ? make(o.model.glow, new THREE.MeshBasicMaterial({ vertexColors: true }))
      : null
    if (this.lit) this.lit.castShadow = true
    const n = o.capacity
    this.t0 = new Float64Array(n)
    this.dur = new Float32Array(n)
    this.sx = new Float32Array(n)
    this.sy = new Float32Array(n)
    this.sz = new Float32Array(n)
    this.tx = new Float32Array(n)
    this.ty = new Float32Array(n)
    this.tz = new Float32Array(n)
    this.lx = new Float32Array(n)
    this.ly = new Float32Array(n)
    this.lz = new Float32Array(n)
    this.lane = new Int8Array(n)
    this.target = new Int32Array(n)
  }

  fire(
    lane: number,
    targetId: number,
    sx: number,
    sy: number,
    sz: number,
    tx: number,
    ty: number,
    tz: number,
    nowMs: number,
  ): void {
    let i: number
    if (this.n < this.cap) i = this.n++
    else {
      i = this.next
      this.next = (this.next + 1) % this.cap
    }
    const dx = tx - sx
    const dz = tz - sz
    const dist = Math.sqrt(dx * dx + dz * dz)
    this.t0[i] = nowMs
    this.dur[i] = Math.max(70, (dist / this.speed) * 1000)
    this.sx[i] = sx
    this.sy[i] = sy
    this.sz[i] = sz
    this.tx[i] = tx
    this.ty[i] = ty
    this.tz[i] = tz
    this.lx[i] = sx
    this.ly[i] = sy
    this.lz[i] = sz
    this.lane[i] = lane
    this.target[i] = targetId
  }

  update(nowMs: number, locate: Locate, onHit: (lane: number, x: number, y: number, z: number) => void): void {
    let i = 0
    while (i < this.n) {
      const t = (nowMs - (this.t0[i] as number)) / (this.dur[i] as number)
      if (t >= 1) {
        onHit(this.lane[i] as number, this.tx[i] as number, this.ty[i] as number, this.tz[i] as number)
        this.remove(i)
        continue
      }
      // Chase: refresh the destination from wherever the creep is drawn now.
      if (locate(this.lane[i] as number, this.target[i] as number, v3)) {
        this.tx[i] = v3.x
        this.ty[i] = v3.y
        this.tz[i] = v3.z
      }
      const sx = this.sx[i] as number
      const sy = this.sy[i] as number
      const sz = this.sz[i] as number
      const dx = (this.tx[i] as number) - sx
      const dy = (this.ty[i] as number) - sy
      const dz = (this.tz[i] as number) - sz
      const x = sx + dx * t
      const z = sz + dz * t
      const lob = this.arc * Math.sqrt(dx * dx + dz * dz) * Math.sin(Math.PI * t)
      const y = sy + dy * t + lob

      v3.set(x, y, z)
      if (this.orient) {
        // Along the last frame's movement. On the first frame that is the
        // launch direction, which is what an arrow leaving a tower looks like.
        s3.set(x - (this.lx[i] as number), y - (this.ly[i] as number), z - (this.lz[i] as number))
        if (s3.lengthSq() < 1e-8) s3.set(dx, dy, dz)
        s3.normalize()
        q4.setFromUnitVectors(X_AXIS, s3)
      } else {
        q4.identity()
      }
      this.lx[i] = x
      this.ly[i] = y
      this.lz[i] = z
      s3.set(1, 1, 1)
      m4.compose(v3, q4, s3)
      if (this.lit) this.lit.setMatrixAt(i, m4)
      if (this.glow) this.glow.setMatrixAt(i, m4)
      i++
    }
    if (this.lit) {
      this.lit.count = this.n
      this.lit.instanceMatrix.needsUpdate = true
    }
    if (this.glow) {
      this.glow.count = this.n
      this.glow.instanceMatrix.needsUpdate = true
    }
  }

  private remove(i: number): void {
    const last = this.n - 1
    if (i !== last) {
      this.t0[i] = this.t0[last] as number
      this.dur[i] = this.dur[last] as number
      this.sx[i] = this.sx[last] as number
      this.sy[i] = this.sy[last] as number
      this.sz[i] = this.sz[last] as number
      this.tx[i] = this.tx[last] as number
      this.ty[i] = this.ty[last] as number
      this.tz[i] = this.tz[last] as number
      this.lx[i] = this.lx[last] as number
      this.ly[i] = this.ly[last] as number
      this.lz[i] = this.lz[last] as number
      this.lane[i] = this.lane[last] as number
      this.target[i] = this.target[last] as number
    }
    this.n = last
    if (this.next > this.n) this.next = 0
  }
}

/** How long a corpse stays before it has sunk out of sight. */
export const CORPSE_MS = 1400

/**
 * Dead creeps, falling over and sinking into the turf.
 *
 * Shares the live creep's geometry and material, so a corpse is exactly the
 * creature that was just walking, frozen at its last heading. The sim removes
 * a creep the tick it dies; without this the field would blink.
 */
export class CorpsePool {
  readonly lit: THREE.InstancedMesh | null
  readonly glow: THREE.InstancedMesh | null
  private readonly cap: number
  private n = 0
  private next = 0
  private readonly t0: Float64Array
  private readonly px: Float32Array
  private readonly pz: Float32Array
  private readonly heading: Float32Array
  private readonly scale: Float32Array
  private readonly cr: Float32Array
  private readonly cg: Float32Array
  private readonly cb: Float32Array

  constructor(model: Model, litMaterial: THREE.Material, glowMaterial: THREE.Material, capacity: number) {
    this.cap = capacity
    const make = (g: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(g, mat, capacity)
      mesh.count = 0
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.setColorAt(0, c3.setRGB(1, 1, 1))
      spanningInstances(mesh)
      return mesh
    }
    this.lit = model.lit ? make(model.lit, litMaterial) : null
    this.glow = model.glow ? make(model.glow, glowMaterial) : null
    if (this.lit) this.lit.castShadow = true
    this.t0 = new Float64Array(capacity)
    this.px = new Float32Array(capacity)
    this.pz = new Float32Array(capacity)
    this.heading = new Float32Array(capacity)
    this.scale = new Float32Array(capacity)
    this.cr = new Float32Array(capacity)
    this.cg = new Float32Array(capacity)
    this.cb = new Float32Array(capacity)
  }

  add(x: number, z: number, heading: number, scale: number, r: number, g: number, b: number, nowMs: number): void {
    let i: number
    if (this.n < this.cap) i = this.n++
    else {
      i = this.next
      this.next = (this.next + 1) % this.cap
    }
    this.t0[i] = nowMs
    this.px[i] = x
    this.pz[i] = z
    this.heading[i] = heading
    this.scale[i] = scale
    this.cr[i] = r
    this.cg[i] = g
    this.cb[i] = b
  }

  update(nowMs: number): void {
    let i = 0
    while (i < this.n) {
      const t = (nowMs - (this.t0[i] as number)) / CORPSE_MS
      if (t >= 1) {
        this.remove(i)
        continue
      }
      const sc = this.scale[i] as number
      // Topple in the first third, then sink.
      const fall = Math.min(1, t * 3)
      const roll = (1 - (1 - fall) * (1 - fall)) * (Math.PI / 2)
      const sink = t < 0.35 ? 0 : ((t - 0.35) / 0.65) ** 2 * 0.7 * sc
      v3.set(this.px[i] as number, -sink, this.pz[i] as number)
      q4.setFromAxisAngle(s3.set(0, 1, 0), this.heading[i] as number)
      // Roll about the model's own forward (+x) axis, after the heading.
      q4.multiply(qRoll.setFromAxisAngle(X_AXIS, roll))
      s3.set(sc, sc, sc)
      m4.compose(v3, q4, s3)
      const dim = 1 - t * 0.6
      if (this.lit) {
        this.lit.setMatrixAt(i, m4)
        this.lit.setColorAt(i, c3.setRGB((this.cr[i] as number) * dim, (this.cg[i] as number) * dim, (this.cb[i] as number) * dim))
      }
      if (this.glow) {
        this.glow.setMatrixAt(i, m4)
        // Eyes go out at once.
        this.glow.setColorAt(i, c3.setRGB(0.15, 0.15, 0.15))
      }
      i++
    }
    for (const mesh of [this.lit, this.glow]) {
      if (!mesh) continue
      mesh.count = this.n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  private remove(i: number): void {
    const last = this.n - 1
    if (i !== last) {
      this.t0[i] = this.t0[last] as number
      this.px[i] = this.px[last] as number
      this.pz[i] = this.pz[last] as number
      this.heading[i] = this.heading[last] as number
      this.scale[i] = this.scale[last] as number
      this.cr[i] = this.cr[last] as number
      this.cg[i] = this.cg[last] as number
      this.cb[i] = this.cb[last] as number
    }
    this.n = last
    if (this.next > this.n) this.next = 0
  }
}

const qRoll = new THREE.Quaternion()
