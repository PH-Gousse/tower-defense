import {
  validateShape,
  versionsMatch,
  localVersions,
  Kind,
  type Command,
  type Versions,
} from '@ltw/sim'
import type { ClientMsg, ServerMsg, EndReason } from './protocol'

/**
 * One match, with no transport in it.
 *
 * Everything the relay actually decides lives here — seating, the version
 * handshake, RTT negotiation, wire validation, ordering, concede, rematch —
 * and none of it touches a WebSocket, a Durable Object or a Cloudflare API.
 * That is deliberate: a relay whose logic can only be exercised by standing up
 * a Worker and opening two browser tabs is a relay that never gets tested, and
 * lockstep bugs are precisely the ones you cannot find by clicking around.
 *
 * `match.ts` is the thin adapter that gives this sockets.
 */

/** Pings each client answers before the match may start. */
export const PING_COUNT = 5

/** Ticks are 50ms. The delay is expressed in ticks, so RTT converts through this. */
export const TICK_MS = 50

/**
 * Delay bounds. The floor is 4 ticks (200ms) because a delay short enough to
 * feel instant is also short enough that ordinary jitter stalls the match, and
 * under strict-wait lockstep one player's stall is both players' stall. The
 * ceiling stops a bad connection from making the game unplayable rather than
 * merely laggy.
 */
export const MIN_DELAY = 4
export const MAX_DELAY = 20

/**
 * Slack on the acceptance window, in ticks.
 *
 * The window exists to reject nonsense — a build stamped for tick 1e9 — not to
 * police pacing. Sized tightly it does the opposite: a client catching up after
 * a stall runs up to 10 ticks per frame, briefly outruns wall clock, and has
 * perfectly legitimate commands dropped. A live two-client run against the real
 * Durable Object produced a stream of `tick-out-of-window` drops for exactly
 * this reason. Two seconds of slack absorbs any honest catch-up or jitter and
 * still rejects garbage by a factor of millions.
 */
const TICK_SLACK = 40

export interface Outbound {
  /** A seat, or null to mean everyone. */
  readonly to: 0 | 1 | null
  readonly msg: ServerMsg
}

type Phase = 'lobby' | 'pinging' | 'playing' | 'ended'

interface Seat {
  readonly seat: 0 | 1
  versions: Versions | null
  /** Round-trip samples in ms. */
  readonly rtt: number[]
  pingsSent: number
  pendingPingAt: number
  /** Highest tick this seat has spoken for, command or watermark. */
  watermark: number
  /** Ticks this seat has already used, so one input per player per tick holds. */
  readonly claimed: Set<number>
  wantsRematch: boolean
}

export interface RoomDeps {
  /** Milliseconds. Injected so tests are not at the mercy of a real clock. */
  readonly now: () => number
  /** 32-bit seed source. The relay may use real randomness; the sim may not. */
  readonly seed: () => number
}

export class Room {
  private phase: Phase = 'lobby'
  private readonly seats = new Map<0 | 1, Seat>()
  private delay = MIN_DELAY
  private matchId = 0
  private startedAt = 0

  constructor(
    readonly code: string,
    private readonly deps: RoomDeps,
  ) {}

  get seated(): number {
    return this.seats.size
  }

  get state(): Phase {
    return this.phase
  }

  get agreedDelay(): number {
    return this.delay
  }

  /**
   * Seat a new socket.
   *
   * Returns the seat, or null when the room is full. Collisions on room codes
   * are handled here rather than by asking whether a code is taken: Durable
   * Objects are addressed by name, every name always resolves, and checking
   * would instantiate the object for it. Generate, and let the room refuse.
   */
  join(): { seat: 0 | 1 | null; out: Outbound[] } {
    if (this.phase === 'playing' || this.phase === 'ended') {
      // No reconnect in v1, and a third party wandering in mid-match would be
      // seated as a player rather than a spectator. Refuse plainly.
      return { seat: null, out: [{ to: null, msg: { t: 'refused', reason: 'already-started' } }] }
    }
    const seat: 0 | 1 = this.seats.has(0) ? 1 : 0
    if (this.seats.has(seat)) {
      return { seat: null, out: [{ to: null, msg: { t: 'refused', reason: 'room-full' } }] }
    }
    this.seats.set(seat, {
      seat,
      versions: null,
      rtt: [],
      pingsSent: 0,
      pendingPingAt: 0,
      watermark: -1,
      claimed: new Set(),
      wantsRematch: false,
    })
    const out: Outbound[] = [
      { to: seat, msg: { t: 'welcome', seat, code: this.code } },
      { to: null, msg: { t: 'lobby', seated: this.seats.size } },
    ]
    if (this.seats.size === 2) out.push({ to: null, msg: { t: 'peer', present: true } })
    return { seat, out }
  }

  /** Handle one message from a seated socket. */
  receive(seat: 0 | 1, raw: unknown): Outbound[] {
    const me = this.seats.get(seat)
    if (!me) return [{ to: seat, msg: { t: 'refused', reason: 'not-seated' } }]
    if (typeof raw !== 'object' || raw === null) {
      return [{ to: seat, msg: { t: 'refused', reason: 'bad-message' } }]
    }
    const msg = raw as ClientMsg

    switch (msg.t) {
      case 'hello':
        return this.hello(me, msg.versions)
      case 'pong':
        return this.pong(me, msg.id)
      case 'cmd':
        return this.command(me, msg.cmd)
      case 'wm':
        return this.watermark(me, msg.tick)
      case 'concede':
        return this.concede(me)
      case 'rematch':
        return this.rematch(me)
      default:
        return [{ to: seat, msg: { t: 'refused', reason: 'bad-message' } }]
    }
  }

  /** A socket went away. */
  leave(seat: 0 | 1): Outbound[] {
    if (!this.seats.delete(seat)) return []
    if (this.phase === 'playing') {
      // Closing the tab already scores as the opponent winning -- the realistic
      // losing ending is a player watching creeps lap and giving up -- so make
      // it explicit rather than leaving the other player staring at a stall.
      this.phase = 'ended'
      const winner = (1 - seat) as 0 | 1
      return [{ to: null, msg: { t: 'ended', reason: 'left', winner } }]
    }
    return [
      { to: null, msg: { t: 'peer', present: false } },
      { to: null, msg: { t: 'lobby', seated: this.seats.size } },
    ]
  }

  // --- handshake ------------------------------------------------------------

  private hello(me: Seat, versions: Versions): Outbound[] {
    const mine = localVersions()
    if (!versions || !versionsMatch(versions, mine)) {
      // The realistic failure: a stale tab after a mid-session redeploy. A
      // refusal now is a far better way to find out than a desync ten minutes
      // in, which is the same trade the whole determinism apparatus makes.
      return [
        {
          to: me.seat,
          msg: {
            t: 'refused',
            reason: 'version',
            detail: `server ${mine.protocol}/${mine.towerData}/${mine.creepData}`,
          },
        },
      ]
    }
    me.versions = versions
    return this.maybeBeginPinging()
  }

  private maybeBeginPinging(): Outbound[] {
    if (this.phase !== 'lobby') return []
    if (this.seats.size < 2) return []
    for (const s of this.seats.values()) if (!s.versions) return []

    this.phase = 'pinging'
    const out: Outbound[] = []
    for (const s of this.seats.values()) out.push(...this.sendPing(s))
    return out
  }

  private sendPing(s: Seat): Outbound[] {
    if (s.pingsSent >= PING_COUNT) return []
    s.pingsSent += 1
    s.pendingPingAt = this.deps.now()
    return [{ to: s.seat, msg: { t: 'ping', id: s.pingsSent } }]
  }

  private pong(me: Seat, id: number): Outbound[] {
    if (this.phase !== 'pinging') return []
    if (id !== me.pingsSent) return [] // stale or forged; ignore rather than punish
    me.rtt.push(this.deps.now() - me.pendingPingAt)
    const more = this.sendPing(me)
    if (more.length > 0) return more
    return this.maybeStart()
  }

  private maybeStart(): Outbound[] {
    for (const s of this.seats.values()) if (s.rtt.length < PING_COUNT) return []
    return this.begin()
  }

  /**
   * `delay = clamp(ceil(worstRTT / 50ms) + 2, 4, 20)`, broadcast once.
   *
   * The worst of the two, not the average: under strict wait, a match runs at
   * the speed of its slower connection, so sizing to the average guarantees the
   * slower player stalls the pair. Set once before tick 0 and never changed --
   * a delay that moved mid-match would change how far ahead each client stamps
   * its inputs, and the two would disagree about which tick a command belongs
   * to, which is a desync dressed as a network feature.
   */
  private begin(): Outbound[] {
    let worst = 0
    for (const s of this.seats.values()) for (const r of s.rtt) if (r > worst) worst = r
    const ticks = Math.ceil(worst / TICK_MS) + 2
    this.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, ticks))
    this.phase = 'playing'
    this.matchId += 1
    this.startedAt = this.deps.now()
    for (const s of this.seats.values()) {
      s.watermark = -1
      s.claimed.clear()
      s.wantsRematch = false
    }
    return [
      {
        to: null,
        msg: { t: 'start', delay: this.delay, seed: this.deps.seed() >>> 0, matchId: this.matchId },
      },
    ]
  }

  // --- play -----------------------------------------------------------------

  private command(me: Seat, raw: unknown): Outbound[] {
    if (this.phase !== 'playing') {
      return [{ to: me.seat, msg: { t: 'dropped', reason: 'not-playing' } }]
    }
    // The window is generous on purpose. The server does not run the sim, so it
    // only knows roughly where the clients are; its job is to reject nonsense,
    // not to second-guess a client that is a few ticks ahead.
    const elapsedTicks = Math.floor((this.deps.now() - this.startedAt) / TICK_MS)
    const result = validateShape(raw, {
      seat: me.seat,
      minTick: 0,
      maxTick: elapsedTicks + this.delay + TICK_SLACK,
    })
    if (!result.ok || !result.command) {
      return [{ to: me.seat, msg: { t: 'dropped', reason: result.error ?? 'invalid' } }]
    }
    const cmd = result.command

    // Exactly one input per player per tick. Without this a client could stack
    // two builds on one tick, and the peer -- which applies commands in the
    // order they arrive within a tick -- could order them differently.
    if (me.claimed.has(cmd.tick)) {
      return [{ to: me.seat, msg: { t: 'dropped', reason: 'tick-taken' } }]
    }
    me.claimed.add(cmd.tick)
    if (cmd.tick > me.watermark) me.watermark = cmd.tick

    // A real command carries its own watermark: everything below its tick is
    // now known to be empty for this seat.
    return [{ to: null, msg: { t: 'cmd', cmd } }]
  }

  private watermark(me: Seat, tick: number): Outbound[] {
    if (this.phase !== 'playing') return []
    if (!Number.isInteger(tick) || tick < 0) {
      return [{ to: me.seat, msg: { t: 'dropped', reason: 'bad-watermark' } }]
    }
    // Watermarks only ever move forward. A backwards one would let a client
    // un-promise ticks its peer has already simulated.
    if (tick <= me.watermark) return []
    me.watermark = tick
    return [{ to: null, msg: { t: 'wm', player: me.seat, tick } }]
  }

  private concede(me: Seat): Outbound[] {
    if (this.phase !== 'playing') return []
    this.phase = 'ended'
    return [{ to: null, msg: { t: 'ended', reason: 'concede' as EndReason, winner: (1 - me.seat) as 0 | 1 } }]
  }

  /**
   * Rematch is a new match, not a continuation.
   *
   * Tick resets to 0, a new seed is issued, and `delay` is renegotiated from
   * scratch — connection quality may have changed since the first match, and a
   * stale delay carried forward silently is exactly the value you do not want.
   */
  private rematch(me: Seat): Outbound[] {
    if (this.phase !== 'ended') return []
    me.wantsRematch = true
    const ready = [...this.seats.values()].filter((s) => s.wantsRematch).length
    const out: Outbound[] = [{ to: null, msg: { t: 'rematch', seated: ready } }]
    if (ready < 2 || this.seats.size < 2) return out
    this.phase = 'pinging'
    for (const s of this.seats.values()) {
      s.rtt.length = 0
      s.pingsSent = 0
    }
    for (const s of this.seats.values()) out.push(...this.sendPing(s))
    return out
  }
}

export { Kind }
export type { Command }
