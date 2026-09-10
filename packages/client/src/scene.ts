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
  CreepArchetypeKind,
  CREEPS,
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
  type Lane,
  type TowerArchetype,
} from '@ltw/sim'
import { Driver } from './driver'
import { ensureCapacity, spanningInstances, INITIAL_INSTANCES } from './instances'
import { PathLine } from './pathline'
import { createRenderer } from './render/renderer'
import { buildBoard, BOARD, BOARD_THEIRS } from './render/board'
import { buildTerrain } from './render/terrain'
import { CameraRig, type GroundBounds } from './render/CameraRig'
import { groundToTile, screenToGround, type LaneLayout } from './render/picking'
import {
  towerModel,
  creepModel,
  projectileModel,
  muzzleHeight,
  creepHeight,
  type Model,
} from './render/models'
import { glowTexture, ringTexture, puffTexture, chevronTexture } from './render/textures'
import { SpritePool, ProjectilePool, CorpsePool } from './render/effects'
import { HealthBars } from './render/bars'
import { renderIcon } from './render/icons'

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

/** One line of plain English per refusal. The rule teaches itself or it does not exist. */
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

/**
 * The renderer reads sim state and draws it.
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
 *
 * The sim has no events. Shots, deaths, leaks and builds are all inferred here
 * by comparing the previous tick with the current one, once per tick, and then
 * played out over wall time by the pools in `render/effects.ts`. That keeps the
 * sim free of anything that exists only to be looked at.
 */

const TILE = 1
const KINDS = [TowerKind.Single, TowerKind.Splash, TowerKind.Slow] as const
const CREEP_KINDS = [CreepArchetypeKind.Swarm, CreepArchetypeKind.Runner, CreepArchetypeKind.Tank] as const

/** A heavier tier is a bigger creature. */
function tierScale(tier: number): number {
  return 1 + 0.22 * tier
}

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

export interface Icons {
  /** One data URL per tower kind, at level 1. */
  readonly towers: readonly string[]
  /** One data URL per creep archetype. */
  readonly creeps: readonly string[]
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
  /** Pictures of the things the palette sells, rendered from the same models. */
  readonly icons: Icons
  /**
   * The renderer, exposed read-only so the benchmark scene can read
   * `renderer.info` (draw calls, triangles, live geometries and textures).
   *
   * Nothing in the game reads this. It exists because the alternative was for
   * the benchmark to stand up a SECOND WebGLRenderer to measure the first,
   * which means two GL contexts on one page — and browsers cap live contexts,
   * so the second silently evicts the first on some machines. Measuring the
   * real renderer is the only way the numbers mean anything.
   */
  readonly renderer: THREE.WebGLRenderer
  start: () => void
  /**
   * Draw one frame at wall time `nowMs`, advancing the sim as far as that
   * time warrants. `start()` hands this to the browser's animation loop; a
   * harness that has no animation loop -- a hidden tab, a benchmark -- calls
   * it itself.
   */
  readonly frame: (nowMs: number) => void
}

/**
 * Thrown when the browser cannot give us a WebGL context. Lives in
 * `render/renderer.ts` and is re-exported here so `main.ts` keeps its one import.
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
  // Sky through the gaps in the treeline, and what the field fades into.
  scene.background = new THREE.Color(0x7f9cc0)
  scene.fog = new THREE.Fog(0x7f9cc0, 70, 150)

  /**
   * Side-by-side layout. Your lane occupies 0..GRID_W; the opponent's sits to
   * the right of it across OPP_GAP, at the same size, and the camera frames
   * both.
   *
   * Both boards render full size because the lane is 8 wide: two of them plus
   * the gap is 20 tiles across, against 24 down, so the pair is roughly square
   * and fits any laptop. That is what the narrow lane bought.
   *
   * These are module-level rather than inline because the camera framing and
   * the opponent group have to agree on them exactly.
   */
  const OPP_GAP = 4
  const CONTENT_W = GRID_W * 2 + OPP_GAP

  /** Where a lane is drawn: yours at the origin, theirs across the gap. */
  const laneX = (lane: number): number => (lane === me() ? 0 : GRID_W + OPP_GAP)

  /**
   * Perspective, on a fixed high-angle rig. See `render/CameraRig.ts`.
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
     * The closest useful zoom, in tiles rather than in distance. 16 is 8
     * scaled by tan(35/2)/tan(18/2), which keeps the floor where it was when
     * the field of view narrowed from 35 to 18.
     */
    minDistance: 16,
    // Edge scrolling is off: the board already fits on screen at the default
    // framing, so the only thing edge scroll would reliably do is slide the
    // lane out from under a cursor that was reaching for the palette.
    edgeSize: 0,
  })
  const camera = rig.camera
  const PITCH = rig.pitchDeg

  /** Your lane's footprint on the ground, for picking. */
  const MY_LANE: LaneLayout = {
    originX: 0,
    originZ: 0,
    width: GRID_W,
    length: GRID_H,
    tile: TILE,
  }
  const THEIR_LANE: LaneLayout = { ...MY_LANE, originX: GRID_W + OPP_GAP }

  // ---- light ---------------------------------------------------------------
  //
  // One warm sun with a shadow map, and a sky-to-turf hemisphere for the fill.
  // The sun sits north-west and fairly high: low enough that a tower throws a
  // shadow you can see it by, high enough that a maze does not shade its own
  // corridors into illegibility.
  scene.add(new THREE.HemisphereLight(0xd6e4ff, 0x3f5230, 0.9))
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.75)
  sun.position.set(CONTENT_W / 2 - 14, 34, GRID_H / 2 + 12)
  sun.target.position.set(CONTENT_W / 2, 0, GRID_H / 2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 90
  sun.shadow.camera.left = -22
  sun.shadow.camera.right = 22
  sun.shadow.camera.top = 22
  sun.shadow.camera.bottom = -22
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  scene.add(sun)
  scene.add(sun.target)

  // ---- ground --------------------------------------------------------------

  const ROWS = {
    entranceRow: ENTRANCE_ROW,
    exitRow: EXIT_ROW,
    spawnTiles: SPAWN_TILES,
    exitTiles: EXIT_TILES,
  }

  scene.add(buildTerrain({ bounds: CONTENT, lanes: [MY_LANE, THEIR_LANE] }))
  scene.add(buildBoard(MY_LANE, BOARD, ROWS))
  scene.add(buildBoard(THEIR_LANE, BOARD_THEIRS, ROWS))

  // ---- materials, shared ----------------------------------------------------

  const litMat = new THREE.MeshLambertMaterial({ vertexColors: true })
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true })
  const ghostMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  })
  /** Tinted by legality on every hover. Its own instance: `color` is shared state. */
  const hoverGhostMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  })

  // ---- towers ------------------------------------------------------------
  //
  // One InstancedMesh per (kind, level), holding both lanes. Nine lit meshes
  // and one glow mesh -- the frost shrine's crystals -- for every tower on the
  // field, in exchange for a maze whose composition and strength read from
  // its skyline without clicking anything.

  interface TowerSet {
    readonly lit: THREE.InstancedMesh
    readonly glow: THREE.InstancedMesh | null
    count: number
  }
  const towerModels: Model[][] = KINDS.map((k) => [1, 2, 3].map((l) => towerModel(k, l)))
  const towerSets: TowerSet[][] = towerModels.map((levels) =>
    levels.map((model) => {
      const lit = new THREE.InstancedMesh(model.lit as THREE.BufferGeometry, litMat, TILE_COUNT)
      lit.count = 0
      lit.castShadow = true
      lit.receiveShadow = true
      lit.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      spanningInstances(lit)
      scene.add(lit)
      let glow: THREE.InstancedMesh | null = null
      if (model.glow) {
        glow = new THREE.InstancedMesh(model.glow, glowMat, TILE_COUNT)
        glow.count = 0
        glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        spanningInstances(glow)
        scene.add(glow)
      }
      return { lit, glow, count: 0 }
    }),
  )

  /**
   * Pending towers, drawn translucent.
   *
   * A predicted tower must never look like a placed one. It is a promise the
   * relay has not kept yet, and drawing it solid would mean the player cannot
   * tell what their opponent can already see. Prediction is client-only and
   * never enters the state hash.
   */
  const ghostMeshes = KINDS.map((k) => {
    const mesh = new THREE.InstancedMesh(
      (towerModels[k] as Model[])[0]!.lit as THREE.BufferGeometry,
      ghostMat,
      64,
    )
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    spanningInstances(mesh)
    scene.add(mesh)
    return mesh
  })

  /**
   * The tower you are about to place, standing on the hovered tile.
   *
   * Warcraft 3 shows the building where the cursor is, and it is the right
   * call here too: the flat square it replaced said WHERE but not WHAT, and
   * with three archetypes of different heights the silhouette is the point.
   */
  const hoverGhosts = KINDS.map((k) => {
    const model = (towerModels[k] as Model[])[0] as Model
    const g = new THREE.Group()
    g.add(new THREE.Mesh(model.lit as THREE.BufferGeometry, hoverGhostMat))
    if (model.glow) g.add(new THREE.Mesh(model.glow, hoverGhostMat))
    g.visible = false
    scene.add(g)
    return g
  })

  // Selection ring, and the range circle it implies.
  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.5, TILE * 0.6, 32),
    new THREE.MeshBasicMaterial({ color: 0x5ef07a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  )
  selectRing.rotation.x = -Math.PI / 2
  selectRing.visible = false
  selectRing.renderOrder = 3
  scene.add(selectRing)

  /**
   * Two range circles, not one, over a single shared geometry.
   *
   * Selection and hover are simultaneous states, and a single mesh forces a
   * precedence rule between them. Split, each ring has exactly one writer --
   * `select()` owns `selectRange`, `previewTile()` owns `hoverRange` -- and
   * neither can reach the other. It also buys the comparison the player is
   * actually making while placing: both circles on screen at once answers
   * "does this cover the gap that one misses?".
   */
  const rangeGeo = new THREE.RingGeometry(0.97, 1.03, 64)

  const selectRange = new THREE.Mesh(
    rangeGeo,
    new THREE.MeshBasicMaterial({ color: 0x5ef07a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
  )
  selectRange.rotation.x = -Math.PI / 2
  selectRange.visible = false
  selectRange.renderOrder = 3
  scene.add(selectRange)

  /**
   * Dimmer than the selection ring and tinted by legality, so the two read
   * apart when both are on screen: what you have versus what you are proposing.
   */
  const hoverRange = new THREE.Mesh(
    rangeGeo,
    new THREE.MeshBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
  )
  hoverRange.rotation.x = -Math.PI / 2
  hoverRange.visible = false
  hoverRange.renderOrder = 3
  scene.add(hoverRange)

  const hoverMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fb6ff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  })
  const hover = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.92, 0.04, TILE * 0.92), hoverMaterial)
  hover.visible = false
  hover.renderOrder = 3
  scene.add(hover)

  const OK_COLOUR = 0x6fb6ff
  const REFUSED_COLOUR = 0xe0483c

  // ---- creeps ------------------------------------------------------------
  //
  // One InstancedMesh per archetype (plus one for the glowing eyes), holding
  // both lanes, sized by `ensureCapacity` as the match grows. This is the mesh
  // that has to survive a thousand of them.

  interface CreepSet {
    lit: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>
    glow: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material> | null
    readonly corpses: CorpsePool
    readonly height: number
    count: number
  }
  const creepModels = CREEP_KINDS.map((k) => creepModel(k))
  const creepSets: CreepSet[] = creepModels.map((model, k) => {
    const lit = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>(
      model.lit as THREE.BufferGeometry,
      litMat,
      INITIAL_INSTANCES,
    )
    lit.count = 0
    lit.castShadow = true
    lit.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    lit.setColorAt(0, scratchColour.setRGB(1, 1, 1))
    spanningInstances(lit)
    scene.add(lit)
    let glow: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material> | null = null
    if (model.glow) {
      glow = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>(model.glow, glowMat, INITIAL_INSTANCES)
      glow.count = 0
      glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      spanningInstances(glow)
      scene.add(glow)
    }
    const corpses = new CorpsePool(model, litMat, glowMat, 192)
    if (corpses.lit) scene.add(corpses.lit)
    if (corpses.glow) scene.add(corpses.glow)
    return { lit, glow, corpses, height: creepHeight(CREEP_KINDS[k] as CreepArchetypeKind), count: 0 }
  })

  /**
   * Where every creep was last drawn, and which way it faced, per lane and
   * array slot. Read by projectiles chasing a target and by the corpse a creep
   * leaves, so a shot lands where the creature was seen rather than where the
   * sim had it a tick earlier.
   *
   * Indexed by slot rather than by id because slots are what the sim's arrays
   * use and a Map from id would allocate. When the sim compacts its arrays
   * after a death the slots shift, and `detectDeaths` shifts these to match in
   * the same pass.
   */
  const drawX = [new Float32Array(MAX_CREEPS), new Float32Array(MAX_CREEPS)]
  const drawY = [new Float32Array(MAX_CREEPS), new Float32Array(MAX_CREEPS)]
  const drawZ = [new Float32Array(MAX_CREEPS), new Float32Array(MAX_CREEPS)]
  const facing = [new Float32Array(MAX_CREEPS), new Float32Array(MAX_CREEPS)]

  const bars = new HealthBars(PITCH, INITIAL_INSTANCES, MAX_CREEPS * 2, scene)

  /**
   * Lap pips.
   *
   * Instanced markers, not numerals. Text is not instanceable: 500 numeral
   * labels is 500 draw calls, and the count peaks exactly when the field is
   * most crowded and the frame budget tightest. Precision fades past five
   * laps, which is the right trade: you need to know a creep is bad, not that
   * it is on lap nine. Lap 1 draws nothing.
   */
  const MAX_PIPS = 5
  let pips = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.06, 0),
    new THREE.MeshBasicMaterial({ color: 0xf2c94c, depthTest: false }),
    INITIAL_INSTANCES,
  )
  pips.count = 0
  pips.renderOrder = 10
  pips.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  spanningInstances(pips)
  scene.add(pips)

  // ---- effects -----------------------------------------------------------

  const glowTex = glowTexture()
  const ringTex = ringTexture()
  const puffTex = puffTexture()
  const chevronTex = chevronTexture()

  const flashes = new SpritePool({ texture: glowTex, capacity: 512, pitchDeg: PITCH })
  const rings = new SpritePool({ texture: ringTex, capacity: 160 })
  const dust = new SpritePool({ texture: puffTex, capacity: 256, pitchDeg: PITCH })
  scene.add(flashes.mesh, rings.mesh, dust.mesh)

  const projectiles: ProjectilePool[] = [
    new ProjectilePool({ model: projectileModel(TowerKind.Single), capacity: 384, speed: 14, arc: 0.06, orient: true }),
    new ProjectilePool({ model: projectileModel(TowerKind.Splash), capacity: 192, speed: 7, arc: 0.55, orient: false }),
    new ProjectilePool({ model: projectileModel(TowerKind.Slow), capacity: 384, speed: 10, arc: 0.1, orient: true }),
  ]
  for (const p of projectiles) {
    if (p.lit) scene.add(p.lit)
    if (p.glow) scene.add(p.glow)
  }

  /** What lands when each kind of shot arrives. */
  const onHit: ((lane: number, x: number, y: number, z: number, now: number) => void)[] = [
    (_lane, x, y, z, now) => {
      flashes.spawn(x, y, z, 0.25, 0.55, 0xfff1b0, 150, now)
    },
    (_lane, x, y, z, now) => {
      const radius = (ARCHETYPES[TowerKind.Splash] as TowerArchetype).splashRadius ?? 1
      flashes.spawn(x, y + 0.1, z, 0.5, 1.4, 0xffa040, 240, now, 0.3)
      flashes.spawn(x, y + 0.1, z, 0.2, 0.7, 0xfff4d0, 120, now)
      rings.spawn(x, 0.035, z, 0.5, radius * 2.2, 0xffb060, 380, now)
      dust.spawn(x, y + 0.2, z, 0.6, 1.5, 0x6b5a3a, 600, now, 0.6)
    },
    (_lane, x, y, z, now) => {
      flashes.spawn(x, y, z, 0.3, 0.9, 0x9fe0ff, 260, now, 0.2)
      rings.spawn(x, 0.035, z, 0.2, 0.9, 0x8fd4ff, 300, now)
    },
  ]

  /**
   * Leak trail: the route the creep that just leaked was taking.
   *
   * Under the loop rule you ask "why does this keep getting through" about the
   * same creep repeatedly, so the answer has to be visible rather than
   * inferred. This draws the current field route at the moment of the leak,
   * which is the route the creep walked unless the maze changed mid-lap.
   */
  const leakTrail = new PathLine(chevronTex, 0xff5a4a, 0.85, 0.05, 0.55)
  scene.add(leakTrail.object)
  let leakTrailUntil = 0

  // Two routes: what creeps do now, and what they would do if you built here.
  // Seeing the difference is how a player learns to maze; the number alone
  // tells you a placement is good without telling you why.
  const currentPath = new PathLine(chevronTex, 0xe8f0d8, 0.28, 0.04, 0.42)
  const candidatePath = new PathLine(chevronTex, 0x7dff9a, 0.9, 0.06, 0.5)
  scene.add(currentPath.object)
  scene.add(candidatePath.object)

  // ---- icons -------------------------------------------------------------

  const icons: Icons = {
    towers: KINDS.map((k) => renderIcon(renderer, (towerModels[k] as Model[])[0] as Model, { yaw: 0.8, pitch: 0.5 })),
    creeps: creepModels.map((m) => renderIcon(renderer, m, { yaw: 1.0, pitch: 0.45, zoom: 1.0 })),
  }

  // ---- scratch -----------------------------------------------------------

  // Reused across hovers: a candidate rebuild per tile would otherwise allocate
  // two typed arrays every time the pointer crosses a tile boundary.
  const probeField: FlowField = createField()
  const routeScratch: number[] = []

  const scratch = new THREE.Matrix4()
  const scratchQ = new THREE.Quaternion()
  const scratchQ2 = new THREE.Quaternion()
  const scratchV = new THREE.Vector3()
  const scratchS = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)
  const X_AXIS = new THREE.Vector3(1, 0, 0)
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
   * Plane maths rather than a `Raycaster` against the ground mesh: the same
   * answer without the garbage. `groundToTile` bounds the result to your own
   * lane, which is what keeps a click on the opponent's board -- reachable,
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
   * Called on pointer movement AND once a frame, because the camera moves:
   * panning under a stationary cursor changes which tile is beneath it. The
   * expensive part -- `previewTile`, which rebuilds a candidate flow field --
   * still runs only when the tile changes.
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
   *   allowed  ──▶ blue ghost tower + green candidate route + "+54 tiles"
   *   refused  ──▶ red ghost tower + the reason, in words
   */
  function previewTile(t: Tile | null): void {
    for (const g of hoverGhosts) g.visible = false
    if (!t) {
      hover.visible = false
      // Only the hover's own ring. The selection's is `select()`'s to hide.
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

    if (check.refusal === Refusal.Occupied) {
      // A tile that already holds a tower has a range worth seeing, but it is
      // that tower's, not the tool's -- and it is one click away on the
      // selection ring.
      hoverRange.visible = false
    } else {
      const ghost = hoverGhosts[tool] as THREE.Group
      ghost.position.set(t.x + 0.5, 0, t.y + 0.5)
      ghost.visible = true
      hoverGhostMat.color.setHex(allowed ? 0xbfe0ff : 0xff8a80)
      const reach = levelOf(tool, 1).range
      hoverRange.position.set(t.x + 0.5, 0.042, t.y + 0.5)
      hoverRange.scale.set(reach, reach, 1)
      ;(hoverRange.material as THREE.MeshBasicMaterial).color.setHex(allowed ? OK_COLOUR : REFUSED_COLOUR)
      hoverRange.visible = true
    }

    if (allowed) {
      const i = tileIndex(t)
      const lane = state.lanes[me()] as Lane
      lane.blocked[i] = 1
      buildField(lane.blocked, probeField)
      lane.blocked[i] = 0
      candidatePath.set(pathFrom(probeField, SPAWN_INDICES[0] as number, routeScratch))
    } else {
      candidatePath.hide()
    }

    const before = mazeLength((state.lanes[me()] as Lane).field)
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
   * A tap does one of two things depending on what is under it: an occupied
   * tile selects its tower, an empty tile places the current tool.
   *
   * This fires on pointer*up*, and builds unless the camera actually moved --
   * a drag pans, and on touch that drag begins with a `pointerdown` on a tile.
   * "Did the camera move" is asked of the RIG rather than re-derived from a
   * pixel threshold here, so the two can never disagree.
   */
  let tapId = -1

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    tapId = ev.pointerId
  })

  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (ev.pointerId !== tapId) return
    tapId = -1
    if (rig.didPan(ev.pointerId)) {
      cameraMoved = true
      return
    }

    const t = tileAt(ev.clientX, ev.clientY)
    if (!t) { select(null); return }
    const state = driver.current
    if ((state.lanes[me()] as Lane).towers.kind[tileIndex(t)] !== -1) {
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
    const lane = state.lanes[me()] as Lane
    const kind = lane.towers.kind[i] as TowerKind
    const level = lane.towers.level[i] as number
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
   * Draw what is in flight, and retire what has resolved.
   *
   * Three outcomes, not two. A confirmed ghost simply disappears -- the real
   * tower is already underneath it. A refused or lost one is reported once and
   * removed, because a translucent tower left on screen forever is exactly how
   * a game looks when it is ignoring your clicks.
   */
  function syncGhosts(): void {
    const counts = [0, 0, 0]
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
      if (cmd.kind !== Kind.Build) continue
      const n = counts[cmd.tower] as number
      if (n >= 64) continue
      scratch.makeTranslation(cmd.x + 0.5, 0, cmd.y + 0.5)
      ;(ghostMeshes[cmd.tower] as THREE.InstancedMesh).setMatrixAt(n, scratch)
      counts[cmd.tower] = n + 1
    }
    ghostMeshes.forEach((mesh, k) => {
      mesh.count = counts[k] as number
      mesh.instanceMatrix.needsUpdate = true
    })
  }

  /** Rebuild tower instances for both lanes, grouped by kind and level. */
  function syncTowers(): number {
    for (const levels of towerSets) for (const set of levels) set.count = 0
    let mine = 0
    for (let lane = 0; lane < 2; lane++) {
      const t = (driver.current.lanes[lane] as Lane).towers
      const ox = laneX(lane)
      for (let i = 0; i < TILE_COUNT; i++) {
        const kind = t.kind[i] as number
        if (kind === -1) continue
        const level = t.level[i] as number
        const set = (towerSets[kind] as TowerSet[])[level - 1] as TowerSet
        scratch.makeTranslation(ox + tileX(i) + 0.5, 0, tileY(i) + 0.5)
        set.lit.setMatrixAt(set.count, scratch)
        if (set.glow) set.glow.setMatrixAt(set.count, scratch)
        set.count += 1
        if (lane === me()) mine += 1
      }
    }
    for (const levels of towerSets) {
      for (const set of levels) {
        set.lit.count = set.count
        set.lit.instanceMatrix.needsUpdate = true
        if (set.glow) {
          set.glow.count = set.count
          set.glow.instanceMatrix.needsUpdate = true
        }
      }
    }
    return mine
  }

  /**
   * Towers that appeared, grew or vanished since the last tick.
   *
   * A build raises dust; an upgrade throws sparks; a sale leaves dust. Small,
   * but a tower that pops into existence with no ceremony reads as a glitch
   * rather than a purchase, and this is the action the player takes most.
   */
  function detectTowerChanges(now: number): void {
    for (let lane = 0; lane < 2; lane++) {
      const prev = (driver.previous.lanes[lane] as Lane).towers
      const curr = (driver.current.lanes[lane] as Lane).towers
      const ox = laneX(lane)
      for (let i = 0; i < TILE_COUNT; i++) {
        const pk = prev.kind[i] as number
        const ck = curr.kind[i] as number
        if (pk === ck && prev.level[i] === curr.level[i]) continue
        const x = ox + tileX(i) + 0.5
        const z = tileY(i) + 0.5
        if (ck !== -1 && pk === -1) {
          for (let d = 0; d < 4; d++) {
            const a = (d / 4) * Math.PI * 2
            dust.spawn(x + Math.cos(a) * 0.3, 0.15, z + Math.sin(a) * 0.3, 0.5, 1.1, 0x7a6a48, 520, now, 0.35)
          }
          rings.spawn(x, 0.035, z, 0.4, 1.4, 0xd8c8a0, 320, now)
        } else if (ck === -1) {
          dust.spawn(x, 0.3, z, 0.7, 1.4, 0x7a6a48, 500, now, 0.4)
        } else {
          for (let d = 0; d < 5; d++) {
            const a = (d / 5) * Math.PI * 2 + 0.3
            flashes.spawn(x + Math.cos(a) * 0.25, 0.4 + (d % 2) * 0.4, z + Math.sin(a) * 0.25, 0.15, 0.4, 0xffd86a, 420, now, 0.5)
          }
          rings.spawn(x, 0.035, z, 0.3, 1.3, 0xffd86a, 360, now)
        }
      }
    }
  }

  /**
   * Which creep a tower shot, reconstructed the way `fireTowers` chooses it:
   * in range, nearest the exit by the field's `dist`, ties to the lowest id.
   * Searched over the previous tick's creeps because that is where they were
   * when the shot resolved. A creep that spawned on this very tick is missed,
   * which is invisible: it is standing on the entrance.
   */
  function targetOf(lane: number, tile: number, range: number): number {
    const prev = driver.previous.lanes[lane] as Lane
    const c = prev.creeps
    const dist = (driver.current.lanes[lane] as Lane).field.dist
    const tx = tileX(tile) + 0.5
    const ty = tileY(tile) + 0.5
    const r2 = range * range
    let best = -1
    let bestDist = UNREACHABLE
    let bestId = 0
    for (let i = 0; i < c.count; i++) {
      if ((c.hp[i] as number) <= 0) continue
      const dx = (c.x[i] as number) - tx
      const dy = (c.y[i] as number) - ty
      if (dx * dx + dy * dy > r2) continue
      let cx = Math.floor(c.x[i] as number)
      let cy = Math.floor(c.y[i] as number)
      if (cx < 0) cx = 0
      if (cx >= GRID_W) cx = GRID_W - 1
      if (cy < 0) cy = 0
      if (cy >= GRID_H) cy = GRID_H - 1
      const d = dist[cy * GRID_W + cx] as number
      const id = c.id[i] as number
      if (d < bestDist || (d === bestDist && id < bestId)) {
        best = i
        bestDist = d
        bestId = id
      }
    }
    return best
  }

  /**
   * Shots fired since the last tick.
   *
   * A tower's cooldown counts down every tick and jumps back to its full
   * value only when it fires, so "cooldown equals the spec's, and last tick it
   * was zero or the tower did not exist or was just upgraded" is a shot. The
   * sim has no other trace of one.
   */
  function detectShots(now: number): void {
    for (let lane = 0; lane < 2; lane++) {
      const prev = (driver.previous.lanes[lane] as Lane).towers
      const curr = (driver.current.lanes[lane] as Lane).towers
      const ox = laneX(lane)
      for (let i = 0; i < TILE_COUNT; i++) {
        const kind = curr.kind[i] as number
        if (kind === -1) continue
        const level = curr.level[i] as number
        const spec = levelOf(kind as TowerKind, level)
        if (curr.cooldown[i] !== spec.cooldownTicks) continue
        const wasIdle = prev.kind[i] === -1 || prev.cooldown[i] === 0 || prev.level[i] !== level
        if (!wasIdle) continue
        const slot = targetOf(lane, i, spec.range)
        if (slot === -1) continue
        const sx = ox + tileX(i) + 0.5
        const sz = tileY(i) + 0.5
        const sy = muzzleHeight(kind as TowerKind, level)
        const id = (driver.previous.lanes[lane] as Lane).creeps.id[slot] as number
        ;(projectiles[kind] as ProjectilePool).fire(
          lane,
          id,
          sx,
          sy,
          sz,
          drawX[lane]![slot] as number,
          drawY[lane]![slot] as number,
          drawZ[lane]![slot] as number,
          now,
        )
        if (kind === TowerKind.Splash) {
          flashes.spawn(sx, sy + 0.15, sz - 0.2, 0.3, 0.7, 0xffb070, 140, now)
          dust.spawn(sx, sy + 0.2, sz - 0.2, 0.3, 0.8, 0x6a6058, 500, now, 0.5)
        } else if (kind === TowerKind.Slow) {
          flashes.spawn(sx, sy, sz, 0.2, 0.45, 0xa0e4ff, 160, now)
        }
      }
    }
  }

  /**
   * Creeps that died or leaked since the last tick, and the slot shift that
   * a death causes.
   *
   * Ids are monotonic and the sim compacts stably, so both arrays are sorted
   * by id and a single merge walk finds every id in `prev` missing from `curr`
   * -- a death -- and every survivor's new slot. The per-slot draw and facing
   * caches are shifted down in the same walk, which is safe because a
   * survivor's new slot is never above its old one.
   */
  function detectDeaths(now: number): void {
    for (let lane = 0; lane < 2; lane++) {
      const prev = (driver.previous.lanes[lane] as Lane).creeps
      const curr = (driver.current.lanes[lane] as Lane).creeps
      const dx = drawX[lane] as Float32Array
      const dy = drawY[lane] as Float32Array
      const dz = drawZ[lane] as Float32Array
      const face = facing[lane] as Float32Array
      const ox = laneX(lane)
      let p = 0
      let c = 0
      while (p < prev.count) {
        const pid = prev.id[p] as number
        const cid = c < curr.count ? (curr.id[c] as number) : Infinity
        if (pid === cid) {
          if (c !== p) {
            dx[c] = dx[p] as number
            dy[c] = dy[p] as number
            dz[c] = dz[p] as number
            face[c] = face[p] as number
          }
          // A lap counter that moved is a leak: the creep is back at the entrance.
          if ((curr.laps[c] as number) > (prev.laps[p] as number)) {
            rings.spawn(dx[c] as number, 0.04, dz[c] as number, 0.3, 1.6, 0xff5040, 420, now)
            flashes.spawn(dx[c] as number, 0.3, dz[c] as number, 0.4, 1.0, 0xff6a50, 300, now, 0.4)
            const sx = ox + (curr.x[c] as number)
            const sz = curr.y[c] as number
            rings.spawn(sx, 0.04, sz, 0.2, 1.2, 0x7cf0a0, 400, now)
            // Snap the caches to the entrance so the next frame does not
            // interpolate a creep the length of the lane.
            dx[c] = sx
            dz[c] = sz
          }
          p++
          c++
          continue
        }
        if (pid < cid) {
          // Gone from the field: a death.
          const spec = CREEPS[prev.spec[p] as number]
          const kind = spec ? spec.archetype : CreepArchetypeKind.Swarm
          const scale = tierScale(spec ? spec.tier : 0)
          const set = creepSets[kind] as CreepSet
          const x = dx[p] as number
          const z = dz[p] as number
          set.corpses.add(x, z, face[p] as number, scale, 1, 1, 1, now)
          dust.spawn(x, 0.15 * scale, z, 0.3 * scale, 0.9 * scale, 0x5a4a38, 450, now, 0.3)
          if (kind === CreepArchetypeKind.Tank) {
            rings.spawn(x, 0.035, z, 0.3, 1.5 * scale, 0xc8b898, 350, now)
          }
          p++
          continue
        }
        // An id in curr but not prev: a spawn. Nothing to shift.
        c++
      }
    }
  }

  /** Bob, roll and stride cadence per archetype, in Hz and tiles. */
  const GAIT = [
    { hz: 7, bob: 0.015, roll: 0.0, yaw: 0.12 },
    { hz: 3.6, bob: 0.06, roll: 0.05, yaw: 0.0 },
    { hz: 1.7, bob: 0.05, roll: 0.12, yaw: 0.0 },
  ] as const

  /** Draw creeps of both lanes between the previous and current tick. */
  function syncCreeps(alpha: number, now: number): void {
    // Size the buffers before writing into them. Pips need counting first: a
    // creep draws one per lap up to MAX_PIPS, so the total is a property of
    // the match rather than of the creep count.
    let pipsNeeded = 0
    let total = 0
    const needed = [0, 0, 0]
    for (let lane = 0; lane < 2; lane++) {
      const curr = (driver.current.lanes[lane] as Lane).creeps
      total += curr.count
      for (let i = 0; i < curr.count; i++) {
        const laps = curr.laps[i] as number
        pipsNeeded += laps > MAX_PIPS ? MAX_PIPS : laps
        const spec = CREEPS[curr.spec[i] as number]
        const k = spec ? spec.archetype : 0
        needed[k] = (needed[k] as number) + 1
      }
    }
    for (let k = 0; k < 3; k++) {
      const set = creepSets[k] as CreepSet
      set.lit = ensureCapacity(set.lit, needed[k] as number, MAX_CREEPS * 2, scene)
      if (set.glow) set.glow = ensureCapacity(set.glow, needed[k] as number, MAX_CREEPS * 2, scene)
      set.count = 0
    }
    pips = ensureCapacity(pips, pipsNeeded, MAX_CREEPS * MAX_PIPS, scene)
    bars.begin(total)

    const tick = driver.current.tick
    const tSec = now * 0.001
    let pipCount = 0

    for (let lane = 0; lane < 2; lane++) {
      const curr = (driver.current.lanes[lane] as Lane).creeps
      const prev = (driver.previous.lanes[lane] as Lane).creeps
      const ox = laneX(lane)
      const dxs = drawX[lane] as Float32Array
      const dys = drawY[lane] as Float32Array
      const dzs = drawZ[lane] as Float32Array
      const face = facing[lane] as Float32Array

      for (let i = 0; i < curr.count; i++) {
        const cx = curr.x[i] as number
        const cy = curr.y[i] as number
        let x = cx
        let y = cy
        let moving = false
        let mdx = 0
        let mdy = 0
        // Interpolate only when the same creep occupied this slot last tick,
        // and only over a short distance. A teleport back to spawn must snap;
        // gliding it across the field would look like a bug and would hide
        // the rule that put it there.
        if (i < prev.count && prev.id[i] === curr.id[i]) {
          const px = prev.x[i] as number
          const py = prev.y[i] as number
          mdx = cx - px
          mdy = cy - py
          const travelled = (mdx < 0 ? -mdx : mdx) + (mdy < 0 ? -mdy : mdy)
          if (travelled < 2) {
            x = px + mdx * alpha
            y = py + mdy * alpha
            moving = travelled > 1e-6
          }
        }

        const spec = CREEPS[curr.spec[i] as number]
        const kind = spec ? spec.archetype : CreepArchetypeKind.Swarm
        const tier = spec ? spec.tier : 0
        const scale = tierScale(tier)
        const set = creepSets[kind] as CreepSet
        const gait = GAIT[kind]
        const slowed = tick < (curr.slowUntil[i] as number)

        // Turn toward the direction of travel, smoothly: creeps steer centre
        // to centre so the raw heading snaps ninety degrees at every corner.
        let heading = face[i] as number
        if (moving) {
          const want = Math.atan2(-mdy, mdx)
          let d = want - heading
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          heading += d * 0.25
          face[i] = heading
        }

        const id = curr.id[i] as number
        const phase = id * 1.37
        const cadence = slowed ? gait.hz * 0.5 : gait.hz
        const stride = moving ? Math.sin(tSec * cadence * Math.PI * 2 + phase) : 0
        const bob = moving ? Math.abs(stride) * gait.bob * scale : 0
        const wx = ox + x
        const wz = y
        scratchV.set(wx, bob, wz)
        scratchQ.setFromAxisAngle(UP, heading + stride * gait.yaw)
        if (gait.roll > 0) scratchQ.multiply(scratchQ2.setFromAxisAngle(X_AXIS, stride * gait.roll))
        scratchS.set(scale, scale, scale)
        scratch.compose(scratchV, scratchQ, scratchS)
        set.lit.setMatrixAt(set.count, scratch)
        if (set.glow) set.glow.setMatrixAt(set.count, scratch)

        // Frost tints a slowed creep; a heavier tier runs darker and redder.
        if (slowed) scratchColour.setRGB(0.55, 0.78, 1.15)
        else if (tier === 0) scratchColour.setRGB(1, 1, 1)
        else if (tier === 1) scratchColour.setRGB(1.0, 0.78, 0.7)
        else scratchColour.setRGB(0.82, 0.62, 0.95)
        set.lit.setColorAt(set.count, scratchColour)
        set.count += 1

        dxs[i] = wx
        dys[i] = 0.35 * scale
        dzs[i] = wz

        const top = set.height * scale + 0.22
        const hp = curr.hp[i] as number
        const maxHp = spec ? spec.hp : hp
        if (hp < maxHp) bars.add(wx, top, wz, hp / maxHp)

        // Pips ride above the bar, one per lap, capped. Lap 1 draws none.
        const laps = curr.laps[i] as number
        const show = laps > MAX_PIPS ? MAX_PIPS : laps
        for (let p = 0; p < show; p++) {
          scratch.makeTranslation(wx - 0.16 + p * 0.08, top + 0.16, wz)
          pips.setMatrixAt(pipCount, scratch)
          pipCount += 1
        }
      }
    }

    for (const set of creepSets) {
      set.lit.count = set.count
      set.lit.instanceMatrix.needsUpdate = true
      if (set.lit.instanceColor) set.lit.instanceColor.needsUpdate = true
      if (set.glow) {
        set.glow.count = set.count
        set.glow.instanceMatrix.needsUpdate = true
      }
    }
    pips.count = pipCount
    pips.instanceMatrix.needsUpdate = true
    bars.end()
  }

  /**
   * Where a creep is being drawn right now, by lane and id, for a projectile
   * to chase. Binary search: ids are ascending in the sim's arrays.
   */
  function locate(lane: number, id: number, out: THREE.Vector3): boolean {
    const c = (driver.current.lanes[lane] as Lane).creeps
    let lo = 0
    let hi = c.count - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const v = c.id[mid] as number
      if (v === id) {
        out.set(drawX[lane]![mid] as number, drawY[lane]![mid] as number, drawZ[lane]![mid] as number)
        return true
      }
      if (v < id) lo = mid + 1
      else hi = mid - 1
    }
    return false
  }

  /**
   * Default framing, re-applied on every resize until the player moves the
   * camera themselves. Landscape frames both boards; portrait frames your lane
   * alone, and the pan bounds still span both.
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

  // Size and frame immediately, rather than waiting for `start()`, so any
  // framing computed by `setSafeArea` at module load is against a real aspect.
  host.resize()

  // Any deliberate camera input retires the automatic framing, so a later
  // resize does not yank the view back from wherever the player put it.
  for (const type of ['wheel', 'keydown'] as const) {
    window.addEventListener(type, () => { cameraMoved = true }, { passive: true })
  }
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.pointerType === 'touch') cameraMoved = true
  })

  /** Wall time of the frame being drawn, for effects spawned by a projectile landing. */
  let currentNow = 0
  let started = false
  const hits = onHit.map((fn) => (lane: number, x: number, y: number, z: number) => fn(lane, x, y, z, currentNow))

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
      // Before the match starts nothing drives the loop, so the start screen
      // would sit over a black canvas. One still frame puts the field behind
      // it; the scenery does not move, so one is enough until the next resize.
      if (!started) renderer.render(scene, camera)
    },
    send: (creep) => driver.queueSend(creep),
    setBot: (b) => driver.setBot(b),
    dump: (trigger) => driver.dump(trigger, BUILD),
    driver,
    icons,
    renderer,
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
      started = true
      host.resize()
      renderer.setAnimationLoop(drawFrame)
    },
    frame: drawFrame,
  }

  function drawFrame(nowMs: number): void {
      currentNow = nowMs
      const ran = driver.advance(nowMs)
      const state = driver.current
      if (ran > 0 && state.tick !== lastSyncedTick) {
        // Events first, while the draw caches still describe the previous
        // tick's slots; `syncCreeps` below overwrites them for this one.
        detectShots(nowMs)
        detectDeaths(nowMs)
        detectTowerChanges(nowMs)
        const towerCount = syncTowers()
        syncGhosts()
        lastSyncedTick = state.tick
        currentPath.set(pathFrom((state.lanes[me()] as Lane).field, SPAWN_INDICES[0] as number))
        // Both of these go stale the moment the field or the gold changes.
        if (hovered) previewTile(hovered)
        if (selected) {
          if ((state.lanes[me()] as Lane).towers.kind[tileIndex(selected)] === -1) select(null)
          else select(selected)
        }
        // A leak just happened: show the route that produced it. Comparing
        // leak counts is cheaper and more reliable than watching lap numbers
        // on individual creeps, which move between array slots as creeps die.
        if ((state.players[me()]!).leaks > lastLeaks) {
          leakTrail.set(pathFrom((state.lanes[me()] as Lane).field, SPAWN_INDICES[0] as number))
          leakTrailUntil = state.tick + 60
        }
        lastLeaks = state.players[me()]!.leaks
        if (state.tick > leakTrailUntil) leakTrail.hide()

        const maze = mazeLength((state.lanes[me()] as Lane).field)
        statsCb({
          towers: towerCount,
          creeps: (state.lanes[me()] as Lane).creeps.count,
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
          oppCreeps: (state.lanes[1 - me()] as Lane).creeps.count,
          desync: driver.desync,
          peerLag: driver.lockstep ? driver.peerLag(me()) : 0,
        })
      }
      syncCreeps(driver.alpha, nowMs)
      for (let k = 0; k < projectiles.length; k++) {
        ;(projectiles[k] as ProjectilePool).update(nowMs, locate, hits[k]!)
      }
      flashes.update(nowMs)
      rings.update(nowMs)
      dust.update(nowMs)
      for (const set of creepSets) set.corpses.update(nowMs)
      currentPath.update(nowMs)
      candidatePath.update(nowMs)
      leakTrail.update(nowMs)
      // Keyboard panning is integrated here, then the hover is re-resolved:
      // the tile under a stationary cursor changes when the camera moves.
      rig.update()
      refreshHover()
      renderer.render(scene, camera)
  }
}

const scratchColour = new THREE.Color()
