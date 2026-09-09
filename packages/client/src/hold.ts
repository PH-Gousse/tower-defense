/**
 * Press-and-hold repeat for the send palette.
 *
 * A send is one creep and one command, the way clicking a shrine in the map
 * this game descends from queues one unit. Filling a lane is therefore a lot of
 * clicks, and spamming is the intended way to mass-send rather than a symptom
 * of a missing feature -- it is why an experienced player's sends arrive as a
 * stream and not a blob. This makes the BUTTON cheaper to press. It does not
 * make a send bigger, and it changes no balance: every repeat is an ordinary
 * command the simulation can refuse.
 *
 * It exists because holding a key already did this -- keydown auto-repeats --
 * and the mouse did not, so the two inputs disagreed about what holding meant.
 * They now agree, and both go through `sendN` in `send.ts`, which owns the
 * rules about whether a send may happen at all. This file owns only WHEN.
 *
 * Split out of `main.ts` and handed its timers so the cadence can be tested.
 * The whole thing is timing, and timing is the part that goes wrong quietly:
 * a repeat that starts too early turns every click into two sends.
 */

/** Grace before a press counts as a hold. Long enough that a click sends once. */
export const HOLD_DELAY_MS = 350
/** Cadence once held. Slower than a tick, so the wallet check is never stale. */
export const HOLD_EVERY_MS = 110

type Listener = (ev: { button?: number; detail?: number }) => void

/** The slice of a button this needs. Narrow so a test can stand one up. */
export interface HoldButton {
  addEventListener(type: string, listener: Listener): void
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
 * `send` reports whether a send actually happened. That boolean is the only
 * thing this file knows about locks and wallets: it does not read the button's
 * attributes, because deciding whether a send is allowed is `send.ts`'s job and
 * a second copy of that decision here is exactly what went wrong before.
 *
 * Returns the stop function, so the caller can also cut every button off on a
 * window blur -- a press held while the tab goes away would otherwise still be
 * repeating on return.
 */
export function holdToRepeat(b: HoldButton, send: () => boolean, timers: HoldTimers): () => void {
  let delay = 0
  let timer = 0

  const stop = (): void => {
    if (delay) timers.clearTimeout(delay)
    if (timer) timers.clearInterval(timer)
    delay = 0
    timer = 0
  }

  b.addEventListener('pointerdown', (ev) => {
    // Left button only: middle and right belong to the camera, which pans.
    if (ev.button !== 0) return
    // The first send goes on pointerdown, not click, so a hold that becomes a
    // repeat still starts on the press rather than a frame after the release.
    stop()
    if (!send()) return
    delay = timers.setTimeout(() => {
      timer = timers.setInterval(() => {
        // A refused send ends the hold: the wallet emptied, or the card locked
        // mid-press. Carrying on would spray commands the simulation drops.
        if (!send()) stop()
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
    if (ev.detail === 0) send()
  })

  return stop
}
