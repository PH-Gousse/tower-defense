import type { Command, Versions } from '@ltw/sim'

/**
 * The relay's message shapes.
 *
 * Commands are the only thing the simulation ever sees. Everything else here --
 * lobby, ping, start, concede, rematch -- is out-of-band on purpose, because
 * anything stamped for a future tick cannot be acted on while the sim is
 * stalled waiting for a peer, and being stalled is exactly when some of these
 * matter most.
 */

export type ClientMsg =
  | { readonly t: 'hello'; readonly versions: Versions }
  | { readonly t: 'pong'; readonly id: number }
  /** A command, stamped for a tick in the future by `delay`. */
  | { readonly t: 'cmd'; readonly cmd: unknown }
  /** "I have no input through tick N." Sent every 10 ticks. */
  | { readonly t: 'wm'; readonly tick: number }
  | { readonly t: 'concede' }
  | { readonly t: 'rematch' }

export type EndReason = 'concede' | 'left'

export type ServerMsg =
  | { readonly t: 'welcome'; readonly seat: 0 | 1; readonly code: string }
  | { readonly t: 'refused'; readonly reason: RefusalReason; readonly detail?: string }
  | { readonly t: 'ping'; readonly id: number }
  | { readonly t: 'lobby'; readonly seated: number }
  | { readonly t: 'start'; readonly delay: number; readonly seed: number; readonly matchId: number }
  | { readonly t: 'cmd'; readonly cmd: Command }
  | { readonly t: 'wm'; readonly player: 0 | 1; readonly tick: number }
  /**
   * Your frame was refused. The match continues; you lost that one input.
   *
   * `tick` identifies which frame, so the sender can fade the right pending
   * ghost with a reason rather than leaving it on screen until it expires. A
   * seat may only have one command per tick, so the tick is enough to name it.
   * Absent when the frame was too malformed to have a readable tick.
   */
  | { readonly t: 'dropped'; readonly reason: string; readonly tick?: number }
  | { readonly t: 'ended'; readonly reason: EndReason; readonly winner: 0 | 1 }
  | { readonly t: 'peer'; readonly present: boolean }
  | { readonly t: 'rematch'; readonly seated: number }

export type RefusalReason =
  | 'version'
  | 'room-full'
  | 'bad-message'
  | 'not-seated'
  | 'already-started'
