import * as THREE from 'three'

/**
 * The one WebGL renderer, and the one resize hub.
 *
 * Extracted from `scene.ts` so the camera demo does not stand up a second
 * renderer beside the game's. Two `WebGLRenderer`s on one page means two GL
 * contexts, two canvases stacked in the DOM and two `resize` listeners racing
 * to set the same pixel ratio -- and browsers cap live contexts, so the second
 * one silently evicts the first on some machines.
 *
 * Resize is a subscription rather than a hard-coded body, because the camera
 * rig needs the new aspect at the same moment the drawing buffer changes. A
 * rig that learns about a resize one frame late renders one stretched frame on
 * every window drag, which reads as a stutter.
 */
export class WebGLUnavailable extends Error {
  constructor(cause: unknown) {
    super('WebGL is unavailable in this browser')
    this.name = 'WebGLUnavailable'
    this.cause = cause
  }
}

export interface RendererHost {
  readonly renderer: THREE.WebGLRenderer
  readonly canvas: HTMLCanvasElement
  /** Subscribe to viewport changes. Returns an unsubscribe function. */
  readonly onResize: (cb: (width: number, height: number) => void) => () => void
  /** Re-read the window size and notify subscribers. Safe to call at any time. */
  readonly resize: () => void
  readonly dispose: () => void
}

/**
 * Device pixel ratio is capped at 2 on purpose.
 *
 * A 3x phone renders 9x the fragments of a 1x one for a difference no one can
 * see on a checkerboard of flat-shaded tiles, and it is the single easiest way
 * to miss 60fps on hardware that is otherwise fine.
 */
const MAX_PIXEL_RATIO = 2

export function createRenderer(parent: HTMLElement): RendererHost {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch (err) {
    throw new WebGLUnavailable(err)
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
  // One sun, one shadow map. Soft PCF because the towers are small and a hard
  // shadow edge aliases visibly as the camera pans; the cost is a few extra
  // texture reads per fragment on a scene that is otherwise trivially light.
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  parent.appendChild(renderer.domElement)

  const listeners = new Set<(w: number, h: number) => void>()

  function resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    // The pixel ratio is re-read here, not just at construction: dragging a
    // window between a Retina and an external display changes it mid-session.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    renderer.setSize(w, h)
    for (const cb of listeners) cb(w, h)
  }

  window.addEventListener('resize', resize)

  return {
    renderer,
    canvas: renderer.domElement,
    onResize: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    resize,
    dispose: () => {
      window.removeEventListener('resize', resize)
      listeners.clear()
      renderer.setAnimationLoop(null)
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
