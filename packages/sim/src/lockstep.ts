import { Kind, type Command } from './step'

/**
 * The lockstep input buffer.
 *
 * It lives in the sim rather than the client because the canonical ordering
 * rule -- sorted by player, then by kind -- is a determinism contract, not a
 * presentation detail, and it belongs next to the `step()` it feeds. The server
 * and the headless duel harness need the same rule, and three copies of it
 * would be three chances to disagree.
 *
 * Strict wait: a client simulates tick T only once it holds *both* players'
 * inputs for T. That is the whole safety property — an input can never arrive
 * for a tick already simulated, so the failure mode is stalling rather than
 * desync, and a stall is visible and recoverable while a desync is neither.
 *
 * Two things make this tractable at 20Hz:
 *
 *   **Watermarks, not per-tick messages.** A client says "nothing through tick
 *   T" every 10 ticks and the peer treats every tick up to T as `None`. One
 *   message per tick per client would be ~2,400 a minute per match, forever,
 *   even while both players idle — and with a 15-second income cadence they
 *   idle most of the time. It would also defeat the Hibernation API the whole
 *   hosting story rests on.
 *
 *   **The bootstrap.** Ticks 0..delay-1 are implicit `None` for both players.
 *   Without it, strict wait deadlocks at tick 0: nobody can have sent an input
 *   for tick 0, because inputs are stamped `delay` ticks ahead.
 */
export class InputBuffer {
  /** Commands by tick, per seat. A tick with no entry is `None` below the mark. */
  private readonly byTick: [Map<number, Command[]>, Map<number, Command[]>] = [
    new Map(),
    new Map(),
  ]
  /** Highest tick each seat has accounted for. -1 means nothing yet. */
  private readonly marks: [number, number] = [-1, -1]

  constructor(readonly delay: number) {
    // The bootstrap. Both seats are known-empty through the delay window.
    this.marks[0] = delay - 1
    this.marks[1] = delay - 1
  }

  /** Record a command. Its own tick is a watermark for the seat that sent it. */
  add(cmd: Command): void {
    if (cmd.kind === Kind.None) {
      this.mark(cmd.player, cmd.tick)
      return
    }
    const map = this.byTick[cmd.player]
    const list = map.get(cmd.tick)
    if (list) list.push(cmd)
    else map.set(cmd.tick, [cmd])
    this.mark(cmd.player, cmd.tick)
  }

  /** "Nothing through tick N from this seat." Only ever moves forward. */
  mark(player: 0 | 1, tick: number): void {
    if (tick > this.marks[player]) this.marks[player] = tick
  }

  /** The highest tick both seats have accounted for. */
  get readyThrough(): number {
    return Math.min(this.marks[0], this.marks[1])
  }

  /** Can tick T be simulated yet? */
  ready(tick: number): boolean {
    return tick <= this.readyThrough
  }

  /**
   * Commands to apply at a tick, in canonical order.
   *
   * Sorted by player then kind, and that ordering is not cosmetic: both clients
   * must hand `step()` the same array in the same order or they compute
   * different states from the same inputs. Arrival order over a network is not
   * a shared fact; this sort is.
   */
  take(tick: number): Command[] {
    const out: Command[] = []
    for (const p of [0, 1] as const) {
      const list = this.byTick[p].get(tick)
      if (list) out.push(...list)
      this.byTick[p].delete(tick)
    }
    out.sort((a, b) => a.player - b.player || a.kind - b.kind)
    return out
  }

  /** How far ahead of us a seat has promised. Used to spot a stalling peer. */
  markOf(player: 0 | 1): number {
    return this.marks[player]
  }
}

/** Ticks a peer may fall behind before the match is visibly stalled. */
export const STALL_TICKS = 40

/** Ceiling on how often a client re-states its watermark when it is idle. */
export const WATERMARK_EVERY = 10

/**
 * How often a client must actually send one, in local ticks.
 *
 * It cannot simply be every 10 ticks, and this is the one place the design doc
 * was wrong. At local tick T a client can only honestly promise "nothing
 * through T + delay" -- it might act at T + 1, which lands at T + 1 + delay. So
 * one watermark buys exactly `delay` ticks of progress for the peer. With the
 * negotiated delay flooring at 4 and a fixed cadence of 10, every client would
 * promise 4 ticks of progress every 10 ticks and both sides would deadlock
 * permanently, at precisely the connection quality that two people on the same
 * network produce.
 *
 * Taking the smaller of the two keeps the 10x traffic saving wherever the delay
 * is large enough to allow it, and guarantees progress where it is not.
 */
export function watermarkCadence(delay: number): number {
  return Math.max(1, Math.min(WATERMARK_EVERY, delay))
}
