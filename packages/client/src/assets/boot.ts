import type * as THREE from 'three'
import { AssetRegistry } from './registry'
import { SfxPlayer } from './sfx'
import { checkMatchBudget } from './budget'
import type { AssetId } from './manifest.generated'

/**
 * Bringing the catalogue up for a match: load the manifest, preload the
 * match set with progress, run the dev budget check, build the layer.
 *
 * In dev a missing or broken asset REFUSES to start the match, with the id
 * in the error: a fallback that silently drew the procedural model would
 * hide exactly the breakage the factory exists to surface. In a build the
 * same failure logs once and the match starts on the procedural models,
 * because a player should never be stopped by a catalogue.
 */

export interface BootResult {
  readonly registry: AssetRegistry | null
  readonly sfx: SfxPlayer | null
  readonly loaded: number
  readonly problems: readonly string[]
}

export async function bootAssets(renderer: THREE.WebGLRenderer, baseUrl: string, dev: boolean, onProgress?: (text: string) => void): Promise<BootResult> {
  const registry = new AssetRegistry(baseUrl)
  registry.attachRenderer(renderer)
  const problems: string[] = []
  try {
    const manifest = await registry.load()
    const set: AssetId[] = registry.matchSet()
    if (set.length === 0) {
      onProgress?.('no assets in the catalogue; procedural models')
      return { registry: null, sfx: null, loaded: 0, problems: ['manifest has no assets'] }
    }
    await registry.preload(set, (done, total, id) => onProgress?.(`loading assets ${done}/${total}  ${id}`))
    const budget = checkMatchBudget(manifest.assets)
    if (!budget.ok) {
      for (const p of budget.problems) problems.push(`budget: ${p}`)
      if (dev) console.warn('[assets] match budget:', budget.problems.join('; '))
    }
    if (dev) console.info(`[assets] ${set.length} assets loaded · ${(budget.triangles / 1e6).toFixed(2)} M triangles at the creep peak · ${budget.drawCallsAtPeak} draw calls at the peak (skinned path)`)
    const sfx = new SfxPlayer(registry)
    return { registry, sfx, loaded: set.length, problems }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (dev) throw new Error(`assets failed to load, and dev refuses to start without them: ${msg}`)
    console.warn(`[assets] ${msg}; starting on procedural models`)
    return { registry: null, sfx: null, loaded: 0, problems: [msg] }
  }
}
