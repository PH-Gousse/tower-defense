import * as THREE from 'three'
import type { LaneLayout } from './picking'
import { laneTexture, type LaneTextureOptions } from './textures'
import { kerbModel, postModel } from './models'

/**
 * One lane's ground, drawn once and shared by the game and the /camera demo.
 *
 * A lane is a baked turf-and-cobble floor, a stone kerb around it with gaps
 * where creeps enter and leave, and a banner post at each corner in the
 * owner's colour. It knows nothing about the simulation: rows and tiles arrive
 * as plain numbers so this stays a renderer, and so the demo can draw a board
 * without a sim.
 *
 * The floor used to be five instanced meshes of flat quads plus a line grid.
 * It is one textured quad now -- see `laneTexture` for why -- and the kerb is
 * what makes the lane read as a place rather than a spreadsheet.
 */

export interface BoardPalette {
  /** Turf hue and lightness. The opponent's is a shade cooler and darker. */
  readonly hue: number
  readonly light: number
  /** CSS rgba() of the glow on the tiles creeps actually use. */
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
 * Both boards render at full size because reading their maze is how you pick
 * what to send. They still must not be confusable at a glance -- you build on
 * exactly one of them -- so the banners differ and the turf is a shade off.
 */
export const BOARD_THEIRS: BoardPalette = {
  hue: 98,
  light: 0.31,
  spawnGlow: 'rgba(110, 240, 160, 0.95)',
  exitGlow: 'rgba(250, 120, 90, 0.95)',
  team: 1,
}

export interface BoardRows {
  readonly entranceRow: number
  readonly exitRow: number
  /** Tiles creeps actually enter on. Empty or omitted draws no rune and no gap. */
  readonly spawnTiles?: readonly { readonly x: number; readonly y: number }[]
  readonly exitTiles?: readonly { readonly x: number; readonly y: number }[]
}

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
  const l = lane.length * lane.tile

  const floorGeo = new THREE.PlaneGeometry(w, l)
  floorGeo.rotateX(-Math.PI / 2)
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshLambertMaterial({
      map: floorTexture({
        width: lane.width,
        length: lane.length,
        entranceRow: rows.entranceRow,
        exitRow: rows.exitRow,
        spawnTiles: rows.spawnTiles ?? [],
        exitTiles: rows.exitTiles ?? [],
        hue: palette.hue,
        light: palette.light,
        spawnGlow: palette.spawnGlow,
        exitGlow: palette.exitGlow,
      }),
    }),
  )
  floor.name = 'floor'
  floor.position.set(w / 2, Y_FLOOR, l / 2)
  floor.receiveShadow = true
  group.add(floor)

  group.add(kerb(lane, rows))
  group.add(posts(lane, palette.team))
  return group
}

/**
 * The kerb, one block per tile of edge, with gaps in front of the tiles creeps
 * use. The gaps are the only hint the floor does not already give about which
 * way is in and which is out, and they cost nothing.
 */
function kerb(lane: LaneLayout, rows: BoardRows): THREE.InstancedMesh {
  const w = lane.width
  const l = lane.length
  const t = lane.tile
  const spawnX = new Set((rows.spawnTiles ?? []).filter((p) => p.y === rows.entranceRow).map((p) => p.x))
  const exitX = new Set((rows.exitTiles ?? []).filter((p) => p.y === rows.exitRow).map((p) => p.x))

  const mesh = new THREE.InstancedMesh(
    kerbModel(),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    2 * w + 2 * l,
  )
  mesh.name = 'kerb'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const one = new THREE.Vector3(t, 1, 1)
  const side = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  let n = 0
  for (let x = 0; x < w; x++) {
    if (!spawnX.has(x)) {
      pos.set((x + 0.5) * t, 0, -KERB_OUT)
      q.identity()
      mesh.setMatrixAt(n++, m.compose(pos, q, one))
    }
    if (!exitX.has(x)) {
      pos.set((x + 0.5) * t, 0, l * t + KERB_OUT)
      q.identity()
      mesh.setMatrixAt(n++, m.compose(pos, q, one))
    }
  }
  for (let y = 0; y < l; y++) {
    pos.set(-KERB_OUT, 0, (y + 0.5) * t)
    mesh.setMatrixAt(n++, m.compose(pos, side, one))
    pos.set(w * t + KERB_OUT, 0, (y + 0.5) * t)
    mesh.setMatrixAt(n++, m.compose(pos, side, one))
  }
  mesh.count = n
  mesh.instanceMatrix.needsUpdate = true
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
  return mesh
}
