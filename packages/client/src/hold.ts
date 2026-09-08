/**
 * Press-and-hold repeat for the send palette.
 *
 * A send is one PURCHASE, and for Runner and Tank one purchase is one creep, so
 * filling a lane meant clicking the same card ten times. The obvious fix is to
 * make those cards ship a pack the way Swarm ships six, and it is the wrong one.
 * `count` is priced into `cost` and `incomeBonus`, so a 3-pack Runner costs 135g
 * and a 2-pack Tank 280g. Starting income is 25 and the bot saves across two
 * income periods, which is 50g: at those prices Swarm is the only card anyone
 * can reach in the opening, there is nothing left to counter-pick between, and
 * `pnpm --filter @ltw/harness opening` falls from 12-0 to 0-0 with all twelve
 * matches undecided. Measured, then reverted. It is not a bot artifact either --
 * a human on 25 income waiting out 280g for one click is the same game, slower.
 *
 * So the roster keeps its granularity and the BUTTON gets cheaper to press.
 * Repeating here changes no balance: every repeat is an ordinary command the
 * simulation can refuse, and holding Q already did this, because keydown
 * auto-repeats and the mouse did not.
 *
 * Split out of `main.ts` and handed its timers so the cadence can be tested.
 * The whole thing is timing, and timing is the part that goes wrong quietly:
 * a repeat that starts too early turns every click into two sends.
 */

/** Grace before a press counts as a hold. Long enough that a click sends once. */
export const HOLD_DELAY_MS = 350
/** Cadence once held. Slower than a tick, so `data-broke` is never stale. */
export const HOLD_EVERY_MS = 110

type Listener = (ev: { button?: number; detail?: number }) => void

/** The slice of a button this needs. Narrow so a test can stand one up. */
export interface HoldButton {
  addEventListener(type: string, listener: Listener): void
  hasAttribute(name: string): boolean
}

/** The slice of `window` this needs, for the same reason. */
export interface HoldTimers {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
  setInterval(fn: () => void, ms: number): number
  clearInterval(id: number): void
}

/**
 * Wire `b` so a press sends once and a hold keeps sending.
 *
 * Returns the stop function, so the caller can also cut every button off on a
 * window blur -- a press held while the tab goes away would otherwise still be
 * repeating on return.
 */
export function holdToRepeat(b: HoldButton, send: () => void, timers: HoldTimers): () => void {
  let delay = 0
  let timer = 0

  const stop = (): void => {
    if (delay) timers.clearTimeout(delay)
    if (timer) timers.clearInterval(timer)
    delay = 0
    timer = 0
  }

  const fire = (): boolean => {
    if (b.hasAttribute('data-locked')) return false
    send()
    return true
  }

  b.addEventListener('pointerdown', (ev) => {
    // Left button only: middle and right belong to the camera, which pans.
    if (ev.button !== 0) return
    // The first send goes on pointerdown, not click, so a hold that becomes a
    // repeat still starts on the press rather than a frame after the release.
    stop()
    if (!fire()) return
    delay = timers.setTimeout(() => {
      timer = timers.setInterval(() => {
        // Stop at the wallet rather than spraying sends the simulation would
        // refuse anyway. Gold is repainted every tick and the cadence is slower
        // than a tick, so `data-broke` is current by the time it is read.
        if (b.hasAttribute('data-broke') || !fire()) stop()
      }, HOLD_EVERY_MS)
    }, HOLD_DELAY_MS)
  })

  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    b.addEventListener(type, stop)
  }

  // Tab-then-Enter arrives as a click with no pointer behind it. A mouse click
  // carries detail >= 1 and was already served by the pointer path above, so
  // this is the keyboard-only branch and cannot double-send.
  b.addEventListener('click', (ev) => {
    if (ev.detail === 0) fire()
  })

  return stop
}
