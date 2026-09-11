import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { LICENSES, MANIFEST } from './paths'

/**
 * assets/manifest.json: what the client loads. Generated only by the gate
 * and the audio tools; never edited by hand (a hook rejects it). Keys are
 * sorted at every level so a regeneration that changes nothing is a
 * zero-line diff.
 */

export interface ClipEntry { seconds: number; loop: boolean; markers: Record<string, number>; stride?: number }

export interface AssetEntry {
  class: string
  archetype: string
  tier?: number
  level?: number
  derived_from?: string
  file: string
  bytes: number
  hash: string
  spec_hash: string
  generator_version: string
  version: number
  triangles: number
  vertices: number
  bones: number
  textures: { size: number; format: string }[]
  /** glTF extensions the client must support to load the file. */
  extensions: string[]
  clips: Record<string, ClipEntry>
  height: number
  footprint: number
  muzzle?: [number, number, number]
  audio: Record<string, string>
  source: { kind: string; licence: string; author: string; url: string; attribution: string; service: string; approved_by: string }
  gated_by: string
}

export interface SoundEntry {
  event: string
  variant: number
  files: { webm: string; mp3: string }
  bytes: { webm: number; mp3: number }
  seconds: number
  lufs: number
  /** How the loudness was measured: integrated for sounds of a second or more, momentary (loudest 400 ms) below that. */
  measure: 'integrated' | 'momentary'
  peak_dbtp: number
  hash: string
  version: number
  source: { kind: string; licence: string; author: string; url: string; attribution: string }
}

export interface Manifest {
  manifest_version: number
  assets: Record<string, AssetEntry>
  sounds: Record<string, SoundEntry>
}

export function loadManifest(): Manifest {
  if (!existsSync(MANIFEST)) return { manifest_version: 1, assets: {}, sounds: {} }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest
  m.assets ??= {}
  m.sounds ??= {}
  return m
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]))
  }
  return v
}

export function saveManifest(m: Manifest): void {
  writeFileSync(MANIFEST, JSON.stringify(sortKeys(m), null, 2) + '\n')
  writeFileSync(LICENSES, licensesMarkdown(m))
}

const LICENCE_TEXT: Record<string, string> = {
  own: 'Own work, part of this repository and covered by its licence.',
  cc0: 'CC0 1.0 Universal (public domain dedication).',
  'cc-by': 'Creative Commons Attribution 4.0. Attribution is reproduced below.',
  other: 'Licensed under the terms recorded in the spec; see the row.',
}

export function licensesMarkdown(m: Manifest): string {
  const lines: string[] = [
    '# Asset licences',
    '',
    '*Generated from `assets/manifest.json` by `asset-gate` and the audio tools. Do not edit.*',
    '',
    'Every file under `assets/build/` is listed here with its source and licence. Anything that is not own work or CC0 carries its attribution line and, where required, who signed it off.',
    '',
  ]
  const groups: Record<string, string[]> = {}
  const push = (lic: string, row: string) => (groups[lic] ??= []).push(row)
  for (const [id, a] of Object.entries(m.assets).sort()) {
    const s = a.source
    const extra = [s.author && s.author !== 'asset-factory' ? `by ${s.author}` : '', s.url ? `<${s.url}>` : '', s.service ? `via ${s.service}` : '', s.attribution ? `— ${s.attribution}` : '', s.approved_by ? `(approved by ${s.approved_by})` : ''].filter(Boolean).join(' ')
    push(s.licence, `- \`${id}\` (${a.class}, ${s.kind}) ${extra}`.trimEnd())
  }
  for (const [id, snd] of Object.entries(m.sounds).sort()) {
    const s = snd.source
    const extra = [s.author && s.author !== 'asset-factory' ? `by ${s.author}` : '', s.url ? `<${s.url}>` : '', s.attribution ? `— ${s.attribution}` : ''].filter(Boolean).join(' ')
    push(s.licence, `- \`${id}\` (sound, ${s.kind}) ${extra}`.trimEnd())
  }
  for (const lic of ['own', 'cc0', 'cc-by', 'other']) {
    const rows = groups[lic]
    if (!rows?.length) continue
    lines.push(`## ${lic}`, '', LICENCE_TEXT[lic] ?? '', '', ...rows, '')
  }
  if (Object.keys(groups).length === 0) lines.push('*Nothing has been admitted yet.*', '')
  return lines.join('\n')
}
