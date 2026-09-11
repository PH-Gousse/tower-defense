import { existsSync, mkdirSync, rmSync, statSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs, str, say, emit, fail, requireTools } from './lib/cli'
import { deliver, TARGETS, SOUND_BUILD, sha256File } from './lib/audio'
import { loadManifest, saveManifest } from './lib/manifest'
import { RAW, rel } from './lib/paths'

/**
 * audio-import <file> --as <sfx_id> --event <event> --kind <pack|hand|ai|freelance> --licence <cc0|cc-by|own|other> [--author ..] [--url ..] [--attribution ..] [--approved-by ..] [--variant n] [--stereo]
 *
 * An external sound into the same pipeline as a synthesised one: copied
 * to assets/raw/sfx/ as delivered, then trimmed, normalised, encoded and
 * recorded. Refuses without a source kind and licence; refuses ai,
 * freelance and other-licence sources without --approved-by.
 */

const argv = process.argv.slice(2)
const args = parseArgs(argv)
requireTools([{ bin: 'ffmpeg', install: 'brew install ffmpeg' }])
const file = argv.find((a) => !a.startsWith('--') && existsSync(a))
const id = str(args, 'as', '')
const event = str(args, 'event', '')
const kind = str(args, 'kind', '')
const licence = str(args, 'licence', '')
if (!file || !id || !event || !kind || !licence) fail('audio-import <file> --as <sfx_id> --event <event> --kind <pack|hand|ai|freelance> --licence <cc0|cc-by|own|other>')
if (!/^sfx_[a-z0-9_]+_[0-9]+$/.test(id)) fail(`"${id}" is not a sound id (sfx_<event>_<variant>)`)
if (!['pack', 'hand', 'ai', 'freelance'].includes(kind)) fail('--kind pack|hand|ai|freelance')
if (!['cc0', 'cc-by', 'own', 'other'].includes(licence)) fail('--licence cc0|cc-by|own|other')
const approved = str(args, 'approved-by', '')
if ((kind === 'ai' || kind === 'freelance' || licence === 'other') && !approved) fail(`a ${kind} / ${licence} sound needs --approved-by before it ships`)
const attribution = str(args, 'attribution', '')
if (licence === 'cc-by' && !attribution) fail('cc-by needs --attribution "<the line for LICENSES.md>"')

const stereo = args['stereo'] === true
mkdirSync(join(RAW, 'sfx'), { recursive: true })
mkdirSync(SOUND_BUILD, { recursive: true })
const rawCopy = join(RAW, 'sfx', `${id}.source${file.slice(file.lastIndexOf('.'))}`)
copyFileSync(file, rawCopy)
const work = join(tmpdir(), `ltw-audio-${process.pid}`)
mkdirSync(work, { recursive: true })
const target = event.includes('match') || event.includes('tier') ? TARGETS.stinger : TARGETS.sfx
const d = deliver(rawCopy, join(work, id), target, stereo)
const errs: string[] = []
if (!existsSync(d.webm) || !existsSync(d.mp3)) errs.push('ffmpeg failed: ' + d.log.split('\n').filter((l) => /error|Error|Invalid/.test(l)).slice(-2).join(' | '))
if (d.measured.seconds > target.maxSeconds) errs.push(`${d.measured.seconds.toFixed(2)} s is over the ${target.maxSeconds} s limit; trim it first`)
if (Number.isFinite(d.measured.lufs) && Math.abs(d.measured.lufs - target.lufs) > 1.5) errs.push(`normalised to ${d.measured.lufs.toFixed(1)} LUFS, target ${target.lufs}`)
if (errs.length) {
  rmSync(work, { recursive: true, force: true })
  for (const e of errs) say(`REJECT   ${id}  ${e}`)
  emit('audio-import', false, errs.join('; '), { id, problems: errs })
}
const webm = join(SOUND_BUILD, `${id}.webm`)
const mp3 = join(SOUND_BUILD, `${id}.mp3`)
copyFileSync(d.webm, webm)
copyFileSync(d.mp3, mp3)
rmSync(work, { recursive: true, force: true })
const manifest = loadManifest()
const prev = manifest.sounds[id]
const hash = sha256File(rawCopy)
manifest.sounds[id] = {
  event, variant: Number(str(args, 'variant', '1')),
  files: { webm: `build/sfx/${id}.webm`, mp3: `build/sfx/${id}.mp3` },
  bytes: { webm: statSync(webm).size, mp3: statSync(mp3).size },
  seconds: Number(d.measured.seconds.toFixed(3)), lufs: Number(d.measured.lufs.toFixed(1)), measure: d.measured.measure, peak_dbtp: Number(d.measured.peak.toFixed(1)),
  hash, version: prev ? (prev.hash === hash ? prev.version : prev.version + 1) : 1,
  source: { kind, licence, author: str(args, 'author', ''), url: str(args, 'url', ''), attribution },
}
saveManifest(manifest)
say(`sound    ${id}  ${d.measured.seconds.toFixed(2)}s · ${d.measured.lufs.toFixed(1)} LUFS · ${d.measured.peak.toFixed(1)} dBTP  → ${rel(webm)}`)
emit('audio-import', true, `${id} imported`, { id, entry: manifest.sounds[id] })
