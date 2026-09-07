import * as THREE from 'three'
import {
  GRID_W,
  GRID_H,
  SPAWN_TILES,
  EXIT_TILES,
  TILE_COUNT,
  MAX_CREEPS,
  UNREACHABLE,
  inBounds,
  tileIndex,
  tileX,
  tileY,
  canBuild,
  buildField,
  mazeLength,
  type Tile,
} from '@ltw/sim'
import { Driver } from './driver'

/**
 * Step 2: the renderer reads sim state and draws it.
 *
 * The wall between this file and `@ltw/sim` is the load-bearing boundary of the
 * whole project. Everything here may be impure — floats, three.js, the DOM,
 * wall-clock time. Nothing here may write game state; the only channel back
 * into the sim is a queued command.
 *
 *   pointer ──▶ canBuild(state) ──▶ queueBuild ──┐
 *                    │                           │
 *                    ▼                           ▼
 *              hover preview            Driver.advance() ──▶ step()
 *                                                 │
 *                                                 ▼
 *                                    prev, curr, alpha ──▶ draw
 *
 * Creeps draw interpolated between the previous and current tick, so a 20Hz
 * simulation renders smoothly at any refresh rate. The alpha is clamped in the
 * driver — see the comment there for why that matters more than it looks.
 */

const TILE = 1
const TOWER_H = 0.55
const CREEP_R = 0.22

export interface Stats {
  readonly towers: number
  readonly creeps: number
  /** Maze length in tiles, or -1 when the lane is sealed. */
  readonly maze: number
  readonly tick: number
}

export interface Scene {
  readonly onTileHover: (cb: (t: Tile | null, mazeDelta: number | null) => void) => void
  readonly onStats: (cb: (s: Stats) => void) => void
  start: () => void
}

export function createScene(canvasParent: HTMLElement): Scene {
  const driver = new Driver()

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  canvasParent.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0e1013)

  // Orthographic so identical towers at opposite ends of the lane read the same
  // size. A perspective camera would make the far end of your maze look weaker
  // than the near end, which is exactly wrong for a game about reading a maze.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
  camera.position.set(GRID_W / 2, 26, GRID_H / 2 + 17)
  camera.lookAt(GRID_W / 2, 0, GRID_H / 2)

  scene.add(new THREE.AmbientLight(0xffffff, 1.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(-12, 24, 8)
  scene.add(key)

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

  const towers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE * 0.82, TOWER_H, TILE * 0.82),
    new THREE.MeshLambertMaterial({ color: 0x8d949c }),
    TILE_COUNT,
  )
  towers.count = 0
  towers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(towers)

  // Creeps are instanced from the start because the design bounds their
  // population only by gold. This is the mesh that has to survive 500 of them.
  const creeps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(CREEP_R, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xd8613f }),
    MAX_CREEPS,
  )
  creeps.count = 0
  creeps.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(creeps)

  const hover = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 0.9, 0.06, TILE * 0.9),
    new THREE.MeshBasicMaterial({ color: 0x4f8cc9, transparent: true, opacity: 0.5 }),
  )
  hover.visible = false
  scene.add(hover)

  const scratch = new THREE.Matrix4()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  let hovered: Tile | null = null
  let lastSyncedTick = -1
  let hoverCb: (t: Tile | null, d: number | null) => void = () => {}
  let statsCb: (s: Stats) => void = () => {}

  function tileUnderPointer(ev: PointerEvent): Tile | null {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(ground, false)[0]
    if (!hit) return null
    const t: Tile = { x: Math.floor(hit.point.x), y: Math.floor(hit.point.z) }
    return inBounds(t.x, t.y) ? t : null
  }

  /**
   * Hover preview: how much longer would this placement make the walk?
   *
   * The `+54 tiles` teaching signal. It is a candidate field rebuild, so it
   * runs on tile change only — never on raw pointer movement.
   */
  function mazeDelta(t: Tile): number | null {
    const state = driver.current
    if (!canBuild(state, t.x, t.y)) return null
    const before = mazeLength(state.lane.field)
    const i = tileIndex(t)
    state.lane.blocked[i] = 1
    const after = mazeLength(buildField(state.lane.blocked))
    state.lane.blocked[i] = 0
    if (after === UNREACHABLE || before === UNREACHABLE) return null
    return after - before
  }

  renderer.domElement.addEventListener('pointermove', (ev) => {
    const t = tileUnderPointer(ev)
    const changed = t?.x !== hovered?.x || t?.y !== hovered?.y
    hovered = t
    if (t && canBuild(driver.current, t.x, t.y)) {
      hover.position.set(t.x + 0.5, 0.03, t.y + 0.5)
      hover.visible = true
    } else {
      hover.visible = false
    }
    if (changed) hoverCb(t, t ? mazeDelta(t) : null)
  })

  renderer.domElement.addEventListener('pointerleave', () => {
    hover.visible = false
    hovered = null
    hoverCb(null, null)
  })

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    const t = tileUnderPointer(ev)
    if (t && canBuild(driver.current, t.x, t.y)) driver.queueBuild(t.x, t.y)
  })

  function syncTowers(): void {
    const blocked = driver.current.lane.blocked
    let n = 0
    for (let i = 0; i < TILE_COUNT; i++) {
      if (blocked[i] !== 1) continue
      scratch.makeTranslation(tileX(i) + 0.5, TOWER_H / 2, tileY(i) + 0.5)
      towers.setMatrixAt(n, scratch)
      n += 1
    }
    towers.count = n
    towers.instanceMatrix.needsUpdate = true
  }

  /** Draw creeps between the previous and current tick. */
  function syncCreeps(alpha: number): void {
    const curr = driver.current.lane.creeps
    const prev = driver.previous.lane.creeps
    for (let i = 0; i < curr.count; i++) {
      const cx = curr.x[i] as number
      const cy = curr.y[i] as number
      let x = cx
      let y = cy
      // Interpolate only when the same creep occupied this slot last tick, and
      // only over a short distance. A teleport back to spawn or a fresh release
      // must snap; gliding it across the field would look like a bug and would
      // hide the rule that put it there.
      if (i < prev.count && prev.id[i] === curr.id[i]) {
        const px = prev.x[i] as number
        const py = prev.y[i] as number
        const dx = cx - px
        const dy = cy - py
        const travelled = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy)
        if (travelled < 2) {
          x = px + dx * alpha
          y = py + dy * alpha
        }
      }
      scratch.makeTranslation(x, CREEP_R + 0.02, y)
      creeps.setMatrixAt(i, scratch)
    }
    creeps.count = curr.count
    creeps.instanceMatrix.needsUpdate = true
  }

  function resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h)
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
    onStats: (cb) => { statsCb = cb },
    start: () => {
      resize()
      renderer.setAnimationLoop((nowMs) => {
        const ran = driver.advance(nowMs)
        const state = driver.current
        if (ran > 0 && state.tick !== lastSyncedTick) {
          syncTowers()
          lastSyncedTick = state.tick
          const maze = mazeLength(state.lane.field)
          statsCb({
            towers: towers.count,
            creeps: state.lane.creeps.count,
            maze: maze === UNREACHABLE ? -1 : maze,
            tick: state.tick,
          })
        }
        syncCreeps(driver.alpha)
        renderer.render(scene, camera)
      })
    },
  }
}

function gridLines(): THREE.LineSegments {
  const pts: number[] = []
  for (let x = 0; x <= GRID_W; x++) pts.push(x, 0.01, 0, x, 0.01, GRID_H)
  for (let y = 0; y <= GRID_H; y++) pts.push(0, 0.01, y, GRID_W, 0.01, y)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x272c33 }))
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
