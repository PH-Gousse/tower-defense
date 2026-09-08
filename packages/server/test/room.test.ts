import { describe, it, expect } from 'vitest'
import { localVersions, Kind, TowerKind } from '@ltw/sim'
import { Room, PING_COUNT, MIN_DELAY, MAX_DELAY, type Outbound } from '../src/room'

/**
 * A room with a clock under test control.
 *
 * `pingRounds` answers both seats' pings CONCURRENTLY, one round at a time,
 * which is how it actually happens: the server sends both first pings at the
 * same instant and each client answers on its own connection. An earlier
 * version of this helper completed one seat's five round trips before starting
 * the other's, so the second seat's outstanding ping aged by the first seat's
 * entire exchange and measured a round trip that never happened.
 */
function makeRoom() {
  let clock = 1000
  const room = new Room('ABCDEF', { now: () => clock, seed: () => 0x1234 })
  const collected: Outbound[] = []

  function pingRounds(rttA: number, rttB: number): Outbound[] {
    collected.length = 0
    for (let round = 1; round <= PING_COUNT; round++) {
      const t0 = clock
      const order: (0 | 1)[] = rttA <= rttB ? [0, 1] : [1, 0]
      for (const seat of order) {
        clock = t0 + (seat === 0 ? rttA : rttB)
        collected.push(...room.receive(seat, { t: 'pong', id: round }))
      }
    }
    return collected
  }

  return { room, pingRounds, advance: (ms: number) => { clock += ms } }
}

/** Seat both players, exchange versions, and negotiate at the given round trips. */
function playing(rttA = 0, rttB = 0) {
  const h = makeRoom()
  h.room.join()
  h.room.join()
  h.room.receive(0, { t: 'hello', versions: localVersions() })
  h.room.receive(1, { t: 'hello', versions: localVersions() })
  const out = h.pingRounds(rttA, rttB)
  return { ...h, out }
}

const msgs = (out: Outbound[], t: string) => out.filter((o) => o.msg.t === t)

describe('seating', () => {
  it('seats two players and refuses the third', () => {
    const { room } = makeRoom()
    expect(room.join().seat).toBe(0)
    expect(room.join().seat).toBe(1)
    const third = room.join()
    expect(third.seat).toBeNull()
    expect(third.out[0]!.msg).toMatchObject({ t: 'refused', reason: 'room-full' })
  })

  it('refuses a latecomer once the match is running', () => {
    // There is no reconnect in v1, and someone wandering in mid-match would be
    // seated as a player rather than a spectator.
    const h = playing(0, 0)
    expect(h.room.state).toBe('playing')
    expect(h.room.join().out[0]!.msg).toMatchObject({ reason: 'already-started' })
  })
})

describe('version handshake', () => {
  it('refuses a client on different data, rather than letting it desync', () => {
    // The realistic failure is a stale tab after a redeploy. A refusal now beats
    // a desync ten minutes in.
    const { room } = makeRoom()
    room.join()
    const v = localVersions()
    const out = room.receive(0, { t: 'hello', versions: { ...v, creepData: v.creepData + 1 } })
    expect(out[0]!.msg).toMatchObject({ t: 'refused', reason: 'version' })
  })

  it('does not start pinging until both have said hello', () => {
    const { room } = makeRoom()
    room.join(); room.join()
    expect(msgs(room.receive(0, { t: 'hello', versions: localVersions() }), 'ping')).toHaveLength(0)
    expect(msgs(room.receive(1, { t: 'hello', versions: localVersions() }), 'ping').length).toBeGreaterThan(0)
  })
})

describe('delay negotiation', () => {
  it('floors at 4 ticks on a perfect connection', () => {
    const h = playing(0, 0)
    expect(msgs(h.out, 'start')).toHaveLength(1)
    expect(h.room.agreedDelay).toBe(MIN_DELAY)
  })

  it('grows with round trip time', () => {
    // 300ms is 6 ticks, plus the 2-tick margin.
    expect(playing(300, 300).room.agreedDelay).toBe(8)
  })

  it('caps, so a bad connection is laggy rather than unplayable', () => {
    expect(playing(5000, 5000).room.agreedDelay).toBe(MAX_DELAY)
  })

  it('sizes to the WORSE of the two connections', () => {
    // Under strict wait the match runs at the speed of its slower link, so
    // averaging would guarantee the slower player stalls the pair.
    expect(playing(10, 400).room.agreedDelay).toBe(10)
  })

  it('does not start until both have finished pinging', () => {
    const h = makeRoom()
    h.room.join(); h.room.join()
    h.room.receive(0, { t: 'hello', versions: localVersions() })
    const out = h.room.receive(1, { t: 'hello', versions: localVersions() })
    // One seat answers everything; the other says nothing.
    for (let round = 1; round <= PING_COUNT; round++) out.push(...h.room.receive(0, { t: 'pong', id: round }))
    expect(msgs(out, 'start')).toHaveLength(0)
    expect(h.room.state).toBe('pinging')
  })
})

describe('relay', () => {
  it('relays a valid command to everyone', () => {
    const h = playing(0, 0)
    const out = h.room.receive(0, {
      t: 'cmd',
      cmd: { tick: 5, player: 0, kind: Kind.Build, tower: TowerKind.Single, x: 4, y: 11 },
    })
    expect(out).toHaveLength(1)
    expect(out[0]!.to).toBeNull()
    expect(out[0]!.msg).toMatchObject({ t: 'cmd' })
  })

  it('drops a frame claiming the other seat', () => {
    // Not cheating around the edges: this is playing both sides of the board.
    const h = playing(0, 0)
    const out = h.room.receive(0, {
      t: 'cmd',
      cmd: { tick: 5, player: 1, kind: Kind.Send, creep: 0 },
    })
    expect(out[0]!.msg).toMatchObject({ t: 'dropped', reason: 'wrong-seat' })
  })

  it('drops an off-grid build without letting it reach step()', () => {
    const h = playing(0, 0)
    const out = h.room.receive(0, {
      t: 'cmd',
      cmd: { tick: 5, player: 0, kind: Kind.Build, tower: 0, x: 1e9, y: 11 },
    })
    expect(out[0]!.msg).toMatchObject({ t: 'dropped', reason: 'off-grid' })
  })

  it('drops a creep index that does not exist in the loaded data', () => {
    const h = playing(0, 0)
    const out = h.room.receive(0, { t: 'cmd', cmd: { tick: 5, player: 0, kind: Kind.Send, creep: 9999 } })
    expect(out[0]!.msg).toMatchObject({ t: 'dropped', reason: 'bad-creep' })
  })

  it('enforces one input per player per tick', () => {
    // Two builds on one tick could be ordered differently by the two clients.
    const h = playing(0, 0)
    const cmd = { tick: 5, player: 0, kind: Kind.Build, tower: 0, x: 4, y: 11 }
    expect(h.room.receive(0, { t: 'cmd', cmd })[0]!.msg.t).toBe('cmd')
    expect(h.room.receive(0, { t: 'cmd', cmd: { ...cmd, x: 5 } })[0]!.msg).toMatchObject({
      t: 'dropped',
      reason: 'tick-taken',
    })
  })

  it('relays watermarks but never a backwards one', () => {
    const h = playing(0, 0)
    expect(h.room.receive(0, { t: 'wm', tick: 30 })[0]!.msg).toMatchObject({ t: 'wm', tick: 30 })
    expect(h.room.receive(0, { t: 'wm', tick: 10 })).toHaveLength(0)
  })
})

describe('endings', () => {
  it('concedes instantly, out of band', () => {
    // A concede stamped for T+delay could not be applied while the sim is
    // stalled waiting for the peer -- which is exactly when you want to concede.
    const h = playing(0, 0)
    const out = h.room.receive(0, { t: 'concede' })
    expect(out[0]!.msg).toMatchObject({ t: 'ended', reason: 'concede', winner: 1 })
    expect(h.room.state).toBe('ended')
  })

  it('scores a disconnect as the opponent winning', () => {
    const h = playing(0, 0)
    expect(h.room.leave(1)[0]!.msg).toMatchObject({ t: 'ended', reason: 'left', winner: 0 })
  })

  it('renegotiates delay on rematch instead of carrying a stale one', () => {
    const h = playing(0, 0)
    h.room.receive(0, { t: 'concede' })
    expect(h.room.receive(0, { t: 'rematch' })[0]!.msg).toMatchObject({ t: 'rematch', seated: 1 })
    const out = h.room.receive(1, { t: 'rematch' })
    // Back to pinging, not straight back to playing.
    expect(h.room.state).toBe('pinging')
    expect(msgs(out, 'ping').length).toBeGreaterThan(0)
  })

  it('issues a fresh match id and seed on rematch', () => {
    const h = playing(0, 0)
    h.room.receive(0, { t: 'concede' })
    h.room.receive(0, { t: 'rematch' })
    h.room.receive(1, { t: 'rematch' })
    const start = msgs(h.pingRounds(0, 0), 'start')[0]
    expect((start!.msg as { matchId: number }).matchId).toBe(2)
  })
})
