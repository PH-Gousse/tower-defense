import { describe, it, expect } from 'vitest'
import { createState, STARTING_GOLD, STARTING_INCOME, INCOME_EVERY_TICKS, MAX_CREEPS } from '../src/state'
import { checkSend, checkUpgrade, checkSell, sellValue, Refusal } from '../src/step'
import { TowerKind, levelOf, investedIn, SELL_REFUND, CREEPS, creepSpec, tierUnlockTick, UNLOCK_EVERY_TICKS } from '../src/data'
import { towerSlotAt } from '../src/state'
import { tileIndex } from '../src/grid'
import { build, upgrade, sell, send, run, tick, withGold, R, SCRAPLING, DASHER_HOUND, EMBER_IMP, withoutBuildPhase } from './helpers'

// Not a test of the opening: see withoutBuildPhase.
withoutBuildPhase()

describe('the opening purse (user, 2026-09-16)', () => {
  // Gold is stored as the player sees it (creeps.json v11).
  const GOLD = 1

  it('starts a match on 100 gold and 10 gold a period', () => {
    const s = createState()
    for (const p of s.players) {
      expect(p.gold).toBe(100 * GOLD)
      expect(p.income).toBe(10 * GOLD)
    }
  })

  it('buys exactly ten level-1 towers with the opening purse', () => {
    expect(Math.floor(STARTING_GOLD / levelOf(TowerKind.Single, 1).cost)).toBe(10)
  })
})

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
    const spec = creepSpec(SCRAPLING)
    const s = run(2, { 0: [send(SCRAPLING, 0)] })
    expect(s.players[0]!.income).toBe(STARTING_INCOME + spec.incomeBonus)
    // Still raised much later — the bonus never expires.
    const later = run(INCOME_EVERY_TICKS * 2, { 0: [send(SCRAPLING, 0)] })
    expect(later.players[0]!.income).toBe(STARTING_INCOME + spec.incomeBonus)
  })

  it('charges the sender the creep cost', () => {
    // The first rung: the only creep open at tick 0 on the ladder (ADR-0031).
    const spec = creepSpec(SCRAPLING)
    const s = run(2, { 0: [send(SCRAPLING, 0)] })
    expect(s.players[0]!.gold).toBe(STARTING_GOLD - spec.cost)
  })

  it('compounds: two sends raise income twice', () => {
    const s = run(4, { 0: [send(SCRAPLING, 0)], 2: [send(SCRAPLING, 0)] })
    expect(s.players[0]!.income).toBe(STARTING_INCOME + creepSpec(SCRAPLING).incomeBonus * 2)
  })

  it('turtling loses the money war', () => {
    // The whole strategic claim, asserted. A player who only sends out-earns
    // one who never does, given the same starting position.
    const sender = run(INCOME_EVERY_TICKS * 4, {
      0: [send(SCRAPLING, 0)], 10: [send(SCRAPLING, 0)], 20: [send(SCRAPLING, 0)],
    })
    const turtle = run(INCOME_EVERY_TICKS * 4)
    expect(sender.players[0]!.income).toBeGreaterThan(turtle.players[0]!.income)
  })

  it('refuses a send the sender cannot afford', () => {
    // An open rung, so the refusal is the purse and not the unlock clock.
    const s = withGold(createState(), 0, creepSpec(SCRAPLING).cost - 1)
    expect(checkSend(s, 0, SCRAPLING)).toBe(Refusal.NotEnoughGold)
  })
})

describe('the creep ladder (ADR-0031)', () => {
  // Gold is stored as the player sees it (creeps.json v11).
  const GOLD = 1

  it("prices the first four rungs exactly as the user gave them", () => {
    const given = [
      [5, 1, 1],
      [10, 2, 2],
      [22, 4, 4],
      [50, 8, 8],
    ] as const
    given.forEach(([cost, income, bounty], i) => {
      const c = creepSpec(i)
      expect([c.cost, c.incomeBonus, c.bounty], c.name).toEqual([cost * GOLD, income * GOLD, bounty * GOLD])
    })
  })

  it('has fourteen rungs, one per tier, cheapest first', () => {
    expect(CREEPS).toHaveLength(14)
    CREEPS.forEach((c, i) => expect(c.tier, c.name).toBe(i))
  })

  it('cycles horde, fast, armoured up the ladder', () => {
    CREEPS.forEach((c, i) => expect(c.archetype, c.name).toBe(i % 3))
  })

  it('pays the killer what the sender earns, from the first rung to the last', () => {
    for (const c of CREEPS) expect(c.bounty, c.name).toBe(c.incomeBonus)
  })

  it('gives the most HP per gold to armoured creeps and the least to fast ones, rung for rung', () => {
    // Equal threat per gold: time in range goes as 1/speed. Compare neighbours,
    // so the 1.1-a-rung growth cannot stand in for the shape.
    for (let i = 0; i + 2 < CREEPS.length; i += 3) {
      const horde = CREEPS[i]!
      const fast = CREEPS[i + 1]!
      const armoured = CREEPS[i + 2]!
      expect(armoured.hp / armoured.cost).toBeGreaterThan(horde.hp / horde.cost)
      expect(fast.hp / fast.cost).toBeLessThan(horde.hp / horde.cost)
      expect(fast.speed).toBeGreaterThan(horde.speed)
      expect(armoured.speed).toBeLessThan(horde.speed)
    }
  })
})

describe('income per gold', () => {
  it('favours cheaper creeps, which is what makes buying up a threat decision', () => {
    // data.ts asserts this at load; this asserts the assertion is meaningful by
    // checking it against the actual roster rather than trusting the loader.
    // On the ladder (ADR-0031) it holds rung by rung, and strictly from the
    // second rung up: the user's first two creeps tie at 20%.
    for (let i = 2; i < CREEPS.length; i++) {
      const cheap = CREEPS[i - 1]!
      const dear = CREEPS[i]!
      expect(cheap.cost).toBeLessThan(dear.cost)
      expect(cheap.incomeBonus / cheap.cost).toBeGreaterThan(dear.incomeBonus / dear.cost)
    }
  })
})

describe('kill bounty', () => {
  it('pays the defender, not the sender', () => {
    // Killing in your own lane is what earns it.
    //
    // The towers sit on the left edge. The swarm spawns in column 0 and is
    // routed around them, so it passes one tile from their footprints -- well
    // inside range, rather than at exactly range as an earlier layout had it,
    // where whether the tower fired turned on the creep's sub-tile phase.
    const cmds = {
      0: [send(SCRAPLING, 1)],
      1: [build(0, R + 2, TowerKind.Single, 0), build(0, R + 4, TowerKind.Single, 0)],
    }
    const s = run(900, cmds)
    expect(s.players[0]!.kills).toBeGreaterThan(0)
    const spent = levelOf(TowerKind.Single, 1).cost * 2
    const earnedIncome = STARTING_INCOME * Math.floor(900 / INCOME_EVERY_TICKS)
    const bounty = s.players[0]!.gold - (STARTING_GOLD - spent + earnedIncome)
    expect(bounty).toBeGreaterThan(0)
    expect(bounty).toBe(s.players[0]!.kills * creepSpec(SCRAPLING).bounty)
  })

  it('never exceeds the send cost, or sending would be a gift', () => {
    for (const c of CREEPS) expect(c.bounty).toBeLessThan(c.cost)
  })
})

describe('a refused send costs nothing', () => {
  /**
   * The bug this pins used to be reachable and silent.
   *
   * `applyCommands` debits gold and grants income, and only THEN puts creeps in
   * the lane. Every capacity check lived at the spawn, so a lane that could not
   * hold the creep took the money, granted the permanent income, and dropped
   * the creep without a word. It was unreachable while the cap was 512 queued
   * and 2048 live; it stopped being unreachable the moment sends became
   * unpaced. `checkSend` now answers the capacity question before any gold
   * moves, which is where the other nine refusals already lived.
   */
  it('refuses when the target lane is full, before taking the gold', () => {
    const s = createState()
    s.tick = 1
    // Fill the lane player 0 sends into. Player 0 sends, so that is lane 1.
    s.lanes[1]!.creeps.count = MAX_CREEPS
    expect(checkSend(s, 0, SCRAPLING)).toBe(Refusal.LaneFull)

    // Gold and income are the whole assertion. Not the creep count: these 2048
    // are a raised `count` over zeroed arrays, so they read as 0 HP and
    // `removeDead` compacts every one of them away inside the same tick. That
    // is an artefact of the fake, and asserting on it would be asserting on the
    // scaffolding rather than on the refusal.
    const goldBefore = s.players[0]!.gold
    const incomeBefore = s.players[0]!.income
    const out = tick(s, [send(SCRAPLING, 0)])
    expect(out.players[0]!.gold).toBe(goldBefore)
    expect(out.players[0]!.income).toBe(incomeBefore)
  })

  it('allows the send that exactly fills the lane', () => {
    // Off-by-one in the other direction: refusing at capacity minus one would
    // quietly cost the last creep the lane can actually hold.
    const s = createState()
    s.tick = 1
    s.lanes[1]!.creeps.count = MAX_CREEPS - creepSpec(SCRAPLING).count
    expect(checkSend(s, 0, SCRAPLING)).toBe(Refusal.None)
  })
})

describe('creep tiers', () => {
  it('locks tier 1 until its unlock tick', () => {
    const s = createState()
    expect(checkSend(s, 0, SCRAPLING)).toBe(Refusal.None)
    expect(checkSend(s, 0, EMBER_IMP)).toBe(Refusal.TierLocked)
  })

  it('unlocks tier 1 on schedule', () => {
    const at = tierUnlockTick(1)
    expect(at).toBe(UNLOCK_EVERY_TICKS)
    const before = run(at - 1)
    const after = run(at)
    // Rung 1 is tier 1 on the ladder.
    expect(creepSpec(DASHER_HOUND).tier).toBe(1)
    expect(checkSend(before, 0, DASHER_HOUND)).toBe(Refusal.TierLocked)
    expect(checkSend(withGold(after, 0, 9999), 0, DASHER_HOUND)).toBe(Refusal.None)
  })

  it('ignores a locked send rather than charging for it', () => {
    const s = run(3, { 0: [send(EMBER_IMP, 0)] })
    expect(s.players[0]!.gold).toBe(STARTING_GOLD)
    expect(s.players[0]!.income).toBe(STARTING_INCOME)
    expect(s.lanes[1]!.creeps.count).toBe(0)
  })
})

describe('towers and gold', () => {
  it('charges on build and refuses when short', () => {
    const cost = levelOf(TowerKind.Single, 1).cost
    const after = run(2, { 0: [build(4, R + 4)] })
    expect(after.players[0]!.gold).toBe(STARTING_GOLD - cost)

    const broke = withGold(createState(), 0, cost - 1)
    const out = tick(broke, [build(4, R + 4)])
    expect(towerSlotAt(out.lanes[0]!, 4, R + 4)).toBe(-1)
    expect(out.players[0]!.gold).toBe(cost - 1)
  })

  it('upgrades through three levels then refuses', () => {
    let s = run(2, { 0: [build(4, R + 4)] })
    s = tick(s, [upgrade(4, R + 4)])
    expect(s.lanes[0]!.towers.level[towerSlotAt(s.lanes[0]!, 4, R + 4)]).toBe(2)
    s = tick(s, [upgrade(4, R + 4)])
    expect(s.lanes[0]!.towers.level[towerSlotAt(s.lanes[0]!, 4, R + 4)]).toBe(3)
    expect(checkUpgrade(s, 0, 4, R + 4)).toBe(Refusal.AlreadyMaxLevel)
  })

  it('refuses upgrade and sell on an empty tile', () => {
    const s = createState()
    expect(checkUpgrade(s, 0, 4, R + 4)).toBe(Refusal.NoTowerHere)
    expect(checkSell(s, 0, 4, R + 4)).toBe(Refusal.NoTowerHere)
  })

  it('refunds a fraction of everything invested, and reopens the tile', () => {
    let s = run(2, { 0: [build(4, R + 4)] })
    s = tick(s, [upgrade(4, R + 4)])
    const invested = investedIn(TowerKind.Single, 2)
    expect(sellValue(s, 0, 4, R + 4)).toBe(Math.floor(invested * SELL_REFUND))

    const goldBefore = s.players[0]!.gold
    s = tick(s, [sell(4, R + 4)])
    expect(s.players[0]!.gold).toBe(goldBefore + Math.floor(invested * SELL_REFUND))
    expect(towerSlotAt(s.lanes[0]!, 4, R + 4)).toBe(-1)
    expect(s.lanes[0]!.blocked[tileIndex({ x: 4, y: R + 4 })]).toBe(0)
  })

  it('never refunds in full, so rebuilding the maze is never free', () => {
    expect(SELL_REFUND).toBeGreaterThan(0)
    expect(SELL_REFUND).toBeLessThan(1)
  })
})
