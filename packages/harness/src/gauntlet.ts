import {
  createState,
  step,
  buildField,
  mazeLength,
  tileIndex,
  templateAt,
  CREEPS,
  creepSpec,
  levelOf,
  TowerKind,
  Kind,
  type GameState,
  type Command,
  type CreepSpec,
} from '@ltw/sim'

/**
 * Can this creep survive that maze?
 *
 * The single question tuning turns on, answered with the real simulation rather
 * than with a damage model. A model would have to guess at aggro soak, splash
 * overlap and slow stacking, and guessing at exactly the things that are hard
 * to reason about is how you tune a game into a shape that only exists in the
 * spreadsheet.
 *
 * So: build a maze of `towers` towers all at `level`, send one purchase of one
 * creep type into it, and run until every creep of that purchase is dead or has
 * completed a lap. Report which.
 */

export interface GauntletResult {
  readonly creep: string
  readonly tier: number
  readonly towers: number
  readonly level: number
  /** Tiles the walk takes with this maze in place. */
  readonly mazeLength: number
  /** Of one purchase (`count` creeps), how many completed a lap. */
  readonly leaked: number
  readonly sent: number
  /** Ticks until the last one died, or until the first leak. */
  readonly ticks: number
  /** Fraction of the creep's HP the maze removed, for the ones that died. */
  readonly hpFraction: number
}

/**
 * Build a defence into lane 1 by hand.
 *
 * Placement follows the same serpentine template the bot uses, so the number is
 * comparable to a maze a player would actually build, and it upgrades in place
 * rather than spreading, because that is what a defender under pressure does.
 */
function fortify(s: GameState, towers: number, level: number): void {
  const lane = s.lanes[1]!
  const template = templateAt(0)
  let placed = 0
  for (let i = 0; i < template.tiles.length && placed < towers; i++) {
    const t = template.tiles[i]!
    const idx = tileIndex(t)
    if (lane.blocked[idx] === 1) continue
    lane.blocked[idx] = 1
    lane.towers.kind[idx] = TowerKind.Single
    lane.towers.level[idx] = level
    lane.towers.cooldown[idx] = 0
    placed += 1
  }
  buildField(lane.blocked, lane.field)
}

export function runGauntlet(creepIndex: number, towers: number, level: number): GauntletResult {
  const spec: CreepSpec = creepSpec(creepIndex)
  let a: GameState = createState()
  let b: GameState = createState()
  fortify(a, towers, level)
  fortify(b, towers, level)

  // Player 0 sends into lane 1. Gold and the tier clock are not the subject
  // here, so give it enough of both that the purchase always goes through.
  ;(a.players[0] as { gold: number }).gold = 1_000_000
  ;(b.players[0] as { gold: number }).gold = 1_000_000
  ;(a.players[1] as { lives: number }).lives = 1_000_000
  ;(b.players[1] as { lives: number }).lives = 1_000_000
  ;(a as { tick: number }).tick = 100_000
  ;(b as { tick: number }).tick = 100_000

  const send: Command = { tick: a.tick, player: 0, kind: Kind.Send, creep: creepIndex }
  let cmds: Command[] = [send]

  const startLives = a.players[1]!.lives
  let ticks = 0
  let minHpSeen = 1
  const limit = 20_000
  for (let t = 0; t < limit; t++) {
    const out = step(a, cmds, b)
    cmds = []
    b = a
    a = out
    ticks = t + 1

    const lane = a.lanes[1]!
    const c = lane.creeps
    // Track how close the survivors are to dying, which is what says whether a
    // near miss was near.
    for (let i = 0; i < c.count; i++) {
      const frac = (c.hp[i] as number) / spec.hp
      if (frac < minHpSeen) minHpSeen = frac
    }
    const leaked = startLives - a.players[1]!.lives
    // Stop at the first leak (the creep survived) or when the wave is gone.
    if (leaked > 0) return result(spec, towers, level, a, leaked, ticks, minHpSeen)
    if (t > 20 && c.count === 0 && lane.queueHead === lane.queueTail) {
      return result(spec, towers, level, a, 0, ticks, minHpSeen)
    }
  }
  return result(spec, towers, level, a, startLives - a.players[1]!.lives, ticks, minHpSeen)
}

function result(
  spec: CreepSpec,
  towers: number,
  level: number,
  s: GameState,
  leaked: number,
  ticks: number,
  minHp: number,
): GauntletResult {
  return {
    creep: spec.name,
    tier: spec.tier,
    towers,
    level,
    mazeLength: mazeLength(s.lanes[1]!.field),
    leaked,
    sent: spec.count,
    ticks,
    hpFraction: 1 - minHp,
  }
}

/** Every creep against a ladder of defences. The table tuning is read from. */
export function gauntletTable(
  defences: readonly (readonly [towers: number, level: number])[],
): GauntletResult[] {
  const out: GauntletResult[] = []
  for (let i = 0; i < CREEPS.length; i++) {
    for (const [towers, level] of defences) out.push(runGauntlet(i, towers, level))
  }
  return out
}

export { levelOf }
