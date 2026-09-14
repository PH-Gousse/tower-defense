/**
 * Where inside its tile a creep is drawn (ADR-0021).
 *
 * The sim has no creep–creep collision: creeps share cells freely and a
 * mass send arrives as a stack. Separation is visual only, and it has to be
 * a pure function of the creep's id — never of time, never of anything the
 * sim reads — so two clients draw the same crowd and nothing here can leak
 * back into the rules.
 *
 * The offset is a point in a disc. The angle steps by the golden angle per
 * id and the radius by the square root of a second golden-ratio fraction,
 * which spreads consecutive ids evenly over the disc instead of along a
 * spiral arm. The disc is smaller than half a tile so a creep in a one-wide
 * slot never draws inside the towers beside it; a creep model's footprint
 * budget is 1.2 tiles (style sheet §7), so the visual overlap two neighbours
 * can still have is a fraction of a body, not a merged blob.
 */

/** Half the disc's diameter, in tiles. */
export const CREEP_OFFSET_RADIUS = 0.22

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const GOLDEN_FRACTION = 0.6180339887498949

export interface Offset {
  x: number
  z: number
}

/** The draw offset for creep `id`, written into `out`. Deterministic and allocation-free. */
export function creepOffset(id: number, out: Offset, radius = CREEP_OFFSET_RADIUS): Offset {
  const angle = id * GOLDEN_ANGLE
  const f = id * GOLDEN_FRACTION
  const r = radius * Math.sqrt(f - Math.floor(f))
  out.x = Math.cos(angle) * r
  out.z = Math.sin(angle) * r
  return out
}
