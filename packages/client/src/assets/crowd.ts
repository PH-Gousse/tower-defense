/**
 * THE CROWD SEAM.
 *
 * One `SkinnedMesh` per creep is one draw call per creep, and a flood is
 * a thousand creeps against a budget of 200 draw calls (style sheet §7).
 * The layer in `layer.ts` draws skinned creeps individually and warns in
 * dev past `LIMITS.skinnedWarn`. The fix is an instanced crowd path: bake
 * each clip to a vertex-animation texture (bone matrices per frame), draw
 * every creep of one asset as an `InstancedMesh` whose shader samples the
 * texture by per-instance clip and phase, and keep the skinned path only
 * for the few creeps that need a one-shot (death) at full fidelity.
 *
 * That path is NOT built here. It is tracked as issue #37 and this
 * interface is the seam it plugs into: whatever draws a crowd implements
 * `CrowdRenderer`, and `layer.ts` picks it over the skinned path when one
 * is registered.
 */

import type * as THREE from 'three'
import type { AssetId } from './manifest.generated'

export interface CrowdInstance {
  id: number
  asset: AssetId
  x: number
  y: number
  z: number
  heading: number
  scale: number
  clip: string
  /** Seconds into the clip. */
  time: number
  team: 0 | 1
  tint: THREE.Color | null
}

export interface CrowdRenderer {
  /** Called once per frame with every creep the layer would otherwise draw skinned. Return the ids it took. */
  draw(instances: readonly CrowdInstance[]): ReadonlySet<number>
  dispose(): void
}

/** The registered crowd renderer, or null: the skinned path is used. */
export let crowd: CrowdRenderer | null = null

export function registerCrowd(r: CrowdRenderer | null): void {
  crowd = r
}
