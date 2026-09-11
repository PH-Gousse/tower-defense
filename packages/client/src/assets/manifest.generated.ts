/* Generated from assets/manifest.json by `pnpm manifest-types`. Do not edit. */

export type AssetId = 'creep_runner_t1' | 'creep_runner_t2'
export type SoundId = never
export type ClipName = 'Idle' | 'Walk' | 'Death' | 'Spawn' | 'Build' | 'Attack' | 'Upgrade' | 'Sell'

export const ASSET_IDS: readonly AssetId[] = ['creep_runner_t1', 'creep_runner_t2']
export const SOUND_IDS: readonly SoundId[] = []

/** Ids by class, for preloading a match and for the dev viewer. */
export const ASSETS_BY_CLASS: Readonly<Record<string, readonly AssetId[]>> = {
  'creep': [
    'creep_runner_t1',
    'creep_runner_t2'
  ]
}

/** Manifest version this file was generated from; the registry refuses a manifest that disagrees. */
export const MANIFEST_VERSION = 1
export const MANIFEST_ASSET_COUNT = 2
export const MANIFEST_SOUND_COUNT = 0
