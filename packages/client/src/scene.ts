import * as THREE from 'three'
import {
  GRID_W,
  GRID_H,
  SPAWN_TILES,
  EXIT_TILES,
  SPAWN_INDICES,
  TILE_COUNT,
  MAX_CREEPS,
  UNREACHABLE,
  Refusal,
  inBounds,
  tileIndex,
  tileX,
  tileY,
  checkBuild,
  checkUpgrade,
  checkSell,
  sellValue,
  buildField,
  createField,
  mazeLength,
  pathFrom,
  TowerKind,
  ARCHETYPES,
  levelOf,
  MAX_LEVEL,
  MatchResult,
  BOT_NORMAL,
  Kind,
  type Tile,
  type FlowField,
  type BotConfig,
  type Divergence,
  type DesyncDump,
} from '@ltw/sim'
import { Driver } from './driver'
import { PathLine } from './pathline'

/** One line of plain English per refusal. The rule teaches itself or it does not exist. */
/**
 * Wire-level refusals, in the player's language.
 *
 * These come from the relay's shape check rather than from `step()`, so they
 * are things the game's own rules have no words for -- a tick already used, a
 * frame outside the window. A player should still be told something true.
 */
const REFUSAL_WIRE: Record<string, string> = {
  'tick-taken': 'two commands landed on the same instant',
  'tick-out-of-window': 'that arrived too late to be applied',
  'wrong-seat': 'that command was for the other player',
  'off-grid': 'that tile is off the board',
  'bad-creep': 'that creep does not exist in this version',
  'bad-tower': 'that tower does not exist in this version',
  'not-playing': 'the match is not running',
}

const REFUSAL_TEXT: Record<Refusal, string> = {
  [Refusal.None]: '',
  [Refusal.OutOfBounds]: 'Outside the lane',
  [Refusal.Occupied]: 'A tower is already here',
  [Refusal.SpawnOrExit]: 'Cannot build on the entrance or the exit',
  [Refusal.WouldSealLane]: 'No path IN to OUT — creeps must always have a way through',
  [Refusal.NotEnoughGold]: 'Not enough gold',
  [Refusal.NoTowerHere]: 'No tower on this tile',
  [Refusal.AlreadyMaxLevel]: 'Already at maximum level',
  [Refusal.TierLocked]: 'Not unlocked yet',
}

/** One colour per archetype so a maze is readable without clicking anything. */
const TOWER_COLOUR: Record<TowerKind, number> = {
  [TowerKind.Single]: 0x8d949c,
  [TowerKind.Splash]: 0xc08a4a,
  [TowerKind.Slow]: 0x5a8fa8,
}

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
  readonly gold: number
  readonly kills: number
  readonly lives: number
  readonly leaks: number
  readonly income: number
  readonly result: MatchResult
  readonly winner: number
  readonly oppLives: number
  readonly oppCreeps: number
  /** Non-null once a peer's hashes disagreed with ours. The sim is frozen. */
  readonly desync: Divergence | null
  /** Ticks the opponent is behind. 0 against a bot, or when keeping up. */
  readonly peerLag: number
}

export interface Selection {
  readonly tile: Tile
  readonly tower: TowerKind
  readonly level: number
  readonly upgradeCost: number | null
  readonly sellValue: number
  readonly canUpgrade: boolean
}

export interface HoverInfo {
  readonly tile: Tile | null
  /** Extra tiles this placement would add to the walk, or null when refused. */
  readonly mazeDelta: number | null
  readonly refusal: Refusal
  readonly refusalText: string
}

export interface Scene {
  readonly onTileHover: (cb: (h: HoverInfo) => void) => void
  readonly onStats: (cb: (s: Stats) => void) => void
  readonly onSelect: (cb: (sel: Selection | null) => void) => void
  /** A predicted command was refused or lost. Tell the player, once. */
  readonly onGhostFailed: (cb: (text: string) => void) => void
  readonly setTool: (tower: TowerKind) => void
  readonly send: (creep: number) => void
  readonly upgradeSelected: () => void
  readonly sellSelected: () => void
  readonly setBot: (bot: BotConfig | null) => void
  /** The match as a reproducible JSON file. See packages/sim/src/dump.ts. */
  readonly dump: (trigger: 'desync' | 'manual') => DesyncDump
  /** The driver, for the network layer to feed and question. */
  readonly driver: Driver
  start: () => void
}

/**
 * Thrown when the browser cannot give us a WebGL context.
 *
 * Worth its own error type. Without it, three.js throws deep inside the
 * renderer, `main.ts` dies on its first line, and every listener and palette
 * built afterwards silently never exists — the page renders the static HUD and
 * nothing at all responds. A blank game that looks fine is the worst failure
 * mode this project has, and it is the same principle as the placement
 * refusals: say why.
 */
export class WebGLUnavailable extends Error {
  constructor(cause: unknown) {
    super('WebGL is unavailable in this browser')
    this.name = 'WebGLUnavailable'
    this.cause = cause
  }
}

/**
 * Build identity, stamped into every dump.
 *
 * Two peers running different builds is the most likely cause of a desync that
 * is not a real bug, and the cheapest to rule out -- but only if the file says
 * which build produced it. Vite substitutes this at build time.
 */
const BUILD = __BUILD__

export function createScene(
  canvasParent: HTMLElement,
  bot: BotConfig | null = BOT_NORMAL,
): Scene {
  const driver = new Driver(0, bot)
  /** This client controls player 0 and defends lane 0. */
  /**
   * The seat this client plays. Read through the driver rather than captured,
   * because it is not known when the scene is built: it arrives from the relay
   * in `welcome`, after the canvas exists. A captured constant meant seat 1
   * rendered seat 0's lane and sent commands the relay refused.
   */
  const me = () => driver.me

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch (err) {
    throw new WebGLUnavailable(err)
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  canvasParent.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0e1013)

  // Orthographic so identical towers at opposite ends of the lane read the same
  // size. A perspective camera would make the far end of your maze look weaker
  // than the near end, which is exactly wrong for a game about reading a maze.
  /**
   * Side-by-side layout. Your lane occupies 0..GRID_W; the opponent's sits to
   * the right of it across OPP_GAP, at the same size, and the camera frames
   * both.
   *
   * Both boards render full size because the lane is 8 wide: two of them plus
   * the gap is 20 tiles across, against 24 down, so the pair is roughly square
   * and fits any laptop. That is what the narrow lane bought. The horizontal
   * 40 x 24 lane could not do this -- two of those was 2080px and forced the
   * opponent's board down to 40% scale, where reading their maze to counter-pick
   * was an open question. It is not a question any more.
   *
   * These are module-level rather than inline because the camera framing and
   * the opponent group have to agree on them exactly. They did not on the first
   * pass -- the camera still centred on your lane alone, so the opponent's board
   * hung off the right edge of the screen and only a sliver of it was visible.
   */
  const OPP_GAP = 4
  const CONTENT_W = GRID_W * 2 + OPP_GAP
  const CONTENT_CX = CONTENT_W / 2

  /**
   * Near top-down, unlike the old horizontal board.
   *
   * The tilt foreshortens whichever axis it leans along, and that axis is now
   * the 24-tile length of the lane rather than its width. At the old 57 degrees
   * a vertical lane rendered visibly squashed; 75 degrees costs 3% of the
   * length and keeps enough angle for tower height to read as height.
   */
  const CAM_UP = 30
  const CAM_BACK = 8

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
  camera.position.set(CONTENT_CX, CAM_UP, GRID_H / 2 + CAM_BACK)
  camera.lookAt(CONTENT_CX, 0, GRID_H / 2)

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

  // One InstancedMesh per archetype. Three draw calls instead of one, in
  // exchange for reading a maze's composition at a glance without clicking.
  const towerMeshes: THREE.InstancedMesh[] = []
  for (const kind of [TowerKind.Single, TowerKind.Splash, TowerKind.Slow]) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE * 0.82, TOWER_H, TILE * 0.82),
      new THREE.MeshLambertMaterial({ color: TOWER_COLOUR[kind] }),
      TILE_COUNT,
    )
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(mesh)
    towerMeshes.push(mesh)
  }

  /**
   * Pending towers, drawn translucent.
   *
   * A predicted tower must never look like a placed one. It is a promise the
   * relay has not kept yet, and drawing it solid would mean the player cannot
   * tell what their opponent can already see. Prediction is client-only and
   * never enters the state hash.
   */
  const ghostMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE * 0.82, TOWER_H, TILE * 0.82),
    new THREE.MeshLambertMaterial({
      color: 0x9fd8ff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
    64,
  )
  ghostMesh.count = 0
  ghostMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(ghostMesh)

  // Selection ring, and the range circle it implies.
  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.52, TILE * 0.62, 24),
    new THREE.MeshBasicMaterial({ color: 0x63c8a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  )
  selectRing.rotation.x = -Math.PI / 2
  selectRing.visible = false
  scene.add(selectRing)

  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.04, 48),
    new THREE.MeshBasicMaterial({ color: 0x63c8a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  )
  rangeRing.rotation.x = -Math.PI / 2
  rangeRing.visible = false
  scene.add(rangeRing)

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

  /**
   * Lap pips.
   *
   * Instanced markers, not numerals. Text is not instanceable: 500 numeral
   * labels is 500 draw calls, and the count peaks exactly when the field is
   * most crowded and the frame budget tightest — a losing position, where
   * nearly every creep is on a high lap. Precision fades past five laps, which
   * is the right trade: you need to know a creep is bad, not that it is on lap
   * nine. Lap 1 draws nothing.
   */
  const MAX_PIPS = 5
  const pips = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.07, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xe8b84b }),
    MAX_CREEPS * MAX_PIPS,
  )
  pips.count = 0
  pips.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(pips)

  /**
   * Leak trail: the route the creep that just leaked was taking.
   *
   * Under the loop rule you ask "why does this keep getting through" about the
   * same creep repeatedly, so the answer has to be visible rather than
   * inferred. This draws the current field route at the moment of the leak,
   * which is the route the creep walked unless the maze changed mid-lap — an
   * approximation, and a deliberate one: retaining a per-creep tile history for
   * hundreds of creeps costs far more than it teaches.
   */
  const leakTrail = new PathLine(0xd0483c, 0.85, 0.08)
  scene.add(leakTrail.object)
  let leakTrailUntil = 0

  /**
   * The opponent's lane, drawn beside yours at the same size.
   *
   * Counter-picking is premise-level — "you see their maze and send what
   * exploits it" — so their board cannot be hidden, and it cannot be squinted
   * at either. Same tile size, same tower geometry, different colours: the only
   * difference between the two boards is that you cannot click theirs.
   */
  const oppGroup = new THREE.Group()
  oppGroup.position.set(GRID_W + OPP_GAP, 0, 0)
  scene.add(oppGroup)

  // A frame, so the second board reads as a board of its own rather than as a
  // continuation of yours across the gap.
  const oppFrame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(GRID_W + 1, GRID_H + 1)),
    new THREE.LineBasicMaterial({ color: 0x39424d }),
  )
  oppFrame.rotation.x = -Math.PI / 2
  oppFrame.position.set(GRID_W / 2, 0.02, GRID_H / 2)
  oppGroup.add(oppFrame)

  const oppGround = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_W, GRID_H),
    new THREE.MeshBasicMaterial({ color: 0x11151a }),
  )
  oppGround.rotation.x = -Math.PI / 2
  oppGround.position.set(GRID_W / 2, 0, GRID_H / 2)
  oppGroup.add(oppGround)

  // Same grid and the same IN/OUT markers as your own board. At 40% scale these
  // were noise; at full size they are what lets you count the gap in their maze
  // and pick the creep that walks it.
  oppGroup.add(gridLines(0x1e232a))
  for (const t of SPAWN_TILES) oppGroup.add(marker(t, 0x1f5d48))
  for (const t of EXIT_TILES) oppGroup.add(marker(t, 0x7d332e))

  const oppTowers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE * 0.82, TOWER_H, TILE * 0.82),
    new THREE.MeshLambertMaterial({ color: 0x6a7079 }),
    TILE_COUNT,
  )
  oppTowers.count = 0
  oppTowers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  oppGroup.add(oppTowers)

  const oppCreeps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(CREEP_R, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0x9ac06a }),
    MAX_CREEPS,
  )
  oppCreeps.count = 0
  oppCreeps.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  oppGroup.add(oppCreeps)

  const hoverMaterial = new THREE.MeshBasicMaterial({
    color: 0x4f8cc9,
    transparent: true,
    opacity: 0.5,
  })
  const hover = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 0.9, 0.06, TILE * 0.9),
    hoverMaterial,
  )
  hover.visible = false
  scene.add(hover)

  const OK_COLOUR = 0x4f8cc9
  const REFUSED_COLOUR = 0xc4453c

  // Two routes: what creeps do now, and what they would do if you built here.
  // Seeing the difference is how a player learns to maze; the number alone
  // tells you a placement is good without telling you why.
  const currentPath = new PathLine(0x5b6470, 0.55, 0.04)
  const candidatePath = new PathLine(0x63c8a0, 0.95, 0.06)
  scene.add(currentPath.object)
  scene.add(candidatePath.object)

  // Reused across hovers: a candidate rebuild per tile would otherwise allocate
  // two typed arrays every time the pointer crosses a tile boundary.
  const probeField: FlowField = createField()
  const routeScratch: number[] = []

  const scratch = new THREE.Matrix4()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  let hovered: Tile | null = null
  let selected: Tile | null = null
  let tool: TowerKind = TowerKind.Single
  let lastSyncedTick = -1
  let lastLeaks = 0
  let hoverCb: (h: HoverInfo) => void = () => {}
  let statsCb: (s: Stats) => void = () => {}
  let selectCb: (sel: Selection | null) => void = () => {}
  let ghostCb: ((text: string) => void) | null = null

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
   * Preview the tile under the cursor.
   *
   * Runs on tile change only, never on raw pointer movement: each call is a
   * candidate field rebuild, and the pointer fires far more often than it
   * crosses a tile boundary.
   *
   *   allowed  ──▶ blue ghost + green candidate route + "+54 tiles"
   *   refused  ──▶ red ghost  + the reason, in words
   */
  function previewTile(t: Tile | null): void {
    if (!t) {
      hover.visible = false
      candidatePath.hide()
      hoverCb({ tile: null, mazeDelta: null, refusal: Refusal.None, refusalText: '' })
      return
    }

    const state = driver.current
    const check = checkBuild(state, me(), t.x, t.y, tool, probeField)
    const allowed = check.refusal === Refusal.None

    hover.position.set(t.x + 0.5, 0.03, t.y + 0.5)
    hoverMaterial.color.setHex(allowed ? OK_COLOUR : REFUSED_COLOUR)
    hover.visible = true

    if (allowed) {
      // checkBuild already rebuilt the field into probeField with this tile
      // blocked, so the route is there for the taking — no second rebuild.
      const i = tileIndex(t)
      state.lanes[me()]!.blocked[i] = 1
      buildField(state.lanes[me()]!.blocked, probeField)
      state.lanes[me()]!.blocked[i] = 0
      candidatePath.set(pathFrom(probeField, SPAWN_INDICES[0] as number, routeScratch))
    } else {
      candidatePath.hide()
    }

    const before = mazeLength(state.lanes[me()]!.field)
    const delta =
      allowed && before !== UNREACHABLE && check.mazeAfter !== UNREACHABLE
        ? check.mazeAfter - before
        : null

    hoverCb({
      tile: t,
      mazeDelta: delta,
      refusal: check.refusal,
      refusalText: REFUSAL_TEXT[check.refusal],
    })
  }

  renderer.domElement.addEventListener('pointermove', (ev) => {
    const t = tileUnderPointer(ev)
    const changed = t?.x !== hovered?.x || t?.y !== hovered?.y
    hovered = t
    if (changed) previewTile(t)
  })

  renderer.domElement.addEventListener('pointerleave', () => {
    hovered = null
    previewTile(null)
  })

  /**
   * Click does one of two things depending on what is under it.
   *
   * An occupied tile selects its tower, which opens the upgrade/sell panel —
   * upgrading is the most frequent mid-match action after placing, and putting
   * it on the tile keeps your eyes on the maze rather than on a side bar.
   * An empty tile places the current tool.
   */
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    const t = tileUnderPointer(ev)
    if (!t) { select(null); return }
    const state = driver.current
    if (state.lanes[me()]!.towers.kind[tileIndex(t)] !== -1) {
      select(t)
      return
    }
    select(null)
    if (checkBuild(state, me(), t.x, t.y, tool, probeField).refusal === Refusal.None) {
      driver.queueBuild(t.x, t.y, tool)
    }
  })

  function select(t: Tile | null): void {
    selected = t
    if (!t) {
      selectRing.visible = false
      rangeRing.visible = false
      selectCb(null)
      return
    }
    const state = driver.current
    const i = tileIndex(t)
    const kind = state.lanes[me()]!.towers.kind[i] as TowerKind
    const level = state.lanes[me()]!.towers.level[i] as number
    const spec = levelOf(kind, level)

    selectRing.position.set(t.x + 0.5, 0.05, t.y + 0.5)
    selectRing.visible = true
    rangeRing.position.set(t.x + 0.5, 0.045, t.y + 0.5)
    rangeRing.scale.set(spec.range, spec.range, 1)
    rangeRing.visible = true

    const canUpgrade = checkUpgrade(state, me(), t.x, t.y) === Refusal.None
    selectCb({
      tile: t,
      tower: kind,
      level,
      upgradeCost: level < MAX_LEVEL ? levelOf(kind, level + 1).cost : null,
      sellValue: sellValue(state, me(), t.x, t.y),
      canUpgrade,
    })
  }

  /**
   * Rebuild tower instances, grouped by archetype.
   *
   * Level is drawn as height so maze strength is readable without clicking:
   * a level 3 tower stands visibly taller than a level 1.
   */
  /**
   * Draw what is in flight, and retire what has resolved.
   *
   * Three outcomes, not two. A confirmed ghost simply disappears -- the real
   * tower is already underneath it. A refused or lost one is reported once and
   * removed, because a translucent tower left on screen forever is exactly how
   * a game looks when it is ignoring your clicks, in the mechanic the player
   * uses most.
   */
  function syncGhosts(): void {
    let n = 0
    for (const g of [...driver.ghosts]) {
      if (g.state === 'confirmed') {
        driver.clearGhost(g)
        continue
      }
      if (g.state === 'refused' || g.state === 'lost') {
        if (ghostCb) {
          ghostCb(
            g.state === 'lost'
              ? 'Command lost on the way to your opponent — try again.'
              : `Refused: ${REFUSAL_WIRE[g.reason ?? ''] ?? g.reason ?? 'unknown'}`,
          )
        }
        driver.clearGhost(g)
        continue
      }
      const cmd = g.cmd
      if (cmd.kind !== Kind.Build || n >= 64) continue
      scratch.makeTranslation(cmd.x + 0.5, TOWER_H / 2, cmd.y + 0.5)
      ghostMesh.setMatrixAt(n, scratch)
      n += 1
    }
    ghostMesh.count = n
    ghostMesh.instanceMatrix.needsUpdate = true
  }

  function syncTowers(): number {
    const t = driver.current.lanes[me()]!.towers
    const counts = [0, 0, 0]
    for (let i = 0; i < TILE_COUNT; i++) {
      const kind = t.kind[i] as number
      if (kind === -1) continue
      const level = t.level[i] as number
      const h = TOWER_H * (0.7 + 0.3 * level)
      const mesh = towerMeshes[kind] as THREE.InstancedMesh
      scratch.makeScale(1, h / TOWER_H, 1)
      scratch.setPosition(tileX(i) + 0.5, h / 2, tileY(i) + 0.5)
      mesh.setMatrixAt(counts[kind] as number, scratch)
      counts[kind] = (counts[kind] as number) + 1
    }
    let total = 0
    for (let k = 0; k < towerMeshes.length; k++) {
      const mesh = towerMeshes[k] as THREE.InstancedMesh
      mesh.count = counts[k] as number
      mesh.instanceMatrix.needsUpdate = true
      total += counts[k] as number
    }
    return total
  }

  /** Draw creeps between the previous and current tick. */
  function syncCreeps(alpha: number): void {
    const curr = driver.current.lanes[me()]!.creeps
    const prev = driver.previous.lanes[me()]!.creeps
    let pipCount = 0
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

      // Pips ride above the creep, one per lap, capped. Lap 1 draws none:
      // a creep on its first pass is the population that does not matter yet.
      const laps = curr.laps[i] as number
      const show = laps > MAX_PIPS ? MAX_PIPS : laps
      for (let p = 0; p < show; p++) {
        scratch.makeTranslation(x - 0.16 + p * 0.08, CREEP_R + 0.34, y)
        pips.setMatrixAt(pipCount, scratch)
        pipCount += 1
      }
    }
    creeps.count = curr.count
    creeps.instanceMatrix.needsUpdate = true
    pips.count = pipCount
    pips.instanceMatrix.needsUpdate = true
  }

  /** Mirror the opponent's lane into its scaled group. */
  function syncOpponent(): void {
    const lane = driver.current.lanes[1 - me()]!
    let n = 0
    for (let i = 0; i < TILE_COUNT; i++) {
      if (lane.towers.kind[i] === -1) continue
      scratch.makeTranslation(tileX(i) + 0.5, TOWER_H / 2, tileY(i) + 0.5)
      oppTowers.setMatrixAt(n, scratch)
      n += 1
    }
    oppTowers.count = n
    oppTowers.instanceMatrix.needsUpdate = true

    const c = lane.creeps
    for (let i = 0; i < c.count; i++) {
      scratch.makeTranslation(c.x[i] as number, CREEP_R + 0.02, c.y[i] as number)
      oppCreeps.setMatrixAt(i, scratch)
    }
    oppCreeps.count = c.count
    oppCreeps.instanceMatrix.needsUpdate = true
  }

  function resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h)
    const margin = 3
    // Both boards, not just yours.
    const halfW = (CONTENT_W + margin) / 2
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
    onSelect: (cb) => { selectCb = cb },
    onGhostFailed: (cb) => { ghostCb = cb },
    setTool: (tower) => {
      tool = tower
      if (hovered) previewTile(hovered)
    },
    send: (creep) => driver.queueSend(creep),
    setBot: (b) => driver.setBot(b),
    dump: (trigger) => driver.dump(trigger, BUILD),
    driver,
    upgradeSelected: () => {
      if (selected) driver.queueUpgrade(selected.x, selected.y)
    },
    sellSelected: () => {
      if (selected) {
        driver.queueSell(selected.x, selected.y)
        select(null)
      }
    },
    start: () => {
      resize()
      renderer.setAnimationLoop((nowMs) => {
        const ran = driver.advance(nowMs)
        const state = driver.current
        if (ran > 0 && state.tick !== lastSyncedTick) {
          const towerCount = syncTowers()
          syncGhosts()
          syncOpponent()
          lastSyncedTick = state.tick
          currentPath.set(pathFrom(state.lanes[me()]!.field, SPAWN_INDICES[0] as number))
          // Both of these go stale the moment the field or the gold changes.
          if (hovered) previewTile(hovered)
          if (selected) {
            if (state.lanes[me()]!.towers.kind[tileIndex(selected)] === -1) select(null)
            else select(selected)
          }
          // A leak just happened: show the route that produced it. Comparing
          // leak counts is cheaper and more reliable than watching lap numbers
          // on individual creeps, which move between array slots as creeps die.
          if (state.players[me()]!.leaks > lastLeaks) {
            leakTrail.set(pathFrom(state.lanes[me()]!.field, SPAWN_INDICES[0] as number))
            leakTrailUntil = state.tick + 60
          }
          lastLeaks = state.players[me()]!.leaks
          if (state.tick > leakTrailUntil) leakTrail.hide()

          const maze = mazeLength(state.lanes[me()]!.field)
          statsCb({
            towers: towerCount,
            creeps: state.lanes[me()]!.creeps.count,
            maze: maze === UNREACHABLE ? -1 : maze,
            tick: state.tick,
            gold: state.players[me()]!.gold,
            kills: state.players[me()]!.kills,
            lives: state.players[me()]!.lives,
            leaks: state.players[me()]!.leaks,
            income: state.players[me()]!.income,
            result: state.result,
            winner: state.winner,
            oppLives: state.players[1 - me()]!.lives,
            oppCreeps: state.lanes[1 - me()]!.creeps.count,
            desync: driver.desync,
            peerLag: driver.lockstep ? driver.peerLag(me()) : 0,
          })
        }
        syncCreeps(driver.alpha)
        renderer.render(scene, camera)
      })
    },
  }
}

function gridLines(color = 0x272c33): THREE.LineSegments {
  const pts: number[] = []
  for (let x = 0; x <= GRID_W; x++) pts.push(x, 0.01, 0, x, 0.01, GRID_H)
  for (let y = 0; y <= GRID_H; y++) pts.push(0, 0.01, y, GRID_W, 0.01, y)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }))
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
