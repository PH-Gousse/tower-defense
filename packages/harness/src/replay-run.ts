import { readFileSync } from 'node:fs'
import { MatchResult } from '@ltw/sim'
import { replayFile } from './replay'

/**
 * `pnpm --filter @ltw/harness replay <dump.json>`
 *
 * Reads a dump produced by the client and re-runs it here. The verdict line at
 * the bottom is the point: it names which peer this machine agrees with.
 */
const path = process.argv[2]
if (!path) {
  console.error('usage: replay <dump.json>')
  process.exit(1)
}

const { dump, result } = replayFile(readFileSync(path, 'utf8'))

console.log(`\n${path}`)
console.log(`  captured   ${dump.capturedAt}  (${dump.trigger})`)
console.log(`  build      ${dump.build}`)
console.log(`  data       towers v${dump.towerDataVersion}, creeps v${dump.creepDataVersion}`)
console.log(`  match      ${dump.ticks} ticks, ${dump.commands.length} commands, seat ${dump.me}`)
if (dump.divergedAtTick >= 0) console.log(`  diverged   tick ${dump.divergedAtTick}`)

console.log(`\nreplayed ${result.ticks} ticks — ${MatchResult[result.result]}`)

const describe = (name: string, d: ReturnType<typeof replayFile>['result']['vsLocal'] | null) => {
  if (!d) {
    console.log(`  vs ${name.padEnd(6)} no hashes in the dump`)
    return
  }
  if (d.reason === 'agree') {
    console.log(`  vs ${name.padEnd(6)} AGREES on all ${d.compared} shared ticks`)
  } else if (d.reason === 'no-overlap') {
    console.log(`  vs ${name.padEnd(6)} no shared ticks to compare`)
  } else {
    console.log(
      `  vs ${name.padEnd(6)} DIVERGES at tick ${d.tick} ` +
        `(replay ${d.mine.toString(16)}, dump ${d.theirs.toString(16)}) after ${d.compared} agreeing ticks`,
    )
  }
}
describe('local', result.vsLocal)
describe('peer', result.vsPeer)

// The verdict. A replay that matches one side and not the other has found the
// broken client, which is the whole reason the dump carries both rings.
const local = result.vsLocal.reason
const peer = result.vsPeer?.reason
if (local === 'no-overlap') {
  // An empty or very short capture. Saying "matches neither side" here would be
  // an accusation where there is simply nothing to compare.
  console.log(`\nNothing to compare: the dump shares no ticks with this replay. A capture taken`)
  console.log(`before the match started has nothing in its ring yet.`)
} else if (local === 'agree' && peer === 'diverged') {
  console.log(`\nThe PEER was wrong: this machine reproduces the local client exactly.`)
} else if (local === 'diverged' && peer === 'agree') {
  console.log(`\nThe LOCAL client was wrong: this machine reproduces the peer exactly.`)
} else if (local === 'agree' && (peer === 'agree' || peer === undefined)) {
  console.log(`\nNo divergence reproduced here. Suspect the environment: a different engine, a`)
  console.log(`different build, or balance data that did not travel with the dump.`)
} else {
  console.log(`\nThis machine matches neither side. Check the build and data versions above first.`)
}
console.log()
