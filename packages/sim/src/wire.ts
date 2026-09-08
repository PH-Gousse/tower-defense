import { GRID_W, GRID_H } from './grid'
import { ARCHETYPES, CREEPS, DATA_VERSION, CREEP_DATA_VERSION } from './data'
import { Kind, type Command } from './step'

/**
 * The wire contract: what the relay lets through.
 *
 * Two guards, two jobs, and keeping them apart is the point. `step()` guards
 * *rules* — can you afford it, is the tile free, would it seal the lane. This
 * guards *shape* — is `x` a number inside the grid, is `creep` an index that
 * exists in the loaded data, is this player allowed to speak for that seat.
 *
 * The split matters because rules are subjective and shape is not. A build that
 * fails the gold check is a legitimate frame from an honest client that guessed
 * wrong about timing, and the sim refuses it as part of playing the game. A
 * build at x = 1e9 is not a game event at all; it is a malformed or hostile
 * frame, and letting it reach `step()` means an array index out of a stranger's
 * control.
 *
 * **One validator, two callers.** The server imports this rather than deriving
 * index bounds from the data files itself, so the wire contract stays versioned
 * with the data it validates and there is exactly one place to change when a
 * creep type is added.
 */

/** Bump when the message shapes change incompatibly. */
export const PROTOCOL_VERSION = 1

export type ShapeError =
  | 'not-an-object'
  | 'bad-tick'
  | 'bad-player'
  | 'wrong-seat'
  | 'bad-kind'
  | 'bad-tower'
  | 'bad-creep'
  | 'off-grid'
  | 'tick-out-of-window'

export interface ShapeResult {
  readonly ok: boolean
  readonly error: ShapeError | null
  /** Present only when ok. Narrowed and safe to hand to `step()`. */
  readonly command: Command | null
}

const ok = (command: Command): ShapeResult => ({ ok: true, error: null, command })
const bad = (error: ShapeError): ShapeResult => ({ ok: false, error, command: null })

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

export interface ShapeWindow {
  /** The seat the sending socket owns. A frame claiming the other is refused. */
  readonly seat: 0 | 1
  /** Earliest tick still acceptable. */
  readonly minTick: number
  /** Latest tick still acceptable, normally current + delay + slack. */
  readonly maxTick: number
}

/**
 * Validate one frame off the wire.
 *
 * Returns rather than throws: a bad frame drops, the sender is told, and the
 * match continues. Throwing would let one malformed message from one client end
 * a match for both.
 */
export function validateShape(raw: unknown, window: ShapeWindow): ShapeResult {
  if (typeof raw !== 'object' || raw === null) return bad('not-an-object')
  const c = raw as Record<string, unknown>

  if (!isInt(c.tick)) return bad('bad-tick')
  if (c.tick < window.minTick || c.tick > window.maxTick) return bad('tick-out-of-window')

  if (c.player !== 0 && c.player !== 1) return bad('bad-player')
  // A client may only speak for its own seat. Without this a player could send
  // commands as their opponent, which is not cheating around the edges -- it is
  // playing both sides of the board.
  if (c.player !== window.seat) return bad('wrong-seat')

  const tick = c.tick
  const player = c.player

  switch (c.kind) {
    case Kind.None:
      return ok({ tick, player, kind: Kind.None })

    case Kind.Build: {
      if (!isInt(c.tower) || c.tower < 0 || c.tower >= ARCHETYPES.length) return bad('bad-tower')
      if (!inGrid(c.x, c.y)) return bad('off-grid')
      return ok({ tick, player, kind: Kind.Build, tower: c.tower, x: c.x as number, y: c.y as number })
    }

    case Kind.Upgrade:
      if (!inGrid(c.x, c.y)) return bad('off-grid')
      return ok({ tick, player, kind: Kind.Upgrade, x: c.x as number, y: c.y as number })

    case Kind.Sell:
      if (!inGrid(c.x, c.y)) return bad('off-grid')
      return ok({ tick, player, kind: Kind.Sell, x: c.x as number, y: c.y as number })

    case Kind.Send: {
      if (!isInt(c.creep) || c.creep < 0 || c.creep >= CREEPS.length) return bad('bad-creep')
      return ok({ tick, player, kind: Kind.Send, creep: c.creep })
    }

    default:
      return bad('bad-kind')
  }
}

function inGrid(x: unknown, y: unknown): boolean {
  return isInt(x) && isInt(y) && x >= 0 && x < GRID_W && y >= 0 && y < GRID_H
}

/**
 * What a client and server must agree on before a match can start.
 *
 * A mismatch is refused with "reload, the game updated" rather than allowed to
 * desync. The realistic failure is a stale tab after a mid-session redeploy,
 * and a desync ten minutes in is a far worse way to discover it than a refusal
 * at connect.
 */
export interface Versions {
  readonly protocol: number
  readonly towerData: number
  readonly creepData: number
}

export function localVersions(): Versions {
  return {
    protocol: PROTOCOL_VERSION,
    towerData: DATA_VERSION,
    creepData: CREEP_DATA_VERSION,
  }
}

export function versionsMatch(a: Versions, b: Versions): boolean {
  return a.protocol === b.protocol && a.towerData === b.towerData && a.creepData === b.creepData
}
