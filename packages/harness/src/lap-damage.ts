import {
  createState, step, buildField, tileIndex, templateAt, mazeLength,
  CREEPS, TowerKind, Kind,
  type GameState, type Command, type CreepSpec,
} from '@ltw/sim'

/**
 * How much damage does one lap of this maze actually deal?
 *
 * The number every creep tier has to be sized against, and it cannot be
 * derived on paper: it depends on how the path threads the towers, how long a
 * creep spends inside each range, and how much of the fire the rest of the wave
 * soaks. So measure it — send one creep with absurd HP, let it complete a lap,
 * and read off what the maze took.
 *
 * The creep row is patched in memory to do it. That is only safe because this
 * is a tuning tool running in its own process and it never writes anything
 * back; nothing here is imported by the sim, the client or the golden fixture.
 */

function fortify(s: GameState, towers: number, level: number): number {
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
  return placed
}

export interface LapDamage {
  readonly towers: number
  readonly level: number
  readonly speed: number
  readonly mazeLength: number
  /** HP removed over one complete lap. A creep needs more than this to leak. */
  readonly damage: number
  readonly lapTicks: number
}

const PROBE_HP = 1_000_000_000

export function measureLapDamage(towers: number, level: number, speed: number): LapDamage {
  // Patch creep 0 into an indestructible probe, then put it back.
  const row = CREEPS[0] as { hp: number; speed: number; count: number; cost: number }
  const saved = { hp: row.hp, speed: row.speed, count: row.count, cost: row.cost }
  row.hp = PROBE_HP
  row.speed = speed
  row.count = 1
  row.cost = 1
  try {
    let a: GameState = createState()
    let b: GameState = createState()
    fortify(a, towers, level)
    fortify(b, towers, level)
    ;(a.players[0] as { gold: number }).gold = 1000
    ;(b.players[0] as { gold: number }).gold = 1000
    ;(a.players[1] as { lives: number }).lives = 1_000_000
    ;(b.players[1] as { lives: number }).lives = 1_000_000

    let cmds: Command[] = [{ tick: 0, player: 0, kind: Kind.Send, creep: 0 }]
    const startLives = a.players[1]!.lives
    let spawnTick = -1
    for (let t = 0; t < 200_000; t++) {
      const out = step(a, cmds, b)
      cmds = []
      b = a
      a = out
      const lane = a.lanes[1]!
      if (spawnTick === -1 && lane.creeps.count > 0) spawnTick = t
      if (startLives - a.players[1]!.lives > 0) {
        const hp = lane.creeps.count > 0 ? (lane.creeps.hp[0] as number) : 0
        return {
          towers, level, speed,
          mazeLength: mazeLength(lane.field),
          damage: PROBE_HP - hp,
          lapTicks: t - spawnTick,
        }
      }
    }
    throw new Error('probe never completed a lap')
  } finally {
    Object.assign(row, saved)
  }
}

export type { CreepSpec }
