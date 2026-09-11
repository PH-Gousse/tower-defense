import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BUDGETS, REQUIRED_CLIPS, FPS } from '../lib/budgets'
import { licensesMarkdown, type Manifest } from '../lib/manifest'
import { readGlb, triangleCount, bounds, clips } from '../lib/glb'
import { synthesise } from '../lib/audio'
import { REPO_ROOT } from '../lib/spec'
import { RAW } from '../lib/paths'

const sheet = readFileSync(join(REPO_ROOT, 'docs', 'art', 'style-sheet.md'), 'utf8')
const contract = readFileSync(join(REPO_ROOT, 'docs', 'art', 'animation-contract.md'), 'utf8')

describe('the budgets the gate enforces are the ones the style sheet states', () => {
  it('triangles, bones and file size per class match §7', () => {
    const row = (label: string) => sheet.split('\n').find((l) => l.startsWith(`| ${label} |`)) ?? ''
    const nums = (s: string) => s.replace(/ /g, ' ').match(/[\d ]+(?= KB|\b)/g)
    expect(row('Creep')).toContain(BUDGETS.creep.triangles.toLocaleString('en-GB').replace(',', ' '))
    expect(row('Creep')).toContain(`≤ ${BUDGETS.creep.bones}`)
    expect(row('Creep')).toContain(`${BUDGETS.creep.bytes / 1024} KB`)
    expect(row('Tower')).toContain(`≤ ${BUDGETS.tower.bones}`)
    expect(row('Tower')).toContain(`${BUDGETS.tower.bytes / 1024} KB`)
    expect(row('Projectile / effect')).toContain(`${BUDGETS.projectile.bytes / 1024} KB`)
    expect(row('Tile / prop')).toContain(`${BUDGETS.tile.bytes / 1024} KB`)
    void nums
  })
  it('required clips per class match the contract', () => {
    expect(contract).toContain('### Creeps — ' + REQUIRED_CLIPS.creep.join(', '))
    expect(contract).toContain('### Towers — ' + REQUIRED_CLIPS.tower.join(', '))
    expect(contract).toContain(`**${FPS} fps**`)
  })
})

describe('the manifest and LICENSES.md', () => {
  it('lists every asset under its licence, and says so when empty', () => {
    const m: Manifest = { manifest_version: 1, assets: {}, sounds: {} }
    expect(licensesMarkdown(m)).toContain('Nothing has been admitted yet')
    m.assets['creep_x_t1'] = { class: 'creep', archetype: 'x', file: 'build/creep_x_t1.glb', bytes: 1, hash: 'h', spec_hash: 's', generator_version: '0', version: 1, triangles: 1, vertices: 1, bones: 0, textures: [], extensions: [], clips: {}, height: 1, footprint: 1, audio: {}, source: { kind: 'pack', licence: 'cc-by', author: 'A. Person', url: 'https://x', attribution: 'Model by A. Person', service: '', approved_by: '' }, gated_by: 'test' }
    const md = licensesMarkdown(m)
    expect(md).toContain('## cc-by')
    expect(md).toContain('Model by A. Person')
    expect(md).toContain('<https://x>')
  })
})

describe('the glb reader', () => {
  const raw = join(RAW, 'creep_runner_t1.glb')
  it.skipIf(!existsSync(raw))('reads counts, bounds and clip seams from a raw build', () => {
    const g = readGlb(raw)
    expect(triangleCount(g)).toBeGreaterThan(500)
    const b = bounds(g)!
    expect(Math.abs(b.min[1]!)).toBeLessThan(0.005)
    const c = clips(g, FPS)
    expect(c.map((x) => x.name).sort()).toEqual(['Death', 'Idle', 'Spawn', 'Walk'])
    for (const k of c) {
      expect(k.onGrid).toBe(true)
      if (k.name === 'Walk' || k.name === 'Idle') expect(k.seamRotation).toBeLessThan(0.01)
    }
  })
})

describe('the synthesiser', () => {
  const spec = { id: 'sfx_test_1', event: 'test', variant: 1, duration: 0.2, stereo: false, reverb: 0.1, layers: [{ wave: 'noise' as const, freq: 440, freq_end: null, glide: 'exp' as const, attack: 0.001, decay: 0.05, sustain: 0, hold: 0, release: 0.02, gain: 0.5, delay: 0, filter: { type: 'bandpass' as const, freq: 2000, freq_end: 500, q: 1 }, vibrato: null, pan: 0, drive: 0.2 }], source: { kind: 'generated', licence: 'own', author: '', url: '', attribution: '', approved_by: '', notes: '' } }
  it('is deterministic for an id and differs between ids', () => {
    const a = synthesise(spec)
    const b = synthesise(spec)
    expect(Array.from(a.left.subarray(0, 2000))).toEqual(Array.from(b.left.subarray(0, 2000)))
    const c = synthesise({ ...spec, id: 'sfx_test_2' })
    expect(Array.from(c.left.subarray(100, 200))).not.toEqual(Array.from(a.left.subarray(100, 200)))
  })
  it('never exceeds ±1 and is silent after the envelope', () => {
    const a = synthesise(spec)
    let peak = 0
    for (const v of a.left) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(1)
    expect(peak).toBeGreaterThan(0.05)
    expect(Math.abs(a.left[a.left.length - 1]!)).toBeLessThan(0.05)
  })
})
