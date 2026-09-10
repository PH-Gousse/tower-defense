import * as THREE from 'three'
import type { Model } from './models'

/**
 * Palette icons, rendered from the game's own models.
 *
 * The build and send cards need a picture of what they buy, and drawing twelve
 * icons by hand would put a second, slowly diverging description of every
 * tower and creep next to the first. Rendering the real geometry once at
 * start-up into a small texture keeps the card and the board in agreement by
 * construction: change the mortar, and its icon changes with it.
 *
 * Uses the game's own renderer rather than a second one -- see `renderer.ts`
 * for why two GL contexts on a page is a bad idea -- and restores every piece
 * of renderer state it touches.
 */

const SIZE = 128

export function renderIcon(
  renderer: THREE.WebGLRenderer,
  model: Model,
  view: { yaw?: number; pitch?: number; zoom?: number } = {},
): string {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xe0ecff, 0x3d4a2e, 1.1))
  const sun = new THREE.DirectionalLight(0xfff1d8, 1.9)
  sun.position.set(2, 3.5, 2.5)
  scene.add(sun)

  const group = new THREE.Group()
  const disposables: THREE.Material[] = []
  if (model.lit) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true })
    disposables.push(m)
    group.add(new THREE.Mesh(model.lit, m))
  }
  if (model.glow) {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true })
    disposables.push(m)
    group.add(new THREE.Mesh(model.glow, m))
  }
  scene.add(group)

  const box = new THREE.Box3().setFromObject(group)
  const centre = box.getCenter(new THREE.Vector3())
  const radius = box.getSize(new THREE.Vector3()).length() / 2

  const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 100)
  const yaw = view.yaw ?? 0.7
  const pitch = view.pitch ?? 0.55
  const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * (view.zoom ?? 1.05)
  camera.position.set(
    centre.x + Math.cos(pitch) * Math.sin(yaw) * dist,
    centre.y + Math.sin(pitch) * dist,
    centre.z + Math.cos(pitch) * Math.cos(yaw) * dist,
  )
  camera.lookAt(centre)

  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { colorSpace: THREE.SRGBColorSpace })
  const prevTarget = renderer.getRenderTarget()
  const prevClear = renderer.getClearColor(new THREE.Color())
  const prevAlpha = renderer.getClearAlpha()
  const prevShadows = renderer.shadowMap.enabled
  renderer.shadowMap.enabled = false
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 0)
  renderer.clear()
  renderer.render(scene, camera)

  const pixels = new Uint8Array(SIZE * SIZE * 4)
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels)

  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevClear, prevAlpha)
  renderer.shadowMap.enabled = prevShadows
  target.dispose()
  for (const m of disposables) m.dispose()

  // GL reads bottom-up; a canvas is top-down. Flip while copying, then draw at
  // half size so the browser's downsample does the anti-aliasing.
  const full = document.createElement('canvas')
  full.width = SIZE
  full.height = SIZE
  const ctx = full.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(SIZE, SIZE)
  for (let y = 0; y < SIZE; y++) {
    const src = (SIZE - 1 - y) * SIZE * 4
    img.data.set(pixels.subarray(src, src + SIZE * 4), y * SIZE * 4)
  }
  ctx.putImageData(img, 0, 0)
  const out = document.createElement('canvas')
  out.width = SIZE / 2
  out.height = SIZE / 2
  const octx = out.getContext('2d')
  if (!octx) return ''
  octx.drawImage(full, 0, 0, SIZE / 2, SIZE / 2)
  return out.toDataURL('image/png')
}
