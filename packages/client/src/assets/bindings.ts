import type { ClipName } from './animated'

/**
 * THE EVENT BINDING TABLE.
 *
 * Every sim event the renderer infers (ADR-0015) maps here to what the
 * asset does: which contract clip plays, which sound, which pool effect.
 * Adding a new asset must not require touching game code beyond this
 * table and the manifest -- so nothing in `layer.ts` or `scene.ts` names a
 * clip or a sound id; they look them up here.
 *
 * `sfx` is a sound EVENT name (docs/art/audio.md §4); the layer resolves it
 * to a manifest id by the asset's own `audio` block first, then by the
 * `sfx_<event>_<size|archetype>_<n>` convention, rotating variants.
 * `effect` names a pool in the scene (dust, rings, flashes) or none.
 */

export type CreepEvent = 'spawned' | 'moving' | 'idle' | 'died' | 'leaked' | 'respawned'
export type TowerEvent = 'built' | 'idle' | 'fired' | 'upgraded' | 'sold'
export type Effect = 'dust' | 'ring' | 'flash' | 'corpse' | 'none'

export interface Binding {
  readonly clip: ClipName | null
  /** Sound event; null for silence. `{size}` and `{archetype}` are filled from the asset. */
  readonly sfx: string | null
  readonly effect: Effect
  /** For one-shots: what happens when the clip ends. */
  readonly then: 'Idle' | 'Walk' | 'remove' | 'hold' | null
  /** Fire the sound at this marker rather than at the event. */
  readonly at?: 'fire' | 'land' | 'impact'
}

export const CREEP_BINDINGS: Readonly<Record<CreepEvent, Binding>> = {
  spawned: { clip: 'Spawn', sfx: 'spawn_{size}', effect: 'ring', then: 'Walk', at: 'land' },
  moving: { clip: 'Walk', sfx: null, effect: 'none', then: null },
  idle: { clip: 'Idle', sfx: null, effect: 'none', then: null },
  died: { clip: 'Death', sfx: 'death_{size}', effect: 'dust', then: 'hold', at: 'impact' },
  /** `{side}` is `mine` or `theirs`: a leak in your lane is a warning, in theirs good news. */
  leaked: { clip: null, sfx: 'leak_{side}', effect: 'flash', then: null },
  respawned: { clip: 'Spawn', sfx: 'respawn', effect: 'ring', then: 'Walk' },
}

export const TOWER_BINDINGS: Readonly<Record<TowerEvent, Binding>> = {
  built: { clip: 'Build', sfx: 'build_{archetype}', effect: 'dust', then: 'Idle' },
  idle: { clip: 'Idle', sfx: null, effect: 'none', then: null },
  fired: { clip: 'Attack', sfx: 'shot_{archetype}', effect: 'flash', then: 'Idle', at: 'fire' },
  upgraded: { clip: 'Upgrade', sfx: 'upgrade', effect: 'flash', then: 'Idle' },
  sold: { clip: 'Sell', sfx: 'sell', effect: 'dust', then: 'remove' },
}

/** Which size class a creep archetype's spawn and death sounds use. */
export const SIZE_OF: Readonly<Record<string, 'small' | 'medium' | 'large'>> = {
  swarm: 'small', runner: 'medium', tank: 'large',
  // The fourteen ladder creeps, one design each (#51), sized by shape:
  // horde small, fast medium, armoured large.
  scrapling: 'small', emberimp: 'small', hivedrone: 'small', wraith: 'small', doomherald: 'small',
  dasherhound: 'medium', windwolf: 'medium', shadowstalker: 'medium', nightmaresteed: 'medium', stormdrake: 'medium',
  bogbrute: 'large', stonetroll: 'large', irongolem: 'large', siegebehemoth: 'large',
}

/** How long a corpse is held before removal, matching the effects pool. */
export const CORPSE_MS = 1400

/** Projectile and hit effects per tower archetype: the projectile asset id stem and the hit sound event. */
export const TOWER_FX: Readonly<Record<string, { projectile: string; hit: string; hitEffect: Effect }>> = {
  single: { projectile: 'proj_bolt', hit: 'hit_single', hitEffect: 'flash' },
  splash: { projectile: 'proj_shell', hit: 'hit_splash', hitEffect: 'dust' },
  slow: { projectile: 'proj_orb', hit: 'hit_slow', hitEffect: 'ring' },
}

export function fillSfx(template: string, archetype: string, side: 'mine' | 'theirs' = 'mine'): string {
  return template.replace('{size}', SIZE_OF[archetype] ?? 'medium').replace('{archetype}', archetype).replace('{side}', side)
}
