import { TICK_HZ, INCOME_EVERY_TICKS, SEND_UNLOCK_TICKS, tierUnlockTick, MAX_TIER } from '@ltw/sim'

/**
 * Every clock the HUD shows, as pure functions of the tick.
 *
 * These live in their own module rather than inside `main.ts` for one reason:
 * `main.ts` calls `createScene` at module scope, which builds a WebGLRenderer,
 * so the test suite cannot import it at all -- `palette.test.ts` and
 * `overlay.test.ts` fall back to asserting on the file's SOURCE TEXT, which as
 * their own comments admit catches deletion and nothing else. `send.ts` and
 * `hold.ts` set the pattern: logic that can be wrong moves out where a test can
 * reach it. Countdown arithmetic can be wrong by one tick, and one tick of drift
 * is a clock that reads 0 while the gold has not arrived.
 *
 * Everything here derives from `Stats.tick`, which the snapshot already carries.
 * No sim change, no new state.
 *
 *   tick 0 ............. 400 .................. 700 ......... 1000
 *        |               |                      |             |
 *        build phase     sending opens          1st income    2nd income
 *        (no sends)      SEND_UNLOCK_TICKS      +300          +300
 *                        tier 0 buyable
 */

/** Whole seconds until `target`, rounded up. Negative once `target` has passed. */
export function secondsUntil(target: number, now: number): number {
  return Math.ceil((target - now) / TICK_HZ)
}

/**
 * Ticks as `MM:SS`, minutes zero-padded to two digits.
 *
 * Fixed width is load-bearing, not cosmetic. The HUD lives in a vertical rail
 * whose WIDTH the camera reserves as a safe area (`CameraRig.setSafeArea` ->
 * `safeH`), so text that gains a character as it counts widens the rail and
 * re-frames the board -- once a second, for the whole match. `tabular-nums` in
 * the stylesheet equalises digit widths but does nothing about a digit COUNT
 * that changes, which is why the padding is here and not left to CSS.
 *
 * Past 99:59 the string does grow by one character, once. Mirror bot-vs-bot
 * matches decide in 4 to 17 minutes, so that is unreachable in practice and not
 * worth lying about with a clamp.
 */
export function mmss(ticks: number): string {
  const total = Math.max(0, Math.floor(ticks / TICK_HZ))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Ticks until the next income payout.
 *
 * Mirrors `step.ts`, which pays when `sinceOpen > 0 && sinceOpen %
 * INCOME_EVERY_TICKS === 0` -- note the `> 0`, so the tick sending opens on is
 * NOT a payday and the first lump lands a full period after it.
 *
 * The obvious one-liner for this is
 * `INCOME_EVERY_TICKS - (sinceOpen % INCOME_EVERY_TICKS)`, leaning on JS keeping
 * the sign of a negative dividend. It is wrong, and wrong in the least visible
 * way: during the build phase `sinceOpen` runs from -SEND_UNLOCK_TICKS to -1,
 * and once that is more negative than one whole period the modulo wraps. At
 * tick 0, `-400 % 300` is -100, so the one-liner answers 400 ticks when the
 * true wait is 700. It is only wrong for the first five seconds of a match --
 * the five seconds every player watches while placing their opening towers.
 *
 * So the build phase is answered directly instead of by arithmetic that has to
 * be reasoned about, which is also why this is a named function and not an
 * expression inlined at the call site.
 */
export function ticksUntilIncome(tick: number): number {
  const first = SEND_UNLOCK_TICKS + INCOME_EVERY_TICKS
  if (tick < first) return first - tick
  return INCOME_EVERY_TICKS - ((tick - SEND_UNLOCK_TICKS) % INCOME_EVERY_TICKS)
}

/** Highest tier buyable at this tick. */
export function unlockedTier(tick: number): number {
  let tier = 0
  while (tier + 1 <= MAX_TIER && tick >= tierUnlockTick(tier + 1)) tier += 1
  return tier
}

/**
 * Ticks until the next tier opens, or `null` once the ladder is exhausted.
 *
 * Null rather than Infinity or -1: the caller has to render something different
 * for "there is no next tier", and a sentinel number invites arithmetic on a
 * value that has no meaning.
 */
export function ticksUntilNextTier(tick: number): number | null {
  const tier = unlockedTier(tick)
  if (tier >= MAX_TIER) return null
  return tierUnlockTick(tier + 1) - tick
}
