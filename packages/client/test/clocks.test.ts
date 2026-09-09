import { describe, it, expect } from 'vitest'
import {
  TICK_HZ, INCOME_EVERY_TICKS, SEND_UNLOCK_TICKS, tierUnlockTick, MAX_TIER,
} from '@ltw/sim'
import {
  secondsUntil, mmss, ticksUntilIncome, unlockedTier, ticksUntilNextTier,
} from '../src/clocks'

/**
 * The HUD's clocks, as arithmetic.
 *
 * Expressed in the sim's own constants rather than in literals, so tuning the
 * income cadence or the build phase moves these tests with the game instead of
 * turning them red. The few literals that remain are the ones whose VALUE is
 * the thing being asserted -- "00:00" is a format, not a tuning number.
 *
 * `ticksUntilIncome` gets the most attention because it is the one with a wrong
 * answer that looks right: see its doc comment for the negative-modulo version
 * that is off by a whole period during the opening.
 */

const FIRST_PAYOUT = SEND_UNLOCK_TICKS + INCOME_EVERY_TICKS

describe('secondsUntil', () => {
  it('rounds up, so a clock never shows 0 while time remains', () => {
    // One tick left is still a second on screen. Truncating here is what makes
    // a countdown sit on 0 for the last fraction of every second.
    expect(secondsUntil(1, 0)).toBe(1)
    expect(secondsUntil(TICK_HZ, 0)).toBe(1)
    expect(secondsUntil(TICK_HZ + 1, 0)).toBe(2)
  })

  it('is zero exactly at the target', () => {
    expect(secondsUntil(400, 400)).toBe(0)
  })

  it('goes negative past the target rather than clamping', () => {
    // The caller decides what a passed deadline renders as. Clamping here would
    // hide the difference between "just now" and "four minutes ago".
    expect(secondsUntil(0, TICK_HZ * 3)).toBe(-3)
  })
})

describe('mmss', () => {
  it('pads minutes to two digits so the string width never changes', () => {
    // Load-bearing: the rail's WIDTH is the camera's safe area, so a string
    // that gains a character re-frames the board. See the doc comment.
    expect(mmss(0)).toBe('00:00')
    expect(mmss(9 * TICK_HZ)).toBe('00:09')
    expect(mmss(59 * TICK_HZ)).toBe('00:59')
    expect(mmss(60 * TICK_HZ)).toBe('01:00')
    expect(mmss(9 * 60 * TICK_HZ)).toBe('09:00')
    expect(mmss(10 * 60 * TICK_HZ)).toBe('10:00')
  })

  it('holds a constant width across the whole range a match can reach', () => {
    // Mirror bot-vs-bot decides in 4 to 17 minutes; walk well past that.
    const widths = new Set<number>()
    for (let t = 0; t <= 40 * 60 * TICK_HZ; t += TICK_HZ) widths.add(mmss(t).length)
    expect([...widths]).toEqual([5])
  })

  it('floors within the second rather than rounding', () => {
    // A match clock counts UP, so it must not reach 00:01 before a second has
    // actually elapsed.
    expect(mmss(TICK_HZ - 1)).toBe('00:00')
    expect(mmss(TICK_HZ)).toBe('00:01')
  })

  it('clamps negative input to zero instead of rendering a negative time', () => {
    expect(mmss(-1)).toBe('00:00')
  })
})

describe('ticksUntilIncome', () => {
  it('counts the whole wait from tick 0, not just the first period', () => {
    // THE REGRESSION THIS MODULE EXISTS FOR. The one-line version using
    // `INCOME_EVERY_TICKS - (sinceOpen % INCOME_EVERY_TICKS)` answers 400 here
    // because JS gives -400 % 300 === -100. The first payout is at tick 700.
    expect(ticksUntilIncome(0)).toBe(FIRST_PAYOUT)
  })

  it('is right at every tick of the build phase', () => {
    // The naive version is only wrong while sinceOpen is more negative than one
    // period -- the first 100 ticks -- so a spot check at tick 399 would pass
    // and ship the bug. Walk the whole phase.
    for (let t = 0; t < SEND_UNLOCK_TICKS; t++) {
      expect(ticksUntilIncome(t)).toBe(FIRST_PAYOUT - t)
    }
  })

  it('gives a full period at the tick sending opens', () => {
    // step.ts pays on `sinceOpen > 0`, so the unlock tick itself is not a
    // payday. Off by one here and the HUD promises gold a period early.
    expect(ticksUntilIncome(SEND_UNLOCK_TICKS)).toBe(INCOME_EVERY_TICKS)
  })

  it('reaches 1 the tick before a payout and resets to a full period on it', () => {
    expect(ticksUntilIncome(FIRST_PAYOUT - 1)).toBe(1)
    expect(ticksUntilIncome(FIRST_PAYOUT)).toBe(INCOME_EVERY_TICKS)
  })

  it('never returns 0, so the HUD cannot show a payout that has not happened', () => {
    for (let t = 0; t < FIRST_PAYOUT + INCOME_EVERY_TICKS * 4; t++) {
      const left = ticksUntilIncome(t)
      expect(left).toBeGreaterThan(0)
      expect(left).toBeLessThanOrEqual(FIRST_PAYOUT)
    }
  })

  it('agrees with the sim: it hits a full period exactly on every payday', () => {
    // The sim's own predicate, restated. If either side is edited the two stop
    // agreeing and this fails, which is the point.
    for (let t = 0; t < 20_000; t++) {
      const sinceOpen = t - SEND_UNLOCK_TICKS
      const isPayday = sinceOpen > 0 && sinceOpen % INCOME_EVERY_TICKS === 0
      if (isPayday) expect(ticksUntilIncome(t)).toBe(INCOME_EVERY_TICKS)
    }
  })
})

describe('unlockedTier', () => {
  it('opens tier 0 when sending does, not at tick 0', () => {
    expect(unlockedTier(0)).toBe(0)
    expect(unlockedTier(SEND_UNLOCK_TICKS)).toBe(0)
  })

  it('advances one tier at each unlock tick', () => {
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      expect(unlockedTier(tierUnlockTick(tier) - 1)).toBe(tier - 1)
      expect(unlockedTier(tierUnlockTick(tier))).toBe(tier)
    }
  })

  it('stops at MAX_TIER rather than running off the roster', () => {
    expect(unlockedTier(tierUnlockTick(MAX_TIER) * 10)).toBe(MAX_TIER)
  })
})

describe('ticksUntilNextTier', () => {
  it('counts down to the next unlock', () => {
    expect(ticksUntilNextTier(0)).toBe(tierUnlockTick(1))
    expect(ticksUntilNextTier(tierUnlockTick(1) - 1)).toBe(1)
  })

  it('rolls to the following tier the moment one lands', () => {
    const at = tierUnlockTick(1)
    expect(ticksUntilNextTier(at)).toBe(tierUnlockTick(2) - at)
  })

  it('is null once the ladder is exhausted, not a sentinel number', () => {
    // A caller that renders "--" needs to distinguish this from a countdown.
    expect(ticksUntilNextTier(tierUnlockTick(MAX_TIER))).toBeNull()
    expect(ticksUntilNextTier(tierUnlockTick(MAX_TIER) + 99_999)).toBeNull()
  })
})
