import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AssetId, SoundId } from './manifest.generated'
import { MANIFEST_VERSION } from './manifest.generated'

/**
 * The asset registry: the manifest, and the loaded models it names.
 *
 * The client refers to assets by TYPED id (`manifest.generated.ts`) and
 * never by path; this is the one place a path is built. Models load
 * through GLTFLoader with the meshopt decoder and KTX2Loader, which is what
 * the gate wrote them for. A match preloads its set with progress for the
 * loading screen and, in dev, refuses to start with anything missing --
 * a fallback that silently draws the old procedural model would hide
 * exactly the breakage this exists to surface.
 */

export interface ClipEntry { seconds: number; loop: boolean; markers: Record<string, number>; stride?: number }
export interface AssetEntry {
  class: 'creep' | 'tower' | 'projectile' | 'effect' | 'tile' | 'prop'
  archetype: string
  tier?: number
  level?: number
  file: string
  bytes: number
  hash: string
  version: number
  triangles: number
  vertices: number
  bones: number
  textures: { size: number; format: string }[]
  clips: Record<string, ClipEntry>
  height: number
  footprint: number
  muzzle?: [number, number, number]
  audio: Record<string, string>
  source: { kind: string; licence: string; author: string }
}
export interface SoundEntry { event: string; variant: number; files: { webm: string; mp3: string }; seconds: number }
export interface Manifest { manifest_version: number; assets: Record<string, AssetEntry>; sounds: Record<string, SoundEntry> }

export interface LoadedAsset {
  readonly id: AssetId
  readonly entry: AssetEntry
  /** The template scene. Never added to a scene directly: `instantiate` clones it. */
  readonly template: THREE.Group
  readonly clips: readonly THREE.AnimationClip[]
  readonly skinned: boolean
  /** The albedo texture, so a material can be rebuilt with the team-colour shader. */
  readonly albedo: THREE.Texture | null
  readonly glowColour: THREE.Color | null
}

export class MissingAsset extends Error {
  constructor(readonly id: string) {
    super(`asset "${id}" is not in the manifest or failed to load`)
  }
}

export class AssetRegistry {
  private manifest: Manifest | null = null
  private readonly loaded = new Map<string, LoadedAsset>()
  private readonly loader = new GLTFLoader()
  private ktx2: KTX2Loader | null = null

  constructor(private readonly baseUrl: string) {
    this.loader.setMeshoptDecoder(MeshoptDecoder)
  }

  /** The KTX2 transcoder needs the renderer to know which GPU formats it can target. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    this.ktx2 = new KTX2Loader().setTranscoderPath(`${this.baseUrl}basis/`).detectSupport(renderer)
    this.loader.setKTX2Loader(this.ktx2)
  }

  async load(): Promise<Manifest> {
    const res = await fetch(`${this.baseUrl}assets/manifest.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`)
    const m = (await res.json()) as Manifest
    if (m.manifest_version !== MANIFEST_VERSION) {
      throw new Error(`manifest version ${m.manifest_version} but the client was generated from ${MANIFEST_VERSION}: run pnpm manifest-types`)
    }
    this.manifest = m
    return m
  }

  get ready(): boolean {
    return this.manifest !== null
  }

  ids(): AssetId[] {
    return Object.keys(this.manifest?.assets ?? {}) as AssetId[]
  }

  entry(id: string): AssetEntry | null {
    return this.manifest?.assets[id] ?? null
  }

  sound(id: string): SoundEntry | null {
    return this.manifest?.sounds[id] ?? null
  }

  soundIds(): SoundId[] {
    return Object.keys(this.manifest?.sounds ?? {}) as SoundId[]
  }

  /** The asset for a class/archetype at a tier or level, or null when the catalogue has none. */
  find(cls: AssetEntry['class'], archetype: string, tierOrLevel?: number): AssetId | null {
    const suffix = cls === 'creep' ? `_t${tierOrLevel ?? 1}` : cls === 'tower' ? `_l${tierOrLevel ?? 1}` : ''
    const prefix = { creep: 'creep', tower: 'tower', projectile: 'proj', effect: 'fx', tile: 'tile', prop: 'prop' }[cls]
    const id = `${prefix}_${archetype}${suffix}`
    return this.manifest?.assets[id] ? (id as AssetId) : null
  }

  urlFor(file: string): string {
    return `${this.baseUrl}assets/${file}`
  }

  has(id: string): boolean {
    return this.loaded.has(id)
  }

  get(id: AssetId): LoadedAsset {
    const a = this.loaded.get(id)
    if (!a) throw new MissingAsset(id)
    return a
  }

  async loadOne(id: AssetId): Promise<LoadedAsset> {
    const cached = this.loaded.get(id)
    if (cached) return cached
    const entry = this.entry(id)
    if (!entry) throw new MissingAsset(id)
    const gltf: GLTF = await this.loader.loadAsync(this.urlFor(entry.file))
    const template = gltf.scene
    let skinned = false
    let albedo: THREE.Texture | null = null
    let glowColour: THREE.Color | null = null
    template.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = false
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial
          if (std.name === 'body' && std.map) albedo = std.map
          if (std.name === 'glow') glowColour = std.emissive.clone()
        }
      }
    })
    const asset: LoadedAsset = { id, entry, template, clips: gltf.animations, skinned, albedo, glowColour }
    this.loaded.set(id, asset)
    return asset
  }

  /**
   * Load a set with progress. Resolves when every id is loaded; rejects
   * with the first failure so a match never starts on a broken catalogue.
   */
  async preload(ids: readonly AssetId[], onProgress?: (done: number, total: number, id: string) => void): Promise<void> {
    let done = 0
    for (const id of ids) {
      await this.loadOne(id)
      done += 1
      onProgress?.(done, ids.length, id)
    }
  }

  /** A fresh instance. Skinned models are cloned with their skeletons; static ones share geometry. */
  instantiate(id: AssetId): THREE.Group {
    const a = this.get(id)
    const inst = (a.skinned ? cloneSkeleton(a.template) : a.template.clone()) as THREE.Group
    return inst
  }

  /** The ids a match needs: every creep tier, every tower level, every projectile, tile and effect in the manifest. */
  matchSet(): AssetId[] {
    return this.ids().filter((id) => {
      const e = this.entry(id)!
      return e.class !== 'prop'
    })
  }
}
