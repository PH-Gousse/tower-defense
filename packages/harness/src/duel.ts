import {
  createState, step, hashState, botCommand, Kind, localVersions,
  type BotConfig, type Command, type GameState,
} from '@ltw/sim'
import { InputBuffer, watermarkCadence } from '@ltw/sim'
import { Room, PING_COUNT, type Outbound } from '@ltw/server/room'

/**
 * Two lockstep clients playing a whole match through a real relay, headlessly.
 *
 * This is the only way to actually test 1v1. Two browser tabs cannot be driven
 * reliably, they cannot be asserted on, and a lockstep divergence is invisible
 * from the outside anyway — the two players simply see different games. Here
 * both clients are real: each owns its own `GameState`, generates commands only
 * for its own seat, and learns about its opponent exclusively through the
 * relay. If the wire protocol or the ordering rule is wrong, the hashes part.
 *
 * The thing that would make this test worthless is sharing state between the
 * two clients, so nothing here is shared: not the state, not the buffer, not
 * the command generation.
 */

interface Client {
  readonly seat: 0 | 1
  a: GameState
  b: GameState
  buffer: InputBuffer | null
  /** Local tick reached. Equals a.tick; kept explicit for clarity. */
  tick: number
  lastWatermark: number
  hashes: Map<number, number>
}

export interface DuelResult {
  readonly ticks: number
  /** First tick at which the two clients' hashes differed, or -1. */
  readonly divergedAt: number
  readonly delay: number
  readonly commandsRelayed: number
  readonly stalls: number
  readonly finalHash: [number, number]
}

export interface DuelOptions {
  readonly bots?: readonly [BotConfig, BotConfig]
  readonly maxTicks?: number
  readonly rtt?: readonly [number, number]
  /** Drop every Nth frame from this seat, to prove strict wait stalls safely. */
  readonly dropEvery?: number
}

export function runDuel(options: DuelOptions = {}): DuelResult {
  const bots = options.bots
  const maxTicks = options.maxTicks ?? 4000
  const [rttA, rttB] = options.rtt ?? [0, 0]

  let clock = 1000
  const room = new Room('DUELXX', { now: () => clock, seed: () => 0x5eed })

  const clients: Client[] = [0, 1].map((s) => ({
    seat: s as 0 | 1,
    a: createState(),
    b: createState(),
    buffer: null,
    tick: 0,
    lastWatermark: -1,
    hashes: new Map<number, number>(),
  }))

  let delay = 0
  let commandsRelayed = 0

  /** Deliver relay output to the clients it is addressed to. */
  function deliver(out: Outbound[]): void {
    for (const o of out) {
      const targets = o.to === null ? clients : [clients[o.to] as Client]
      for (const c of targets) apply(c, o.msg)
    }
  }

  function apply(c: Client, msg: Outbound['msg']): void {
    switch (msg.t) {
      case 'start':
        delay = msg.delay
        c.buffer = new InputBuffer(msg.delay)
        break
      case 'cmd':
        c.buffer?.add(msg.cmd)
        break
      case 'wm':
        c.buffer?.mark(msg.player, msg.tick)
        break
      default:
        break
    }
  }

  // --- handshake ------------------------------------------------------------
  deliver(room.join().out)
  deliver(room.join().out)
  deliver(room.receive(0, { t: 'hello', versions: localVersions() }))
  deliver(room.receive(1, { t: 'hello', versions: localVersions() }))
  for (let round = 1; round <= PING_COUNT; round++) {
    const t0 = clock
    const order: (0 | 1)[] = rttA <= rttB ? [0, 1] : [1, 0]
    for (const seat of order) {
      clock = t0 + (seat === 0 ? rttA : rttB)
      deliver(room.receive(seat, { t: 'pong', id: round }))
    }
  }
  if (delay === 0) throw new Error('the match never started')

  // --- play -----------------------------------------------------------------
  let divergedAt = -1
  let stalls = 0
  let ticks = 0
  let frame = 0

  for (let guard = 0; guard < maxTicks * 4 && ticks < maxTicks; guard++) {
    // Each client emits for its own seat only, stamped `delay` ticks ahead.
    // Reading the peer's intentions locally would defeat the entire test.
    for (const c of clients) {
      if (!c.buffer) continue
      const at = c.tick + delay
      const cfg = bots?.[c.seat]
      const cmd: Command | null = cfg ? botCommand(c.a, c.seat, cfg) : null
      frame += 1
      const drop = options.dropEvery ? frame % options.dropEvery === 0 : false
      if (cmd && !drop) {
        deliver(room.receive(c.seat, { t: 'cmd', cmd: { ...cmd, tick: at } }))
        commandsRelayed += 1
      }
      // The watermark goes out on its own cadence, independent of commands.
      //
      // Treating a sent command as a promise looks like a free optimisation and
      // is a deadlock: the relay can drop a frame -- bad shape, a tick already
      // claimed, a tick outside the window -- and then the peer never receives
      // the promise the sender believes it made, and waits for that tick
      // forever. A redundant watermark costs one small message and is
      // monotonic, so it can never do harm.
      if (at - c.lastWatermark >= watermarkCadence(delay)) {
        deliver(room.receive(c.seat, { t: 'wm', tick: at }))
        c.lastWatermark = at
      }
    }

    // Strict wait: advance only ticks both seats have accounted for.
    let advanced = false
    for (const c of clients) {
      if (!c.buffer) continue
      if (!c.buffer.ready(c.tick)) continue
      const cmds = c.buffer.take(c.tick)
      const out = step(c.a, cmds, c.b)
      c.b = c.a
      c.a = out
      c.tick = c.a.tick
      c.hashes.set(c.tick, hashState(c.a) >>> 0)
      advanced = true
      // Real clients take 50ms of wall clock per tick, and the relay's
      // acceptance window is measured against that. A harness that froze the
      // clock had every later command rejected as out-of-window.
      clock += 50
    }
    if (!advanced) stalls += 1

    ticks = Math.min(clients[0]!.tick, clients[1]!.tick)

    // Compare every tick both have reached. A divergence that is only noticed
    // at the end tells you nothing about where it began.
    if (divergedAt === -1) {
      for (const [t, h] of clients[0]!.hashes) {
        const other = clients[1]!.hashes.get(t)
        if (other !== undefined && other !== h) {
          divergedAt = t
          break
        }
      }
    }
    if (divergedAt !== -1) break
  }

  return {
    ticks,
    divergedAt,
    delay,
    commandsRelayed,
    stalls,
    finalHash: [hashState(clients[0]!.a) >>> 0, hashState(clients[1]!.a) >>> 0],
  }
}

export { Kind }
