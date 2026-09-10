import {
  createState,
  step,
  buildField,
  tileIndex,
  templateAt,
  CREEPS,
  TowerKind,
  Kind,
  laneThreat,
  routeOf,
  population,
  type GameState,
  type Command,
} from '@ltw/sim'

/**
 * `pnpm --filter @ltw/harness flood`
 *
 * The bot's leak model against the sim. Streams one creep type at a maze of
 * the bot's own 3:1:1 mix, and once a lap prints what `laneThreat` predicts
 * for the crowd then in the lane next to the lives that actually leave the
 * board over the following lap.
 *
 * This is the calibration ADR-0016 was fitted on, kept runnable because the
 * model has one fitted constant and any rule change to targeting, splash or
 * speed will move the right answer without failing a single test. Read it
 * for the trend, not the digits: the model must say zero where the sim leaks
 * nothing, and it must start leaking at about the crowd size the sim does.
 *
 * Patches nothing. The lane is fortified by writing the tower arrays directly,
 * which is fine for a tool that never writes anything back.
 */

function fortify(s: GameState, template: number, towers: number, level: number): void {
  const lane = s.lanes[1]!
  const tiles = templateAt(template).tiles
  let placed = 0
  for (let i = 0; i < tiles.length && placed < towers; i++) {
    const idx = tileIndex(tiles[i]!)
    if (lane.blocked[idx] === 1) continue
    const m = i % 5
    const kind = m === 3 ? TowerKind.Splash : m === 4 ? TowerKind.Slow : TowerKind.Single
    lane.blocked[idx] = 1
    lane.towers.kind[idx] = kind
    lane.towers.level[idx] = level
    lane.towers.cooldown[idx] = 0
    placed += 1
  }
  buildField(lane.blocked, lane.field)
}

interface Sample {
  readonly tick: number
  readonly pop: number
  readonly predicted: number
  readonly lives: number
}

function stream(
  template: number,
  towers: number,
  level: number,
  creep: number,
  burst: number,
  every: number,
  ticks: number,
): void {
  let a = createState()
  let b = createState()
  fortify(a, template, towers, level)
  fortify(b, template, towers, level)
  for (const st of [a, b]) {
    ;(st.players[0] as { gold: number }).gold = 1e9
    ;(st.players[1] as { lives: number }).lives = 1_000_000
    // Past the opening, or every send is refused as BuildPhase.
    ;(st as { tick: number }).tick = 100_000
  }
  const spec = CREEPS[creep]!
  const route = routeOf(a.lanes[1]!)
  const lapTicks = Math.round(route.length / spec.speed)
  const pop = new Int32Array(64)
  const t0 = a.tick
  let sampleAt = t0 + lapTicks
  const samples: Sample[] = []
  for (let t = 0; t < ticks + lapTicks * 3; t++) {
    const cmds: Command[] = []
    if (t < ticks && t % every === 0) {
      for (let i = 0; i < burst; i++) cmds.push({ tick: a.tick, player: 0, kind: Kind.Send, creep })
    }
    ;(a.players[0] as { gold: number }).gold = 1e9
    const out = step(a, cmds, b)
    b = a
    a = out
    if (a.tick >= sampleAt) {
      const lane = a.lanes[1]!
      samples.push({ tick: a.tick, pop: population(lane, pop), predicted: laneThreat(lane, route), lives: a.players[1]!.lives })
      sampleAt += lapTicks
    }
    if (t >= ticks && a.lanes[1]!.creeps.count === 0) break
  }
  console.log(
    `\ntemplate ${template}, ${towers} towers L${level}: ${burst} x ${spec.name} every ${every} ticks for ${ticks} ticks` +
      ` (route ${route.length}, lap ${lapTicks} ticks)`,
  )
  console.log('    after      crowd  predicted  leaked in the next lap')
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!
    const next = samples[i + 1]
    const actual = next ? s.lives - next.lives : s.lives - a.players[1]!.lives
    console.log(
      `    t+${String(s.tick - t0).padStart(5)}  ${String(s.pop).padStart(5)}  ${s.predicted.toFixed(1).padStart(9)}  ${String(actual).padStart(6)}`,
    )
  }
}

console.log('\nThe leak model against the sim (ADR-0016). Zero where the sim leaks nothing; rising where it does.')
stream(1, 12, 1, 0, 22, 10, 1500)
stream(1, 20, 1, 0, 22, 10, 2500)
stream(1, 20, 1, 1, 10, 10, 2000)
stream(1, 20, 1, 2, 5, 10, 2000)
stream(1, 30, 2, 5, 3, 10, 3000)
console.log()
