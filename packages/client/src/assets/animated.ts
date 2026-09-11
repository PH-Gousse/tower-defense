import * as THREE from 'three'
import type { ClipEntry } from './registry'

/**
 * One animated instance: one mixer, one action per contract clip, and the
 * contract's rules for what plays after what (docs/art/animation-contract.md).
 *
 *   play(state)       crossfade to the clip for the state; a one-shot that is
 *                     already playing is not restarted by the same state
 *   Walk.timeScale    speed / stride, so feet do not slide at any speed
 *   one-shots         clampWhenFinished; `onFinished` fires once per play
 *   markers           `onMarker(name)` fires when the clip crosses it
 *
 * The mixer advances with wall time, never the sim tick. A missing clip
 * throws in dev and falls back to Idle in a build.
 */

export const CROSSFADE_S = 0.12
export const DEV = typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV)

export type ClipName = 'Idle' | 'Walk' | 'Death' | 'Spawn' | 'Build' | 'Attack' | 'Upgrade' | 'Sell'
const LOOPS: ReadonlySet<string> = new Set(['Idle', 'Walk'])

export interface AnimatedModelOptions {
  readonly root: THREE.Object3D
  readonly clips: readonly THREE.AnimationClip[]
  readonly entries: Record<string, ClipEntry>
  readonly onFinished?: (clip: ClipName) => void
  readonly onMarker?: (clip: ClipName, marker: string) => void
}

export class AnimatedModel {
  readonly root: THREE.Object3D
  readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private readonly entries: Record<string, ClipEntry>
  private current: ClipName | null = null
  private markerCursor = new Map<string, number>()
  private readonly onFinished?: (clip: ClipName) => void
  private readonly onMarker?: (clip: ClipName, marker: string) => void

  constructor(o: AnimatedModelOptions) {
    this.root = o.root
    this.entries = o.entries
    this.onFinished = o.onFinished
    this.onMarker = o.onMarker
    this.mixer = new THREE.AnimationMixer(o.root)
    for (const clip of o.clips) {
      const action = this.mixer.clipAction(clip)
      if (LOOPS.has(clip.name)) {
        action.setLoop(THREE.LoopRepeat, Infinity)
      } else {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      this.actions.set(clip.name, action)
    }
    this.mixer.addEventListener('finished', (e) => {
      const name = (e as { action: THREE.AnimationAction }).action.getClip().name as ClipName
      this.onFinished?.(name)
    })
  }

  has(clip: ClipName): boolean {
    return this.actions.has(clip)
  }

  get playing(): ClipName | null {
    return this.current
  }

  /** Crossfade to `clip`. Returns false when the clip is missing (and, in dev, throws). */
  play(clip: ClipName, opts: { restart?: boolean; timeScale?: number } = {}): boolean {
    let action = this.actions.get(clip)
    if (!action) {
      if (DEV) throw new Error(`AnimatedModel: no "${clip}" clip on ${this.root.name || 'model'}; the contract requires it`)
      console.warn(`AnimatedModel: no "${clip}" clip on ${this.root.name || 'model'}, falling back to Idle`)
      action = this.actions.get('Idle')
      if (!action) return false
      clip = 'Idle'
    }
    if (this.current === clip && !opts.restart) {
      if (opts.timeScale !== undefined) action.timeScale = opts.timeScale
      return true
    }
    const prev = this.current ? this.actions.get(this.current) : undefined
    action.reset()
    action.enabled = true
    action.timeScale = opts.timeScale ?? 1
    if (prev && prev !== action) {
      action.setEffectiveWeight(1)
      action.crossFadeFrom(prev, CROSSFADE_S, false)
    } else {
      action.setEffectiveWeight(1)
    }
    action.play()
    this.current = clip
    this.markerCursor.set(clip, 0)
    return true
  }

  /** Walk speed in tiles per second → timeScale, from the clip's declared stride. */
  walk(tilesPerSecond: number): void {
    const e = this.entries['Walk']
    const stride = e?.stride ?? 1
    const seconds = e?.seconds ?? 1
    // One cycle covers `stride` tiles in `seconds` at timeScale 1.
    const natural = stride / seconds
    this.play('Walk', { timeScale: natural > 0 ? tilesPerSecond / natural : 1 })
  }

  /** Advance by wall-clock seconds, firing marker callbacks the clip crossed. */
  update(dt: number): void {
    this.mixer.update(dt)
    if (!this.current || !this.onMarker) return
    const e = this.entries[this.current]
    const action = this.actions.get(this.current)
    if (!e || !action) return
    const markers = Object.entries(e.markers)
    if (markers.length === 0) return
    const t = action.time / Math.max(1e-6, action.getClip().duration)
    const seen = this.markerCursor.get(this.current) ?? 0
    let fired = seen
    let bit = 1
    for (const [name, at] of markers) {
      if (!(seen & bit) && t >= at) {
        this.onMarker(this.current, name)
        fired |= bit
      }
      bit <<= 1
    }
    this.markerCursor.set(this.current, fired)
  }

  stop(): void {
    this.mixer.stopAllAction()
    this.current = null
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
  }
}
