import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { AnimatedModel } from '../src/assets/animated'
import { CREEP_BINDINGS, TOWER_BINDINGS, fillSfx, TOWER_FX } from '../src/assets/bindings'
import { checkMatchBudget, LIMITS, MATCH } from '../src/assets/budget'
import { teamToonMaterial, setTeam, TEAM_COLOURS, TEAM_SHADER_TAG } from '../src/assets/material'
import type { AssetEntry } from '../src/assets/registry'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..', '..', '..')

function clip(name: string, seconds: number): THREE.AnimationClip {
  const track = new THREE.VectorKeyframeTrack('.position', [0, seconds], [0, 0, 0, 0, 1, 0])
  return new THREE.AnimationClip(name, seconds, [track])
}

describe('the event binding table', () => {
  it('binds every creep and tower event to a contract clip or to nothing on purpose', () => {
    const contract = readFileSync(join(REPO, 'docs', 'art', 'animation-contract.md'), 'utf8')
    for (const [ev, b] of Object.entries({ ...CREEP_BINDINGS, ...TOWER_BINDINGS })) {
      if (b.clip) expect(contract, `${ev} → ${b.clip}`).toContain(`\`${b.clip}\``)
    }
    expect(CREEP_BINDINGS.spawned.then).toBe('Walk')
    expect(CREEP_BINDINGS.died.then).toBe('hold')
    expect(TOWER_BINDINGS.sold.then).toBe('remove')
  })
  it('every sound event it names is in docs/art/audio.md', () => {
    const audio = readFileSync(join(REPO, 'docs', 'art', 'audio.md'), 'utf8')
    const events = new Set<string>()
    for (const b of [...Object.values(CREEP_BINDINGS), ...Object.values(TOWER_BINDINGS)]) if (b.sfx) events.add(b.sfx)
    for (const f of Object.values(TOWER_FX)) events.add(f.hit)
    for (const ev of events) {
      // Creep templates take a size, tower templates an archetype; the doc lists `sfx_<event>_<size|archetype>_n` rows.
      // The doc writes `<size>` and `<archetype>` where a row covers several ids, and concrete ids elsewhere.
      const forms = [ev.replace('{size}', '<size>').replace('{archetype}', '<archetype>'), fillSfx(ev, 'runner'), fillSfx(ev, 'single')]
      expect(forms.some((f) => audio.includes(`sfx_${f}`)), `sound event ${ev} (${forms.join(' | ')})`).toBe(true)
    }
  })
})

describe('AnimatedModel', () => {
  it('plays loops as loops and one-shots once, then reports the end', () => {
    const root = new THREE.Object3D()
    const finished: string[] = []
    const m = new AnimatedModel({ root, clips: [clip('Idle', 1), clip('Walk', 0.5), clip('Death', 0.4)], entries: { Idle: { seconds: 1, loop: true, markers: {} }, Walk: { seconds: 0.5, loop: true, markers: {}, stride: 1 }, Death: { seconds: 0.4, loop: false, markers: { impact: 0.5 } } }, onFinished: (c) => finished.push(c) })
    m.play('Walk')
    for (let i = 0; i < 30; i++) m.update(0.1)
    expect(finished).toEqual([])
    expect(m.playing).toBe('Walk')
    m.play('Death')
    for (let i = 0; i < 10; i++) m.update(0.1)
    expect(finished).toEqual(['Death'])
    expect(m.playing).toBe('Death')
  })
  it('scales Walk so feet cover the declared stride at the given speed', () => {
    const root = new THREE.Object3D()
    const m = new AnimatedModel({ root, clips: [clip('Walk', 0.5)], entries: { Walk: { seconds: 0.5, loop: true, markers: {}, stride: 1.0 } } })
    m.walk(3.0) // 1 tile per 0.5 s naturally = 2 tiles/s; 3 tiles/s is 1.5×
    const playing = (m as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get('Walk')!
    expect(playing.timeScale).toBeCloseTo(1.5)
  })
  it('fires a marker once when the clip crosses it', () => {
    const root = new THREE.Object3D()
    const markers: string[] = []
    const m = new AnimatedModel({ root, clips: [clip('Death', 1)], entries: { Death: { seconds: 1, loop: false, markers: { impact: 0.6 } } }, onMarker: (_c, mk) => markers.push(mk) })
    m.play('Death')
    m.update(0.3)
    expect(markers).toEqual([])
    m.update(0.4)
    m.update(0.4)
    expect(markers).toEqual(['impact'])
  })
  it('a missing clip throws in dev', () => {
    const root = new THREE.Object3D()
    const m = new AnimatedModel({ root, clips: [clip('Idle', 1)], entries: {} })
    expect(() => m.play('Attack')).toThrow(/no "Attack" clip/)
  })
})

describe('the team-colour material', () => {
  it('reads the mask from the albedo alpha and takes the colour from a uniform or instanceColor', () => {
    const mat = teamToonMaterial({ map: null, instanced: true, team: 1 })
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n' }
    mat.onBeforeCompile!(shader as never, null as never)
    expect(shader.fragmentShader).toContain(TEAM_SHADER_TAG)
    expect(shader.fragmentShader).toContain('mix( sampledDiffuseColor.rgb, ltwTeam, sampledDiffuseColor.a )')
    expect(shader.fragmentShader).toContain('USE_INSTANCING_COLOR')
    expect(shader.fragmentShader).not.toContain('#include <color_fragment>')
    expect((shader.uniforms['teamColour'] as { value: THREE.Color }).value.getHex()).toBe(TEAM_COLOURS[1].getHex())
    setTeam(mat, 0)
    expect((shader.uniforms['teamColour'] as { value: THREE.Color }).value.getHex()).toBe(TEAM_COLOURS[0].getHex())
  })
})

describe('the match budget', () => {
  const entry = (cls: AssetEntry['class'], triangles: number): AssetEntry => ({ class: cls, archetype: 'x', file: '', bytes: 0, hash: '', version: 1, triangles, vertices: 0, bones: 0, textures: [{ size: 512, format: 'image/ktx2' }], clips: {}, height: 1, footprint: 1, audio: {}, source: { kind: 'generated', licence: 'own', author: '' } })
  it('is measured at the real creep peak, not the stated 300', () => {
    expect(MATCH.creeps).toBe(1000)
    const r = checkMatchBudget({ a: entry('creep', 1500), b: entry('tower', 2500) })
    expect(r.triangles).toBe(1500 * 1000 + 2500 * 60 * 2)
    expect(r.ok).toBe(true)
  })
  it('flags a catalogue that cannot fit a flood', () => {
    const r = checkMatchBudget({ a: entry('creep', 3000) })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toMatch(/triangles/)
    expect(r.drawCallsAtPeak).toBeGreaterThan(LIMITS.drawCalls)
  })
})
