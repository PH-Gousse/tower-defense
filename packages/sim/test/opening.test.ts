import { describe, it, expect } from 'vitest'
import { createState, INCOME_EVERY_TICKS } from '../src/state'
import { step, checkSend, Refusal, Kind, TICK_HZ, type Command } from '../src/step'
import {
  SEND_UNLOCK_TICKS,
  UNLOCK_EVERY_TICKS,
  creepSpec,
  tierUnlockTick,
  liveBalanceData,
  installBalanceData,
} from '../src/data'
import { botCommand, BOT_NORMAL } from '../src/bot'
import { SWARM, RUNNER, build, send, run } from './helpers'

/**
 * The opening build phase.
 *
 * Sending was legal from tick 0, so the first wave could be walking your lane
 * before you had placed a single tower. That is not an opening, it is a
 * scramble, and it punished the player who spent two seconds thinking.
 *
 * These are the tests that should go red when the number moves, which is why
 * every other file in this suite opts out of the rule via `withoutBuildPhase`.
 * A mechanic test that also happened to assert the opening's length would make
 * this a balance knob nobody could turn without a day of triage.
 */
describe('the opening build phase', () => {
  it('refuses every send before it ends', () => {
    const s = createState()
    expect(checkSend(s, 0, SWARM)).toBe(Refusal.BuildPhase)
    expect(checkSend(s, 1, SWARM)).toBe(Refusal.BuildPhase)
  })

  it('blames the build phase, not the tier, while both would refuse', () => {
    // Tier 0 opens at exactly the tick sending does, so during the opening the
    // two rules coincide and either could claim the refusal. The build phase is
    // the one that explains what the player is looking at -- "not unlocked yet"
    // about the cheapest creep in the game, on turn one, teaches nothing.
    expect(tierUnlockTick(creepSpec(SWARM).tier)).toBe(SEND_UNLOCK_TICKS)
    expect(checkSend(createState(), 0, SWARM)).toBe(Refusal.BuildPhase)
  })

  it('opens on exactly the unlock tick, not a tick either side', () => {
    const before = createState()
    before.tick = SEND_UNLOCK_TICKS - 1
    expect(checkSend(before, 0, SWARM)).toBe(Refusal.BuildPhase)

    const on = createState()
    on.tick = SEND_UNLOCK_TICKS
    expect(checkSend(on, 0, SWARM)).toBe(Refusal.None)
  })

  it('drops a send command issued during the phase, rather than applying it', () => {
    // The check is not advisory: `step` has to refuse it too, or a client that
    // skipped the check would desync from one that did not.
    const a = createState()
    const b = createState()
    const goldBefore = a.players[1]!.gold
    const out = step(a, [send(SWARM, 1)], b)
    expect(out.lanes[0]!.creeps.count).toBe(0)
    expect(out.players[1]!.gold).toBe(goldBefore)
    // Income is the real tell: a send that landed would have raised it.
    expect(out.players[1]!.income).toBe(a.players[1]!.income)
  })

  it('lets the same send through once the phase is over', () => {
    const s = run(SEND_UNLOCK_TICKS + 5, { [SEND_UNLOCK_TICKS]: [send(SWARM, 1)] })
    expect(s.players[1]!.income).toBeGreaterThan(createState().players[1]!.income)
  })

  it('never blocks building -- that is the whole point of the phase', () => {
    const s = run(10, { 0: [build(4, 10)], 3: [build(5, 10)] })
    expect(s.lanes[0]!.towers.kind[10 * 8 + 4]).not.toBe(-1)
    expect(s.lanes[0]!.towers.kind[10 * 8 + 5]).not.toBe(-1)
  })

  it('ends before tier 1 unlocks, so the two are separate beats', () => {
    // Deliberate: if sending opened at the same instant tier 1 did, the first
    // unlock on the ladder would be spent rather than felt.
    expect(SEND_UNLOCK_TICKS).toBeLessThan(tierUnlockTick(1))
    const atOpen = createState()
    atOpen.tick = SEND_UNLOCK_TICKS
    expect(checkSend(atOpen, 0, RUNNER)).toBe(Refusal.None)
    // ...and tier 1 is still genuinely locked at that moment.
    const tier1 = creepSpec(3)
    expect(tier1.tier).toBe(1)
    expect(checkSend(atOpen, 0, 3)).toBe(Refusal.TierLocked)
  })

  it('is a round number of seconds, so the countdown can be honest', () => {
    expect(SEND_UNLOCK_TICKS % TICK_HZ).toBe(0)
    expect(SEND_UNLOCK_TICKS / TICK_HZ).toBe(20)
  })

  it('refuses a length that would silently stop the economy', () => {
    // A fractional value is never congruent to zero under the income modulo, so
    // nobody would ever be paid again -- and that reads as catastrophic balance
    // rather than as a typo. Asserted at load, like every other invariant here.
    const base = liveBalanceData()
    try {
      expect(() => installBalanceData({ ...base, sendUnlockTicks: 400.5 })).toThrow(
        /non-negative integer/,
      )
      expect(() => installBalanceData({ ...base, sendUnlockTicks: -1 })).toThrow(
        /non-negative integer/,
      )
    } finally {
      installBalanceData(base)
    }
  })
})

/**
 * Everything on a clock hangs off the end of the build phase, not off tick 0.
 *
 * This is the rule the whole opening turned on, and it was not obvious. A
 * 20-second phase anchored at tick 0 swallowed the first income payout and
 * two-thirds of the wait for tier 1, and the measured effect was severe: the
 * bot's counter-picking advantage over the fixed template inverted from 12-0 to
 * 4-8. Anchoring income alone recovered it to 8-4; anchoring the tier ladder as
 * well restored 12-0 at every phase length tried, from 0 to 45 seconds.
 * Reproduce with `pnpm --filter @ltw/harness opening`.
 */
describe('the match clock starts when the contest does', () => {
  it('pays no income during the build phase', () => {
    const s = run(SEND_UNLOCK_TICKS)
    expect(s.players[0]!.gold).toBe(createState().players[0]!.gold)
  })

  it('pays the first income one full period after sending opens', () => {
    const justBefore = run(SEND_UNLOCK_TICKS + INCOME_EVERY_TICKS - 1)
    const on = run(SEND_UNLOCK_TICKS + INCOME_EVERY_TICKS)
    expect(justBefore.players[0]!.gold).toBe(createState().players[0]!.gold)
    expect(on.players[0]!.gold).toBeGreaterThan(justBefore.players[0]!.gold)
  })

  it('opens the whole tier ladder relative to sending, not to tick 0', () => {
    // The concrete claim: a 20s opening must not eat 20s of the wait for tier 1.
    expect(tierUnlockTick(0)).toBe(SEND_UNLOCK_TICKS)
    expect(tierUnlockTick(1)).toBe(SEND_UNLOCK_TICKS + UNLOCK_EVERY_TICKS)
    expect(tierUnlockTick(2)).toBe(SEND_UNLOCK_TICKS + UNLOCK_EVERY_TICKS * 2)
  })

  it('has nobody richer than they started when sending opens', () => {
    // The ordering whose loss caused the inversion: the first send has to come
    // before the first payout, so the attacker can compound it.
    const atOpen = run(SEND_UNLOCK_TICKS)
    expect(atOpen.players[0]!.gold).toBe(createState().players[0]!.gold)
    expect(atOpen.players[1]!.gold).toBe(createState().players[1]!.gold)
  })
})

/**
 * The bot plays by the same rule, and -- more importantly -- does something
 * useful with the time rather than idling.
 */
describe('the bot during the opening', () => {
  it('never emits a send that would be refused', () => {
    const cmds = botRun(SEND_UNLOCK_TICKS)
    const sends = cmds.filter((c) => c.kind === Kind.Send)
    expect(sends).toEqual([])
  })

  it('spends the opening building instead of banking', () => {
    // The failure this guards: `affordableSoon` would name a target the bot
    // cannot buy, the banking branch would refuse to let anything below it
    // spend, and the bot would sit on 600 gold for the whole phase.
    const cmds = botRun(SEND_UNLOCK_TICKS)
    const builds = cmds.filter((c) => c.kind === Kind.Build)
    expect(builds.length).toBeGreaterThan(4)
  })
})

/** Collect the bot's commands over the first `ticks` ticks of a real match. */
function botRun(ticks: number): Command[] {
  let a = createState()
  let b = createState()
  const out: Command[] = []
  for (let t = 0; t < ticks; t++) {
    const cmd = botCommand(a, 1, BOT_NORMAL)
    const cmds = cmd ? [cmd] : []
    if (cmd) out.push(cmd)
    const next = step(a, cmds, b)
    b = a
    a = next
  }
  return out
}
