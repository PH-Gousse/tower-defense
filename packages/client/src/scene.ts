import * as THREE from 'three'
import {
  GRID_W,
  GRID_H,
  SPAWN_TILES,
  EXIT_TILES,
  inBounds,
  isSpawn,
  isExit,
  tileIndex,
  type Tile,
} from './grid'

/**
 * Step 1 skeleton: a lane you can look at and click.
 *
 * There is no simulation here yet. Placement writes straight to a Set and a
 * mesh, because step 2 replaces this entirely with `packages/sim` driving the
 * renderer. What this file is proving is narrower: three.js renders the field,
 * the raycast picks the right tile, and instancing is wired from the start.
 *
 *   pointer ──▶ raycast onto ground plane ──▶ floor() to tile ──▶ InstancedMesh
 *                      │                            │
 *                      ▼                            ▼
 *                 [off grid?]                  [already taken?]
 *                 [spawn/exit?]                 ignore, no-op
 */

const TILE = 1
const TOWER_H = 0.55

/** InstancedMesh needs its ceiling up front; 40x24 is every tile at once. */
const MAX_TOWERS = GRID_W * GRID_H

export interface Scene {
  readonly onTileHover: (cb: (t: Tile | null) => void) => void
  readonly onTowerCount: (cb: (n: number) => void) => void
  start: () => void
}

export function createScene(canvasParent: HTMLElement): Scene {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  canvasParent.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0e1013)

  // Orthographic, tilted just enough that towers read as solid rather than as
  // flat squares. A perspective camera would make identical towers at opposite
  // ends of the lane look different sizes, which is exactly wrong for a game
  // about reading a maze at a glance.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
  camera.position.set(GRID_W / 2, 26, GRID_H / 2 + 17)
  camera.lookAt(GRID_W / 2, 0, GRID_H / 2)

  scene.add(new THREE.AmbientLight(0xffffff, 1.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(-12, 24, 8)
  scene.add(key)

  // --- ground: the raycast target, and the only thing the pointer hits -------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_W, GRID_H),
    new THREE.MeshBasicMaterial({ color: 0x14181d }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(GRID_W / 2, 0, GRID_H / 2)
  scene.add(ground)

  scene.add(gridLines())
  for (const t of SPAWN_TILES) scene.add(marker(t, 0x2a7f62))
  for (const t of EXIT_TILES) scene.add(marker(t, 0xa8443c))

  // --- towers: instanced from the first commit ------------------------------
  // Not premature. Swapping a Mesh-per-tower approach for instancing later
  // means rewriting every placement path, and the design already commits to
  // hundreds of instanced creeps on this same field.
  const towers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE * 0.82, TOWER_H, TILE * 0.82),
    new THREE.MeshLambertMaterial({ color: 0x8d949c }),
    MAX_TOWERS,
  )
  towers.count = 0
  towers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(towers)

  const hover = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 0.9, 0.06, TILE * 0.9),
    new THREE.MeshBasicMaterial({ color: 0x4f8cc9, transparent: true, opacity: 0.5 }),
  )
  hover.visible = false
  scene.add(hover)

  const placed = new Set<number>()
  const scratch = new THREE.Matrix4()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  let hovered: Tile | null = null
  let hoverCb: (t: Tile | null) => void = () => {}
  let countCb: (n: number) => void = () => {}

  function tileUnderPointer(ev: PointerEvent): Tile | null {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(ground, false)[0]
    if (!hit) return null
    const t: Tile = { x: Math.floor(hit.point.x), y: Math.floor(hit.point.z) }
    return inBounds(t) ? t : null
  }

  /** Step 1 legality: on the grid, not taken, not a spawn or exit tile. */
  function canPlace(t: Tile): boolean {
    return !placed.has(tileIndex(t)) && !isSpawn(t) && !isExit(t)
  }

  function place(t: Tile): void {
    const i = tileIndex(t)
    if (!canPlace(t)) return
    placed.add(i)
    scratch.makeTranslation(t.x + 0.5, TOWER_H / 2, t.y + 0.5)
    towers.setMatrixAt(towers.count, scratch)
    towers.count += 1
    towers.instanceMatrix.needsUpdate = true
    countCb(placed.size)
  }

  renderer.domElement.addEventListener('pointermove', (ev) => {
    const t = tileUnderPointer(ev)
    const changed = t?.x !== hovered?.x || t?.y !== hovered?.y
    hovered = t
    if (t && canPlace(t)) {
      hover.position.set(t.x + 0.5, 0.03, t.y + 0.5)
      hover.visible = true
    } else {
      hover.visible = false
    }
    if (changed) hoverCb(t)
  })

  renderer.domElement.addEventListener('pointerleave', () => {
    hover.visible = false
    hovered = null
    hoverCb(null)
  })

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    const t = tileUnderPointer(ev)
    if (t) place(t)
  })

  function resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h)
    // Fit the lane to the viewport with a margin, preserving aspect so the
    // grid stays square whatever the window shape.
    const margin = 3
    const halfW = (GRID_W + margin) / 2
    const halfH = (GRID_H + margin) / 2
    const aspect = w / h
    const [x, y] = aspect > halfW / halfH ? [halfH * aspect, halfH] : [halfW, halfW / aspect]
    camera.left = -x
    camera.right = x
    camera.top = y
    camera.bottom = -y
    camera.updateProjectionMatrix()
  }

  window.addEventListener('resize', resize)

  return {
    onTileHover: (cb) => { hoverCb = cb },
    onTowerCount: (cb) => { countCb = cb },
    start: () => {
      resize()
      renderer.setAnimationLoop(() => renderer.render(scene, camera))
    },
  }
}

function gridLines(): THREE.LineSegments {
  const pts: number[] = []
  for (let x = 0; x <= GRID_W; x++) pts.push(x, 0.01, 0, x, 0.01, GRID_H)
  for (let y = 0; y <= GRID_H; y++) pts.push(0, 0.01, y, GRID_W, 0.01, y)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x272c33 }),
  )
}

function marker(t: Tile, color: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE, TILE),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
  )
  m.rotation.x = -Math.PI / 2
  m.position.set(t.x + 0.5, 0.02, t.y + 0.5)
  return m
}
