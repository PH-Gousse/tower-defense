import * as THREE from 'three'
import { GRID_W, GRID_H, ENTRANCE_ROW, EXIT_ROW } from '@ltw/sim'
import { createRenderer, WebGLUnavailable } from '../render/renderer'
import { CameraRig } from '../render/CameraRig'
import { groundToTile, groundUnderNdc, ndcFromClient, type LaneLayout } from '../render/picking'
import { attachCameraGui, type FitMode } from '../render/cameraGui'

/**
 * The camera's test rig, served at /camera.
 *
 * Deliberately not the game. It draws the same lane geometry with none of the
 * simulation attached, so a framing or picking bug shows up as a framing or
 * picking bug rather than as "the towers look wrong today". The HUD reads out
 * the exact numbers the rig is running on, which is what makes the parameters
 * tunable by eye instead of by recompile.
 *
 * Flat materials only, one directional light and an ambient fill, no
 * post-processing -- matching the hand-painted low-poly direction, and keeping
 * the frame budget honest. If this scene cannot hold 60fps, nothing built on
 * top of it will.
 */

/** Gap between the two lanes, matching `scene.ts`. */
const LANE_GAP = 4

const LANES: readonly LaneLayout[] = [
  { originX: 0, originZ: 0, width: GRID_W, length: GRID_H, tile: 1 },
  { originX: GRID_W + LANE_GAP, originZ: 0, width: GRID_W, length: GRID_H, tile: 1 },
]

/** Everything the camera is allowed to look at, plus a tile of breathing room. */
const CONTENT = {
  minX: LANES[0]!.originX - 1,
  minZ: -1,
  maxX: LANES[1]!.originX + GRID_W + 1,
  maxZ: GRID_H + 1,
}

const COLOUR = {
  background: 0x11151a,
  tileLight: 0x3f4a3a,
  tileDark: 0x36402f,
  border: 0x6b7a5e,
  entrance: 0x2f7f5f,
  exit: 0xa8493c,
  tower: 0x8d949c,
  creep: 0xd8613f,
  hover: 0x9fd8ff,
}

export function startCameraDemo(): void {
  const host = createRenderer(document.body)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(COLOUR.background)

  scene.add(new THREE.AmbientLight(0xffffff, 1.35))
  const key = new THREE.DirectionalLight(0xffffff, 1.15)
  key.position.set(-14, 26, 10)
  scene.add(key)

  for (const lane of LANES) scene.add(buildLane(lane))

  // Pitch, fov and the zoom clamps are the rig's tuned defaults; see the note
  // on the `PerspectiveCamera` in CameraRig for how 35 was arrived at. Only the
  // two things the rig cannot know are passed here: what it may look at, and
  // that this page wants edge scrolling.
  const rig = new CameraRig(host.canvas, { edgeSize: 24, bounds: CONTENT })

  /**
   * Reserve the same screen the game's HUD and palette occupy.
   *
   * Without this the demo frames the board edge to edge and the game does not,
   * so a pitch or fov picked here lands tighter over there -- which makes the
   * tuning tool quietly wrong about the only thing it exists to tune. The bands
   * are measured rather than hardcoded so this runs the same `setSafeArea` path
   * `main.ts` does; what they measure is printed in the HUD, so if the game's
   * real chrome drifts away from these stand-ins it shows up as a number.
   */
  function chromeHeight(id: string): number {
    return document.getElementById(id)?.getBoundingClientRect().height ?? 0
  }

  /**
   * Last measured band heights, kept so the HUD can print them without
   * re-measuring. `getBoundingClientRect` forces a layout flush, and the HUD
   * repaints ten times a second -- putting that on this page in particular
   * would be measuring the frame budget with a thumb on the scale. Caching also
   * makes the readout honest: it shows the numbers actually handed to the rig,
   * not a fresh pair that could have moved since.
   */
  let safeTop = 0
  let safeBottom = 0

  function syncSafeArea(): void {
    safeTop = chromeHeight('chromeTop')
    safeBottom = chromeHeight('chromeBottom')
    rig.setSafeArea(safeTop, 0, safeBottom, 0)
  }

  host.onResize((w, h) => {
    rig.setViewport(w, h)
    syncSafeArea()
    applyFraming()
  })

  // --- framing ---------------------------------------------------------------
  // 'auto' picks from the aspect on every resize: both lanes side by side on a
  // landscape viewport, your lane alone on a portrait one. It has to be
  // re-evaluated rather than decided once at startup -- a phone rotated into
  // portrait while pinned to 'both' needs distance 68 to fit the pair, which is
  // hard against the zoom cap and renders both lanes too small to read.
  // Choosing a mode from the panel pins it and stops the automatic switching.
  let frameMode: FitMode | 'auto' = 'auto'
  let userMoved = false

  function resolveMode(): FitMode {
    if (frameMode !== 'auto') return frameMode
    return window.innerWidth >= window.innerHeight ? 'both' : 'lane'
  }

  function applyFraming(): void {
    if (userMoved) return
    const lane = LANES[0]!
    const mode = resolveMode()
    const rect =
      mode === 'lane'
        ? { minX: lane.originX, minZ: 0, maxX: lane.originX + lane.width, maxZ: GRID_H }
        : { minX: LANES[0]!.originX, minZ: 0, maxX: LANES[1]!.originX + GRID_W, maxZ: GRID_H }

    // Pan is clamped to whatever is being framed, not to the union of both
    // lanes. Otherwise "show my lane" on a phone frames one lane and the clamp
    // immediately drags the view back toward the gap between the two.
    rig.bounds = {
      minX: rect.minX - 1,
      minZ: rect.minZ - 1,
      maxX: rect.maxX + 1,
      maxZ: rect.maxZ + 1,
    }
    rig.fitBounds(rect.minX, rect.minZ, rect.maxX, rect.maxZ)
  }

  function setFraming(mode: FitMode): void {
    frameMode = mode
    userMoved = false
    applyFraming()
  }

  // --- hover -----------------------------------------------------------------
  const hoverMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.94, 0.08, 0.94),
    new THREE.MeshBasicMaterial({ color: COLOUR.hover, transparent: true, opacity: 0.55 }),
  )
  hoverMesh.visible = false
  scene.add(hoverMesh)

  const _ndc = new THREE.Vector2()
  const _point = new THREE.Vector3()
  const _tile = { x: 0, y: 0 }
  let hoverText = '--'

  host.canvas.addEventListener('pointermove', (ev) => {
    // The rig's cached rect, not a fresh getBoundingClientRect: this runs on
    // every pointer move, and that call forces a layout flush.
    ndcFromClient(ev.clientX, ev.clientY, rig.viewportRect, _ndc)
    if (groundUnderNdc(rig.camera, _ndc.x, _ndc.y, _point) === null) {
      hoverMesh.visible = false
      hoverText = '--'
      return
    }
    for (let i = 0; i < LANES.length; i++) {
      const lane = LANES[i]!
      if (groundToTile(_point, lane, _tile) === null) continue
      hoverMesh.position.set(
        lane.originX + _tile.x + 0.5,
        0.05,
        lane.originZ + _tile.y + 0.5,
      )
      hoverMesh.visible = true
      hoverText = `lane ${i} · ${_tile.x},${_tile.y}`
      return
    }
    hoverMesh.visible = false
    hoverText = '--'
  })

  host.canvas.addEventListener('pointerleave', () => {
    hoverMesh.visible = false
    hoverText = '--'
  })

  // Any deliberate camera move retires the automatic framing. Without this, the
  // next resize would yank the view back and undo whatever you were looking at.
  for (const type of ['wheel', 'pointerdown', 'keydown']) {
    window.addEventListener(type, () => { userMoved = true }, { passive: true })
  }

  attachCameraGui(rig, setFraming)

  // Handles for the console, and for automated screenshot comparisons while
  // tuning. `renderer.info` is the one that answers "is this scene cheap?"
  // with a number rather than an impression. This page is the tuning tool, so
  // the handles belong to it -- neither `scene.ts` nor the rig exposes them.
  ;(window as unknown as Record<string, unknown>).rig = rig
  ;(window as unknown as Record<string, unknown>).host = host

  // --- HUD -------------------------------------------------------------------
  const hud = document.getElementById('camhud')
  const _target = new THREE.Vector3()
  let hudDue = 0
  let frames = 0
  let fpsSince = performance.now()
  let fps = 0

  // The first resize sizes the drawing buffer, hands the rig its aspect and
  // frames the scene, in that order. Portrait shows one lane, landscape both.
  host.resize()

  host.renderer.setAnimationLoop((now) => {
    rig.update()
    host.renderer.render(scene, rig.camera)

    frames += 1
    if (now - fpsSince >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsSince))
      frames = 0
      fpsSince = now
    }

    // The HUD is DOM, so it updates at 10Hz rather than every frame. Writing
    // textContent 60 times a second is a layout thrash that would show up in
    // the very frame budget this page exists to measure.
    if (hud && now >= hudDue) {
      hudDue = now + 100
      rig.getTarget(_target)
      hud.textContent =
        `target ${_target.x.toFixed(2)}, ${_target.z.toFixed(2)}` +
        `\ndistance ${rig.distance.toFixed(2)}` +
        `\npitch ${rig.pitchDeg.toFixed(1)}°   fov ${rig.fovDeg.toFixed(1)}°` +
        // Printed so a drift between these stand-ins and the game's real HUD
        // and palette is a number you can read, not a framing you cannot place.
        `\nsafe area ${safeTop.toFixed(0)}px / ${safeBottom.toFixed(0)}px` +
        `\ntile ${hoverText}` +
        `\n${fps} fps`
    }
  })
}

/**
 * One lane: a checkerboard, a border, and the two reserved rows.
 *
 * Four instanced meshes rather than 192 individual ones. The checkerboard is
 * split into two instanced meshes by parity because that is how you get two
 * colours out of flat unlit materials without a texture or per-instance colour
 * -- and a texture is the wrong tool for a board whose whole job is to make
 * integer tile boundaries legible.
 */
function buildLane(lane: LaneLayout): THREE.Group {
  const group = new THREE.Group()
  group.position.set(lane.originX, 0, lane.originZ)

  // Baked into the geometry so instances only ever carry a translation.
  const quad = new THREE.PlaneGeometry(lane.tile, lane.tile)
  quad.rotateX(-Math.PI / 2)

  const counts = { light: 0, dark: 0, entrance: 0, exit: 0 }
  for (let y = 0; y < lane.length; y++) {
    for (let x = 0; x < lane.width; x++) {
      if (y === ENTRANCE_ROW) counts.entrance += 1
      else if (y === EXIT_ROW) counts.exit += 1
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

  const light = make(COLOUR.tileLight, counts.light, 0)
  const dark = make(COLOUR.tileDark, counts.dark, 0)
  // The reserved rows sit a hair proud of the board so they win the depth test
  // against the checkerboard rather than z-fighting with it.
  const entrance = make(COLOUR.entrance, counts.entrance, 0.004)
  const exit = make(COLOUR.exit, counts.exit, 0.004)

  const m = new THREE.Matrix4()
  const n = { light: 0, dark: 0, entrance: 0, exit: 0 }
  for (let y = 0; y < lane.length; y++) {
    for (let x = 0; x < lane.width; x++) {
      m.makeTranslation((x + 0.5) * lane.tile, 0, (y + 0.5) * lane.tile)
      if (y === ENTRANCE_ROW) entrance.setMatrixAt(n.entrance++, m)
      else if (y === EXIT_ROW) exit.setMatrixAt(n.exit++, m)
      else if ((x + y) % 2 === 0) light.setMatrixAt(n.light++, m)
      else dark.setMatrixAt(n.dark++, m)
    }
  }

  group.add(borderLines(lane))
  group.add(placeholders(lane))
  return group
}

/** Tile grid plus a heavier outline, in the border colour. */
function borderLines(lane: LaneLayout): THREE.LineSegments {
  const pts: number[] = []
  const w = lane.width * lane.tile
  const l = lane.length * lane.tile
  for (let x = 0; x <= lane.width; x++) pts.push(x * lane.tile, 0.01, 0, x * lane.tile, 0.01, l)
  for (let y = 0; y <= lane.length; y++) pts.push(0, 0.01, y * lane.tile, w, 0.01, y * lane.tile)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: COLOUR.border }))
}

/**
 * A handful of stand-in towers and creeps.
 *
 * Fixed positions, not random: the demo is a reference for judging framing and
 * picking, and a scene that differs between reloads cannot be compared against
 * a screenshot from an hour ago.
 */
function placeholders(lane: LaneLayout): THREE.Group {
  const group = new THREE.Group()

  const towerTiles = [
    [2, 4], [5, 6], [3, 9], [6, 12], [1, 15], [4, 18], [6, 20], [2, 21],
  ]
  const towers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1.5, 1),
    new THREE.MeshLambertMaterial({ color: COLOUR.tower }),
    towerTiles.length,
  )
  const m = new THREE.Matrix4()
  towerTiles.forEach(([x, y], i) => {
    m.makeTranslation((x as number) + 0.5, 0.75, (y as number) + 0.5)
    towers.setMatrixAt(i, m)
  })
  group.add(towers)

  const creepTiles = [
    [0.5, 1.5], [1.5, 2.5], [0.5, 3.5], [2.5, 7.5], [4.5, 10.5], [5.5, 14.5], [3.5, 17.5],
  ]
  const creeps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.3, 12, 8),
    new THREE.MeshLambertMaterial({ color: COLOUR.creep }),
    creepTiles.length,
  )
  creepTiles.forEach(([x, y], i) => {
    m.makeTranslation(x as number, 0.32, y as number)
    creeps.setMatrixAt(i, m)
  })
  group.add(creeps)

  return group
}

try {
  startCameraDemo()
} catch (err) {
  const msg = document.createElement('div')
  msg.id = 'fatal'
  msg.textContent =
    err instanceof WebGLUnavailable
      ? 'WebGL is unavailable in this browser.'
      : `The camera demo failed to start: ${String(err)}`
  document.body.appendChild(msg)
  throw err
}
