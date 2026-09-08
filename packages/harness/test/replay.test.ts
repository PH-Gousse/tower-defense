import { describe, it, expect } from 'vitest'
import {
  createState, step, hashState, buildDump, parseDump, HashRing, MatchResult,
  botCommand, BOT_NORMAL, Kind,
  type Command, type GameState, type HashEntry,
} from '@ltw/sim'
import { replayDump, replayFile } from '../src/replay'

/**
 * The end-to-end claim step 9 rests on: a dump taken from a running match
 * reproduces that match exactly, somewhere else, later.
 *
 * If this is wrong then everything else in the determinism apparatus is
 * theatre — hashing every tick and freezing on a mismatch is only useful if the
 * file it hands you can be replayed.
 */

/** Play a bot-vs-bot match the way the client does, logging as the driver logs. */
function playAndDump(ticks: number, perturbAt = -1) {
  let a: GameState = createState()
  let b: GameState = createState()
  const log: Command[] = []
  const ring = new HashRing()
  for (let t = 0; t < ticks; t++) {
    const cmds: Command[] = []
    for (const p of [0, 1] as const) {
      const c = botCommand(a, p, BOT_NORMAL)
      if (c) cmds.push(c)
    }
    // The driver rewrites `tick` to the tick a command is applied on, because
    // `step()` ignores the field and the producers disagree about it.
    for (const c of cmds) log.push({ ...c, tick: a.tick })
    const out = step(a, cmds, b)
    b = a
    a = out
    if (t === perturbAt) (a as { nextCreepId: number }).nextCreepId += 1
    ring.record(a)
  }
  return {
    state: a,
    dump: buildDump({
      build: 'test',
      trigger: 'manual',
      me: 0,
      ticks: a.tick,
      commands: log,
      localHashes: ring.entries(),
    }),
  }
}

describe('replaying a dump', () => {
  it('reproduces the match it was taken from, tick for tick', () => {
    const { state, dump } = playAndDump(900)
    const r = replayDump(dump)
    expect(r.ticks).toBe(state.tick)
    expect(r.vsLocal.reason).toBe('agree')
    expect(r.vsLocal.compared).toBeGreaterThan(0)
    // And the final state, not only the sampled window.
    expect(r.hashes[r.hashes.length - 1]!.hash).toBe(hashState(state) >>> 0)
  })

  it('names which client was wrong', () => {
    // The question a desync actually poses. Build a dump whose local ring came
    // from a perturbed run and whose peer ring came from a clean one: replaying
    // the clean log here must side with the peer.
    const clean = playAndDump(900)
    const broken = playAndDump(900, 400)
    const dump = buildDump({
      build: 'test',
      trigger: 'desync',
      me: 0,
      ticks: broken.dump.ticks,
      commands: clean.dump.commands,
      localHashes: broken.dump.localHashes,
      peerHashes: clean.dump.localHashes,
      divergedAtTick: 401,
    })
    const r = replayDump(dump)
    expect(r.vsLocal.reason).toBe('diverged')
    expect(r.vsPeer!.reason).toBe('agree')
  })

  it('replays against the dump’s own balance data, not the checkout’s', () => {
    // A dump that only names a data version cannot be replayed after the next
    // tuning pass, which is exactly how the golden fixture spent six steps
    // claiming to pin data it was not pinning.
    const { dump } = playAndDump(600)
    const weakened = {
      ...dump,
      balance: {
        ...dump.balance,
        creeps: dump.balance.creeps.map((c) => ({ ...c, hp: c.hp * 2 })),
      },
    }
    const r = replayDump(weakened)
    // Different numbers, so a different match: the point is it ran at all and
    // disagreed, rather than silently using today's creeps.json.
    expect(r.vsLocal.reason).toBe('diverged')
    // And the live data is restored afterwards, or every later test is retuned.
    expect(replayDump(dump).vsLocal.reason).toBe('agree')
  })

  it('round-trips through JSON, which is how it actually travels', () => {
    const { dump } = playAndDump(400)
    const { result } = replayFile(JSON.stringify(dump))
    expect(result.vsLocal.reason).toBe('agree')
  })

  it('refuses a file that is not a dump, before wasting a replay on it', () => {
    expect(() => parseDump('{"hello":1}')).toThrow(/dumpVersion/)
    expect(() => parseDump(JSON.stringify({ dumpVersion: 999 }))).toThrow(/newer than this build/)
    expect(() => parseDump(JSON.stringify({ dumpVersion: 1 }))).toThrow(/command log/)
  })

  it('carries enough to finish a decided match', () => {
    const { state, dump } = playAndDump(40000)
    expect(state.result).not.toBe(MatchResult.Playing)
    const r = replayDump(dump)
    expect(r.result).toBe(state.result)
    expect(r.vsLocal.reason).toBe('agree')
    // A sanity floor on the log: a whole match is not three commands.
    expect(dump.commands.filter((c) => c.kind === Kind.Send).length).toBeGreaterThan(10)
  })
})
