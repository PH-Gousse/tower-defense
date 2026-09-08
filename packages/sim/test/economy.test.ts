import { describe, it, expect } from 'vitest'
import { createState, STARTING_GOLD, STARTING_INCOME, INCOME_EVERY_TICKS } from '../src/state'
import { checkSend, checkUpgrade, checkSell, sellValue, Refusal } from '../src/step'
import { TowerKind, levelOf, investedIn, SELL_REFUND, CREEPS, creepSpec, tierUnlockTick, UNLOCK_EVERY_TICKS } from '../src/data'
import { tileIndex } from '../src/grid'
import { build, upgrade, sell, send, run, tick, withGold, SWARM, RUNNER, TANK, SWARM2 } from './helpers'

describe('income', () => {
  it('pays into gold every 15 seconds, not continuously', () => {
    // The decision cadence of the whole game: roughly four times a minute you
    // choose between towers and creeps.
    const before = run(INCOME_EVERY_TICKS - 1)
    const after = run(INCOME_EVERY_TICKS)
    expect(before.players[0]!.gold).toBe(STARTING_GOLD)
    expect(after.players[0]!.gold).toBe(STARTING_GOLD + STARTING_INCOME)
  })

  it('pays both players', () => {
    const s = run(INCOME_EVERY_TICKS)
    expect(s.players[1]!.gold).toBe(STARTING_GOLD + STARTING_INCOME)
  })

  it('pays repeatedly', () => {
    const s = run(INCOME_EVERY_TICKS * 3)
    expect(s.players[0]!.gold).toBe(STARTING_GOLD + STARTING_INCOME * 3)
  })
})

describe('sending raises income', () => {
  it('permanently, and it is the only way income grows', () => {
    const spec = creepSpec(SWARM)
    const s = run(2, { 0: [send(SWARM, 0)] })
    expect(s.players[0]!.income).toBe(STARTING_INCOME + spec.incomeBonus)
    // Still raised much later — the bonus never expires.
    const later = run(INCOME_EVERY_TICKS * 2, { 0: [send(SWARM, 0)] })
    expect(later.players[0]!.income).toBe(STARTING_INCOME + spec.incomeBonus)
  })

  it('charges the sender the creep cost', () => {
    const spec = creepSpec(RUNNER)
    const s = run(2, { 0: [send(RUNNER, 0)] })
    expect(s.players[0]!.gold).toBe(STARTING_GOLD - spec.cost)
  })

  it('compounds: two sends raise income twice', () => {
    const s = run(4, { 0: [send(SWARM, 0)], 2: [send(SWARM, 0)] })
    expect(s.players[0]!.income).toBe(STARTING_INCOME + creepSpec(SWARM).incomeBonus * 2)
  })

  it('turtling loses the money war', () => {
    // The whole strategic claim, asserted. A player who only sends out-earns
    // one who never does, given the same starting position.
    const sender = run(INCOME_EVERY_TICKS * 4, {
      0: [send(SWARM, 0)], 10: [send(SWARM, 0)], 20: [send(SWARM, 0)],
    })
    const turtle = run(INCOME_EVERY_TICKS * 4)
    expect(sender.players[0]!.income).toBeGreaterThan(turtle.players[0]!.income)
  })

  it('refuses a send the sender cannot afford', () => {
    const s = withGold(createState(), 0, 5)
    expect(checkSend(s, 0, TANK)).toBe(Refusal.NotEnoughGold)
  })
})

describe('income per gold', () => {
  it('favours cheaper creeps, which is what makes buying up a threat decision', () => {
    // data.ts asserts this at load; this asserts the assertion is meaningful by
    // checking it against the actual roster rather than trusting the loader.
    const tier0 = CREEPS.filter((c) => c.tier === 0).slice().sort((a, b) => a.cost - b.cost)
    for (let i = 1; i < tier0.length; i++) {
      const cheap = tier0[i - 1]!
      const dear = tier0[i]!
      expect(cheap.incomeBonus / cheap.cost).toBeGreaterThan(dear.incomeBonus / dear.cost)
    }
  })
})

describe('kill bounty', () => {
  it('pays the defender, not the sender', () => {
    // Killing in your own lane is what earns it.
    const cmds = {
      0: [send(SWARM, 1)],
      1: [build(3, 11, TowerKind.Single, 0), build(3, 12, TowerKind.Single, 0)],
    }
    const s = run(600, cmds)
    expect(s.players[0]!.kills).toBeGreaterThan(0)
    const spent = levelOf(TowerKind.Single, 1).cost * 2
    const earnedIncome = STARTING_INCOME * Math.floor(600 / INCOME_EVERY_TICKS)
    const bounty = s.players[0]!.gold - (STARTING_GOLD - spent + earnedIncome)
    expect(bounty).toBeGreaterThan(0)
    expect(bounty).toBe(s.players[0]!.kills * creepSpec(SWARM).bounty)
  })

  it('never exceeds the send cost, or sending would be a gift', () => {
    for (const c of CREEPS) expect(c.bounty).toBeLessThan(c.cost)
  })
})

describe('creep tiers', () => {
  it('locks tier 1 until its unlock tick', () => {
    const s = createState()
    expect(checkSend(s, 0, SWARM)).toBe(Refusal.None)
    expect(checkSend(s, 0, SWARM2)).toBe(Refusal.TierLocked)
  })

  it('unlocks tier 1 on schedule', () => {
    const at = tierUnlockTick(1)
    expect(at).toBe(UNLOCK_EVERY_TICKS)
    const before = run(at - 1)
    const after = run(at)
    expect(checkSend(before, 0, SWARM2)).toBe(Refusal.TierLocked)
    expect(checkSend(withGold(after, 0, 9999), 0, SWARM2)).toBe(Refusal.None)
  })

  it('ignores a locked send rather than charging for it', () => {
    const s = run(3, { 0: [send(SWARM2, 0)] })
    expect(s.players[0]!.gold).toBe(STARTING_GOLD)
    expect(s.players[0]!.income).toBe(STARTING_INCOME)
    expect(s.lanes[1]!.creeps.count).toBe(0)
  })
})

describe('towers and gold', () => {
  it('charges on build and refuses when short', () => {
    const cost = levelOf(TowerKind.Single, 1).cost
    const after = run(2, { 0: [build(5, 5)] })
    expect(after.players[0]!.gold).toBe(STARTING_GOLD - cost)

    const broke = withGold(createState(), 0, cost - 1)
    const out = tick(broke, [build(5, 5)])
    expect(out.lanes[0]!.towers.kind[tileIndex({ x: 5, y: 5 })]).toBe(-1)
    expect(out.players[0]!.gold).toBe(cost - 1)
  })

  it('upgrades through three levels then refuses', () => {
    let s = run(2, { 0: [build(5, 5)] })
    s = tick(s, [upgrade(5, 5)])
    expect(s.lanes[0]!.towers.level[tileIndex({ x: 5, y: 5 })]).toBe(2)
    s = tick(s, [upgrade(5, 5)])
    expect(s.lanes[0]!.towers.level[tileIndex({ x: 5, y: 5 })]).toBe(3)
    expect(checkUpgrade(s, 0, 5, 5)).toBe(Refusal.AlreadyMaxLevel)
  })

  it('refuses upgrade and sell on an empty tile', () => {
    const s = createState()
    expect(checkUpgrade(s, 0, 5, 5)).toBe(Refusal.NoTowerHere)
    expect(checkSell(s, 0, 5, 5)).toBe(Refusal.NoTowerHere)
  })

  it('refunds a fraction of everything invested, and reopens the tile', () => {
    let s = run(2, { 0: [build(5, 5)] })
    s = tick(s, [upgrade(5, 5)])
    const invested = investedIn(TowerKind.Single, 2)
    expect(sellValue(s, 0, 5, 5)).toBe(Math.floor(invested * SELL_REFUND))

    const goldBefore = s.players[0]!.gold
    s = tick(s, [sell(5, 5)])
    expect(s.players[0]!.gold).toBe(goldBefore + Math.floor(invested * SELL_REFUND))
    expect(s.lanes[0]!.towers.kind[tileIndex({ x: 5, y: 5 })]).toBe(-1)
    expect(s.lanes[0]!.blocked[tileIndex({ x: 5, y: 5 })]).toBe(0)
  })

  it('never refunds in full, so rebuilding the maze is never free', () => {
    expect(SELL_REFUND).toBeGreaterThan(0)
    expect(SELL_REFUND).toBeLessThan(1)
  })
})
