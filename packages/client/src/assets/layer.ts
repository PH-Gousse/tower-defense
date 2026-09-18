import { CREEP_VIEW_SCALE } from '../render/creepBand'
import * as THREE from 'three'
import { AnimatedModel, type ClipName } from './animated'
import { CREEP_BINDINGS, TOWER_BINDINGS, CORPSE_MS, fillSfx, type Binding } from './bindings'
import { applyTeamMaterials } from './material'
import { LIMITS } from './budget'
import { crowd, type CrowdInstance } from './crowd'
import type { AssetRegistry } from './registry'
import type { AssetId } from './manifest.generated'
import type { SfxPlayer } from './sfx'

/**
 * The asset layer: draws creeps and towers from the catalogue when the
 * catalogue has them, and plays the bound clip and sound for every event
 * the scene infers. The scene keeps inferring events and keeps its pools
 * (dust, rings, flashes, projectiles); this owns the animated models.
 *
 * Each creep and tower is its own AnimatedModel over a cloned skinned
 * scene: one draw call per material per model. That is the honest v1 and
 * it warns in dev past `LIMITS.skinnedWarn` creeps. The instanced crowd
 * path plugs into `crowd.ts`; when a renderer is registered there, creeps
 * in Walk or Idle go through it and only one-shots stay skinned.
 *
 * Model space is +Z forward (style sheet §8). The scene's heading is for
 * +X-facing models, so rotation.y = heading + π/2 here.
 */

const FROST = new THREE.Color(0.55, 0.78, 1.15)
const WHITE = new THREE.Color(1, 1, 1)

interface Creep {
  lane: number
  id: number
  asset: AssetId
  model: AnimatedModel
  body: THREE.MeshToonMaterial
  archetype: string
  seen: number
  dying: number // wall ms the Death clip ended, or 0
  spawning: boolean
}

interface Tower {
  lane: number
  tile: number
  asset: AssetId
  model: AnimatedModel
  archetype: string
  level: number
  removeAt: number
}

/** One line of the layer's event trace, for the dev viewer and for tests: what the binding table did. */
export interface TraceEntry { t: number; event: string; id: string; clip: string | null; sfx: string | null }

export class AssetLayer {
  /** The last 200 bound events, newest last. Dev tooling reads it; nothing in the render loop does. */
  readonly trace: TraceEntry[] = []
  private readonly creeps = new Map<number, Creep>() // key: lane * 2^24 + id
  private readonly towers = new Map<number, Tower>() // key: lane * 4096 + tile
  private readonly missing = new Set<string>()
  private lastMs = 0
  private frame = 0
  private warned = false
  private readonly crowdBuffer: CrowdInstance[] = []

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: AssetRegistry,
    private readonly sfx: SfxPlayer,
    private readonly opts: {
      readonly dev: boolean
      readonly creepNames: readonly string[]
      readonly towerNames: readonly string[]
    },
  ) {}

  get active(): boolean {
    return this.registry.ready
  }

  creepAsset(kind: number, tier: number): AssetId | null {
    const name = this.opts.creepNames[kind]
    if (!name) return null
    const id = this.registry.find('creep', name, tier + 1)
    return id && this.registry.has(id) ? id : null
  }

  towerAsset(kind: number, level: number): AssetId | null {
    const name = this.opts.towerNames[kind]
    if (!name) return null
    const id = this.registry.find('tower', name, level)
    return id && this.registry.has(id) ? id : null
  }

  // ---- creeps ---------------------------------------------------------------

  private key(lane: number, id: number): number {
    return lane * 16777216 + id
  }

  private makeCreep(lane: number, id: number, kind: number, asset: AssetId): Creep {
    const loaded = this.registry.get(asset)
    const root = this.registry.instantiate(asset)
    root.name = `${asset}#${id}`
    const body = applyTeamMaterials(root, loaded.albedo, loaded.glowColour, (1 - lane) as 0 | 1)
    const archetype = this.opts.creepNames[kind] ?? 'runner'
    // Drawn larger than the model is built: see CREEP_VIEW_SCALE.
    root.scale.setScalar(CREEP_VIEW_SCALE)
    const creep: Creep = { lane, id, asset, archetype, body, seen: this.frame, dying: 0, spawning: false, model: null as unknown as AnimatedModel }
    creep.model = new AnimatedModel({
      root,
      clips: loaded.clips,
      entries: loaded.entry.clips,
      onFinished: (clip) => this.creepClipEnded(creep, clip),
      onMarker: (clip, marker) => this.creepMarker(creep, clip, marker),
    })
    this.scene.add(root)
    this.creeps.set(this.key(lane, id), creep)
    return creep
  }

  private creepClipEnded(c: Creep, clip: ClipName): void {
    if (clip === 'Spawn') {
      c.spawning = false
      c.model.play('Walk')
    } else if (clip === 'Death') {
      c.dying = this.lastMs
    }
  }

  private creepMarker(c: Creep, clip: ClipName, marker: string): void {
    const b = clip === 'Spawn' ? CREEP_BINDINGS.spawned : clip === 'Death' ? CREEP_BINDINGS.died : null
    if (b && b.at === marker && b.sfx) this.playSfx(c.asset, b, c.archetype, c.model.root.position.x, `${clip === 'Spawn' ? 'spawned' : 'died'}@${marker}`)
  }

  private record(event: string, id: string, clip: string | null, sfx: string | null): void {
    this.trace.push({ t: this.lastMs, event, id, clip, sfx })
    if (this.trace.length > 200) this.trace.shift()
  }

  private playSfx(asset: AssetId, b: Binding, archetype: string, x: number, event = ''): boolean {
    if (!b.sfx) return false
    const entry = this.registry.entry(asset)
    // The asset's own audio block wins; then the convention.
    const own = entry?.audio[b.sfx.split('_')[0] ?? '']
    const ev = own && this.registry.sound(own) ? this.registry.sound(own)!.event : fillSfx(b.sfx, archetype)
    const played = this.sfx.play(ev, x)
    if (event) this.record(event, asset, b.clip, played)
    return played !== null
  }

  /** A creep appeared this tick. Returns true when a file sound will play (so the scene skips its synthesised one). */
  creepSpawned(lane: number, id: number, kind: number, tier: number, x: number, z: number, respawn: boolean): boolean {
    const asset = this.creepAsset(kind, tier)
    if (!asset) return false
    const c = this.creeps.get(this.key(lane, id)) ?? this.makeCreep(lane, id, kind, asset)
    c.model.root.position.set(x, 0, z)
    const b = respawn ? CREEP_BINDINGS.respawned : CREEP_BINDINGS.spawned
    if (b.clip) c.model.play(b.clip, { restart: true })
    c.spawning = true
    // The sound plays at the `land` marker unless the binding says now.
    if (b.sfx && !b.at) return this.playSfx(asset, b, c.archetype, x, respawn ? 'respawned' : 'spawned')
    this.record(respawn ? 'respawned' : 'spawned', asset, b.clip, null)
    return b.sfx !== null
  }

  /**
   * Per frame, for every live creep the scene would draw. Returns false when
   * this creep is not asset-backed and the scene must draw it itself.
   */
  placeCreep(lane: number, id: number, kind: number, tier: number, x: number, z: number, heading: number, moving: boolean, tilesPerSecond: number, slowed: boolean): boolean {
    const asset = this.creepAsset(kind, tier)
    if (!asset) return false
    let c = this.creeps.get(this.key(lane, id))
    if (!c) {
      // First sight without a spawn event: attached mid-match, or the spawn tick was skipped.
      c = this.makeCreep(lane, id, kind, asset)
      c.model.play('Walk')
    }
    c.seen = this.frame
    const r = c.model.root
    r.position.set(x, 0, z)
    r.rotation.y = heading + Math.PI / 2
    if (!c.spawning && c.dying === 0 && c.model.playing !== 'Death') {
      if (moving) c.model.walk(tilesPerSecond)
      else c.model.play(CREEP_BINDINGS.idle.clip ?? 'Idle')
    }
    c.body.color.copy(slowed ? FROST : WHITE)
    return true
  }

  creepDied(lane: number, id: number, x: number, z: number): boolean {
    const c = this.creeps.get(this.key(lane, id))
    if (!c) return false
    c.model.root.position.set(x, 0, z)
    c.spawning = false
    const b = CREEP_BINDINGS.died
    if (b.clip) c.model.play(b.clip, { restart: true })
    if (!c.model.has('Death')) c.dying = this.lastMs
    this.record('died', c.asset, b.clip, null)
    return b.sfx !== null
  }

  /** `mine` is whether the leak cost THIS client a life (the creep is in its lane). */
  creepLeaked(lane: number, id: number, x: number, z: number, mine: boolean): boolean {
    const c = this.creeps.get(this.key(lane, id))
    if (!c) return false
    const b = CREEP_BINDINGS.leaked
    c.model.root.position.set(x, 0, z)
    if (!b.sfx) return false
    const played = this.sfx.play(fillSfx(b.sfx, c.archetype, mine ? 'mine' : 'theirs'), x)
    this.record('leaked', c.asset, b.clip, played)
    return played !== null
  }

  /** After the scene's creep loop: retire models for creeps that are gone and corpses that have lain long enough. */
  endCreepFrame(): void {
    for (const [k, c] of this.creeps) {
      const corpseDone = c.dying !== 0 && this.lastMs - c.dying > CORPSE_MS
      const vanished = c.seen !== this.frame && c.model.playing !== 'Death' && c.dying === 0
      if (corpseDone || vanished) {
        this.scene.remove(c.model.root)
        c.model.dispose()
        c.body.dispose()
        this.creeps.delete(k)
      }
    }
    if (this.opts.dev && !this.warned && this.creeps.size > LIMITS.skinnedWarn) {
      this.warned = true
      console.warn(`[assets] ${this.creeps.size} skinned creeps on screen, past the ${LIMITS.skinnedWarn} dev warning: each is its own draw call. See assets/crowd.ts for the seam.`)
    }
  }

  // ---- towers ---------------------------------------------------------------

  private tkey(lane: number, tile: number): number {
    return lane * 4096 + tile
  }

  private makeTower(lane: number, tile: number, kind: number, level: number, asset: AssetId, x: number, z: number): Tower {
    const loaded = this.registry.get(asset)
    const root = this.registry.instantiate(asset)
    root.name = `${asset}@${lane}:${tile}`
    applyTeamMaterials(root, loaded.albedo, loaded.glowColour, lane as 0 | 1)
    // The catalogue's towers are built at the 2 x 2 footprint (style sheet §8),
    // with the origin on the grid vertex at its centre; the caller passes that.
    root.position.set(x, 0, z)
    const t: Tower = { lane, tile, asset, archetype: this.opts.towerNames[kind] ?? 'single', level, removeAt: 0, model: null as unknown as AnimatedModel }
    t.model = new AnimatedModel({
      root,
      clips: loaded.clips,
      entries: loaded.entry.clips,
      onFinished: (clip) => {
        if (clip === 'Sell') this.removeTower(lane, tile)
        else if (clip !== 'Idle') t.model.play('Idle')
      },
      onMarker: (clip, marker) => {
        if (clip === 'Attack' && marker === 'fire') this.playSfx(t.asset, TOWER_BINDINGS.fired, t.archetype, x, 'fired@fire')
      },
    })
    t.model.play('Idle')
    this.scene.add(root)
    this.towers.set(this.tkey(lane, tile), t)
    return t
  }

  /** Per tick: the tower on a tile. Returns false when not asset-backed. */
  placeTower(lane: number, tile: number, kind: number, level: number, x: number, z: number): boolean {
    const asset = this.towerAsset(kind, level)
    if (!asset) return false
    const k = this.tkey(lane, tile)
    let t = this.towers.get(k)
    if (t && (t.asset !== asset)) {
      // Level changed: the new level's model plays Upgrade.
      this.removeTower(lane, tile)
      t = undefined
    }
    if (!t) this.makeTower(lane, tile, kind, level, asset, x, z)
    return true
  }

  /**
   * A tower appeared this tick. The scene infers the build before it syncs
   * tower placement, so the model may not exist yet: place it here first.
   */
  towerBuilt(lane: number, tile: number, kind: number, level: number, x: number, z: number): boolean {
    if (!this.placeTower(lane, tile, kind, level, x, z)) return false
    const t = this.towers.get(this.tkey(lane, tile))
    if (!t) return false
    const b = TOWER_BINDINGS.built
    if (b.clip) t.model.play(b.clip, { restart: true })
    return this.playSfx(t.asset, b, t.archetype, t.model.root.position.x, 'built')
  }

  towerUpgraded(lane: number, tile: number): boolean {
    const t = this.towers.get(this.tkey(lane, tile))
    if (!t) return false
    const b = TOWER_BINDINGS.upgraded
    if (b.clip) t.model.play(b.clip, { restart: true })
    return this.playSfx(t.asset, b, t.archetype, t.model.root.position.x, 'upgraded')
  }

  /** Returns the muzzle in world space, or null when the tower is not asset-backed. */
  towerFired(lane: number, tile: number, out: THREE.Vector3): boolean {
    const t = this.towers.get(this.tkey(lane, tile))
    if (!t) return false
    const b = TOWER_BINDINGS.fired
    if (b.clip) t.model.play(b.clip, { restart: true })
    this.record('fired', t.asset, b.clip, null)
    const m = this.registry.entry(t.asset)?.muzzle
    out.set(t.model.root.position.x + (m?.[0] ?? 0), m?.[1] ?? 1, t.model.root.position.z + (m?.[2] ?? 0))
    return true
  }

  /** Whether the catalogue has a file sound for a tower event, so the scene can skip its synthesised one. */
  hasSfxFor(event: 'fired' | 'built' | 'upgraded' | 'sold', kind: number): boolean {
    const b = TOWER_BINDINGS[event]
    if (!b.sfx) return false
    return this.sfx.idsFor(fillSfx(b.sfx, this.opts.towerNames[kind] ?? '')).length > 0
  }

  towerSold(lane: number, tile: number): boolean {
    const t = this.towers.get(this.tkey(lane, tile))
    if (!t) return false
    const b = TOWER_BINDINGS.sold
    if (b.clip && t.model.has('Sell')) t.model.play(b.clip, { restart: true })
    else this.removeTower(lane, tile)
    return this.playSfx(t.asset, b, t.archetype, t.model.root.position.x, 'sold')
  }

  private removeTower(lane: number, tile: number): void {
    const k = this.tkey(lane, tile)
    const t = this.towers.get(k)
    if (!t) return
    this.scene.remove(t.model.root)
    t.model.dispose()
    this.towers.delete(k)
  }

  /** Towers no longer on the board and not mid-Sell. */
  syncTowers(present: (lane: number, tile: number) => boolean): void {
    for (const [, t] of [...this.towers]) {
      if (!present(t.lane, t.tile) && t.model.playing !== 'Sell') this.removeTower(t.lane, t.tile)
    }
  }

  // ---- frame ------------------------------------------------------------------

  /** Advance every mixer by wall time. Call once per frame, before render. */
  update(nowMs: number): void {
    const dt = this.lastMs ? Math.min(0.1, (nowMs - this.lastMs) / 1000) : 0
    this.lastMs = nowMs
    this.frame += 1
    for (const c of this.creeps.values()) c.model.update(dt)
    for (const t of this.towers.values()) t.model.update(dt)
    if (crowd) {
      // The seam: hand loop-state creeps to the crowd renderer and hide their skinned models.
      this.crowdBuffer.length = 0
      for (const c of this.creeps.values()) {
        const p = c.model.playing
        if (p !== 'Walk' && p !== 'Idle') continue
        this.crowdBuffer.push({ id: c.id, asset: c.asset, x: c.model.root.position.x, y: 0, z: c.model.root.position.z, heading: c.model.root.rotation.y, scale: 1, clip: p, time: 0, team: (1 - c.lane) as 0 | 1, tint: null })
      }
      const taken = crowd.draw(this.crowdBuffer)
      for (const c of this.creeps.values()) c.model.root.visible = !taken.has(c.id)
    }
  }

  /** What every model is playing right now. Dev tooling only. */
  playing(): { creeps: Record<string, string | null>; towers: Record<string, string | null> } {
    const creeps: Record<string, string | null> = {}
    for (const c of this.creeps.values()) creeps[`${c.lane}:${c.id}`] = c.model.playing
    const towers: Record<string, string | null> = {}
    for (const t of this.towers.values()) towers[`${t.lane}:${t.tile}`] = t.model.playing
    return { creeps, towers }
  }

  stats(): { creeps: number; towers: number; drawCalls: number } {
    return { creeps: this.creeps.size, towers: this.towers.size, drawCalls: (this.creeps.size + this.towers.size) * 2 }
  }

  /** Assets the catalogue lacks for something the match needs; dev refuses to start on these. */
  missingFor(creepKinds: number, tiers: number, towerKinds: number, levels: number): string[] {
    const out: string[] = []
    for (let k = 0; k < creepKinds; k++) for (let t = 0; t < tiers; t++) if (!this.creepAsset(k, t)) out.push(`creep_${this.opts.creepNames[k]}_t${t + 1}`)
    for (let k = 0; k < towerKinds; k++) for (let l = 1; l <= levels; l++) if (!this.towerAsset(k, l)) out.push(`tower_${this.opts.towerNames[k]}_l${l}`)
    for (const m of out) this.missing.add(m)
    return out
  }
}
