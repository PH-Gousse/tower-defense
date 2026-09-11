import * as THREE from 'three'
import { createRenderer } from '../render/renderer'
import { AssetRegistry } from '../assets/registry'
import { AnimatedModel, type ClipName } from '../assets/animated'
import { applyTeamMaterials, setTeam } from '../assets/material'
import { BUDGETS } from '../assets/viewerBudgets'
import type { AssetId } from '../assets/manifest.generated'

/**
 * /assets — the dev asset viewer.
 *
 * Pick any manifest id, see it at the game camera, cycle its clips, toggle
 * team colour and wireframe, read its budget numbers, and (in dev) rebuild
 * it through asset-build and asset-gate without leaving the page. Shows
 * the BUILT file (meshopt + KTX2), which is what a match loads and what
 * Blender's own previews cannot show.
 */

const base = import.meta.env.BASE_URL
const el = (id: string) => document.getElementById(id) as HTMLElement
const assetSel = el('asset') as HTMLSelectElement
const clipSel = el('clip') as HTMLSelectElement
const status = el('status')
const numbers = el('numbers')
const log = el('log')

const host = createRenderer(document.body)
const renderer = host.renderer
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x6b7f94)
scene.add(new THREE.HemisphereLight(0xd6e4ff, 0x3f5230, 0.9))
const sun = new THREE.DirectionalLight(0xfff0d8, 1.75)
sun.position.set(-3, 6, 4)
sun.castShadow = true
scene.add(sun)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshLambertMaterial({ color: 0x4e6f36 }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)
const grid = new THREE.GridHelper(4, 4, 0x2f4a24, 0x2f4a24)
grid.position.y = 0.002
scene.add(grid)

const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 200)
const registry = new AssetRegistry(base)
registry.attachRenderer(renderer)

let current: { id: AssetId; root: THREE.Group; model: AnimatedModel; body: THREE.MeshToonMaterial } | null = null
let yaw = 0.6

function frameCamera(height: number, footprint: number): void {
  const gamecam = (el('gamecam') as HTMLInputElement).checked
  const fov = gamecam ? 18 : 35
  const pitch = gamecam ? 70 : 30
  camera.fov = fov
  const size = Math.max(height, footprint * 0.9, 0.3)
  const dist = (size / 0.7) / (2 * Math.tan((fov * Math.PI) / 360))
  const p = (pitch * Math.PI) / 180
  camera.position.set(Math.sin(yaw) * Math.cos(p) * dist, height * 0.45 + Math.sin(p) * dist, Math.cos(yaw) * Math.cos(p) * dist)
  camera.lookAt(0, height * 0.45, 0)
  camera.updateProjectionMatrix()
}

async function show(id: AssetId): Promise<void> {
  if (current) {
    scene.remove(current.root)
    current.model.dispose()
  }
  status.textContent = `loading ${id}…`
  const a = await registry.loadOne(id)
  const root = registry.instantiate(id)
  const body = applyTeamMaterials(root, a.albedo, a.glowColour, (el('team') as HTMLInputElement).checked ? 1 : 0)
  body.wireframe = (el('wire') as HTMLInputElement).checked
  scene.add(root)
  const model = new AnimatedModel({ root, clips: a.clips, entries: a.entry.clips, onFinished: (c) => { if (c !== 'Idle' && model.has('Idle') && c !== 'Death' && c !== 'Sell') model.play('Idle') } })
  current = { id, root, model, body }
  clipSel.innerHTML = ''
  const names = Object.keys(a.entry.clips)
  for (const n of names) clipSel.add(new Option(`${n} · ${a.entry.clips[n]!.seconds.toFixed(2)} s${a.entry.clips[n]!.loop ? ' · loop' : ''}`, n))
  if (names.length) model.play((names.includes('Idle') ? 'Idle' : names[0]) as ClipName)
  clipSel.value = model.playing ?? ''
  const e = a.entry
  const b = BUDGETS[e.class] ?? BUDGETS['prop']!
  const over = (v: number, max: number) => (v > max ? 'over' : '')
  numbers.innerHTML = [
    `<span class="${over(e.triangles, b.triangles)}">triangles ${e.triangles} / ${b.triangles}</span>`,
    `<span class="${over(e.bones, b.bones)}">bones     ${e.bones} / ${b.bones}</span>`,
    `<span class="${over(e.bytes, b.bytes)}">file      ${(e.bytes / 1024).toFixed(0)} KB / ${b.bytes / 1024} KB</span>`,
    `textures  ${e.textures.map((t) => `${t.size}² ${t.format.replace('image/', '')}`).join(', ') || 'none'}`,
    `height    ${e.height.toFixed(3)}  footprint ${e.footprint.toFixed(3)}`,
    `clips     ${names.join(', ') || 'none'}`,
    `version   v${e.version}  hash ${e.hash}`,
    `licence   ${e.source.kind} / ${e.source.licence}`,
    e.muzzle ? `muzzle    (${e.muzzle.map((v) => v.toFixed(2)).join(', ')})` : '',
  ].filter(Boolean).join('\n')
  frameCamera(e.height, e.footprint)
  status.textContent = `${id}  ·  ${renderer.info.render.calls} draw calls`
  history.replaceState(null, '', `#${id}`)
}

assetSel.addEventListener('change', () => void show(assetSel.value as AssetId))
clipSel.addEventListener('change', () => current?.model.play(clipSel.value as ClipName, { restart: true }))
el('next').addEventListener('click', () => {
  const i = (clipSel.selectedIndex + 1) % Math.max(1, clipSel.options.length)
  clipSel.selectedIndex = i
  current?.model.play(clipSel.value as ClipName, { restart: true })
})
el('team').addEventListener('change', () => { if (current) setTeam(current.body, (el('team') as HTMLInputElement).checked ? 1 : 0) })
el('wire').addEventListener('change', () => { if (current) current.body.wireframe = (el('wire') as HTMLInputElement).checked })
el('gamecam').addEventListener('change', () => { if (current) frameCamera(registry.entry(current.id)!.height, registry.entry(current.id)!.footprint) })
el('regen').addEventListener('click', async () => {
  if (!current || !import.meta.env.DEV) return
  const btn = el('regen') as HTMLButtonElement
  btn.disabled = true
  log.textContent = 'running asset-build + asset-gate…'
  try {
    const r = await fetch(`/__art/regenerate?id=${current.id}`, { method: 'POST' })
    const j = (await r.json()) as { ok: boolean; output: string }
    log.textContent = j.output.split('\n').filter((l) => !l.startsWith('{')).slice(-25).join('\n')
    if (j.ok) {
      await registry.load()
      ;(registry as unknown as { loaded: Map<string, unknown> }).loaded.delete(current.id)
      await show(current.id)
    }
  } catch (e) {
    log.textContent = String(e)
  }
  btn.disabled = false
})

let last = performance.now()
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if ((el('spin') as HTMLInputElement).checked && current) {
    yaw += dt * 0.6
    const e = registry.entry(current.id)!
    frameCamera(e.height, e.footprint)
  }
  current?.model.update(dt)
  renderer.render(scene, camera)
})
host.onResize((w, h) => {
  camera.aspect = w / h
  camera.updateProjectionMatrix()
})
host.resize()

void (async () => {
  try {
    const m = await registry.load()
    const ids = Object.keys(m.assets).sort() as AssetId[]
    for (const id of ids) assetSel.add(new Option(`${id}  (${m.assets[id]!.class})`, id))
    status.textContent = `${ids.length} assets in the manifest`
    const want = (location.hash.slice(1) || ids[0]) as AssetId | undefined
    if (want && m.assets[want]) {
      assetSel.value = want
      await show(want)
    }
  } catch (e) {
    status.textContent = `manifest failed: ${String(e)}`
  }
})()
