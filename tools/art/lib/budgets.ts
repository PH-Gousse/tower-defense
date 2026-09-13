/**
 * The budgets and the animation contract, as numbers. docs/art/style-sheet.md
 * §7 and docs/art/animation-contract.md are the prose; this is what the gate
 * enforces, and a test checks the two agree on every figure.
 */

export type AssetClass = 'creep' | 'tower' | 'projectile' | 'effect' | 'tile' | 'prop'

export interface Budget {
  triangles: number
  textureSize: number
  textures: number
  bones: number
  bytes: number
  /** Standing height, in tiles. */
  height: [number, number]
  /** Widest extent in x or z, in tiles. */
  footprint: number
  /**
   * Widest extent ACROSS the walking axis (x; models face +z), in tiles.
   * Only creeps have one: a creep walks a one-tile corridor along its own
   * length, so its width is what must leave a margin, not its length.
   */
  width?: number
}

/**
 * Scale, per ADR-0019: a tower's footprint is 2 x 2 tiles and its model
 * stays inside 0.84 of that (1.68) so a one-tile corridor beside it stays
 * visible; a creep stays inside 0.88 of a tile across its walking axis and
 * may run to 1.2 along it. Tiles are one or two tiles square.
 */
export const BUDGETS: Record<AssetClass, Budget> = {
  creep: { triangles: 1500, textureSize: 512, textures: 1, bones: 20, bytes: 400 * 1024, height: [0.15, 1.6], footprint: 1.2, width: 0.88 },
  tower: { triangles: 2500, textureSize: 512, textures: 1, bones: 6, bytes: 500 * 1024, height: [1.4, 4.0], footprint: 1.68 },
  projectile: { triangles: 100, textureSize: 128, textures: 1, bones: 0, bytes: 30 * 1024, height: [0.0, 0.8], footprint: 0.8 },
  effect: { triangles: 100, textureSize: 128, textures: 1, bones: 0, bytes: 30 * 1024, height: [0.0, 1.5], footprint: 1.5 },
  tile: { triangles: 200, textureSize: 256, textures: 1, bones: 0, bytes: 50 * 1024, height: [0.0, 0.25], footprint: 2.0 },
  prop: { triangles: 200, textureSize: 256, textures: 1, bones: 0, bytes: 50 * 1024, height: [0.0, 3.0], footprint: 2.0 },
}

export const FPS = 24

export const REQUIRED_CLIPS: Record<AssetClass, readonly string[]> = {
  creep: ['Idle', 'Walk', 'Death', 'Spawn'],
  tower: ['Build', 'Idle', 'Attack', 'Upgrade', 'Sell'],
  projectile: [],
  effect: [],
  tile: [],
  prop: [],
}

export const ALL_CLIPS = ['Idle', 'Walk', 'Death', 'Spawn', 'Build', 'Attack', 'Upgrade', 'Sell'] as const
export const LOOP_CLIPS = new Set(['Idle', 'Walk'])

/** Seconds, inclusive. From the animation contract's length column. */
export const CLIP_LENGTH: Record<string, [number, number]> = {
  Idle: [0.5, 4.0],
  Walk: [0.1, 2.0],
  Death: [0.3, 1.5],
  Spawn: [0.2, 1.2],
  Build: [0.3, 1.5],
  Attack: [0.1, 0.6],
  Upgrade: [0.2, 1.0],
  Sell: [0.2, 1.0],
}

/** Team-colour mask coverage, as a fraction of the texels the model uses. */
export const TEAM_MASK_COVERAGE: [number, number] = [0.05, 0.25]
export const TEAM_MASK_CLASSES: ReadonlySet<AssetClass> = new Set<AssetClass>(['creep', 'tower'])

export const SEAM_TRANSLATION = 0.001
export const SEAM_ROTATION_RAD = 0.5 * (Math.PI / 180)
export const ROOT_DRIFT = 0.02
export const ORIGIN_TOLERANCE = 0.005
