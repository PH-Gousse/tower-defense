import type { GameState } from './state'

/**
 * Canonical state hash.
 *
 * This is what proves two machines ran the same match. It is deliberately a
 * full walk over the state rather than a running digest updated at each
 * mutation site: ~500 creeps of six fields is ~3,000 values, and hashing that
 * with FNV-1a is microseconds against a 50ms tick budget. An incremental digest
 * would buy nothing and would create an invariant where one forgotten mutation
 * site is a silent hole in the only desync detector in the system.
 *
 * Canonicalisation rules, all load-bearing:
 *   - fields in declared order, never object iteration
 *   - floats written through a DataView as explicit little-endian Float64
 *   - -0 normalised to 0, because -0 and 0 have different bit patterns and
 *     compare equal, so they would desync silently
 *   - NaN is banned outright: a NaN in the sim is a bug, so assert rather than
 *     hash it (NaN !== NaN would make the hash unstable anyway)
 *
 * Math.imul is used for the FNV multiply. It is integer-exact and fully
 * specified by ECMAScript, unlike the libm transcendentals the arithmetic
 * allowlist exists to keep out.
 */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

const scratch = new DataView(new ArrayBuffer(8))

export class Hasher {
  private h = FNV_OFFSET

  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), FNV_PRIME)
  }

  int(v: number): void {
    // Four bytes, little-endian, so the byte order matches the float path.
    this.byte(v)
    this.byte(v >>> 8)
    this.byte(v >>> 16)
    this.byte(v >>> 24)
  }

  float(v: number): void {
    if (v !== v) throw new Error('NaN in sim state — this is a bug, not a value')
    // -0 and 0 compare equal but have different bit patterns. Normalise, or two
    // clients that agree numerically would disagree on the hash.
    scratch.setFloat64(0, v === 0 ? 0 : v, true)
    for (let i = 0; i < 8; i++) this.byte(scratch.getUint8(i))
  }

  get value(): number {
    return this.h >>> 0
  }
}

/** Hash every field that defines the match, in declared order. */
export function hashState(s: GameState): number {
  const h = new Hasher()
  h.int(s.tick)
  h.int(s.nextCreepId)

  const blocked = s.lane.blocked
  for (let i = 0; i < blocked.length; i++) h.byte(blocked[i] as number)

  // The flow field is derived from `blocked`, so hashing it is redundant for
  // correctness — but it is cheap and it turns "our fields diverged" into a
  // hash mismatch instead of into a creep quietly taking a different route.
  const dist = s.lane.field.dist
  for (let i = 0; i < dist.length; i++) h.int(dist[i] as number)

  const c = s.lane.creeps
  h.int(c.count)
  for (let i = 0; i < c.count; i++) {
    h.int(c.id[i] as number)
    h.float(c.x[i] as number)
    h.float(c.y[i] as number)
    h.int(c.hp[i] as number)
    h.int(c.laps[i] as number)
    h.float(c.speed[i] as number)
  }

  return h.value
}

export function hashHex(s: GameState): string {
  return hashState(s).toString(16).padStart(8, '0')
}
