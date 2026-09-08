import { hashState } from './hash'
import type { GameState } from './state'

/**
 * Desync detection.
 *
 * Lockstep's failure mode is silent. Two clients run the same `step()` on the
 * same inputs and are supposed to stay bit-identical forever; when they do not,
 * nothing throws — the two players simply start watching different games, and
 * the first anyone notices is that a creep died on one screen and leaked on the
 * other. The whole point of hashing every tick is to turn that into a loud,
 * located failure: not "something is wrong" but "you and I disagreed at tick
 * 8,412".
 *
 * Nothing here resyncs. Resync means one client silently adopts the other's
 * state, which hides the bug that caused the divergence and is exactly the
 * behaviour that makes lockstep desyncs so hard to chase in other games. On
 * mismatch both clients freeze and offer the dump.
 */

/**
 * Ticks of history kept. At the 20-tick exchange interval this is two full
 * exchanges of overlap, so a peer running a little behind still shares ground
 * with us when its hashes arrive.
 */
export const RING_SIZE = 40

/** How often hashes go on the wire. Every tick would be 20 messages a second. */
export const EXCHANGE_EVERY_TICKS = 20

export interface HashEntry {
  readonly tick: number
  readonly hash: number
}

/**
 * Fixed-size ring of recent state hashes.
 *
 * A ring rather than a growing array because a 30-minute match is 36,000 ticks
 * and the only useful history is the window around the disagreement — anything
 * older cannot be compared any more, because the peer has thrown it away too.
 */
export class HashRing {
  private readonly ticks = new Int32Array(RING_SIZE)
  private readonly hashes = new Int32Array(RING_SIZE)
  private count = 0
  private next = 0

  /** Record the hash of a tick. Ticks must arrive in ascending order. */
  push(tick: number, hash: number): void {
    this.ticks[this.next] = tick
    this.hashes[this.next] = hash | 0
    this.next = (this.next + 1) % RING_SIZE
    if (this.count < RING_SIZE) this.count += 1
  }

  /** Hash the whole state and record it. The normal per-tick call. */
  record(s: GameState): void {
    this.push(s.tick, hashState(s))
  }

  /** Oldest first. Order matters: the divergence walk relies on it. */
  entries(): HashEntry[] {
    const out: HashEntry[] = []
    const start = this.count < RING_SIZE ? 0 : this.next
    for (let i = 0; i < this.count; i++) {
      const j = (start + i) % RING_SIZE
      out.push({ tick: this.ticks[j] as number, hash: (this.hashes[j] as number) >>> 0 })
    }
    return out
  }

  clear(): void {
    this.count = 0
    this.next = 0
  }

  get size(): number {
    return this.count
  }
}

export type DivergenceReason = 'agree' | 'diverged' | 'no-overlap'

export interface Divergence {
  readonly reason: DivergenceReason
  /** First tick both sides recorded and disagreed on. -1 unless diverged. */
  readonly tick: number
  readonly mine: number
  readonly theirs: number
  /** How many ticks the two rings could actually be compared on. */
  readonly compared: number
}

/**
 * The earliest tick two rings disagree on.
 *
 * Earliest, not latest, and that is the entire value of keeping a ring at all.
 * A single mismatched hash tells you the states differ *now*; it does not tell
 * you where it started, and every tick after the first divergence is also
 * wrong, so the newest mismatch is the least informative one. Walking forward
 * from the oldest shared tick finds the moment the two runs parted, which is
 * the tick whose inputs are worth looking at.
 *
 * `no-overlap` is a real answer, not an error: if a peer has fallen more than
 * RING_SIZE ticks behind, its window and ours no longer touch and we genuinely
 * cannot say. That is a stall, which is handled by stalling, not a desync.
 */
export function findDivergence(
  mine: readonly HashEntry[],
  theirs: readonly HashEntry[],
): Divergence {
  const byTick = new Map<number, number>()
  for (const e of theirs) byTick.set(e.tick, e.hash)

  let compared = 0
  for (const e of mine) {
    const other = byTick.get(e.tick)
    if (other === undefined) continue
    compared += 1
    if (other !== e.hash) {
      return { reason: 'diverged', tick: e.tick, mine: e.hash, theirs: other, compared }
    }
  }
  if (compared === 0) {
    return { reason: 'no-overlap', tick: -1, mine: 0, theirs: 0, compared: 0 }
  }
  return { reason: 'agree', tick: -1, mine: 0, theirs: 0, compared }
}
