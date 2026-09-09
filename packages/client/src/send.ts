/**
 * One place that decides whether a send happens.
 *
 * A send is ONE creep and ONE command. Clicking a card, pressing its key,
 * holding it down and (later) the ×N buttons differ only in how many commands
 * they ask for, so the two rules that refuse a send -- the card is locked, the
 * wallet is empty -- live here once.
 *
 * They did not. `main.ts` held the keyboard copy and `hold.ts` held the mouse
 * copy, and the keyboard copy never got the wallet check, so a held key spent
 * everything at the operating system's auto-repeat rate. Two copies of one rule
 * is how one of them ends up wrong, and the one that is wrong is always the one
 * nobody wrote a test for.
 *
 *     click ──┐
 *     key   ──┤
 *     hold  ──┼──▶ sendN(slot, count) ──▶ locked? ──▶ broke? ──▶ scene.send() × count
 *     ×5    ──┤
 *     ×10   ──┘
 *
 * The count is a convenience, never a discount: ten is ten separate commands in
 * the log, each one refused on its own merits by the simulation.
 */

/** The slice of a send card this needs. Narrow so a test can stand one up. */
export interface SendCard {
  readonly dataset: { readonly [name: string]: string | undefined }
  hasAttribute(name: string): boolean
}

/** Ask for `count` sends from palette slot `slot`. Returns how many went. */
export type Sender = (slot: number, count: number) => number

/**
 * Wire a palette to a send function.
 *
 * `cards` is read at call time, not captured by value, because `main.ts` builds
 * the buttons and then re-points them at different creeps as the tier ladder
 * advances -- the slot is stable, the creep behind it is not.
 */
export function createSender(
  cards: readonly SendCard[],
  send: (creep: number) => void,
): Sender {
  return (slot, count) => {
    const b = cards[slot]
    if (!b || b.hasAttribute('data-locked')) return 0

    const creep = Number(b.dataset.creep)
    if (!Number.isInteger(creep)) return 0

    let sent = 0
    while (sent < count) {
      // Stop at the wallet rather than spraying commands the simulation would
      // refuse anyway. Gold is repainted once a tick, so this is current for a
      // click and for the hold cadence, which is slower than a tick. A ×N burst
      // inside one frame reads one value and lets the simulation refuse the
      // rest -- which is what the simulation is for, and why every one of those
      // N is its own command rather than one command carrying a number.
      if (b.hasAttribute('data-broke')) break
      send(creep)
      sent += 1
    }
    return sent
  }
}
