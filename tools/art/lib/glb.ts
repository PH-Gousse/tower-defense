import { readFileSync } from 'node:fs'

/**
 * A GLB reader for the gate: enough of glTF to count triangles, read
 * accessors, find the animations and their samplers, and check materials.
 * Mirrors art/generators/ltw_art/glb.py; two languages, one file format.
 */

export interface Gltf {
  asset: { generator?: string; version: string }
  scenes?: { nodes: number[]; name?: string }[]
  nodes: { name?: string; mesh?: number; skin?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[]
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[]
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[]
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[]
  materials?: { name?: string; alphaMode?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number }; baseColorFactor?: number[] }; emissiveFactor?: number[]; extensions?: Record<string, unknown> }[]
  images?: { name?: string; mimeType?: string; bufferView?: number; uri?: string; extensions?: Record<string, unknown> }[]
  textures?: { source?: number; sampler?: number; extensions?: Record<string, unknown> }[]
  skins?: { name?: string; joints: number[]; inverseBindMatrices?: number }[]
  animations?: { name?: string; channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[]; extras?: Record<string, unknown> }[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

export interface Glb { json: Gltf; bin: Buffer }

export function readGlb(path: string): Glb {
  const b = readFileSync(path)
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`)
  let off = 12
  let json: Gltf | null = null
  let bin: Buffer = Buffer.alloc(0)
  while (off < b.length) {
    const len = b.readUInt32LE(off)
    const type = b.readUInt32LE(off + 4)
    const data = b.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')) as Gltf
    else if (type === 0x004e4942) bin = data
    off += 8 + len
  }
  if (!json) throw new Error(`${path}: no JSON chunk`)
  return { json, bin }
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

export function accessor(g: Glb, index: number): Float32Array | Uint32Array | Uint16Array | Uint8Array {
  const a = g.json.accessors[index]
  if (!a) throw new Error(`no accessor ${index}`)
  if (a.bufferView === undefined) throw new Error('sparse accessors are not handled')
  const v = g.json.bufferViews[a.bufferView]
  if (!v) throw new Error(`no bufferView ${a.bufferView}`)
  const n = COMPONENTS[a.type] ?? 1
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const count = a.count * n
  const slice = g.bin.buffer.slice(g.bin.byteOffset + start, g.bin.byteOffset + start + count * bytes(a.componentType))
  switch (a.componentType) {
    case 5126: return new Float32Array(slice)
    case 5125: return new Uint32Array(slice)
    case 5123: return new Uint16Array(slice)
    case 5121: return new Uint8Array(slice)
    default: throw new Error(`component type ${a.componentType}`)
  }
}

function bytes(componentType: number): number {
  return componentType === 5126 || componentType === 5125 ? 4 : componentType === 5123 ? 2 : 1
}

export function triangleCount(g: Glb): number {
  let n = 0
  for (const m of g.json.meshes ?? []) for (const p of m.primitives) if (p.indices !== undefined) n += (g.json.accessors[p.indices]?.count ?? 0) / 3
  return n
}

/** World-space bounds of the first scene's meshes at rest, from POSITION min/max and node transforms (translation and uniform scale only, which is all the factory emits). */
export function bounds(g: Glb): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const visit = (ni: number, tx: number[], sc: number) => {
    const n = g.json.nodes[ni]
    if (!n) return
    const t = [tx[0]! + (n.translation?.[0] ?? 0) * sc, tx[1]! + (n.translation?.[1] ?? 0) * sc, tx[2]! + (n.translation?.[2] ?? 0) * sc]
    const s = sc * (n.scale?.[0] ?? 1)
    if (n.mesh !== undefined) {
      for (const p of g.json.meshes?.[n.mesh]?.primitives ?? []) {
        const a = g.json.accessors[p.attributes['POSITION'] ?? -1]
        if (!a?.min || !a.max) continue
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i]!, t[i]! + a.min[i]! * s)
          max[i] = Math.max(max[i]!, t[i]! + a.max[i]! * s)
        }
      }
    }
    for (const c of n.children ?? []) visit(c, t, s)
  }
  for (const root of g.json.scenes?.[0]?.nodes ?? []) visit(root, [0, 0, 0], 1)
  return Number.isFinite(min[0]!) ? { min, max } : null
}

export interface ClipInfo {
  name: string
  seconds: number
  /** Max horizontal drift of the root node's translation over the clip, in units. */
  rootDrift: number
  /** Max pose delta between the first and last keyframe, translation (units) and rotation (radians), over every channel. */
  seamTranslation: number
  seamRotation: number
  /** Whether every keyframe time sits on the 1/fps grid within 1 ms. */
  onGrid: boolean
  channels: number
}

export function clips(g: Glb, fps: number): ClipInfo[] {
  const out: ClipInfo[] = []
  const nodeName = (i: number | undefined) => (i === undefined ? '' : g.json.nodes[i]?.name ?? '')
  for (const a of g.json.animations ?? []) {
    let seconds = 0
    let rootDrift = 0
    let seamT = 0
    let seamR = 0
    let onGrid = true
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler]
      if (!s) continue
      const times = accessor(g, s.input) as Float32Array
      const values = accessor(g, s.output) as Float32Array
      const last = times[times.length - 1] ?? 0
      seconds = Math.max(seconds, last)
      for (const t of times) if (Math.abs(t * fps - Math.round(t * fps)) > 0.001 * fps) onGrid = false
      const n = ch.target.path === 'rotation' ? 4 : 3
      const count = values.length / n
      if (count < 2) continue
      const first = Array.from(values.subarray(0, n))
      const end = Array.from(values.subarray((count - 1) * n, count * n))
      if (ch.target.path === 'translation') {
        seamT = Math.max(seamT, Math.hypot(...first.map((v, i) => v - (end[i] ?? 0))))
        if (nodeName(ch.target.node) === 'root') {
          for (let k = 0; k < count; k++) {
            const dx = (values[k * 3] ?? 0) - (first[0] ?? 0)
            const dz = (values[k * 3 + 2] ?? 0) - (first[2] ?? 0)
            rootDrift = Math.max(rootDrift, Math.hypot(dx, dz))
          }
        }
      } else if (ch.target.path === 'rotation') {
        const dot = Math.abs(first.reduce((acc, v, i) => acc + v * (end[i] ?? 0), 0))
        seamR = Math.max(seamR, 2 * Math.acos(Math.min(1, dot)))
      } else if (ch.target.path === 'scale') {
        seamT = Math.max(seamT, Math.hypot(...first.map((v, i) => v - (end[i] ?? 0))))
      }
    }
    out.push({ name: a.name ?? '', seconds, rootDrift, seamTranslation: seamT, seamRotation: seamR, onGrid, channels: a.channels.length })
  }
  return out
}
