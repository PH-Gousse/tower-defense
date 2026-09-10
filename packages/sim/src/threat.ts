import { TILE_COUNT, SPAWN_INDICES, tileX, tileY } from './grid'
import { pathFrom } from './path'
import { TowerKind, CREEPS, ARCHETYPES, levelOf, type CreepSpec, type TowerArchetype } from './data'
import type { Lane } from './state'

/**
 * How many creeps a maze lets through: the bot's model of a maze's strength.
 *
 * The bot used to read a maze as a single word -- "mostly single-target" --
 * and answer it from a three-row table. That knows nothing about how LONG the
 * maze is, how many towers reach the route, what level they are, or how many
 * creeps are in the lane, and every one of those decides whether anything
 * leaks. This estimates the answer instead, from the same state a player reads
 * off the screen: the route, the towers within reach of it, and the creeps
 * walking it.
 *
 * The thing to model is a FLOOD, not a wave. Measured, no single wave the
 * economy can buy survives a lap of a six-tower maze; what leaks in a real
 * match is the lane filling up faster than the towers can empty it, over many
 * sends, until every tower is firing every tick it can and creeps still reach
 * the exit. So the unit is the whole population of the lane:
 *
 *   per tower:  route tiles in range, widened by how far the crowd stretches
 *               ──▶ ticks the tower is firing during one lap ──▶ shots
 *   splash      lands on everyone near its target ──▶ hp off every creep
 *   the rest    kill one creep at a time, shared across the crowd ──▶ kills
 *   leaks = creeps - kills, per roster entry
 *
 * A wave's worth is then MARGINAL: what the lane leaks with the wave added,
 * less what it leaks already. Early on that is zero for anything affordable,
 * which is the model saying what the measurement said -- a send then is an
 * investment in income, not an attack -- and it becomes positive as the lane
 * saturates.
 *
 * It is a heuristic and is meant to be one. It ignores where a creep is when
 * a tower fires, that towers focus the creep nearest the exit, and overkill
 * past the last shot. It keeps every quantity that scales the answer: maze
 * length, tower count, level, range, fire rate, creep speed and hp, crowd
 * size, splash against numbers, slow against speed. `SPREAD` is the one fitted
 * constant, and how it was fitted is written on it.
 *
 * Deterministic and allocation-free after module load, because it runs inside
 * the sim package under the sim's arithmetic rules: `+ - * /`, `ceil`, `min`
 * and `max`, distances compared squared.
 */

/** A tower to imagine in place of whatever stands on its tile: a candidate build or upgrade. */
export interface TowerOverride {
  readonly tile: number
  readonly kind: TowerKind
  readonly level: number
}

/**
 * Tiles of route one more creep in the lane adds to the stretch of the crowd.
 *
 * Creeps in a lane are spread along the route, and a tower fires for as long
 * as any of them is in its range, so the crowd's length is what turns a
 * tower's reach into firing time. Fitted, not derived: a stream of five tanks
 * every half second was simulated against twenty towers of the bot's mix and
 * the constant chosen so the predicted leaks per lap sit within a third of
 * the simulated ones as the crowd grew from 127 to 477 (148 against 179, 380
 * against 317, 51 against 73). Streams of swarm and runners leak nothing in
 * the sim at any crowd size against that maze, and the model agrees. The
 * trend it has to get right is the SATURATION point -- the crowd size past
 * which leaks begin -- because that is the only thing the bot reads off it.
 * `pnpm --filter @ltw/harness flood` re-runs the comparison.
 */
const SPREAD = 0.2

/** Route tiles within range of each tower, scratch. */
const reach = new Int32Array(TILE_COUNT)
const kindAt = new Int8Array(TILE_COUNT)
const levelAt = new Int8Array(TILE_COUNT)
const MAX_ROSTER = 64
const lanePop = new Int32Array(MAX_ROSTER)
const wavePop = new Int32Array(MAX_ROSTER)

/** The route creeps walk in a lane, entrance to exit. */
export function routeOf(lane: Lane, out: number[] = []): number[] {
  return pathFrom(lane.field, SPAWN_INDICES[0] as number, out)
}

/** How many of each roster entry a lane holds, into `out`. Returns the total. */
export function population(lane: Lane, out: Int32Array): number {
  const n = CREEPS.length < out.length ? CREEPS.length : out.length
  for (let i = 0; i < n; i++) out[i] = 0
  const c = lane.creeps
  let total = 0
  for (let i = 0; i < c.count; i++) {
    const s = c.spec[i] as number
    if (s < n) {
      out[s] = (out[s] as number) + 1
      total += 1
    }
  }
  return total
}

/**
 * Creeps predicted to survive one lap of this maze, out of a population of
 * `counts[i]` creeps of roster entry `i`. Fractional: 2.4 means two leak and a
 * third nearly does.
 *
 * `kinds` and `levels` are the lane's tower arrays; `override` stands a
 * different tower on one tile without touching them, which is how a candidate
 * is costed before it is bought.
 */
export function floodLeaks(
  route: readonly number[],
  kinds: ArrayLike<number>,
  levels: ArrayLike<number>,
  counts: ArrayLike<number>,
  override: TowerOverride | null = null,
): number {
  const routeLen = route.length
  // A sealed lane has no route and nothing leaks from it; the sim sends the
  // creeps back to the entrance instead.
  if (routeLen === 0) return 0
  const roster = CREEPS.length < counts.length ? CREEPS.length : counts.length
  let total = 0
  for (let i = 0; i < roster; i++) total += counts[i] as number
  if (total <= 0) return 0

  for (let t = 0; t < TILE_COUNT; t++) {
    kindAt[t] = kinds[t] as number
    levelAt[t] = levels[t] as number
  }
  if (override) {
    kindAt[override.tile] = override.kind
    levelAt[override.tile] = override.level
  }

  // Pass one: how much of the route each tower reaches, and how much of it
  // the slows cover between them.
  let slowTiles = 0
  let slowPct = 0
  for (let t = 0; t < TILE_COUNT; t++) {
    reach[t] = 0
    const kind = kindAt[t] as number
    if (kind === -1) continue
    const lv = levelOf(kind as TowerKind, levelAt[t] as number)
    const r2 = lv.range * lv.range
    const tx = tileX(t)
    const ty = tileY(t)
    let n = 0
    for (let i = 0; i < routeLen; i++) {
      const r = route[i] as number
      const dx = tileX(r) - tx
      const dy = tileY(r) - ty
      if (dx * dx + dy * dy <= r2) n += 1
    }
    reach[t] = n
    if (kind === TowerKind.Slow) {
      slowTiles += n
      const pct = lv.slowPercent ?? 0
      if (pct > slowPct) slowPct = pct
    }
  }
  // Slowed for the share of the route the frost towers cover, at the best
  // slow among them. Overlaps are counted twice, which errs toward the maze.
  const slowFrac = slowTiles > routeLen ? 1 : slowTiles / routeLen
  const slowFactor = 1 - (slowPct / 100) * slowFrac

  // How far the crowd stretches along the route.
  const stretch = total * SPREAD
  // The share of a pass through a mortar's range during which a creep is
  // inside the blast around the mortar's target. The target is whichever
  // creep is nearest the exit, so in a column it is the one about to leave
  // range, and a creep is hit for roughly the last blast-radius of each pass;
  // a pass is at most a diameter long. Measured against a streamed tank
  // flood: this puts a mortar at ~44 damage per tank per lap where the sim
  // shows ~55, and the leak count within 10%.
  const blast = (ARCHETYPES[TowerKind.Splash] as TowerArchetype).splashRadius ?? 1
  const splashRange = levelOf(TowerKind.Splash, 1).range
  const hitZone = blast >= 2 * splashRange ? 1 : blast / (2 * splashRange)

  let leaks = 0
  for (let i = 0; i < roster; i++) {
    const n = counts[i] as number
    if (n <= 0) continue
    const spec = CREEPS[i] as CreepSpec
    let speed = spec.speed * slowFactor
    if (speed < 0.001) speed = 0.001
    const lap = routeLen / speed
    const share = n / total

    // Splash lands on every creep near its target, so what it does to one
    // creep it does to the crowd: the same per-creep damage however many
    // there are. That is what makes it the answer to a flood, and why it is
    // costed per creep rather than shared. Measured: four mortars alone
    // killed 794 of 880 streamed tanks where twenty single-target towers
    // killed 122.
    let splash = 0
    for (let t = 0; t < TILE_COUNT; t++) {
      if (kindAt[t] !== TowerKind.Splash) continue
      const r = reach[t] as number
      if (r === 0) continue
      const lv = levelOf(TowerKind.Splash, levelAt[t] as number)
      const shots = ((r * hitZone) / speed) / (lv.cooldownTicks + 1)
      splash += shots * lv.damage
    }
    if (splash >= spec.hp) continue

    // Everything else kills one creep at a time, and this entry gets its
    // share of the shots by headcount. Splash accrues along the route rather
    // than up front, so a single-target shot lands on a creep carrying about
    // half of it on average.
    const hpLeft = spec.hp - splash * 0.5
    let kills = 0
    for (let t = 0; t < TILE_COUNT; t++) {
      const kind = kindAt[t] as number
      if (kind === -1 || kind === TowerKind.Splash) continue
      const r = reach[t] as number
      if (r === 0) continue
      const lv = levelOf(kind as TowerKind, levelAt[t] as number)
      let firing = (r + stretch) / speed
      if (firing > lap) firing = lap
      const shots = firing / (lv.cooldownTicks + 1)
      kills += (shots * share) / Math.ceil(hpLeft / lv.damage)
    }
    if (n > kills) leaks += n - kills
  }
  return leaks
}

/**
 * Leaks the creeps already walking a lane are predicted to produce.
 *
 * Uses the roster hp rather than each creep's current hp, which errs toward
 * the attacker: a creep half-dead on the far side of the maze is counted as if
 * it had the whole lap ahead of it. The bot wants that bias -- it is asking
 * whether to reinforce, and the cost of a false alarm is a tower it would
 * have built anyway.
 */
export function laneThreat(lane: Lane, route: readonly number[], override: TowerOverride | null = null): number {
  population(lane, lanePop)
  return floodLeaks(route, lane.towers.kind, lane.towers.level, lanePop, override)
}

/**
 * Leaks a wave of `count` creeps of roster entry `creep` would add to a lane,
 * on top of what the lane is predicted to leak already.
 */
export function waveLeaks(lane: Lane, route: readonly number[], creep: number, count: number): number {
  const before = laneThreat(lane, route)
  population(lane, wavePop)
  wavePop[creep] = (wavePop[creep] as number) + count
  const after = floodLeaks(route, lane.towers.kind, lane.towers.level, wavePop)
  return after > before ? after - before : 0
}
