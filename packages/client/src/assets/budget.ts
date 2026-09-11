import type { AssetEntry } from './registry'

/**
 * The global match budget from the style sheet §7, checked at match load
 * in dev: two lanes, 60 towers, and creeps at the MEASURED peak (issue
 * #14), not the stated one. Pure, so it is tested without a scene.
 */

export const MATCH = { lanes: 2, towers: 60, creeps: 1000 } as const
export const LIMITS = { triangles: 2_500_000, drawCalls: 200, textureBytes: 48 * 1024 * 1024, skinnedWarn: 150 } as const

export interface BudgetReport {
  ok: boolean
  triangles: number
  textureBytes: number
  /** Draw calls with one skinned mesh per creep at the peak. Honest, and over budget by design until the crowd path exists. */
  drawCallsAtPeak: number
  problems: string[]
}

export function checkMatchBudget(assets: Record<string, AssetEntry>): BudgetReport {
  const creeps = Object.values(assets).filter((a) => a.class === 'creep')
  const towers = Object.values(assets).filter((a) => a.class === 'tower')
  const worstCreep = Math.max(0, ...creeps.map((a) => a.triangles))
  const worstTower = Math.max(0, ...towers.map((a) => a.triangles))
  const triangles = worstCreep * MATCH.creeps + worstTower * MATCH.towers * MATCH.lanes
  // KTX2 UASTC is 8 bits per texel on the GPU (BC7/ASTC), plus mips.
  const textureBytes = Object.values(assets).reduce((n, a) => n + a.textures.reduce((m, t) => m + t.size * t.size * 1.33, 0), 0)
  // Two materials per model (body, glow); every creep its own skinned mesh.
  const drawCallsAtPeak = MATCH.creeps * 2 + MATCH.towers * MATCH.lanes * 2
  const problems: string[] = []
  if (triangles > LIMITS.triangles) problems.push(`${(triangles / 1e6).toFixed(2)} M triangles at the creep peak, limit ${LIMITS.triangles / 1e6} M (worst creep ${worstCreep}, worst tower ${worstTower})`)
  if (textureBytes > LIMITS.textureBytes) problems.push(`${(textureBytes / 1048576).toFixed(1)} MB of textures, limit ${LIMITS.textureBytes / 1048576} MB`)
  return { ok: problems.length === 0, triangles, textureBytes, drawCallsAtPeak, problems }
}
