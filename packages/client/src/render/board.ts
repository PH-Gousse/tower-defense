import * as THREE from 'three'
import type { LaneLayout } from './picking'

/**
 * One lane's ground, drawn once and shared by the game and the /camera demo.
 *
 * It started life inside the demo. When the game was asked to "look like
 * /camera" the honest move was to lift it out rather than copy a palette
 * across: two copies of a checkerboard drift the moment either is touched, and
 * the demo's whole job is to predict what the game will look like. Now that
 * claim holds by construction instead of by discipline.
 *
 * Knows nothing about the simulation. Rows and tiles arrive as plain numbers so
 * this stays a renderer, and so the demo can draw a board without a sim.
 */

export interface BoardPalette {
  readonly tileLight: number
  readonly tileDark: number
  /** The full reserved row at each end. */
  readonly entrance: number
  readonly exit: number
  readonly border: number
  /**
   * Brighter patch on the tiles creeps actually use.
   *
   * The reserved rows span the whole width, but only two tiles at each end
   * spawn and drain, and the diagonal that fact creates is the reason a bare
   * lane is 29 steps rather than 23. Colouring the row alone would look right
   * and quietly delete that -- a player could no longer see which corner their
   * creeps walk in from.
   */
  readonly spawnMark: number
  readonly exitMark: number
}

/** The /camera palette: lit checkerboard, warm ends. */
export const BOARD: BoardPalette = {
  tileLight: 0x3f4a3a,
  tileDark: 0x36402f,
  entrance: 0x2f7f5f,
  exit: 0xa8493c,
  border: 0x6b7a5e,
  spawnMark: 0x54c79a,
  exitMark: 0xd8705f,
}

/**
 * The opponent's board: same shapes, lower key.
 *
 * Both boards render at full size because reading their maze is how you pick
 * what to send. They still must not be confusable at a glance -- you build on
 * exactly one of them.
 */
export const BOARD_DIM: BoardPalette = {
  tileLight: 0x2f3830,
  tileDark: 0x282f26,
  entrance: 0x235f47,
  exit: 0x7d3830,
  border: 0x4d5945,
  spawnMark: 0x3d8f70,
  exitMark: 0x9c5548,
}

export interface BoardRows {
  readonly entranceRow: number
  readonly exitRow: number
  /** Tiles creeps actually enter on. Empty or omitted draws no sub-marker. */
  readonly spawnTiles?: readonly { readonly x: number; readonly y: number }[]
  readonly exitTiles?: readonly { readonly x: number; readonly y: number }[]
}

/**
 * Heights are small and fixed rather than computed, because everything drawn on
 * top of the board -- hover, selection and range rings, the route lines -- sits
 * at 0.03 and above. Anything here that crept past that would z-fight with the
 * feedback the player is actually reading.
 */
const Y_TILE = 0
const Y_END_ROW = 0.004
const Y_MARK = 0.008
const Y_GRID = 0.012

export function buildBoard(
  lane: LaneLayout,
  palette: BoardPalette,
  rows: BoardRows,
): THREE.Group {
  const group = new THREE.Group()
  group.position.set(lane.originX, 0, lane.originZ)

  // Baked into the geometry so instances only ever carry a translation.
  const quad = new THREE.PlaneGeometry(lane.tile, lane.tile)
  quad.rotateX(-Math.PI / 2)

  const counts = { light: 0, dark: 0, entrance: 0, exit: 0 }
  for (let y = 0; y < lane.length; y++) {
    for (let x = 0; x < lane.width; x++) {
      if (y === rows.entranceRow) counts.entrance += 1
      else if (y === rows.exitRow) counts.exit += 1
      else if ((x + y) % 2 === 0) counts.light += 1
      else counts.dark += 1
    }
  }

  const make = (colour: number, n: number, y: number): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(
      quad,
      new THREE.MeshBasicMaterial({ color: colour }),
      Math.max(n, 1),
    )
    mesh.count = n
    mesh.position.y = y
    group.add(mesh)
    return mesh
  }

  const light = make(palette.tileLight, counts.light, Y_TILE)
  const dark = make(palette.tileDark, counts.dark, Y_TILE)
  const entrance = make(palette.entrance, counts.entrance, Y_END_ROW)
  const exit = make(palette.exit, counts.exit, Y_END_ROW)

  const m = new THREE.Matrix4()
  const n = { light: 0, dark: 0, entrance: 0, exit: 0 }
  for (let y = 0; y < lane.length; y++) {
    for (let x = 0; x < lane.width; x++) {
      m.makeTranslation((x + 0.5) * lane.tile, 0, (y + 0.5) * lane.tile)
      if (y === rows.entranceRow) entrance.setMatrixAt(n.entrance++, m)
      else if (y === rows.exitRow) exit.setMatrixAt(n.exit++, m)
      else if ((x + y) % 2 === 0) light.setMatrixAt(n.light++, m)
      else dark.setMatrixAt(n.dark++, m)
    }
  }

  // The tiles creeps really use, brighter, on top of their row.
  addMarks(group, quad, lane, rows.spawnTiles, palette.spawnMark)
  addMarks(group, quad, lane, rows.exitTiles, palette.exitMark)

  group.add(gridLines(lane, palette.border))
  return group
}

function addMarks(
  group: THREE.Group,
  quad: THREE.BufferGeometry,
  lane: LaneLayout,
  tiles: readonly { readonly x: number; readonly y: number }[] | undefined,
  colour: number,
): void {
  if (!tiles || tiles.length === 0) return
  const mesh = new THREE.InstancedMesh(
    quad,
    new THREE.MeshBasicMaterial({ color: colour }),
    tiles.length,
  )
  mesh.position.y = Y_MARK
  const m = new THREE.Matrix4()
  tiles.forEach((t, i) => {
    m.makeTranslation((t.x + 0.5) * lane.tile, 0, (t.y + 0.5) * lane.tile)
    mesh.setMatrixAt(i, m)
  })
  group.add(mesh)
}

/** Tile grid across the whole lane, in the border colour. */
function gridLines(lane: LaneLayout, colour: number): THREE.LineSegments {
  const pts: number[] = []
  const w = lane.width * lane.tile
  const l = lane.length * lane.tile
  for (let x = 0; x <= lane.width; x++) pts.push(x * lane.tile, Y_GRID, 0, x * lane.tile, Y_GRID, l)
  for (let y = 0; y <= lane.length; y++) pts.push(0, Y_GRID, y * lane.tile, w, Y_GRID, y * lane.tile)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: colour }))
}
