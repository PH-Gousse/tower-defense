/**
 * mulberry32 — seeded, deterministic, and currently unused.
 *
 * Nothing in the v1 rules consumes randomness: no crits, no spawn jitter, no
 * random targeting. This exists for the bot to break ties between equally-rated
 * moves, and the match seed exists so those tie-breaks replay. If the bot ends
 * up not needing it, delete this file and the seed with it.
 *
 * `Math.random` is banned in this package precisely so that reaching for
 * randomness is a deliberate act that goes through a seed.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
