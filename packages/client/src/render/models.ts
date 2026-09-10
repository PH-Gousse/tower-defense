import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TowerKind, CreepArchetypeKind } from '@ltw/sim'

/**
 * Every model in the game, built from primitives with the colour baked into
 * the vertices.
 *
 * Vertex colours rather than one material per part, because everything here is
 * instanced: a tower drawn from six differently coloured boxes would be six
 * InstancedMeshes and six draw calls per level per archetype. Merged with the
 * colour in the geometry it is one, and the whole roster of nine tower shapes
 * and three creeps costs fifteen draw calls for both boards together.
 *
 * A model has a `lit` part, shaded by the sun, and optionally a `glow` part
 * that ignores lighting -- crystals, eyes, runes -- so it reads as a light
 * source from the fixed camera. The two are separate meshes because a material
 * is one thing or the other.
 *
 * Model space: y up, footprint centred on the origin, base at y = 0. Creeps
 * face +x; the scene rotates them about y to face their heading.
 */

export interface Model {
  /** Sun-lit part. Null when the whole model glows, as the frost bolt does. */
  readonly lit: THREE.BufferGeometry | null
  readonly glow: THREE.BufferGeometry | null
}

/** Stamp a single colour onto every vertex. */
function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count
  const c = new THREE.Color(hex)
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  // The uv attribute is dropped so merging never fails on a part that lacks
  // one; nothing here is textured.
  g.deleteAttribute('uv')
  return g
}

interface Place {
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
  sx?: number
  sy?: number
  sz?: number
}

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const e = new THREE.Euler()
const v = new THREE.Vector3()
const s3 = new THREE.Vector3()

/** Colour a primitive and put it somewhere in model space. */
function part(g: THREE.BufferGeometry, hex: number, p: Place = {}): THREE.BufferGeometry {
  paint(g, hex)
  e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)
  q.setFromEuler(e)
  v.set(p.x ?? 0, p.y ?? 0, p.z ?? 0)
  s3.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1)
  m4.compose(v, q, s3)
  g.applyMatrix4(m4)
  return g
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(parts, false)
  if (!out) throw new Error('model parts could not be merged')
  for (const p of parts) p.dispose()
  out.computeBoundingSphere()
  return out
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const cyl = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg)
const sphere = (r: number, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2))
const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg)
const octa = (r: number) => new THREE.OctahedronGeometry(r, 0)

// ---- palette ------------------------------------------------------------

const STONE = 0x8f9399
const STONE_DARK = 0x5f646b
const STONE_BLUE = 0x7d8aa0
const WOOD = 0x6e4a29
const WOOD_DARK = 0x4a301a
const BRONZE = 0xb8813f
const IRON = 0x3c3f45
const GOLD = 0xe2b64a
const ICE = 0xa9e6ff
const ICE_DEEP = 0x5cc3ef
const BANNER = [0x4f8cc9, 0xd0483c] as const

// ---- towers -------------------------------------------------------------

/** The height a projectile leaves from, per kind and level. */
export function muzzleHeight(kind: TowerKind, level: number): number {
  switch (kind) {
    case TowerKind.Single:
      return 1.15 + 0.3 * (level - 1)
    case TowerKind.Splash:
      return 0.75 + 0.1 * (level - 1)
    case TowerKind.Slow:
      return 1.0 + 0.2 * (level - 1)
  }
}

/**
 * Single-target: a guard tower. Square plinth, tapering round keep, a
 * crenellated parapet. Grows a wooden roof at level 2 and a gilded spire and
 * banner at level 3, so a maze's strength reads from its skyline.
 */
function guardTower(level: number): Model {
  const h = 0.85 + 0.3 * (level - 1)
  const parts: THREE.BufferGeometry[] = [
    part(box(0.84, 0.14, 0.84), STONE_DARK, { y: 0.07 }),
    part(box(0.7, 0.1, 0.7), STONE, { y: 0.19 }),
    part(cyl(0.25, 0.3, h, 12), STONE, { y: 0.24 + h / 2 }),
    // Parapet ring and merlons.
    part(cyl(0.34, 0.3, 0.12, 12), STONE_DARK, { y: 0.24 + h + 0.06 }),
  ]
  const top = 0.24 + h + 0.12
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    parts.push(
      part(box(0.1, 0.12, 0.1), STONE, {
        x: Math.cos(a) * 0.28,
        z: Math.sin(a) * 0.28,
        y: top + 0.06,
        ry: -a,
      }),
    )
  }
  // Arrow slits, dark, so the keep is not a plain tube.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    parts.push(
      part(box(0.05, 0.22, 0.03), IRON, {
        x: Math.cos(a) * 0.275,
        z: Math.sin(a) * 0.275,
        y: 0.24 + h * 0.6,
        ry: -a + Math.PI / 2,
      }),
    )
  }
  if (level >= 2) {
    parts.push(part(cone(0.3, 0.42, 8), WOOD_DARK, { y: top + 0.21 }))
    parts.push(part(cone(0.12, 0.18, 8), WOOD, { y: top + 0.42 + 0.09 }))
  }
  if (level >= 3) {
    parts.push(part(cyl(0.02, 0.02, 0.5, 6), WOOD_DARK, { y: top + 0.6 + 0.25 }))
    parts.push(part(box(0.02, 0.2, 0.3), BANNER[0], { x: 0, z: 0.15, y: top + 0.6 + 0.4 }))
    parts.push(part(cyl(0.36, 0.34, 0.05, 12), GOLD, { y: 0.24 + h + 0.125 }))
  }
  return { lit: merge(parts), glow: null }
}

/**
 * Splash: a mortar emplacement. A squat stone drum with a bronze mortar
 * pitched at the sky, iron bands, and at higher levels a second barrel and a
 * ring of iron spikes. Squat on purpose: the thing that hits everything in a
 * radius should look like it lobs, not like it aims.
 */
function mortarTower(level: number): Model {
  const r = 0.34 + 0.03 * (level - 1)
  const drumH = 0.42 + 0.06 * (level - 1)
  const parts: THREE.BufferGeometry[] = [
    part(box(0.84, 0.14, 0.84), STONE_DARK, { y: 0.07 }),
    part(cyl(r, r + 0.04, drumH, 14), STONE, { y: 0.14 + drumH / 2 }),
    part(cyl(r + 0.05, r + 0.05, 0.05, 14), IRON, { y: 0.14 + drumH * 0.3 }),
    part(cyl(r + 0.05, r + 0.05, 0.05, 14), IRON, { y: 0.14 + drumH * 0.8 }),
    part(cyl(r - 0.06, r - 0.06, 0.06, 14), STONE_DARK, { y: 0.14 + drumH + 0.03 }),
  ]
  const top = 0.14 + drumH + 0.06
  const barrels = level >= 3 ? 2 : 1
  for (let b = 0; b < barrels; b++) {
    const side = barrels === 1 ? 0 : b === 0 ? -0.14 : 0.14
    const bl = 0.42 + 0.05 * (level - 1)
    const br = 0.11 + 0.015 * (level - 1)
    // Pitched 55 degrees, pointing along -z (up the lane, toward the entrance).
    parts.push(
      part(cyl(br, br * 0.85, bl, 12), BRONZE, {
        x: side,
        y: top + 0.14,
        z: 0.02,
        rx: -Math.PI / 2 + (55 * Math.PI) / 180,
      }),
    )
    parts.push(part(cyl(br + 0.02, br + 0.02, 0.05, 12), IRON, {
      x: side,
      y: top + 0.14 + Math.sin((55 * Math.PI) / 180) * bl * 0.45,
      z: 0.02 - Math.cos((55 * Math.PI) / 180) * bl * 0.45,
      rx: -Math.PI / 2 + (55 * Math.PI) / 180,
    }))
    parts.push(part(sphere(br * 1.15, 8), IRON, { x: side, y: top + 0.1, z: 0.06 }))
  }
  if (level >= 2) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      parts.push(
        part(cone(0.04, 0.16, 5), IRON, {
          x: Math.cos(a) * (r + 0.02),
          z: Math.sin(a) * (r + 0.02),
          y: top + 0.06,
        }),
      )
    }
  }
  if (level >= 3) {
    parts.push(part(cyl(r + 0.06, r + 0.06, 0.03, 14), GOLD, { y: 0.14 + drumH * 0.55 }))
  }
  // A pile of shot beside the drum, so the archetype reads even from the top.
  parts.push(part(sphere(0.07, 8), IRON, { x: -0.3, z: 0.3, y: 0.21 }))
  parts.push(part(sphere(0.07, 8), IRON, { x: -0.3, z: 0.18, y: 0.21 }))
  parts.push(part(sphere(0.07, 8), IRON, { x: -0.24, z: 0.24, y: 0.32 }))
  return { lit: merge(parts), glow: null }
}

/**
 * Slow: a frost shrine. Blue-grey stone plinth and pedestal with a cluster of
 * ice crystals that glow. More and taller crystals per level. The crystals are
 * the glow part: they are what a player scans for when reading where the slows
 * are, so they must be bright from any angle.
 */
function frostTower(level: number): Model {
  const lit: THREE.BufferGeometry[] = [
    part(box(0.84, 0.14, 0.84), STONE_DARK, { y: 0.07 }),
    part(cyl(0.26, 0.32, 0.3, 8), STONE_BLUE, { y: 0.14 + 0.15 }),
    part(cyl(0.3, 0.26, 0.08, 8), STONE_DARK, { y: 0.44 + 0.04 }),
  ]
  // Snow on the plinth corners.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    lit.push(part(sphere(0.1, 8), 0xe8f4ff, { x: sx * 0.3, z: sz * 0.3, y: 0.14, sy: 0.4 }))
  }
  const glow: THREE.BufferGeometry[] = []
  const mainH = 0.55 + 0.2 * (level - 1)
  glow.push(part(octa(0.16), ICE, { y: 0.48 + mainH / 2, sy: mainH / 0.32 }))
  const ring = 2 + 2 * (level - 1)
  for (let k = 0; k < ring; k++) {
    const a = (k / ring) * Math.PI * 2 + 0.4
    const h = 0.28 + 0.08 * (level - 1)
    glow.push(
      part(octa(0.09), k % 2 === 0 ? ICE_DEEP : ICE, {
        x: Math.cos(a) * 0.2,
        z: Math.sin(a) * 0.2,
        y: 0.48 + h / 2,
        sy: h / 0.18,
        rz: -Math.sin(a) * 0.35,
        rx: Math.cos(a) * 0.35,
      }),
    )
  }
  if (level >= 3) {
    lit.push(part(cyl(0.33, 0.33, 0.03, 8), GOLD, { y: 0.14 + 0.3 }))
  }
  return { lit: merge(lit), glow: merge(glow) }
}

export function towerModel(kind: TowerKind, level: number): Model {
  switch (kind) {
    case TowerKind.Single:
      return guardTower(level)
    case TowerKind.Splash:
      return mortarTower(level)
    case TowerKind.Slow:
      return frostTower(level)
  }
}

// ---- creeps -------------------------------------------------------------

/** Swarm: a beetle. Small, low, six legs, a pale shell stripe. */
function beetle(): Model {
  const shell = 0x3f7f2c
  const dark = 0x22421a
  const parts: THREE.BufferGeometry[] = [
    part(sphere(0.2, 12), shell, { y: 0.16, sx: 1.3, sy: 0.7, sz: 1 }),
    part(sphere(0.06, 8), 0x7ccf5a, { x: 0.02, y: 0.29, sx: 2.6, sy: 0.4, sz: 0.5 }),
    part(sphere(0.1, 10), dark, { x: 0.26, y: 0.13, sx: 1, sy: 0.8, sz: 0.9 }),
    part(cone(0.02, 0.12, 5), dark, { x: 0.36, y: 0.1, z: 0.05, rz: -Math.PI / 2, ry: 0.4 }),
    part(cone(0.02, 0.12, 5), dark, { x: 0.36, y: 0.1, z: -0.05, rz: -Math.PI / 2, ry: -0.4 }),
  ]
  for (let k = 0; k < 3; k++) {
    for (const side of [-1, 1]) {
      parts.push(
        part(box(0.04, 0.03, 0.22), dark, {
          x: -0.1 + k * 0.12,
          y: 0.08,
          z: side * 0.2,
          rx: side * 0.5,
          ry: (k - 1) * 0.35,
        }),
      )
    }
  }
  const glow = merge([
    part(sphere(0.025, 6), 0xffe36a, { x: 0.33, y: 0.17, z: 0.05 }),
    part(sphere(0.025, 6), 0xffe36a, { x: 0.33, y: 0.17, z: -0.05 }),
  ])
  return { lit: merge(parts), glow }
}

/** Runner: a hound. Long, lean, low head, tail up. */
function hound(): Model {
  const fur = 0xb0844c
  const dark = 0x6a4726
  const parts: THREE.BufferGeometry[] = [
    part(new THREE.CapsuleGeometry(0.11, 0.3, 4, 10), fur, { y: 0.3, rz: Math.PI / 2 }),
    part(sphere(0.1, 10), fur, { x: 0.28, y: 0.36, sx: 1.1 }),
    part(box(0.14, 0.08, 0.09), dark, { x: 0.4, y: 0.33 }),
    part(cone(0.035, 0.1, 5), dark, { x: 0.24, y: 0.47, z: 0.05, rx: -0.3 }),
    part(cone(0.035, 0.1, 5), dark, { x: 0.24, y: 0.47, z: -0.05, rx: 0.3 }),
    part(cone(0.04, 0.26, 6), dark, { x: -0.3, y: 0.4, rz: Math.PI / 2 + 0.9 }),
  ]
  for (const [x, z] of [[0.16, 0.07], [0.16, -0.07], [-0.14, 0.07], [-0.14, -0.07]] as const) {
    parts.push(part(cyl(0.03, 0.025, 0.24, 6), dark, { x, y: 0.12, z }))
  }
  const glow = merge([
    part(sphere(0.02, 6), 0xff9a3c, { x: 0.35, y: 0.39, z: 0.05 }),
    part(sphere(0.02, 6), 0xff9a3c, { x: 0.35, y: 0.39, z: -0.05 }),
  ])
  return { lit: merge(parts), glow }
}

/** Tank: an ogre. Broad, slow, a club over one shoulder. */
function ogre(): Model {
  const skin = 0x9a6a48
  const cloth = 0x4b3222
  const parts: THREE.BufferGeometry[] = [
    part(box(0.3, 0.36, 0.38), skin, { y: 0.5 }),
    part(sphere(0.14, 10), skin, { y: 0.66, z: 0.22 }),
    part(sphere(0.14, 10), skin, { y: 0.66, z: -0.22 }),
    part(box(0.32, 0.16, 0.4), cloth, { y: 0.3 }),
    part(sphere(0.13, 10), skin, { x: 0.06, y: 0.86 }),
    part(box(0.1, 0.06, 0.16), 0x6f4a32, { x: 0.15, y: 0.82 }),
    part(cone(0.03, 0.1, 5), 0xe8dcc0, { x: 0.17, y: 0.9, z: 0.05 }),
    part(cone(0.03, 0.1, 5), 0xe8dcc0, { x: 0.17, y: 0.9, z: -0.05 }),
    // Arms and legs.
    part(cyl(0.06, 0.07, 0.34, 8), skin, { y: 0.5, z: 0.26, rx: 0.2 }),
    part(cyl(0.06, 0.07, 0.34, 8), skin, { y: 0.55, z: -0.28, rx: -1.4 }),
    part(cyl(0.07, 0.08, 0.26, 8), skin, { y: 0.13, z: 0.11 }),
    part(cyl(0.07, 0.08, 0.26, 8), skin, { y: 0.13, z: -0.11 }),
    // The club, resting over the left shoulder.
    part(cyl(0.03, 0.05, 0.5, 7), WOOD_DARK, { x: -0.1, y: 0.75, z: -0.3, rx: 0.5, rz: 0.3 }),
    part(sphere(0.1, 8), WOOD_DARK, { x: -0.18, y: 0.98, z: -0.42 }),
  ]
  const glow = merge([
    part(sphere(0.022, 6), 0xff5a3c, { x: 0.18, y: 0.9, z: 0.05 }),
    part(sphere(0.022, 6), 0xff5a3c, { x: 0.18, y: 0.9, z: -0.05 }),
  ])
  return { lit: merge(parts), glow }
}

export function creepModel(kind: CreepArchetypeKind): Model {
  switch (kind) {
    case CreepArchetypeKind.Swarm:
      return beetle()
    case CreepArchetypeKind.Runner:
      return hound()
    case CreepArchetypeKind.Tank:
      return ogre()
  }
}

/** How tall a creep stands, for health bars and pips. Before tier scaling. */
export function creepHeight(kind: CreepArchetypeKind): number {
  switch (kind) {
    case CreepArchetypeKind.Swarm:
      return 0.36
    case CreepArchetypeKind.Runner:
      return 0.55
    case CreepArchetypeKind.Tank:
      return 1.05
  }
}

// ---- projectiles --------------------------------------------------------

/** Projectiles point along +x; the pool orients them along their flight. */
export function projectileModel(kind: TowerKind): Model {
  switch (kind) {
    case TowerKind.Single:
      return {
        lit: merge([
          part(cyl(0.012, 0.012, 0.36, 5), WOOD, { rz: Math.PI / 2 }),
          part(cone(0.03, 0.08, 5), IRON, { x: 0.2, rz: -Math.PI / 2 }),
          part(box(0.08, 0.05, 0.01), 0xe8e0d0, { x: -0.14 }),
        ]),
        glow: null,
      }
    case TowerKind.Splash:
      return { lit: merge([part(sphere(0.09, 10), IRON)]), glow: null }
    case TowerKind.Slow:
      return {
        lit: null,
        glow: merge([part(octa(0.09), ICE, { sx: 1.6 })]),
      }
  }
}

// ---- scenery ------------------------------------------------------------

/** A conifer. Two cones on a trunk, dark enough not to compete with the lanes. */
export function treeModel(): THREE.BufferGeometry {
  return merge([
    part(cyl(0.08, 0.12, 0.5, 6), WOOD_DARK, { y: 0.25 }),
    part(cone(0.55, 1.0, 7), 0x2f5d2a, { y: 0.9 }),
    part(cone(0.42, 0.9, 7), 0x39702f, { y: 1.45 }),
    part(cone(0.26, 0.7, 7), 0x447f38, { y: 1.95 }),
  ])
}

/** A leafy tree, for variety among the conifers. */
export function broadleafModel(): THREE.BufferGeometry {
  return merge([
    part(cyl(0.09, 0.14, 0.7, 6), WOOD_DARK, { y: 0.35 }),
    part(sphere(0.55, 8), 0x3e7a33, { y: 1.2, sy: 0.85 }),
    part(sphere(0.38, 8), 0x4a8a3c, { x: 0.3, y: 1.45, z: 0.2 }),
    part(sphere(0.3, 8), 0x356d2c, { x: -0.3, y: 1.35, z: -0.25 }),
  ])
}

export function rockModel(): THREE.BufferGeometry {
  return merge([
    part(new THREE.DodecahedronGeometry(0.35, 0), 0x75797d, { sy: 0.6 }),
    part(new THREE.DodecahedronGeometry(0.2, 0), 0x868a8e, { x: 0.25, z: 0.15, sy: 0.6 }),
  ])
}

/** A stone kerb block for the lane rim. One tile long. */
export function kerbModel(): THREE.BufferGeometry {
  return merge([
    part(box(1.0, 0.16, 0.3), STONE_DARK, { y: 0.08 }),
    part(box(0.94, 0.06, 0.24), STONE, { y: 0.19 }),
  ])
}

/** A corner post with a team banner. */
export function postModel(team: 0 | 1): THREE.BufferGeometry {
  return merge([
    part(box(0.4, 0.5, 0.4), STONE_DARK, { y: 0.25 }),
    part(box(0.32, 0.08, 0.32), STONE, { y: 0.54 }),
    part(cyl(0.025, 0.025, 1.3, 6), WOOD_DARK, { y: 0.58 + 0.65 }),
    part(box(0.02, 0.5, 0.34), BANNER[team], { y: 0.58 + 1.0, z: 0.17 }),
  ])
}
