import { describe, it, expect } from 'vitest'
import { BOT_EASY, BOT_NORMAL, BOT_HARD, MatchResult, type BotConfig } from '@ltw/sim'
import { runMatch } from '../src/match'

const LADDER: readonly [string, BotConfig][] = [
  ['easy', BOT_EASY],
  ['normal', BOT_NORMAL],
  ['hard', BOT_HARD],
]

describe('bot-vs-bot matches', () => {
  it('resolves rather than stalling', () => {
    // An earlier bot hoarded gold "for emergencies" and produced matches that
    // ran forever, both sides parked on 3 lives. A bot that cannot finish is
    // not an opponent.
    //
    // This covers the shipped presets only, and deliberately so. Below a 0.2
    // spend ratio matches still do not end — both sides reach 20,000 income and
    // 1,800 sends across 33 minutes of game time and stay on 11 lives, because
    // tower upgrades outscale creeps once income compounds. That is a balance
    // problem in the game, not a defect in the bot, and asserting the current
    // behaviour here would freeze it. It is written up for the tuning step
    // instead: see TODOS.md, "defence outscales offence".
    for (const [name, cfg] of LADDER) {
      const m = runMatch({ bots: [cfg, cfg], maxTicks: 24000 })
      expect(m.result, `${name} mirror`).not.toBe(MatchResult.Playing)
    }
  })

  it('is deterministic — the same bots produce the same hash', () => {
    const a = runMatch({ bots: [BOT_NORMAL, BOT_HARD] })
    const b = runMatch({ bots: [BOT_NORMAL, BOT_HARD] })
    expect(a.hash).toBe(b.hash)
    expect(a.ticks).toBe(b.ticks)
  })

  it('gives player 0 no advantage — a mirror match is a draw', () => {
    // Both sides play identically from an identical position, so anything other
    // than a draw would mean the sim favours a seat. Worth asserting directly:
    // it is the cheapest possible check on lane-ordering bugs.
    for (const [name, cfg] of LADDER) {
      const m = runMatch({ bots: [cfg, cfg], maxTicks: 24000 })
      expect(m.result, `${name} mirror`).toBe(MatchResult.Draw)
    }
  })

  it('has a transitive difficulty ladder', () => {
    // The single most important test in the harness, because the ladder has now
    // been wrong twice. First a gold reserve inverted it outright. Then, more
    // subtly, difficulty varied the spend ratio and the maze template as well as
    // the reaction delay — and a sweep showed both of those pointing the wrong
    // way: a higher spend ratio plays WORSE in the current tuning, and the
    // `posts` template is weak enough to sink any config using it. The labels
    // said easy/normal/hard; the measurements said otherwise.
    //
    // If this ever fails, do not adjust the expectation. Re-run the sweep and
    // find out which knob turned around.
    for (let i = 0; i < LADDER.length; i++) {
      for (let j = 0; j < LADDER.length; j++) {
        if (i === j) continue
        const [an, a] = LADDER[i]!
        const [bn, b] = LADDER[j]!
        const m = runMatch({ bots: [a, b], maxTicks: 24000 })
        const strongerIsP0 = i > j
        expect(m.result, `${an} vs ${bn}`).toBe(MatchResult.Decided)
        expect(m.winner, `${an} vs ${bn} — the harder bot should win`).toBe(strongerIsP0 ? 0 : 1)
      }
    }
  })

  it('widens the margin as the difficulty gap widens', () => {
    // Transitivity alone allows a ladder decided by one life every time, which
    // would read as three identical bots. The gap has to be felt.
    const closeGap = runMatch({ bots: [BOT_NORMAL, BOT_HARD], maxTicks: 24000 })
    const wideGap = runMatch({ bots: [BOT_EASY, BOT_HARD], maxTicks: 24000 })
    expect(wideGap.players[1]!.lives).toBeGreaterThan(closeGap.players[1]!.lives)
  })

  it('keeps creep population inside the render budget', () => {
    // Open Q2: population is bounded only by gold, and the renderer has to draw
    // whatever the sim produces.
    const m = runMatch({ bots: [BOT_HARD, BOT_HARD], maxTicks: 24000 })
    expect(m.peakCreeps).toBeLessThan(500)
  })

  it('reports how much of the match was actually contested', () => {
    // Open Q4. Lives only fall, so "the loser never regains a life" is trivially
    // true; what matters is when the gap stopped closing.
    const m = runMatch({ bots: [BOT_EASY, BOT_HARD], maxTicks: 24000 })
    expect(m.result).toBe(MatchResult.Decided)
    expect(m.decidedFraction).toBeGreaterThan(0)
    expect(m.decidedFraction).toBeLessThanOrEqual(1)
  })

  it('both bots build, kill and send — none of them idles', () => {
    const m = runMatch({ bots: [BOT_NORMAL, BOT_NORMAL], maxTicks: 24000 })
    for (let p = 0; p < 2; p++) {
      expect(m.sends[p], `player ${p} sends`).toBeGreaterThan(0)
      expect(m.players[p]!.income, `player ${p} income`).toBeGreaterThan(25)
      expect(m.players[p]!.kills, `player ${p} kills`).toBeGreaterThan(0)
    }
  })
})
