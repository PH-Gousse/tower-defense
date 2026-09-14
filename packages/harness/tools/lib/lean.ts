import { CREEPS } from '@ltw/sim'

/**
 * The degenerate-strategy check, as a comparison rather than a count.
 *
 * Two earlier versions of this flag read "the winner's main send". By count
 * it named the cheapest creep whatever won; by gold it named the economy
 * card, because BOTH seats spend most of their gold on the best earner
 * whenever nothing is predicted to leak, which is most of every match. A
 * pattern both sides play is not a pattern that is winning, and neither
 * version could tell the two apart (issue #12).
 *
 * So the check is now: did the winner lean on an archetype MORE than the
 * loser did? Per decided match, each seat's send gold is split by archetype
 * across tiers and normalised; the lean is the winner's share minus the
 * loser's. An archetype is degenerate when the winner leaned on it by more
 * than the margin in more than the threshold share of decided matches. A
 * mirror, or two seats that sent the same mix, leans on nothing.
 */

export interface Lean {
  readonly archetype: string
  /** Mean of the winner's gold share, 0..1. */
  readonly winnerShare: number
  /** Mean of the loser's gold share, 0..1. */
  readonly loserShare: number
  /** Mean of (winner share - loser share). Positive: winners leaned on it. */
  readonly lean: number
  /** Decided matches in which the winner's lean exceeded the margin. */
  readonly leanedIn: number
  /** Decided matches considered. */
  readonly decided: number
  readonly flagged: boolean
}

/** Strip the tier suffix: "Swarm II" and "Swarm" are the same card. */
export function archetypeOf(name: string): string {
  return name.replace(/ (II|III|IV|V|VI|VII|VIII|IX|X)$/, '')
}

/** A seat's send gold by archetype, normalised to shares. Empty when it sent nothing. */
export function goldShares(sendsByCreep: readonly number[] | undefined): Map<string, number> {
  const by = sendsByCreep ?? []
  const gold = new Map<string, number>()
  let total = 0
  for (let i = 0; i < by.length; i++) {
    const n = by[i] ?? 0
    if (n === 0) continue
    const spec = CREEPS[i]
    const g = n * (spec?.cost ?? 0)
    const a = archetypeOf(spec?.name ?? `creep ${i}`)
    gold.set(a, (gold.get(a) ?? 0) + g)
    total += g
  }
  if (total > 0) for (const [a, g] of gold) gold.set(a, g / total)
  return gold
}

export interface DecidedMix {
  readonly winner: readonly number[] | undefined
  readonly loser: readonly number[] | undefined
}

/**
 * Aggregate the lean over decided matches.
 *
 * `margin` is the share, in points of 1, a winner has to lean by for the
 * match to count; `threshold` is the share of decided matches that have to
 * count for the archetype to be flagged.
 */
export function leanAcross(matches: readonly DecidedMix[], threshold: number, margin: number): Lean[] {
  const names = new Set<string>()
  const shares: { w: Map<string, number>; l: Map<string, number> }[] = []
  for (const m of matches) {
    const w = goldShares(m.winner)
    const l = goldShares(m.loser)
    if (w.size === 0 && l.size === 0) continue
    for (const k of w.keys()) names.add(k)
    for (const k of l.keys()) names.add(k)
    shares.push({ w, l })
  }
  const decided = shares.length
  const out: Lean[] = []
  for (const archetype of [...names].sort()) {
    let ws = 0
    let ls = 0
    let leanedIn = 0
    for (const s of shares) {
      const a = s.w.get(archetype) ?? 0
      const b = s.l.get(archetype) ?? 0
      ws += a
      ls += b
      if (a - b > margin) leanedIn += 1
    }
    const winnerShare = decided > 0 ? ws / decided : 0
    const loserShare = decided > 0 ? ls / decided : 0
    const lean = winnerShare - loserShare
    const flagged = decided > 0 && leanedIn / decided > threshold && lean > margin
    out.push({ archetype, winnerShare, loserShare, lean, leanedIn, decided, flagged })
  }
  return out.sort((a, b) => b.lean - a.lean)
}
