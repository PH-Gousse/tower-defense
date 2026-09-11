import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { say, emit } from './lib/cli'
import { loadManifest } from './lib/manifest'
import { REPO_ROOT } from './lib/spec'
import { ALL_CLIPS } from './lib/budgets'

/**
 * manifest-types — TypeScript types from assets/manifest.json, so the client
 * refers to assets and sounds by TYPED id and a path string never appears
 * in game code. Writes packages/client/src/assets/manifest.generated.ts.
 * Run after every gate; a client test fails if the file is stale.
 */

export const OUT = join(REPO_ROOT, 'packages', 'client', 'src', 'assets', 'manifest.generated.ts')

export function render(): string {
  const m = loadManifest()
  const assetIds = Object.keys(m.assets).sort()
  const soundIds = Object.keys(m.sounds).sort()
  const byClass: Record<string, string[]> = {}
  for (const id of assetIds) (byClass[m.assets[id]!.class] ??= []).push(id)
  const union = (ids: string[]) => (ids.length ? ids.map((i) => `'${i}'`).join(' | ') : 'never')
  const lines = [
    '/* Generated from assets/manifest.json by `pnpm manifest-types`. Do not edit. */',
    '',
    `export type AssetId = ${union(assetIds)}`,
    `export type SoundId = ${union(soundIds)}`,
    `export type ClipName = ${ALL_CLIPS.map((c) => `'${c}'`).join(' | ')}`,
    '',
    `export const ASSET_IDS: readonly AssetId[] = [${assetIds.map((i) => `'${i}'`).join(', ')}]`,
    `export const SOUND_IDS: readonly SoundId[] = [${soundIds.map((i) => `'${i}'`).join(', ')}]`,
    '',
    '/** Ids by class, for preloading a match and for the dev viewer. */',
    `export const ASSETS_BY_CLASS: Readonly<Record<string, readonly AssetId[]>> = ${JSON.stringify(byClass, null, 2).replace(/"/g, "'")}`,
    '',
    '/** Manifest version this file was generated from; the registry refuses a manifest that disagrees. */',
    `export const MANIFEST_VERSION = ${m.manifest_version}`,
    `export const MANIFEST_ASSET_COUNT = ${assetIds.length}`,
    `export const MANIFEST_SOUND_COUNT = ${soundIds.length}`,
    '',
  ]
  return lines.join('\n')
}

if (process.argv[1] && process.argv[1].endsWith('manifest-types.ts') || import.meta.url.endsWith('manifest-types.ts')) {
  const content = render()
  const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (before !== content) writeFileSync(OUT, content)
  say(before === content ? 'up to date' : `wrote ${OUT.slice(REPO_ROOT.length + 1)}`)
  emit('manifest-types', true, before === content ? 'up to date' : 'regenerated', { changed: before !== content })
}
