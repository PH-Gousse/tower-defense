import { describe, it, expect } from 'vitest'
import { createState, type GameState } from '../src/state'
import { botCommand, BOT_EASY, BOT_NORMAL, BOT_HARD } from '../src/bot'
import { MAZE_TEMPLATES, templateAt } from '../src/maze'
import { step, Kind, Refusal, checkBuild, checkUpgrade, checkSend } from '../src/step'
import { hashState } from '../src/hash'
import { GRID_W, GRID_H, tileIndex, SPAWN_INDICES } from '../src/grid'
import { buildField, spawnsReachable } from '../src/field'
import { TowerKind } from '../src/data'
import { send, run, tick, TANK, withoutBuildPhase } from './helpers'

// Not a test of the opening: see withoutBuildPhase.
withoutBuildPhase()

describe('maze templates', () => {
  it('never proposes a tile that would seal the lane', () => {
    // A template that seals is a bot that stalls: every decision retries the
    // same refused tile forever.
    for (const t of MAZE_TEMPLATES) {
      const blocked = new Uint8Array(GRID_W * GRID_H)
      for (const tile of t.tiles) {
        blocked[tileIndex(tile)] = 1
        expect(spawnsReachable(buildField(blocked)), `${t.name} at ${tile.x},${tile.y}`).toBe(true)
      }
    }
  })

  it('proposes only in-bounds tiles, never on spawn or exit', () => {
    for (const t of MAZE_TEMPLATES) {
      for (const tile of t.tiles) {
        expect(tile.x).toBeGreaterThanOrEqual(0)
        expect(tile.x).toBeLessThan(GRID_W)
        expect(tile.y).toBeGreaterThanOrEqual(0)
        expect(tile.y).toBeLessThan(GRID_H)
        expect(SPAWN_INDICES).not.toContain(tileIndex(tile))
      }
    }
  })

  it('actually lengthens the walk', () => {
    for (const t of MAZE_TEMPLATES) {
      const blocked = new Uint8Array(GRID_W * GRID_H)
      for (const tile of t.tiles) blocked[tileIndex(tile)] = 1
      const field = buildField(blocked)
      expect(field.dist[SPAWN_INDICES[0] as number] as number, t.name).toBeGreaterThan(GRID_W)
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

  it('only ever emits commands a player could legally submit', () => {
    // The bot gets no special rules, no extra gold and no bent legality.
    let s: GameState = createState()
    for (let t = 0; t < 3000; t++) {
      const cmds = []
      for (const p of [0, 1] as const) {
        const c = botCommand(s, p, p === 0 ? BOT_NORMAL : BOT_HARD)
        if (!c) continue
        if (c.kind === Kind.Build) {
          expect(checkBuild(s, p, c.x, c.y, c.tower).refusal, `tick ${s.tick} build`).toBe(Refusal.None)
        } else if (c.kind === Kind.Upgrade) {
          expect(checkUpgrade(s, p, c.x, c.y), `tick ${s.tick} upgrade`).toBe(Refusal.None)
        } else if (c.kind === Kind.Send) {
          expect(checkSend(s, p, c.creep), `tick ${s.tick} send`).toBe(Refusal.None)
        }
        cmds.push(c)
      }
      s = step(s, cmds, createState())
    }
  })

  it('respects its reaction delay', () => {
    const s = createState()
    // Derived from the config rather than written out. This said "BOT_HARD
    // reacts every 4 ticks" and went red the moment tuning moved it to 3, which
    // is a test failing for the one reason that tells you nothing.
    for (let t = 1; t < BOT_HARD.reactionTicks; t++) {
      const probe = run(t)
      expect(botCommand(probe, 0, BOT_HARD), `tick ${t}`).toBeNull()
    }
    expect(botCommand(s, 0, BOT_HARD)).not.toBeNull()
  })

  it('reinforces the route when a creep is looping in its lane', () => {
    // The emergency state: a creep that has already leaked is the thing to
    // answer, ahead of whatever the template wanted next.
    let s = run(40, { 0: [send(TANK, 1)] })
    // March the tank round until it leaks at least once.
    for (let t = 0; t < 3000 && s.lanes[0]!.creeps.laps[0]! < 1; t++) s = tick(s)
    expect(s.lanes[0]!.creeps.laps[0] as number).toBeGreaterThanOrEqual(1)

    // Align to a decision tick, then the bot must act on its own lane.
    while (s.tick % BOT_NORMAL.reactionTicks !== 0) s = tick(s)
    const cmd = botCommand(s, 0, BOT_NORMAL)
    expect(cmd).not.toBeNull()
    expect(cmd!.kind === Kind.Build || cmd!.kind === Kind.Upgrade).toBe(true)
  })

  it('escalates to higher tiers once they unlock', () => {
    // A bot that only ever spams the cheapest creep never becomes threatening,
    // however much income it accumulates.
    let s = createState()
    ;(s.players[0] as { gold: number }).gold = 100000
    // Player 1 needs to survive past the tier-1 unlock at tick 1200, or the
    // match ends first and the sim freezes. An undefended lane loses in ~780.
    ;(s.players[1] as { lives: number }).lives = 100000
    let sawTier0 = false
    let sawTier1 = false
    for (let t = 0; t < 1600; t++) {
      const c = botCommand(s, 0, BOT_HARD)
      if (c && c.kind === Kind.Send) {
        if (c.creep <= 2) sawTier0 = true
        if (c.creep >= 3) sawTier1 = true
      }
      s = step(s, c ? [c] : [], createState())
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
        const c = botCommand(s, 0, cfg)
        const out = step(s, c ? [c] : [], into)
        into = s
        s = out
      }
      let towers = 0
      for (const k of s.lanes[0]!.towers.kind) if (k !== -1) towers += 1
      return towers
    }
    // Measured before the tower cap binds. The target is now a function of
    // income rather than of the tier clock, and income compounds fast enough
    // that by 12,000 ticks both ratios have hit the 45-tower ceiling and the
    // difference is invisible -- the test read 45 > 45 and failed for a reason
    // that had nothing to do with the behaviour it names.
    expect(towersAfter(0.1, 3600)).toBeGreaterThan(towersAfter(0.9, 3600))
  })

  it('always builds the opening before it sends anything', () => {
    // The floor that stops a high-ratio bot from playing with an empty lane.
    let s: GameState = createState()
    const cfg = { sendRatio: 1, reactionTicks: 4, template: 0 }
    let firstSendTick = -1
    let towersAtFirstSend = -1
    for (let t = 0; t < 1200 && firstSendTick === -1; t++) {
      const c = botCommand(s, 0, cfg)
      if (c?.kind === Kind.Send) {
        firstSendTick = t
        towersAtFirstSend = 0
        for (const k of s.lanes[0]!.towers.kind) if (k !== -1) towersAtFirstSend += 1
      }
      s = step(s, c ? [c] : [], createState())
    }
    expect(firstSendTick).toBeGreaterThan(-1)
    expect(towersAtFirstSend).toBe(6)
  })
})
