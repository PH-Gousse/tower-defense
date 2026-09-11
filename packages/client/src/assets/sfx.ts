import type { AssetRegistry } from './registry'

/**
 * Plays the manifest's sounds. Decodes each file once on first use, picks
 * Opus/WebM when the browser can play it and MP3 otherwise, rotates
 * variants for an event and varies pitch a few percent, as the synthesised
 * sounds in audio.ts do. Placement follows the same rule: pan by x against
 * the listener, attenuate outside the frame.
 *
 * Owns its own AudioContext for now. audio.ts keeps its context private
 * (it is being edited in flight); when it exposes its sfx bus this should
 * play into that instead, so file sounds and synthesised ones share one
 * compressor and one mute. Two contexts resume on the same gesture, so
 * nothing is lost meanwhile except the shared mix.
 */

export class SfxPlayer {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private readonly buffers = new Map<string, AudioBuffer | Promise<AudioBuffer>>()
  private readonly variantCursor = new Map<string, number>()
  private listenerX = 0
  private halfWidth = 20
  private seed = 12345
  muted = false

  constructor(private readonly registry: AssetRegistry) {}

  start(): void {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 4
    this.master.connect(comp).connect(this.ctx.destination)
  }

  setListener(x: number, halfWidth: number): void {
    this.listenerX = x
    this.halfWidth = Math.max(1, halfWidth)
  }

  /** Every manifest id for an event, sorted, so variants rotate deterministically. */
  idsFor(event: string): string[] {
    return this.registry.soundIds().filter((id) => this.registry.sound(id)?.event === event).sort()
  }

  private pickFile(id: string): string | null {
    const s = this.registry.sound(id)
    if (!s) return null
    const a = (globalThis as { document?: Document }).document?.createElement('audio')
    const opus = a ? a.canPlayType('audio/webm; codecs=opus') !== '' : true
    return this.registry.urlFor(opus ? s.files.webm : s.files.mp3)
  }

  private async buffer(id: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id)
    if (have) return have
    const url = this.pickFile(id)
    if (!url || !this.ctx) return null
    const p = fetch(url).then((r) => r.arrayBuffer()).then((b) => this.ctx!.decodeAudioData(b))
    this.buffers.set(id, p)
    const buf = await p
    this.buffers.set(id, buf)
    return buf
  }

  /** Play one variant of an event at a world x. Returns the id played, or null when the catalogue has none. */
  play(event: string, x = this.listenerX, gain = 1): string | null {
    const ids = this.idsFor(event)
    if (ids.length === 0) return null
    const cursor = (this.variantCursor.get(event) ?? 0) % ids.length
    this.variantCursor.set(event, cursor + 1)
    const id = ids[cursor]!
    if (!this.ctx || !this.master || this.muted) return id
    void this.buffer(id).then((buf) => {
      if (!buf || !this.ctx || !this.master) return
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      // ±4 % pitch variation, seeded so a replay sounds the same twice.
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0
      src.playbackRate.value = 1 + ((this.seed / 4294967296) * 2 - 1) * 0.04
      const pan = this.ctx.createStereoPanner()
      const rel = (x - this.listenerX) / this.halfWidth
      pan.pan.value = Math.max(-1, Math.min(1, rel * 0.8))
      const g = this.ctx.createGain()
      g.gain.value = gain * (Math.abs(rel) > 1 ? Math.max(0.15, 1 - (Math.abs(rel) - 1) * 0.6) : 1)
      src.connect(pan).connect(g).connect(this.master)
      src.start()
    })
    return id
  }
}
