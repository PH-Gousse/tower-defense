/**
 * How a rung of the creep ladder is drawn until it has art of its own.
 *
 * ADR-0031 replaced three creep shapes x three tiers with a fourteen-rung
 * ladder, and the catalogue still holds the nine old models
 * (`creep_{swarm,runner,tank}_t{1,2,3}`). Each rung borrows the old model of its
 * shape from the band it falls in:
 *
 *   rungs  1-5   (tiers 0-4)   -> t1
 *   rungs  6-10  (tiers 5-9)   -> t2
 *   rungs 11-14  (tiers 10-13) -> t3
 *
 * Everything that sized or tinted a creep by its tier reads the band instead.
 * Sizing by tier would have drawn the fourteenth rung at 1 + 0.22 x 13 = 3.86x,
 * taller than a 2x2 tower. Issue #51 replaces the whole file with fourteen
 * real assets.
 */

/** Rungs per model band. */
const RUNGS_PER_BAND = 5

/** Highest band the catalogue has a model for (t3). */
export const MAX_ART_BAND = 2

/** Largest a placeholder creep is ever drawn, as a multiple of its model. */
export const MAX_CREEP_SCALE = 1.6

/** The model band, 0-2, that a ladder tier borrows its look from. */
export function artBand(tier: number): number {
  const band = Math.floor(tier / RUNGS_PER_BAND)
  return band > MAX_ART_BAND ? MAX_ART_BAND : band < 0 ? 0 : band
}

/** A heavier band is a bigger creature, never past MAX_CREEP_SCALE. */
export function creepScale(tier: number): number {
  const scale = 1 + 0.22 * artBand(tier)
  return scale > MAX_CREEP_SCALE ? MAX_CREEP_SCALE : scale
}

/**
 * A creep's name in the art catalogue: its ladder key without underscores.
 *
 * One design per creep (#51): each ladder creep is its own archetype at tier
 * 1, `creep_<name>_t1`, because asset ids allow no underscore inside the name.
 * The bands above are only the procedural fallback now, for a creep whose
 * asset is missing.
 */
export function creepArtName(key: string): string {
  return key.replace(/_/g, '')
}
