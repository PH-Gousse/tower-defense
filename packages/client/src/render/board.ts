import * as THREE from 'three'
import type { LaneLayout } from './picking'
import { laneTexture, type LaneTextureOptions, type LaneZone } from './textures'
import { kerbModel, postModel } from './models'

/**
 * One lane's ground, drawn once and shared by the game and the /camera demo.
 *
 * A lane is a floor of baked turf in CHUNKS, a stone kerb down both long
 * sides, and a banner post at each corner in the owner's colour. It knows
 * nothing about the simulation: zone sizes and tiles arrive as plain numbers
 * so this stays a renderer, and so the demo can draw a board without a sim.
 *
 * Why chunks (ADR-0024). The lane is 213 rows and the camera shows twenty.
 * One quad for the whole lane would be one texture of 1024 x 13,632 pixels --
 * over the limit on most phones -- and one mesh the frustum could never cull,
 * because some of it is always in view. So the floor is a spawn-zone slab, a
 * run of build slabs of CHUNK_ROWS each, and an exit-zone slab, each its own
 * mesh with an honest bounding box: three.js culls the slabs off-screen for
 * free, and the build slabs all share ONE texture, so the lane costs three
 * bakes rather than eleven.
 *
 * The zones read as zones. The old board lit the two spawn tiles and the two
 * exit tiles with runes; on a 10 x 16 spawn zone that was 160 runes and a
 * carpet, not a mark. A zone is now a distinct floor -- worn flagstones with
 * a soft glow in the zone's colour -- and the build area is turf with a grid
 * of grooves at every tile and a firmer line every TOWER_SIZE tiles, so a
 * footprint can be counted at a glance.
 */

export interface BoardPalette {
  /** Turf hue and lightness. The opponent's is a shade cooler and darker. */
  readonly hue: number
  readonly light: number
  /** CSS rgba() of the glow washing the two zones. */
  readonly spawnGlow: string
  readonly exitGlow: string
  /** Banner colour on the corner posts: 0 is blue, 1 is red. */
  readonly team: 0 | 1
}

/** Your lane. */
export const BOARD: BoardPalette = {
  hue: 106,
  light: 0.35,
  spawnGlow: 'rgba(110, 240, 160, 0.95)',
  exitGlow: 'rgba(250, 120, 90, 0.95)',
  team: 0,
}

/**
 * The opponent's lane: same shapes, a touch cooler and darker.
 *
 * Both boards render at the same scale because reading their maze is how you
 * pick what to send. They still must not be confusable at a glance -- you
 * build on exactly one of them -- so the banners differ and the turf is a
 * shade off.
 */
export const BOARD_THEIRS: BoardPalette = {
  hue: 98,
  light: 0.31,
  spawnGlow: 'rgba(110, 240, 160, 0.95)',
  exitGlow: 'rgba(250, 120, 90, 0.95)',
  team: 1,
}

export interface BoardRows {
  /** Rows of the spawn zone at the top of the lane. */
  readonly spawnRows: number
  /** Rows of the exit zone at the bottom. */
  readonly exitRows: number
  /** Tiles per tower side, for the firmer grid line. */
  readonly towerSize: number
}

/**
 * Rows per build slab. Even, so the turf checker keeps its parity across a
 * seam; twenty because it is the default rows in frame, so a view holds one
 * or two slabs and never a dozen.
 */
export const CHUNK_ROWS = 20

/**
 * The floor sits at 0 and the overlays the player reads -- hover, selection
 * and range rings, the route markers -- start at 0.03. Nothing drawn inside the
 * lane's footprint may creep past that, or it z-fights with the feedback rather
 * than with scenery. The kerb and posts stand outside the footprint and may be
 * as tall as they like.
 */
const Y_FLOOR = 0
/** How far outside the lane the kerb's centre line runs. */
const KERB_OUT = 0.16

export interface Chunk {
  readonly zone: LaneZone
  readonly row: number
  readonly rows: number
}

/**
 * How the lane's rows split into slabs. Pure, so a test can hold it down: the
 * slabs must tile the lane exactly, with the zones whole and the build area
 * in CHUNK_ROWS pieces plus a remainder.
 */
export function laneChunks(length: number, rows: BoardRows): Chunk[] {
  const out: Chunk[] = []
  if (rows.spawnRows > 0) out.push({ zone: 'spawn', row: 0, rows: rows.spawnRows })
  const buildEnd = length - rows.exitRows
  for (let r = rows.spawnRows; r < buildEnd; r += CHUNK_ROWS) {
    out.push({ zone: 'build', row: r, rows: Math.min(CHUNK_ROWS, buildEnd - r) })
  }
  if (rows.exitRows > 0) out.push({ zone: 'exit', row: buildEnd, rows: rows.exitRows })
  return out
}

/**
 * `floorTexture` is injectable for one reason: the default bakes on a 2D
 * canvas, and the test suite runs in node where there is none. Tests pass a
 * stub and assert on the geometry, which is the part worth pinning.
 */
export function buildBoard(
  lane: LaneLayout,
  palette: BoardPalette,
  rows: BoardRows,
  floorTexture: (o: LaneTextureOptions) => THREE.Texture = laneTexture,
): THREE.Group {
  const group = new THREE.Group()
  group.position.set(lane.originX, 0, lane.originZ)

  const w = lane.width * lane.tile
  const chunks = laneChunks(lane.length, rows)

  // One texture per (zone, rows) shape. Every full build slab shares one.
  const textures = new Map<string, THREE.Texture>()
  const textureFor = (c: Chunk): THREE.Texture => {
    const key = `${c.zone}:${c.rows}`
    let t = textures.get(key)
    if (!t) {
      t = floorTexture({
        width: lane.width,
        rows: c.rows,
        zone: c.zone,
        towerSize: rows.towerSize,
        hue: palette.hue,
        light: palette.light,
        spawnGlow: palette.spawnGlow,
        exitGlow: palette.exitGlow,
      })
      textures.set(key, t)
    }
    return t
  }

  chunks.forEach((c, i) => {
    const h = c.rows * lane.tile
    const geo = new THREE.PlaneGeometry(w, h)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: textureFor(c) }))
    mesh.name = i === 0 ? 'floor' : `floor:${i}`
    mesh.userData = { zone: c.zone, row: c.row, rows: c.rows }
    mesh.position.set(w / 2, Y_FLOOR, (c.row + c.rows / 2) * lane.tile)
    mesh.receiveShadow = true
    group.add(mesh)
  })

  group.add(kerb(lane))
  group.add(posts(lane, palette.team))
  return group
}

/**
 * The kerb, one block per tile of the two long edges. The ends are open: the
 * spawn zone is where creeps arrive and the exit zone where they leave, and
 * a wall across either would say the opposite.
 */
function kerb(lane: LaneLayout): THREE.InstancedMesh {
  const w = lane.width
  const l = lane.length
  const t = lane.tile

  const mesh = new THREE.InstancedMesh(
    kerbModel(),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    2 * l,
  )
  mesh.name = 'kerb'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const one = new THREE.Vector3(t, 1, 1)
  const side = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  let n = 0
  for (let y = 0; y < l; y++) {
    pos.set(-KERB_OUT, 0, (y + 0.5) * t)
    mesh.setMatrixAt(n++, m.compose(pos, side, one))
    pos.set(w * t + KERB_OUT, 0, (y + 0.5) * t)
    mesh.setMatrixAt(n++, m.compose(pos, side, one))
  }
  mesh.count = n
  mesh.instanceMatrix.needsUpdate = true
  // A real sphere over the instances, computed now while the count is final,
  // so the whole-lane kerb culls honestly when the camera is on the far lane.
  mesh.computeBoundingSphere()
  return mesh
}

function posts(lane: LaneLayout, team: 0 | 1): THREE.InstancedMesh {
  const w = lane.width * lane.tile
  const l = lane.length * lane.tile
  const mesh = new THREE.InstancedMesh(
    postModel(team),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    4,
  )
  mesh.name = 'posts'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const m = new THREE.Matrix4()
  const corners: [number, number][] = [
    [-KERB_OUT - 0.1, -KERB_OUT - 0.1],
    [w + KERB_OUT + 0.1, -KERB_OUT - 0.1],
    [-KERB_OUT - 0.1, l + KERB_OUT + 0.1],
    [w + KERB_OUT + 0.1, l + KERB_OUT + 0.1],
  ]
  corners.forEach(([x, z], i) => {
    mesh.setMatrixAt(i, m.makeTranslation(x, 0, z))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}
