import { readFileSync } from 'node:fs'
import { createState, step, hashHex, MatchResult, type Command, type GameState } from '@ltw/sim'
import { installBalanceData } from '@ltw/sim'
import { parseArgs, str, num, say, emit, fail, resolvePath } from './lib/cli'
import { REPO_ROOT } from './lib/scan'
import { toCommand, type ReplayFile } from './lib/replay'

/**
 * `state-hash` — the stable hash of a sim state, on the command line.
 *
 * The hash function itself lives in `packages/sim/src/hash.ts` and is NOT
 * reimplemented here. That is the whole point: the same `hashState` is used by
 * the server's desync check, by the golden fixture, by determinism-check and by
 * replay-verify, so a hash produced by any one of them is comparable with a
 * hash produced by any other. A second implementation would be a second source
 * of truth for the one thing that proves two machines agree.
 *
 * It does not depend on object key insertion order: every field is walked in
 * DECLARED order, floats go through a DataView as explicit little-endian
 * Float64, -0 is normalised to 0, and a NaN throws rather than hashing.
 *
 * Usage:
 *   state-hash --replay fixtures/replays/short.json   hash a replay's end state
 *   state-hash --ticks 600                            hash an empty match at tick 600
 *
 * With `--every N` it prints the hash every N ticks, which is what you want
 * when bisecting a divergence by hand.
 */

const args = parseArgs(process.argv.slice(2))
const replayPath = str(args, 'replay', '')
const every = num(args, 'every', 0)

function readReplay(path: string): ReplayFile {
  let text: string
  try {
    text = readFileSync(resolvePath(path, REPO_ROOT), 'utf8')
  } catch {
    fail(`cannot read ${path}`)
  }
  const file = JSON.parse(text) as Partial<ReplayFile>
  if (typeof file.ticks !== 'number') fail(`${path}: no "ticks"`)
  if (!Array.isArray(file.commands)) fail(`${path}: no "commands"`)
  if (!file.data) fail(`${path}: no "data" — a replay without frozen balance data cannot be verified`)
  return file as ReplayFile
}

interface Sample {
  readonly tick: number
  readonly hash: string
}

function run(ticks: number, commands: readonly Command[]): { final: string; samples: Sample[]; result: MatchResult } {
  const byTick = new Map<number, Command[]>()
  for (const c of commands) {
    const list = byTick.get(c.tick) ?? []
    list.push(c)
    byTick.set(c.tick, list)
  }

  let a: GameState = createState()
  let b: GameState = createState()
  const samples: Sample[] = []

  for (let t = 0; t < ticks; t++) {
    const out = step(a, byTick.get(t) ?? [], b)
    b = a
    a = out
    if (every > 0 && a.tick % every === 0) samples.push({ tick: a.tick, hash: hashHex(a) })
  }
  return { final: hashHex(a), samples, result: a.result }
}

if (replayPath) {
  const file = readReplay(replayPath)
  const commands = file.commands.map(toCommand)
  const previous = installBalanceData(file.data)
  let out: ReturnType<typeof run>
  try {
    out = run(file.ticks, commands)
  } finally {
    installBalanceData(previous)
  }

  say(`state-hash — ${replayPath}`)
  say(`  ${file.ticks} ticks, ${commands.length} commands, replay's own balance data`)
  for (const s of out.samples) say(`  tick ${String(s.tick).padStart(7)}  ${s.hash}`)
  say(`  final hash: ${out.final}`)
  if (file.expectedHash) {
    say(out.final === file.expectedHash ? '  matches the stored hash' : `  MISMATCH — stored ${file.expectedHash}`)
  }
  say()

  emit('state-hash', file.expectedHash ? out.final === file.expectedHash : true, `hash ${out.final}`, {
    path: replayPath,
    ticks: out.samples.length ? out.samples[out.samples.length - 1]!.tick : file.ticks,
    hash: out.final,
    expectedHash: file.expectedHash ?? null,
    samples: out.samples,
  })
}

const ticks = num(args, 'ticks', 0)
if (ticks <= 0) {
  fail('give either --replay <file.json> or --ticks <n>')
}

const out = run(ticks, [])
say(`state-hash — empty match, live balance data`)
say(`  ${ticks} ticks, no commands`)
for (const s of out.samples) say(`  tick ${String(s.tick).padStart(7)}  ${s.hash}`)
say(`  final hash: ${out.final}`)
say()

emit('state-hash', true, `hash ${out.final}`, {
  path: null,
  ticks,
  hash: out.final,
  expectedHash: null,
  samples: out.samples,
})
