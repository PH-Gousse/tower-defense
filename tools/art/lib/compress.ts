import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import { dedup, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

/**
 * The gate's compression step: KTX2 (UASTC, RGBA) for the albedo and
 * meshopt for everything else, through the gltf-transform API.
 *
 * Why not the CLI's `uastc` command: it decides which channels to keep
 * from the material, and an OPAQUE material keeps RGB only -- so the team
 * mask in the alpha channel was silently dropped and every model tinted
 * solid (measured: `ktx info` reported KHR_DF_CHANNEL_UASTC_RGB). Encoding
 * the PNG ourselves with `ktx create --format R8G8B8A8_SRGB` keeps all
 * four channels whatever the material says.
 */

export const PATH_EXTRA = [join(homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin']
const ENV = { ...process.env, PATH: [...PATH_EXTRA, process.env['PATH'] ?? ''].join(':') }

export function ktxBinary(): string | null {
  for (const d of PATH_EXTRA) if (existsSync(join(d, 'ktx'))) return join(d, 'ktx')
  const r = spawnSync('/bin/sh', ['-c', 'command -v ktx'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

export function encodeKtx2(png: string, out: string): { ok: boolean; log: string } {
  const bin = ktxBinary()
  if (!bin) return { ok: false, log: 'ktx not found' }
  const r = spawnSync(bin, ['create', '--format', 'R8G8B8A8_SRGB', '--assign-tf', 'srgb', '--generate-mipmap', '--encode', 'uastc', '--uastc-quality', '2', '--uastc-rdo', '--zstd', '18', png, out], { encoding: 'utf8', env: ENV, timeout: 300_000 })
  return { ok: r.status === 0 && existsSync(out), log: (r.stdout ?? '') + (r.stderr ?? '') }
}

export async function compressGlb(rawPath: string, outPath: string): Promise<{ ok: boolean; log: string; textures: number }> {
  const work = join(process.env['TMPDIR'] ?? '/tmp', `ltw-compress-${process.pid}`)
  mkdirSync(work, { recursive: true })
  let log = ''
  try {
    await MeshoptEncoder.ready
    await MeshoptDecoder.ready
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
    const doc = await io.read(rawPath)
    const textures = doc.getRoot().listTextures()
    if (textures.length) {
      doc.createExtension(KHRTextureBasisu).setRequired(true)
      textures.forEach((tex, i) => {
        const png = join(work, `t${i}.png`)
        const ktx = join(work, `t${i}.ktx2`)
        writeFileSync(png, tex.getImage() ?? new Uint8Array())
        const r = encodeKtx2(png, ktx)
        log += r.log
        if (!r.ok) throw new Error(`ktx create failed for texture ${i}: ${r.log.split('\n').filter(Boolean).slice(-2).join(' | ')}`)
        tex.setImage(new Uint8Array(readFileSync(ktx))).setMimeType('image/ktx2')
      })
    }
    await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
    await io.write(outPath, doc)
    return { ok: true, log, textures: textures.length }
  } catch (e) {
    return { ok: false, log: log + (e instanceof Error ? e.message : String(e)), textures: 0 }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
