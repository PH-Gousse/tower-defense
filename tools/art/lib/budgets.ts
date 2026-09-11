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
}

export const BUDGETS: Record<AssetClass, Budget> = {
  creep: { triangles: 1500, textureSize: 512, textures: 1, bones: 20, bytes: 400 * 1024, height: [0.15, 1.6], footprint: 1.6 },
  tower: { triangles: 2500, textureSize: 512, textures: 1, bones: 6, bytes: 500 * 1024, height: [0.8, 2.4], footprint: 0.84 },
  projectile: { triangles: 100, textureSize: 128, textures: 1, bones: 0, bytes: 30 * 1024, height: [0.0, 0.8], footprint: 0.8 },
  effect: { triangles: 100, textureSize: 128, textures: 1, bones: 0, bytes: 30 * 1024, height: [0.0, 1.5], footprint: 1.5 },
  tile: { triangles: 200, textureSize: 256, textures: 1, bones: 0, bytes: 50 * 1024, height: [0.0, 0.25], footprint: 1.0 },
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
