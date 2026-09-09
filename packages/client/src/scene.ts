import * as THREE from 'three'
import {
  GRID_W,
  GRID_H,
  SPAWN_TILES,
  EXIT_TILES,
  ENTRANCE_ROW,
  EXIT_ROW,
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
  sellValue,
  buildField,
  createField,
  mazeLength,
  pathFrom,
  TowerKind,
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
import { ensureCapacity, spanningInstances, INITIAL_INSTANCES } from './instances'
import { PathLine } from './pathline'
import { createRenderer } from './render/renderer'
import { buildBoard, BOARD, BOARD_DIM } from './render/board'
import { CameraRig, type GroundBounds } from './render/CameraRig'
import { groundToTile, screenToGround, type LaneLayout } from './render/picking'

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
  [Refusal.BuildPhase]: 'Build phase — no sending yet',
  [Refusal.LaneFull]: 'Their lane is full — nothing more fits',
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
/**
 * Base tower height, in tiles.
 *
 * Was 0.55, which at this camera read as a coloured square rather than a block:
 * the pitch is 56 degrees, so a tower barely half a tile tall shows almost no
 * side face and the board looked flat. /camera drew its stand-ins at 1.5 and
 * that is the look this is matched to -- 1.1 here, because the game scales
 * height by LEVEL on top of this (`0.7 + 0.3 * level`), so a level 3 tower
 * reaches 1.76 and the difference between levels stays visible without the
 * tallest towers hiding the creeps walking behind them.
 */
const TOWER_H = 1.1
const CREEP_R = 0.3

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
  /**
   * Tell the camera how much of the viewport the fixed UI covers, in CSS
   * pixels, so the board is framed into what is actually visible. The DOM
   * chrome belongs to `main.ts`, so measuring it does too.
   */
  readonly setSafeArea: (top: number, right: number, bottom: number, left: number) => void
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
 *
 * It lives in `render/renderer.ts` now, alongside the renderer that throws it,
 * and is re-exported here so `main.ts` keeps its one import.
 */
export { WebGLUnavailable } from './render/renderer'

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

  // The shared renderer and resize hub, so the camera demo at /camera and the
  // game are never two GL contexts fighting over one page.
  const host = createRenderer(canvasParent)
  const renderer = host.renderer

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x11151a)

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

  /**
   * Perspective, on a fixed high-angle rig. See `render/CameraRig.ts`.
   *
   * This board was orthographic once, for a reason worth recording rather than
   * deleting: under perspective a tower at the far end of the lane draws
   * smaller than an identical one near the camera, and this is a game about
   * reading a maze at a glance. That cost is real and it has not gone away --
   * it has been bounded, twice. At the rig's tuned pose the near row of a lane
   * now renders 1.095x the width of the far row, against 1.403x before and
   * 1.565x at the 45 degrees the rig started on; the tilt still buys back depth
   * cues (tower sides, height as height) that flat orthographic never had.
   * `DEFAULT_FOV_DEG` carries the measurements and the conditions they hold
   * under -- the numbers formerly quoted here stated neither, and were wrong.
   *
   * The pan bounds are the whole content rectangle rather than your own lane,
   * so a player can always walk the camera over to the opponent's board. That
   * is premise-level in this game -- you counter-pick what you send by reading
   * their maze -- and a clamp that fenced you into your own half would quietly
   * remove it.
   */
  const CONTENT: GroundBounds = { minX: -1, minZ: -1, maxX: CONTENT_W + 1, maxZ: GRID_H + 1 }

  const rig = new CameraRig(host.canvas, {
    bounds: CONTENT,
    // Arrows only: `q w e r t y` send creeps and `d` saves a match file, so the
    // rig must not claim WASD. See the `keys` option.
    keys: 'arrows',
    /**
     * The closest useful zoom, in tiles rather than in distance.
     *
     * Originally a workaround: the clamp used to require the whole view to fit
     * inside the content, and on a 2:1 desktop the view is still 22.4 tiles
     * wide at distance 14 against a 22-tile rectangle, so every attempt to zoom
     * into your own maze snapped the camera back to the gap between the boards.
     * The clamp holds the target now instead of the view, so that trap is gone
     * -- but a low floor stays, because leaning in far enough to read a single
     * corner of a maze is worth having on its own.
     *
     * 8 became 16 when the field of view narrowed to 18. Distance is the wrong
     * unit for this limit: what the player cares about is how much ground fills
     * the screen, and that is `2 * d * tan(fov/2)`. Holding d at 8 through the
     * fov change would have silently halved the closest view from about five
     * tiles to about two and a half -- tightening the zoom as a side effect of
     * a change about taper. 16 is 8 scaled by tan(35/2)/tan(18/2), which keeps
     * the floor exactly where it was.
     */
    minDistance: 16,
    // Edge scrolling is off. It is right for an RTS with an opaque UI band at
    // the bottom, and wrong here: the board already fits on screen at the
    // default framing, so the only thing edge scroll would reliably do is slide
    // the lane out from under a cursor that was reaching for the palette.
    edgeSize: 0,
  })
  const camera = rig.camera

  /** Your lane's footprint on the ground, for picking. */
  const MY_LANE: LaneLayout = {
    originX: 0,
    originZ: 0,
    width: GRID_W,
    length: GRID_H,
    tile: TILE,
  }

  // The /camera lighting, not a second set tuned by eye. A directional key at a
  // shallower angle than the camera is what gives a tower two visibly different
  // faces; the flat ambient the board used to sit under made every block read
  // as a coloured square.
  scene.add(new THREE.AmbientLight(0xffffff, 1.35))
  const key = new THREE.DirectionalLight(0xffffff, 1.15)
  key.position.set(-14, 26, 10)
  scene.add(key)

  /** Which rows are reserved, and which tiles creeps really use. */
  const ROWS = {
    entranceRow: ENTRANCE_ROW,
    exitRow: EXIT_ROW,
    spawnTiles: SPAWN_TILES,
    exitTiles: EXIT_TILES,
  }

  scene.add(buildBoard(MY_LANE, BOARD, ROWS))

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
    spanningInstances(mesh)
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
  spanningInstances(ghostMesh)
  scene.add(ghostMesh)

  // Selection ring, and the range circle it implies.
  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.52, TILE * 0.62, 24),
    new THREE.MeshBasicMaterial({ color: 0x63c8a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  )
  selectRing.rotation.x = -Math.PI / 2
  selectRing.visible = false
  scene.add(selectRing)

  /**
   * Two range circles, not one, over a single shared geometry.
   *
   * Selection and hover are simultaneous states, and a single mesh forces a
   * precedence rule between them. Sharing one was the shape this started in and
   * it had two failures waiting in it: `previewTile(null)` fires whenever the
   * cursor leaves the board, so hiding the ring there would hide the ring of a
   * tower the player had deliberately selected; and tinting the ring red for a
   * refused placement would recolour the selection's ring too, because a
   * `MeshBasicMaterial` instance is shared state.
   *
   * Split, each ring has exactly one writer -- `select()` owns `selectRange`,
   * `previewTile()` owns `hoverRange` -- and neither can reach the other. The
   * geometry is shared, so this costs one draw call and no memory worth
   * counting, against a scene that already carries four other overlays.
   *
   * It also buys the comparison the player is actually making while placing:
   * both circles on screen at once answers "does this cover the gap that one
   * misses?", which one ring could never show.
   */
  const rangeGeo = new THREE.RingGeometry(1, 1.04, 48)

  const selectRange = new THREE.Mesh(
    rangeGeo,
    new THREE.MeshBasicMaterial({ color: 0x63c8a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  )
  selectRange.rotation.x = -Math.PI / 2
  selectRange.visible = false
  scene.add(selectRange)

  /**
   * Dimmer than the selection ring and tinted by legality, so the two read
   * apart when both are on screen: what you have versus what you are proposing.
   */
  const hoverRange = new THREE.Mesh(
    rangeGeo,
    new THREE.MeshBasicMaterial({ color: 0x4f8cc9, transparent: true, opacity: 0.26, side: THREE.DoubleSide }),
  )
  hoverRange.rotation.x = -Math.PI / 2
  hoverRange.visible = false
  scene.add(hoverRange)

  // Creeps are instanced from the start because the design bounds their
  // population only by gold. This is the mesh that has to survive 500 of them.
  let creeps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(CREEP_R, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xd8613f }),
    INITIAL_INSTANCES,
  )
  creeps.count = 0
  creeps.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  spanningInstances(creeps)
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
  let pips = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.07, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xe8b84b }),
    INITIAL_INSTANCES,
  )
  pips.count = 0
  pips.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  spanningInstances(pips)
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
    new THREE.LineBasicMaterial({ color: 0x4d5945 }),
  )
  oppFrame.rotation.x = -Math.PI / 2
  oppFrame.position.set(GRID_W / 2, 0.02, GRID_H / 2)
  oppGroup.add(oppFrame)

  // The same board, one key lower. At 40% scale the markings were noise; at
  // full size they are what lets you count the gap in their maze and pick the
  // creep that walks it. Dimmer only so you never mistake whose board you are
  // clicking -- you build on exactly one of them.
  oppGroup.add(buildBoard(MY_LANE, BOARD_DIM, ROWS))

  const oppTowers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE * 0.82, TOWER_H, TILE * 0.82),
    new THREE.MeshLambertMaterial({ color: 0x6a7079 }),
    TILE_COUNT,
  )
  oppTowers.count = 0
  oppTowers.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  spanningInstances(oppTowers)
  oppGroup.add(oppTowers)

  let oppCreeps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(CREEP_R, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0x9ac06a }),
    INITIAL_INSTANCES,
  )
  oppCreeps.count = 0
  oppCreeps.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  spanningInstances(oppCreeps)
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
  // Scratch for picking. `screenToGround` writes through these rather than
  // allocating, which matters because the hover path runs on every pointer move
  // and again on every frame the camera has moved under a stationary cursor.
  const pickPoint = new THREE.Vector3()
  const pickNdc = new THREE.Vector2()
  const pickTile = { x: 0, y: 0 }

  /** Last known pointer position, so a pan can re-resolve the hovered tile. */
  let pointerX = 0
  let pointerY = 0
  let pointerInside = false

  let hovered: Tile | null = null
  let selected: Tile | null = null
  let tool: TowerKind = TowerKind.Single
  let lastSyncedTick = -1
  let lastLeaks = 0
  let hoverCb: (h: HoverInfo) => void = () => {}
  let statsCb: (s: Stats) => void = () => {}
  let selectCb: (sel: Selection | null) => void = () => {}
  let ghostCb: ((text: string) => void) | null = null

  /**
   * The tile under a screen point, or null.
   *
   * Plane maths rather than a `Raycaster` against the ground mesh. The
   * raycaster allocated a `Ray` and a hit array per call and walked the mesh's
   * geometry to intersect a plane it already knew was flat; this is the same
   * answer without the garbage. `groundToTile` bounds the result to your own
   * lane, which is what keeps a click on the opponent's board -- now reachable,
   * since the camera can pan over there -- from being read as a build on yours.
   */
  function tileAt(clientX: number, clientY: number): Tile | null {
    const hit = screenToGround(camera, clientX, clientY, rig.viewportRect, pickPoint, pickNdc)
    if (!hit) return null
    const t = groundToTile(hit, MY_LANE, pickTile)
    if (!t) return null
    return inBounds(t.x, t.y) ? { x: t.x, y: t.y } : null
  }

  /**
   * Re-resolve the hovered tile from the last pointer position.
   *
   * Called on pointer movement AND once a frame, because the camera now moves:
   * panning under a stationary cursor changes which tile is beneath it, and a
   * highlight that only updated on `pointermove` would sit on the wrong tile
   * until you jiggled the mouse. The expensive part -- `previewTile`, which
   * rebuilds a candidate flow field -- still runs only when the tile changes.
   */
  function refreshHover(): void {
    if (!pointerInside) return
    const t = tileAt(pointerX, pointerY)
    if (t?.x === hovered?.x && t?.y === hovered?.y) return
    hovered = t
    previewTile(t)
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
      // Only the hover's own ring. The selection's is `select()`'s to hide, and
      // reaching for it here is what made one shared mesh unworkable: the
      // cursor leaving the board would erase the range of a tower the player
      // had deliberately clicked.
      hoverRange.visible = false
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

    /**
     * What the tower you are about to buy would cover.
     *
     * Level 1, because that is what a placement builds -- the upgrade path is
     * the selection ring's job once the tower exists. Shown on refused tiles
     * too, tinted with the ghost: knowing a spot has the coverage you want is
     * useful even when the reason you cannot build there is that it would seal
     * the lane, since the answer is usually the neighbouring tile.
     */
    if (check.refusal === Refusal.Occupied) {
      // A tile that already holds a tower has a range worth seeing, but it is
      // that tower's, not the tool's -- and it is one click away on the
      // selection ring. Drawing the proposed reach over an existing tower would
      // read as a claim about the tower that is there.
      hoverRange.visible = false
    } else {
      const reach = levelOf(tool, 1).range
      hoverRange.position.set(t.x + 0.5, 0.042, t.y + 0.5)
      hoverRange.scale.set(reach, reach, 1)
      ;(hoverRange.material as THREE.MeshBasicMaterial).color.setHex(
        allowed ? OK_COLOUR : REFUSED_COLOUR,
      )
      hoverRange.visible = true
    }

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
    pointerX = ev.clientX
    pointerY = ev.clientY
    pointerInside = true
    refreshHover()
  })

  renderer.domElement.addEventListener('pointerleave', () => {
    pointerInside = false
    hovered = null
    previewTile(null)
  })

  /**
   * A tap does one of two things depending on what is under it.
   *
   * An occupied tile selects its tower, which opens the upgrade/sell panel —
   * upgrading is the most frequent mid-match action after placing, and putting
   * it on the tile keeps your eyes on the maze rather than on a side bar.
   * An empty tile places the current tool.
   *
   * This fires on pointer*up*, and builds unless the camera actually moved.
   * The distinction did not exist while the camera was fixed and it has to now:
   * a drag pans, and on touch that drag begins with a `pointerdown` on a tile,
   * so building on the down event would drop a tower every time a phone player
   * pushed the board around.
   *
   * "Did the camera move" is asked of the RIG rather than re-derived from a
   * pixel threshold here. Two thresholds that had to agree is exactly what went
   * wrong: this file called anything past 6px a drag while the rig had not
   * started panning yet, so a click that drifted -- which a real mouse does --
   * fell in the gap and did nothing at all. No tower, no pan, no feedback, and
   * nothing on screen to say why.
   */
  let tapId = -1

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    // Middle and right belong to the camera; only a primary press can build.
    if (ev.button !== 0) return
    tapId = ev.pointerId
  })

  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (ev.pointerId !== tapId) return
    tapId = -1
    // The gesture dragged the map, so it was not a build. It is also a
    // deliberate camera move, which retires the automatic framing -- otherwise
    // the next resize would yank the view back from wherever it was put.
    if (rig.didPan(ev.pointerId)) {
      cameraMoved = true
      return
    }

    const t = tileAt(ev.clientX, ev.clientY)
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

  renderer.domElement.addEventListener('pointercancel', () => { tapId = -1 })

  function select(t: Tile | null): void {
    selected = t
    if (!t) {
      selectRing.visible = false
      selectRange.visible = false
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
    selectRange.position.set(t.x + 0.5, 0.045, t.y + 0.5)
    selectRange.scale.set(spec.range, spec.range, 1)
    selectRange.visible = true

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

    // Size the buffers before writing into them. Pips need counting first: a
    // creep draws one per lap up to MAX_PIPS, so the total is a property of the
    // match rather than of the creep count, and reserving MAX_PIPS per creep
    // would over-allocate fivefold for a board that has barely lapped.
    let pipsNeeded = 0
    for (let i = 0; i < curr.count; i++) {
      const laps = curr.laps[i] as number
      pipsNeeded += laps > MAX_PIPS ? MAX_PIPS : laps
    }
    creeps = ensureCapacity(creeps, curr.count, MAX_CREEPS, scene)
    pips = ensureCapacity(pips, pipsNeeded, MAX_CREEPS * MAX_PIPS, scene)

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
    oppCreeps = ensureCapacity(oppCreeps, c.count, MAX_CREEPS, oppGroup)
    for (let i = 0; i < c.count; i++) {
      scratch.makeTranslation(c.x[i] as number, CREEP_R + 0.02, c.y[i] as number)
      oppCreeps.setMatrixAt(i, scratch)
    }
    oppCreeps.count = c.count
    oppCreeps.instanceMatrix.needsUpdate = true
  }

  /**
   * Default framing, re-applied on every resize until the player moves the
   * camera themselves.
   *
   * Landscape frames both boards, which is what the orthographic camera did and
   * what counter-picking needs. Portrait frames your lane alone: fitting the
   * pair into a phone's aspect needs roughly twice the distance, and at that
   * range neither maze is readable, so the honest answer is to show one board
   * well and let the player pan to the other. The pan bounds still span both,
   * so the opponent is always one drag away.
   */
  let cameraMoved = false

  function frame(): void {
    if (cameraMoved) return
    if (window.innerWidth >= window.innerHeight) {
      rig.fitBounds(0, 0, CONTENT_W, GRID_H)
    } else {
      rig.fitBounds(0, 0, GRID_W, GRID_H)
    }
  }

  host.onResize((w, h) => {
    rig.setViewport(w, h)
    frame()
  })

  // Size and frame immediately, rather than waiting for `start()`. Until the
  // rig has been handed a real viewport it assumes a square one, so any framing
  // computed before this -- `setSafeArea` from `main.ts` runs at module load --
  // would be against an aspect the page never has.
  host.resize()

  // Any deliberate camera input retires the automatic framing, so a later
  // resize does not yank the view back from wherever the player put it.
  for (const type of ['wheel', 'keydown'] as const) {
    window.addEventListener(type, () => { cameraMoved = true }, { passive: true })
  }
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    // A left PRESS may still turn out to be a build, so it does not retire the
    // framing here; the pointerup above does that once the rig confirms it
    // dragged. Middle, right and touch have no other meaning.
    if (ev.button !== 0 || ev.pointerType === 'touch') cameraMoved = true
  })

  return {
    onTileHover: (cb) => { hoverCb = cb },
    onStats: (cb) => { statsCb = cb },
    onSelect: (cb) => { selectCb = cb },
    onGhostFailed: (cb) => { ghostCb = cb },
    setTool: (tower) => {
      tool = tower
      if (hovered) previewTile(hovered)
    },
    setSafeArea: (top, right, bottom, left) => {
      rig.setSafeArea(top, right, bottom, left)
      frame()
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
      host.resize()
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
        // Keyboard panning is integrated here, then the hover is re-resolved:
        // the tile under a stationary cursor changes when the camera moves.
        rig.update()
        refreshHover()
        renderer.render(scene, camera)
      })
    },
  }
}


