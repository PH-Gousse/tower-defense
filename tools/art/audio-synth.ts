import { existsSync, mkdirSync, rmSync, statSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs, flag, say, emit, fail, selectIds, requireTools } from './lib/cli'
import { listSoundIds, loadSoundSpec, synthesise, writeWav, deliver, TARGETS, SOUND_BUILD, sha256File } from './lib/audio'
import { loadManifest, saveManifest } from './lib/manifest'
import { RAW, rel } from './lib/paths'

/**
 * audio-synth <sfx_id|all> [--force] [--keep-wav]
 *
 * Renders art/sounds/<id>.yaml with the placeholder synthesiser to
 * assets/raw/sfx/<id>.wav, then normalises to −16 LUFS / −1 dBTP, delivers
 * assets/build/sfx/<id>.webm and .mp3, and records the sound in the
 * manifest with its measured loudness. Rejects a sound over the length
 * limit or off target after normalisation; never nudges the target.
 */

const argv = process.argv.slice(2)
const args = parseArgs(argv)
requireTools([{ bin: 'ffmpeg', install: 'brew install ffmpeg' }])
const ids = selectIds(argv, listSoundIds)
if (ids.length === 0) fail('no sound specs in art/sounds/')

const manifest = loadManifest()
mkdirSync(SOUND_BUILD, { recursive: true })
mkdirSync(join(RAW, 'sfx'), { recursive: true })
const work = join(tmpdir(), `ltw-audio-${process.pid}`)
mkdirSync(work, { recursive: true })

const results: { id: string; ok: boolean; problems: string[]; entry?: unknown; skipped?: boolean }[] = []
for (const id of ids) {
  let loaded
  try { loaded = loadSoundSpec(id) } catch (e) { results.push({ id, ok: false, problems: [String(e)] }); continue }
  const { spec, problems, hash } = loaded
  if (problems.length) { results.push({ id, ok: false, problems }); continue }
  const prev = manifest.sounds[id]
  if (prev && prev.hash === hash && !flag(args, 'force') && existsSync(join(SOUND_BUILD, `${id}.webm`))) {
    results.push({ id, ok: true, problems: [], skipped: true })
    continue
  }
  const { left, right } = synthesise(spec)
  const wav = join(RAW, 'sfx', `${id}.wav`)
  writeWav(wav, left, spec.stereo ? right : null)
  const target = spec.event.includes('match') || spec.event.includes('tier') ? TARGETS.stinger : TARGETS.sfx
  const d = deliver(wav, join(work, id), target, spec.stereo)
  const errs: string[] = []
  if (!existsSync(d.webm) || !existsSync(d.mp3)) errs.push('ffmpeg failed: ' + d.log.split('\n').filter((l) => /error|Error/.test(l)).slice(-2).join(' | '))
  if (d.measured.seconds > target.maxSeconds) errs.push(`${d.measured.seconds.toFixed(2)} s is over the ${target.maxSeconds} s limit`)
  if (Number.isFinite(d.measured.lufs) && Math.abs(d.measured.lufs - target.lufs) > 1.5) errs.push(`normalised to ${d.measured.lufs.toFixed(1)} LUFS, target ${target.lufs} (the limiter had to pull it down: the sound is too peaky for its loudness)`)
  if (Number.isFinite(d.measured.peak) && d.measured.peak > target.peak + 0.2) errs.push(`true peak ${d.measured.peak.toFixed(1)} dBTP, ceiling ${target.peak}`)
  if (errs.length) { results.push({ id, ok: false, problems: errs }); continue }
  const webm = join(SOUND_BUILD, `${id}.webm`)
  const mp3 = join(SOUND_BUILD, `${id}.mp3`)
  copyFileSync(d.webm, webm)
  copyFileSync(d.mp3, mp3)
  const fileHash = sha256File(webm)
  const entry = {
    event: spec.event,
    variant: spec.variant,
    files: { webm: `build/sfx/${id}.webm`, mp3: `build/sfx/${id}.mp3` },
    bytes: { webm: statSync(webm).size, mp3: statSync(mp3).size },
    seconds: Number(d.measured.seconds.toFixed(3)),
    lufs: Number(d.measured.lufs.toFixed(1)), measure: d.measured.measure,
    peak_dbtp: Number(d.measured.peak.toFixed(1)),
    hash,
    version: prev ? (prev.hash === hash ? prev.version : prev.version + 1) : 1,
    source: { kind: spec.source.kind, licence: spec.source.licence, author: spec.source.author, url: spec.source.url, attribution: spec.source.attribution },
  }
  void fileHash
  manifest.sounds[id] = entry
  results.push({ id, ok: true, problems: [], entry })
}
rmSync(work, { recursive: true, force: true })
if (results.some((r) => r.entry)) saveManifest(manifest)
for (const r of results) {
  if (r.skipped) say(`fresh    ${r.id}`)
  else if (r.ok) { const e = r.entry as { seconds: number; lufs: number; peak_dbtp: number; bytes: { webm: number; mp3: number } }; say(`sound    ${r.id}  ${e.seconds}s · ${e.lufs} LUFS · ${e.peak_dbtp} dBTP · webm ${(e.bytes.webm / 1024).toFixed(1)} KB · mp3 ${(e.bytes.mp3 / 1024).toFixed(1)} KB`) }
  else { say(`REJECT   ${r.id}`); for (const p of r.problems) say(`           ${p}`) }
}
const bad = results.filter((r) => !r.ok)
say(`${results.filter((r) => r.entry).length} rendered, ${results.filter((r) => r.skipped).length} fresh, ${bad.length} rejected  → ${rel(SOUND_BUILD)}/`)
emit('audio-synth', bad.length === 0, bad.length ? `${bad.length} rejected` : `${results.length} sound(s) ok`, { results })
