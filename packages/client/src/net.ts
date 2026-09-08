import { localVersions, type Command } from '@ltw/sim'

/**
 * The relay connection.
 *
 * Deliberately dumb: it opens a socket, sends JSON, and hands parsed messages
 * to a listener. Every decision — seating, delay, validation, endings — is made
 * by the relay and tested there, without a socket in sight. The one thing this
 * owns is the fact that a socket can fail at any moment, which the rest of the
 * client should not have to think about.
 */

export interface NetEvents {
  onWelcome(seat: 0 | 1, code: string): void
  onLobby(seated: number): void
  onStart(delay: number, seed: number, matchId: number): void
  onCommand(cmd: Command): void
  onWatermark(player: 0 | 1, tick: number): void
  onEnded(reason: 'concede' | 'left', winner: 0 | 1): void
  onRefused(reason: string, detail?: string): void
  onDropped(reason: string): void
  onPeer(present: boolean): void
  onRematch(seated: number): void
  onClosed(): void
}

export class Net {
  private ws: WebSocket | null = null
  private closedByUs = false

  constructor(
    private readonly url: string,
    private readonly events: NetEvents,
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.addEventListener('open', () => {
      // The version handshake goes first, before anything can be misread. A
      // stale tab after a redeploy is the realistic failure, and refusing at
      // connect beats desyncing ten minutes in.
      this.send({ t: 'hello', versions: localVersions() })
    })
    ws.addEventListener('message', (ev) => this.receive(ev.data))
    ws.addEventListener('close', () => {
      if (!this.closedByUs) this.events.onClosed()
    })
    ws.addEventListener('error', () => {
      if (!this.closedByUs) this.events.onClosed()
    })
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    const e = this.events
    switch (msg.t) {
      case 'welcome':
        e.onWelcome(msg.seat as 0 | 1, msg.code as string)
        break
      case 'lobby':
        e.onLobby(msg.seated as number)
        break
      case 'ping':
        // Answered immediately and synchronously. Any delay here inflates the
        // measured round trip and buys everyone a larger input delay for the
        // whole match.
        this.send({ t: 'pong', id: msg.id as number })
        break
      case 'start':
        e.onStart(msg.delay as number, msg.seed as number, msg.matchId as number)
        break
      case 'cmd':
        e.onCommand(msg.cmd as Command)
        break
      case 'wm':
        e.onWatermark(msg.player as 0 | 1, msg.tick as number)
        break
      case 'ended':
        e.onEnded(msg.reason as 'concede' | 'left', msg.winner as 0 | 1)
        break
      case 'refused':
        e.onRefused(msg.reason as string, msg.detail as string | undefined)
        break
      case 'dropped':
        e.onDropped(msg.reason as string)
        break
      case 'peer':
        e.onPeer(msg.present as boolean)
        break
      case 'rematch':
        e.onRematch(msg.seated as number)
        break
      default:
        break
    }
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  sendCommand(cmd: Command): void {
    this.send({ t: 'cmd', cmd })
  }

  sendWatermark(tick: number): void {
    this.send({ t: 'wm', tick })
  }

  concede(): void {
    this.send({ t: 'concede' })
  }

  rematch(): void {
    this.send({ t: 'rematch' })
  }

  close(): void {
    this.closedByUs = true
    this.ws?.close()
  }
}

/** Where the relay lives. Overridable so a dev build can point at wrangler. */
export function relayUrl(code: string): string {
  const base = (import.meta.env?.VITE_RELAY as string | undefined) ?? DEFAULT_RELAY
  return `${base.replace(/\/$/, '')}/r/${code}`
}

const DEFAULT_RELAY = 'wss://ltw-relay.workers.dev'
