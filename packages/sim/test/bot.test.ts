import { describe, it, expect } from 'vitest'
import { createState, MatchResult, type GameState } from '../src/state'
import { botCommand, BOT_NORMAL, BOT_HARD } from '../src/bot'
import { tierUnlockTick, creepSpec, TowerKind, MAX_LEVEL } from '../src/data'
import { MAZE_TEMPLATES, templateAt } from '../src/maze'
import { step, Kind, Refusal, checkBuild, checkUpgrade, checkSend, type Command } from '../src/step'
import { hashState } from '../src/hash'
import { GRID_W, GRID_H, TOWER_SIZE, FOOTPRINT_CELLS, BUILD_ROW_MIN, BUILD_ROW_MAX, footprintCells, SPAWN_INDICES } from '../src/grid'
import { buildField, spawnsReachable } from '../src/field'
import { send, run, place, SCRAPLING, BOG_BRUTE, withoutBuildPhase } from './helpers'

// Not a test of the opening: see withoutBuildPhase.
withoutBuildPhase()

/**
 * Step with no commands until the tick is a bot decision tick.
 *
 * Bounded, and it asserts the match is still on. A finished match stops
 * advancing the tick, so the obvious `while (tick % reactionTicks)` never
 * exits once a leak ends the game inside the alignment window -- which is
 * what the 2026-09-16 tower rework did to a test that sets a player to one
 * life: the suite hung instead of failing, and a hang names no rule.
 */
function alignToDecision(
  s: GameState,
  into: GameState,
  advance: (s: GameState, into: GameState) => GameState,
): [GameState, GameState] {
  for (let i = 0; i < BOT_NORMAL.reactionTicks && s.tick % BOT_NORMAL.reactionTicks !== 0; i++) {
    const out = advance(s, into)
    into = s
    s = out
  }
  expect(s.result, 'the match ended while aligning to a decision tick').toBe(MatchResult.Playing)
  expect(s.tick % BOT_NORMAL.reactionTicks).toBe(0)
  return [s, into]
}

const cells = new Int32Array(FOOTPRINT_CELLS)
function occupy(blocked: Uint8Array, ax: number, ay: number): void {
  footprintCells(ax, ay, cells)
  for (let k = 0; k < FOOTPRINT_CELLS; k++) blocked[cells[k] as number] = 1
}

describe('maze templates', () => {
  it('never proposes an anchor that would seal the lane', () => {
    // A template that seals is a bot that stalls: every decision retries the
    // same refused anchor forever.
    for (const t of MAZE_TEMPLATES) {
      const blocked = new Uint8Array(GRID_W * GRID_H)
      for (const tile of t.tiles) {
        occupy(blocked, tile.x, tile.y)
        expect(spawnsReachable(buildField(blocked)), `${t.name} at ${tile.x},${tile.y}`).toBe(true)
      }
    }
  })

  it('proposes only anchors whose footprint is inside the buildable rows', () => {
    for (const t of MAZE_TEMPLATES) {
      for (const tile of t.tiles) {
        expect(tile.x).toBeGreaterThanOrEqual(0)
        expect(tile.x + TOWER_SIZE).toBeLessThanOrEqual(GRID_W)
        expect(tile.y).toBeGreaterThanOrEqual(BUILD_ROW_MIN)
        expect(tile.y + TOWER_SIZE - 1).toBeLessThanOrEqual(BUILD_ROW_MAX)
      }
    }
  })

  it('never proposes two anchors whose footprints overlap', () => {
    for (const t of MAZE_TEMPLATES) {
      const blocked = new Uint8Array(GRID_W * GRID_H)
      for (const tile of t.tiles) {
        footprintCells(tile.x, tile.y, cells)
        for (let k = 0; k < FOOTPRINT_CELLS; k++) expect(blocked[cells[k] as number], t.name).toBe(0)
        occupy(blocked, tile.x, tile.y)
      }
    }
  })

  it('actually lengthens the walk', () => {
    for (const t of MAZE_TEMPLATES) {
      const blocked = new Uint8Array(GRID_W * GRID_H)
      for (const tile of t.tiles) occupy(blocked, tile.x, tile.y)
      const field = buildField(blocked)
      const bare = buildField(new Uint8Array(GRID_W * GRID_H))
      expect(field.dist[SPAWN_INDICES[0] as number] as number, t.name).toBeGreaterThan(
        (bare.dist[SPAWN_INDICES[0] as number] as number) + GRID_W,
      )
    }
  })

  it('wraps the index rather than returning undefined', () => {
    expect(templateAt(MAZE_TEMPLATES.length).name).toBe(MAZE_TEMPLATES[0]!.name)
  })
})

describe('bot', () => {
  it('emits commands and never mutates state', () => {
    // The whole reason the bot returns commands: a bot match replays from its
    // log on any future version, and the bot is testable in isolation.
    const s = createState()
    const before = hashState(s)
    botCommand(s, 0, BOT_NORMAL)
    botCommand(s, 1, BOT_HARD)
    expect(hashState(s)).toBe(before)
  })

  it.each([
    ['estimate', BOT_NORMAL, BOT_HARD],
    ['table', { ...BOT_NORMAL, reader: 'table' as const }, { ...BOT_HARD, reader: 'table' as const }],
  ])('only ever emits commands a player could legally submit (%s reader)', (_name, a, b) => {
    // The bot gets no special rules, no extra gold and no bent legality.
    // Double-buffered rather than a fresh state per tick. MAX_CREEPS sizes ten
    // typed arrays per lane, so a state is megabytes now, and allocating one
    // every tick took this file from 1.4s to 4.4s on its own.
    let s: GameState = createState()
    let into: GameState = createState()
    for (let t = 0; t < 3000; t++) {
      const cmds = []
      for (const p of [0, 1] as const) {
        for (const c of botCommand(s, p, p === 0 ? a : b)) {
          if (c.kind === Kind.Build) {
            expect(checkBuild(s, p, c.x, c.y, c.tower).refusal, `tick ${s.tick} build`).toBe(Refusal.None)
          } else if (c.kind === Kind.Upgrade) {
            expect(checkUpgrade(s, p, c.x, c.y), `tick ${s.tick} upgrade`).toBe(Refusal.None)
          } else if (c.kind === Kind.Send) {
            expect(checkSend(s, p, c.creep), `tick ${s.tick} send`).toBe(Refusal.None)
          }
          cmds.push(c)
        }
      }
      const out = step(s, cmds, into)
      into = s
      s = out
    }
  })

  it('respects its reaction delay', () => {
    const s = createState()
    // Derived from the config rather than written out. This said "BOT_HARD
    // reacts every 4 ticks" and went red the moment tuning moved it to 3, which
    // is a test failing for the one reason that tells you nothing.
    for (let t = 1; t < BOT_HARD.reactionTicks; t++) {
      const probe = run(t)
      expect(botCommand(probe, 0, BOT_HARD), `tick ${t}`).toEqual([])
    }
    expect(botCommand(s, 0, BOT_HARD).length).toBeGreaterThan(0)
  })

  it('reinforces the route when a creep is looping in its lane', () => {
    // The emergency state: a creep that has already leaked is the thing to
    // answer, ahead of whatever the template wanted next.
    // The first rung: the only creep open at tick 0 on the ladder (ADR-0031),
    // and any creep that laps an empty lane is the emergency this pins.
    let s = run(40, { 0: [send(SCRAPLING, 1)] })
    // Rotating a pair rather than calling the `tick` helper, which allocates a
    // whole state per call: this marches up to 3000 ticks, and a state is
    // megabytes once MAX_CREEPS is sized past what gold can buy.
    let into: GameState = createState()
    const advance = (from: GameState): GameState => {
      const out = step(from, [], into)
      into = from
      return out
    }
    // March the creep round until it leaks at least once. The horizon is a
    // lap and a half at its speed, not a literal from the old board.
    const horizon = Math.ceil((1.5 * GRID_H) / creepSpec(SCRAPLING).speed)
    for (let t = 0; t < horizon && s.lanes[0]!.creeps.laps[0]! < 1; t++) s = advance(s)
    expect(s.lanes[0]!.creeps.laps[0] as number).toBeGreaterThanOrEqual(1)

    // Align to a decision tick, then the bot must act on its own lane.
    ;[s] = alignToDecision(s, s, (st) => advance(st))
    const cmds = botCommand(s, 0, BOT_NORMAL)
    // An emergency yields one tile, not a burst: a maze is placed a tile at a
    // time and the next one depends on where the last went.
    expect(cmds).toHaveLength(1)
    const cmd = cmds[0]!
    expect(cmd.kind === Kind.Build || cmd.kind === Kind.Upgrade).toBe(true)
  })

  it('escalates to higher tiers once they unlock', () => {
    // A bot that only ever spams the cheapest creep never becomes threatening,
    // however much income it accumulates.
    let s = createState()
    ;(s.players[0] as { gold: number }).gold = 100000
    // Player 1 needs to survive past the tier-1 unlock, or the match ends first
    // and the sim freezes. An undefended lane loses in ~780 ticks.
    ;(s.players[1] as { lives: number }).lives = 100000
    let sawTier0 = false
    let sawTier1 = false
    let into: GameState = createState()
    // Run to the unlock plus a margin, derived rather than written down. This
    // was 1600 ticks, which was the old 600-tick unlock plus room; the ladder
    // now opens tier 1 five minutes in, and a hardcoded horizon turns "the bot
    // never escalated" into a test about how long the loop happened to run.
    //
    // To tier 2, not tier 1, since the ladder (ADR-0031): the counter-pick may
    // take a creep one rung down (SHAPE_BAND), so while only rungs 0 and 1 are
    // open the flood model may rightly keep choosing rung 0. Escalation is
    // guaranteed once rung 0 falls out of the band, which is when rung 2 opens.
    const horizon = tierUnlockTick(2) + 1000
    for (let t = 0; t < horizon; t++) {
      const cmds = botCommand(s, 0, BOT_HARD)
      for (const c of cmds) {
        if (c.kind !== Kind.Send) continue
        // By tier, not by index: on the three-by-three roster indices 0-2 were
        // tier 0; on the ladder every index is its own tier.
        if (creepSpec(c.creep).tier === 0) sawTier0 = true
        if (creepSpec(c.creep).tier >= 1) sawTier1 = true
      }
      const out = step(s, cmds, into)
      into = s
      s = out
      ;(s.players[0] as { gold: number }).gold = 100000
      ;(s.players[1] as { lives: number }).lives = 100000
    }
    expect(sawTier0).toBe(true)
    expect(sawTier1).toBe(true)
  })

  it('spends the ratio: a low ratio builds a bigger maze than a high one', () => {
    // This assertion has been rewritten twice as the meaning of the ratio was
    // corrected, and the history is the point. It first read "ratio 1 sends more
    // creeps than ratio 0", which stopped being true when the ratio began
    // splitting gold rather than decisions: a ratio of 1 hands the whole purse
    // to `bestSend`, which buys the heaviest creep it can reach, so it sends
    // FEWER and bigger waves. Send count was measuring the creep table.
    //
    // The ratio now sets how big a maze counts as enough for the tier, so the
    // maze is what to measure.
    const towersAfter = (ratio: number, ticks: number) => {
      let s: GameState = createState()
      // The undefended opponent has to survive, or the match ends inside the
      // first minute and the state freezes with the opening maze still on the
      // board -- which reads as "the ratio does nothing" and is really "nothing
      // was measured". This cost an hour once.
      let into: GameState = createState()
      for (const st of [s, into]) (st.players[1] as { lives: number }).lives = 1_000_000
      const cfg = { sendRatio: ratio, reactionTicks: 12, template: 0 }
      // Double-buffered rather than a fresh state per tick: at 24,000 ticks the
      // allocation alone blew the test timeout.
      for (let t = 0; t < ticks; t++) {
        const out = step(s, botCommand(s, 0, cfg), into)
        into = s
        s = out
      }
      return s.lanes[0]!.towers.count
    }
    // Measured before the tower cap binds. The target is now a function of
    // income rather than of the tier clock, and income compounds fast enough
    // that by 12,000 ticks both ratios have hit the 45-tower ceiling and the
    // difference is invisible -- the test read 45 > 45 and failed for a reason
    // that had nothing to do with the behaviour it names.
    expect(towersAfter(0.1, 3600)).toBeGreaterThan(towersAfter(0.9, 3600))
  })

  it('sends the wave that ends the match the moment it can, instead of building', () => {
    // The model says twenty-two tanks walk through a six-tower opening, and
    // the opponent is on their last life. A bot that keeps building here has
    // a maze and no match.
    let s: GameState = createState()
    let into: GameState = createState()
    for (let t = 0; t < 400; t++) {
      const cmds = [...botCommand(s, 0, BOT_NORMAL), ...botCommand(s, 1, BOT_NORMAL)]
      const out = step(s, cmds, into)
      into = s
      s = out
    }
    ;(s.players[1] as { lives: number }).lives = 1
    ;(s.players[0] as { gold: number }).gold = 20_000
    ;[s, into] = alignToDecision(s, into, (st, buf) => step(st, [], buf))
    const cmds = botCommand(s, 0, BOT_NORMAL)
    expect(cmds.length).toBeGreaterThan(0)
    expect(cmds.every((c) => c.kind === Kind.Send)).toBe(true)
    // And the same purse with the opponent out of reach goes into the maze
    // first. "Out of reach" rather than "healthy": on this lane an opening
    // wall on the first buildable row cannot touch creeps walking the top of
    // the spawn zone, so the model reads twenty lives as one wave away and is
    // right to. A thousand lives is what "no wave ends this" looks like.
    ;(s.players[1] as { lives: number }).lives = 1000
    const calm = botCommand(s, 0, BOT_NORMAL)
    expect(calm.some((c) => c.kind === Kind.Build || c.kind === Kind.Upgrade)).toBe(true)
  })

  it('reinforces before a predicted flood leaks, not after', () => {
    // Sixty tanks land in the bot's lane on one tick. None has lapped, so the
    // emergency branch is silent; only the model can see what is coming. The
    // table reader would spend this decision on its template. Both bots play
    // the warm-up so the opponent has a maze too -- against an empty lane the
    // lethal branch fires first, and rightly.
    let s: GameState = createState()
    let into: GameState = createState()
    // Warm up until the flood's creep is open: on the ladder (ADR-0031) the
    // armoured probe is rung 2, and a flood sent at tick 400 was refused as
    // TierLocked, so the lane held nothing for the model to see.
    const warmUp = Math.max(400, tierUnlockTick(creepSpec(BOG_BRUTE).tier))
    for (let t = 0; t < warmUp; t++) {
      const cmds = [...botCommand(s, 0, BOT_NORMAL), ...botCommand(s, 1, BOT_NORMAL)]
      const out = step(s, cmds, into)
      into = s
      s = out
    }
    ;(s.players[1] as { gold: number }).gold = 1_000_000
    const flood: Command[] = []
    for (let i = 0; i < 60; i++) flood.push({ tick: s.tick, player: 1, kind: Kind.Send, creep: BOG_BRUTE })
    let out = step(s, flood, into)
    into = s
    s = out
    ;[s, into] = alignToDecision(s, into, (st, buf) => step(st, [], buf))
    ;(s.players[0] as { gold: number }).gold = 5_000
    // The opponent is out of reach of any wave this purse buys (see the
    // lethal-wave test above for why twenty lives is not), so the decision is
    // about the bot's own lane.
    ;(s.players[1] as { lives: number }).lives = 1000
    // At least the sixty; the opponent's own opening sends may be in the lane
    // too. None of them has lapped, which is what keeps the emergency branch out.
    const inLane = s.lanes[0]!.creeps
    expect(inLane.count).toBeGreaterThanOrEqual(60)
    for (let i = 0; i < inLane.count; i++) expect(inLane.laps[i]).toBe(0)
    const cmds = botCommand(s, 0, BOT_NORMAL)
    expect(cmds).toHaveLength(1)
    const c = cmds[0]!
    expect(c.kind === Kind.Build || c.kind === Kind.Upgrade).toBe(true)
    // Turned off, the same board gets the ordinary decision.
    const off = botCommand(s, 0, { ...BOT_NORMAL, adaptive: 'send' })
    expect(off.length).toBeGreaterThan(0)
  })

  it('keeps sending while a creep laps a maze it can no longer reinforce', () => {
    // The emergency branch falls through "rather than idling: sending back is
    // still better than doing nothing" -- and until 2026-09-17 both readers then
    // refused to send while the emergency stood, so a full, fully upgraded maze
    // froze the bot for the rest of the match. Measured at ratio 0.25 (#52): it
    // led on income and lives, then banked 14,583 gold while losing its last six.
    for (const reader of ['table', 'estimate'] as const) {
      let s: GameState = createState()
      ;(s as { tick: number }).tick = tierUnlockTick(2) + 1000
      const lane = s.lanes[0]!
      // Every legal anchor, row-major, at the top level: nothing left to
      // build and nothing left to upgrade.
      ;(s.players[0] as { gold: number }).gold = 1_000_000
      for (let ay = BUILD_ROW_MIN; ay <= BUILD_ROW_MAX; ay++) {
        for (let ax = 0; ax + TOWER_SIZE <= GRID_W; ax++) {
          if (checkBuild(s, 0, ax, ay, TowerKind.Single).refusal !== Refusal.None) continue
          place(s, 0, ax, ay, TowerKind.Single, MAX_LEVEL)
        }
      }
      // An unkillable creep that has already lapped: the emergency.
      ;(s.players[1] as { gold: number }).gold = creepSpec(SCRAPLING).cost
      let into: GameState = createState()
      let out = step(s, [{ tick: s.tick, player: 1, kind: Kind.Send, creep: SCRAPLING }], into)
      into = s
      s = out
      expect(s.lanes[0]!.creeps.count).toBe(1)
      s.lanes[0]!.creeps.hp[0] = 1_000_000_000
      s.lanes[0]!.creeps.laps[0] = 1
      ;(s.players[0] as { lives: number }).lives = 1000
      ;(s.players[0] as { gold: number }).gold = 1_000_000
      ;[s, into] = alignToDecision(s, into, (st, buf) => step(st, [], buf))
      expect(lane.towers.count, 'the maze was filled').toBeGreaterThan(0)

      const cmds = botCommand(s, 0, { ...BOT_NORMAL, reader })
      expect(cmds.length, `${reader}: the bot did something`).toBeGreaterThan(0)
      expect(cmds.every((c) => c.kind === Kind.Send), `${reader}: and it was a send`).toBe(true)
    }
  })

  it('always builds the opening before it sends anything', () => {
    // The floor that stops a high-ratio bot from playing with an empty lane.
    let s: GameState = createState()
    const cfg = { sendRatio: 1, reactionTicks: 4, template: 0 }
    let firstSendTick = -1
    let towersAtFirstSend = -1
    let into: GameState = createState()
    for (let t = 0; t < 1200 && firstSendTick === -1; t++) {
      const cmds = botCommand(s, 0, cfg)
      if (cmds.some((c) => c.kind === Kind.Send)) {
        firstSendTick = t
        towersAtFirstSend = s.lanes[0]!.towers.count
      }
      const out = step(s, cmds, into)
      into = s
      s = out
    }
    expect(firstSendTick).toBeGreaterThan(-1)
    expect(towersAtFirstSend).toBe(6)
  })
})
