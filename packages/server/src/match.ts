import { Room, type Outbound } from './room'

/**
 * The Durable Object: one per match, addressed by room code.
 *
 * A thin adapter and nothing more. Every decision the relay makes lives in
 * `Room`, which knows nothing about Cloudflare, so it can be tested without
 * standing up a Worker — and a relay whose logic can only be exercised by
 * opening two browser tabs is a relay that never gets tested.
 *
 * Two Cloudflare specifics that are not optional:
 *
 *   **`WebSocketPair`, not the `ws` package.** `ws` is a Node library and there
 *   is no Node runtime here.
 *
 *   **The Hibernation API.** `acceptWebSocket` lets the object be evicted from
 *   memory between messages and revived when one arrives, which is the whole
 *   reason the hosting bill is near zero while nobody is playing. It is also
 *   why `Kind.None` is a 10-tick watermark rather than a per-tick message: a
 *   message every 25ms would mean the object never hibernates at all, and
 *   "bills nothing when idle" would be true of an empty room and false of a
 *   live match.
 */

interface DOState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
}

export class MatchRoom {
  private room: Room | null = null

  constructor(private readonly state: DOState) {}

  private ensure(code: string): Room {
    // Hibernation can evict this object between messages, so the Room may need
    // rebuilding. Seats are recovered from the sockets' tags, which survive.
    this.room ??= new Room(code, {
      now: () => Date.now(),
      // The relay may use real randomness. The simulation may not, which is why
      // Math.random is banned inside packages/sim.
      seed: () => crypto.getRandomValues(new Uint32Array(1))[0] as number,
    })
    return this.room
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 })
    }
    const code = new URL(request.url).pathname.split('/').pop() ?? 'UNKNOWN'
    const room = this.ensure(code)

    const pair = new WebSocketPair()
    const client = pair[0] as WebSocket
    const server = pair[1] as WebSocket

    const { seat, out } = room.join()
    if (seat === null) {
      // Accept, say why, close. A silent failure here reads as a broken link.
      server.accept()
      for (const o of out) server.send(JSON.stringify(o.msg))
      server.close(4001, 'room full')
      return new Response(null, { status: 101, webSocket: client })
    }

    // The seat is tagged so it survives hibernation: the object may be evicted
    // and revived with only its sockets, and it has to know who is who.
    this.state.acceptWebSocket(server, [`seat:${seat}`])
    this.dispatch(out)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const seat = this.seatOf(ws)
    if (seat === null) return
    const room = this.ensure('UNKNOWN')
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))
    } catch {
      // A frame that is not JSON is dropped and the sender told. One malformed
      // message must never end a match for both players.
      ws.send(JSON.stringify({ t: 'refused', reason: 'bad-message' }))
      return
    }
    this.dispatch(room.receive(seat, parsed))
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const seat = this.seatOf(ws)
    if (seat === null || !this.room) return
    this.dispatch(this.room.leave(seat))
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  private seatOf(ws: WebSocket): 0 | 1 | null {
    for (const seat of [0, 1] as const) {
      if (this.state.getWebSockets(`seat:${seat}`).includes(ws)) return seat
    }
    return null
  }

  private dispatch(out: Outbound[]): void {
    for (const o of out) {
      const text = JSON.stringify(o.msg)
      const targets = o.to === null ? [0, 1] : [o.to]
      for (const seat of targets) {
        for (const ws of this.state.getWebSockets(`seat:${seat}`)) {
          try {
            ws.send(text)
          } catch {
            // A socket that is already gone is not an error worth propagating;
            // its close handler will seat the ending.
          }
        }
      }
    }
  }
}
