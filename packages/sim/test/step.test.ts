import { describe, it, expect } from 'vitest'
import {
  createState,
  spawnPointFor,
  towerSlotAt,
  SPAWN_PERIOD,
  STARTING_LIVES,
  type GameState,
} from '../src/state'
import { step, canBuild, checkBuild, checkUpgrade, checkSell, Refusal, Kind, type Command } from '../src/step'
import {
  GRID_W,
  GRID_H,
  TOWER_SIZE,
  SPAWN_ROWS,
  EXIT_ROW_MIN,
  BUILD_ROW_MAX,
  LANE_WIDTH,
  TOWERS_ACROSS,
  tileIndex,
  tileY,
  footprintContains,
} from '../src/grid'
import { UNREACHABLE, buildField, mazeLength } from '../src/field'
import { hashState } from '../src/hash'
import { TowerKind, levelOf, creepSpec } from '../src/data'
import {
  build, upgrade, sell, send, run, runUntil, tick, advance, stepper, place, wall, seal, withGold,
  R, SCRAPLING, DASHER_HOUND, BOG_BRUTE, withEveryCreepUnlocked,
} from './helpers'

// Not a test of the opening or the unlock clock: see withEveryCreepUnlocked.
withEveryCreepUnlocked()

describe('step', () => {
  it('does not mutate the previous state', () => {
    const prev = createState()
    const into = createState()
    const before = hashState(prev)
    step(prev, [build(4, R + 2)], into)
    expect(hashState(prev)).toBe(before)
    expect(prev.tick).toBe(0)
  })

  it('advances the tick by exactly one', () => {
    expect(run(7).tick).toBe(7)
  })

  it('is reproducible: same commands, same hash', () => {
    const cmds = { 2: [build(4, R + 4)], 5: [send(DASHER_HOUND)], 9: [build(6, R + 8)] }
    expect(hashState(run(60, cmds))).toBe(hashState(run(60, cmds)))
  })
})

describe('sends and where creeps enter', () => {
  it('puts creeps in the opponent lane, never the sender own lane', () => {
    // A creep is owned by its sender for scoring but exists only in the
    // defender's lane. Player 1 sends, so lane 0 fills and lane 1 stays empty.
    const s = run(30, { 0: [send(DASHER_HOUND, 1)] })
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[1]!.creeps.count).toBe(0)
    expect(s.lanes[0]!.creeps.owner[0]).toBe(1)
  })

  it('puts the whole wave on the board at once, with no pacing', () => {
    // A release queue used to pace arrivals at one creep every four ticks,
    // which capped a lane at five a second however fast you clicked -- and
    // clicking fast is how you mass-send. Gold is the only limit now.
    const wave = Array.from({ length: 6 }, () => send(SCRAPLING))
    expect(run(1, { 0: wave }).lanes[0]!.creeps.count).toBe(6)
  })

  it('spawns inside the spawn zone, at every cell once, in scattered order', () => {
    // ADR-0030: a mass send lands scattered over the zone, not as a line. Every
    // cell of the zone is used before any repeats, and nothing lands outside it.
    const field = createState().lanes[0]!.field
    const cellsSeen = new Set<number>()
    for (let r = 0; r < LANE_WIDTH * SPAWN_ROWS; r++) {
      const p = spawnPointFor(r, field)
      const cx = Math.floor(p.x)
      const cy = Math.floor(p.y)
      expect(cy, `release ${r}`).toBeLessThan(SPAWN_ROWS)
      expect(cx).toBeGreaterThanOrEqual(0)
      expect(cx).toBeLessThan(GRID_W)
      cellsSeen.add(cy * GRID_W + cx)
    }
    expect(cellsSeen.size).toBe(LANE_WIDTH * SPAWN_ROWS)
    // A burst of one lane-width is scattered, not a line. Under the old
    // row-fill rule these seventeen shared one row and each was the next
    // creep's neighbour; the scramble spreads them over most of the zone.
    const rows = new Set<number>()
    const cols = new Set<number>()
    let neighbours = 0
    for (let r = 0; r < LANE_WIDTH; r++) {
      const p = spawnPointFor(r, field)
      const q = spawnPointFor(r + 1, field)
      rows.add(Math.floor(p.y))
      cols.add(Math.floor(p.x))
      const dx = Math.abs(Math.floor(p.x) - Math.floor(q.x))
      const dy = Math.abs(Math.floor(p.y) - Math.floor(q.y))
      if (dx + dy <= 1) neighbours += 1
    }
    expect(rows.size).toBeGreaterThanOrEqual(5)
    expect(cols.size).toBeGreaterThanOrEqual(10)
    expect(neighbours).toBeLessThanOrEqual(3)
  })

  it('gives every release in a period a distinct setback, and repeats only after it', () => {
    // The fractional setback is what stops two creeps symmetric about the
    // first gap from welding (ADR-0022). Unique per release, or the guarantee
    // is gone: assert it directly rather than through a match.
    const field = createState().lanes[0]!.field
    const setbacks = new Set<number>()
    for (let r = 0; r < SPAWN_PERIOD; r++) {
      const p = spawnPointFor(r, field)
      // The zone points south on an empty lane, so the setback is in y.
      setbacks.add(Math.floor(p.y) + 0.5 - p.y)
    }
    expect(setbacks.size).toBe(SPAWN_PERIOD)
    expect(spawnPointFor(SPAWN_PERIOD, field)).toEqual(spawnPointFor(0, field))
    // 17 columns x 10 rows x 11 setback slots.
    expect(SPAWN_PERIOD).toBe(1870)
  })

  it('is deterministic across states: the same release gets the same point', () => {
    const a = createState().lanes[0]!.field
    const b = run(50).lanes[1]!.field
    for (const r of [0, 1, 17, 160, 1759, 5000]) expect(spawnPointFor(r, a)).toEqual(spawnPointFor(r, b))
  })

  it('keeps a burst apart long after it has funnelled through a gap', () => {
    // A wall with one 2-wide gap at the right forces every creep of a
    // 40-creep burst -- scattered over the whole zone (ADR-0030) -- through
    // the same cells. If any two shared a point they would be welded forever.
    let s = createState()
    wall(s, 0, R + 2, [GRID_W - 2, GRID_W - 1])
    const wave: Command[] = Array.from({ length: 40 }, () => send(SCRAPLING))
    // Paid for: forty of the first rung is 2,000, twice the opening purse.
    ;(s.players[1] as { gold: number }).gold = 40 * creepSpec(SCRAPLING).cost
    s = tick(s, wave)
    // The wall's towers shoot. This is a test of positions, not of damage,
    // so the creeps are made unkillable after they spawn.
    for (let i = 0; i < 40; i++) s.lanes[0]!.creeps.hp[i] = 1e9
    // Short of a lap: a swarm that has been round once is back in the spawn
    // zone, and "past the wall" below would be false for the wrong reason.
    // Sized from the exit, not the grid: a scattered spawn (ADR-0030) can start
    // a creep on the zone's last row, 100 rows from the exit, and the old
    // GRID_H-based walk of 102 tiles took that one round a lap.
    s = advance(s, Math.floor((EXIT_ROW_MIN - SPAWN_ROWS - 1) / creepSpec(SCRAPLING).speed))
    const c = s.lanes[0]!.creeps
    expect(c.count).toBe(40)
    for (let i = 0; i < c.count; i++) expect(c.laps[i], `creep ${i} lapped`).toBe(0)
    const seen = new Set<string>()
    for (let i = 0; i < c.count; i++) seen.add(`${c.x[i]},${c.y[i]}`)
    expect(seen.size).toBe(40)
    // And they have all passed the wall by now.
    for (let i = 0; i < c.count; i++) expect(c.y[i] as number).toBeGreaterThan(R + 4)
  })

  it('walks a creep toward the exit', () => {
    // The lane is vertical: the exit is at the bottom, so progress is +y.
    const early = run(40, { 0: [send(DASHER_HOUND)] })
    const late = run(120, { 0: [send(DASHER_HOUND)] })
    expect(late.lanes[0]!.creeps.y[0] as number).toBeGreaterThan(
      early.lanes[0]!.creeps.y[0] as number,
    )
  })
})

describe('placement refusals, each in isolation, before any gold moves', () => {
  /** Apply one build and assert gold did not move and no tower appeared. */
  function refusedCleanly(s: GameState, cmd: Command, expected: Refusal): void {
    if (cmd.kind !== Kind.Build) throw new Error('build only')
    expect(checkBuild(s, 0, cmd.x, cmd.y, cmd.tower).refusal).toBe(expected)
    const gold = s.players[0]!.gold
    const towers = s.lanes[0]!.towers.count
    const out = tick(s, [cmd])
    expect(out.players[0]!.gold).toBe(gold)
    expect(out.lanes[0]!.towers.count).toBe(towers)
  }

  it('NotEnoughGold, and it is asked first', () => {
    const cost = levelOf(TowerKind.Single, 1).cost
    refusedCleanly(withGold(createState(), 0, cost - 1), build(4, R + 2), Refusal.NotEnoughGold)
    // First: a broke player hovering outside the lane hears about the gold,
    // which is the only one of the two they can do anything about.
    refusedCleanly(withGold(createState(), 0, 0), build(-1, R + 2), Refusal.NotEnoughGold)
  })

  it('OutOfBounds when any cell of the footprint is off the lane', () => {
    refusedCleanly(createState(), build(-1, R + 2), Refusal.OutOfBounds)
    refusedCleanly(createState(), build(GRID_W - 1, R + 2), Refusal.OutOfBounds)
    refusedCleanly(createState(), build(GRID_W, R + 2), Refusal.OutOfBounds)
    refusedCleanly(createState(), build(0, GRID_H - 1), Refusal.OutOfBounds)
    refusedCleanly(createState(), build(0, -1), Refusal.OutOfBounds)
  })

  it('InSpawnZone when any cell of the footprint is in the spawn zone', () => {
    refusedCleanly(createState(), build(0, 0), Refusal.InSpawnZone)
    // Straddling the seam: the anchor row is the last spawn row.
    refusedCleanly(createState(), build(7, SPAWN_ROWS - 1), Refusal.InSpawnZone)
    // And the row after it is fine.
    expect(checkBuild(createState(), 0, 7, SPAWN_ROWS).refusal).toBe(Refusal.None)
  })

  it('InExitZone when any cell of the footprint is in the exit zone', () => {
    refusedCleanly(createState(), build(0, EXIT_ROW_MIN), Refusal.InExitZone)
    // Straddling: the footprint's second row is the first exit row.
    refusedCleanly(createState(), build(7, EXIT_ROW_MIN - 1), Refusal.InExitZone)
    expect(checkBuild(createState(), 0, 7, BUILD_ROW_MAX - TOWER_SIZE + 1).refusal).toBe(Refusal.None)
  })

  it('OverlapsTower when any cell is already inside a footprint', () => {
    const s = createState()
    place(s, 0, 4, R + 4)
    refusedCleanly(s, build(4, R + 4), Refusal.OverlapsTower)
    refusedCleanly(s, build(5, R + 5), Refusal.OverlapsTower)
    refusedCleanly(s, build(3, R + 3), Refusal.OverlapsTower)
    // Touching is not overlapping.
    expect(checkBuild(s, 0, 6, R + 4).refusal).toBe(Refusal.None)
    expect(checkBuild(s, 0, 4, R + 6).refusal).toBe(Refusal.None)
  })

  it('CreepOnFootprint when a creep stands on the footprint (ADR-0023)', () => {
    // Walk a runner into the buildable rows, then try to build on top of it.
    const s = runUntil((x) => (x.lanes[0]!.creeps.y[0] as number) > R + 3, 2000, { 0: [send(DASHER_HOUND)] })
    const cx = Math.floor(s.lanes[0]!.creeps.x[0] as number)
    const cy = Math.floor(s.lanes[0]!.creeps.y[0] as number)
    // Every anchor whose footprint covers the creep's tile is refused...
    for (let ax = cx - 1; ax <= cx; ax++) {
      for (let ay = cy - 1; ay <= cy; ay++) {
        if (ax < 0 || ax + TOWER_SIZE > GRID_W) continue
        expect(footprintContains(ax, ay, cx, cy)).toBe(true)
        refusedCleanly(s, build(ax, ay), Refusal.CreepOnFootprint)
      }
    }
    // ...and the anchor one column over is not.
    const clear = cx + 1 + TOWER_SIZE <= GRID_W ? cx + 1 : cx - 2
    expect(checkBuild(s, 0, clear, cy).refusal).toBe(Refusal.None)
  })

  it('WouldSealLane when no route of empty tiles would remain', () => {
    const s = createState()
    // A full row of towers leaves the spare column open (ADR-0027); the tower
    // that covers it in the rows below is the one that seals.
    wall(s, 0, R + 4, [])
    expect(s.lanes[0]!.towers.count).toBe(TOWERS_ACROSS)
    refusedCleanly(s, build(GRID_W - TOWER_SIZE, R + 4 + TOWER_SIZE), Refusal.WouldSealLane)
    expect(canBuild(s, 0, GRID_W - TOWER_SIZE, R + 4 + TOWER_SIZE)).toBe(false)
  })

  it('names the reason from the player side, and every reason has one', () => {
    // The enum is the contract the client's message table is written against.
    expect(Refusal.None).toBe(0)
    const names = Object.keys(Refusal).filter((k) => Number.isNaN(Number(k)))
    expect(names).toEqual([
      'None', 'NotEnoughGold', 'OutOfBounds', 'InSpawnZone', 'InExitZone', 'OverlapsTower',
      'CreepOnFootprint', 'WouldSealLane', 'NoTowerHere', 'AlreadyMaxLevel', 'TierLocked',
      'BuildPhase', 'LaneFull',
    ])
  })
})

describe('the half-slot rule', () => {
  it('lets two towers offset by one tile leave a 1-wide corridor, and creeps use it', () => {
    // Towers at anchors 0 and 3 leave column 2 between them. The rest of the
    // row closes by the ordinary stride, up to the far edge; a tower one row
    // down at the far edge is there to show the offset row is legal too.
    // Every placement is legal, so this is a maze a player can build.
    const cmds: Command[] = [build(0, R + 4), build(GRID_W - 2, R + 6)]
    for (let ax = 3; ax + TOWER_SIZE <= GRID_W; ax += TOWER_SIZE) cmds.push(build(ax, R + 4))
    let s = createState()
    for (const c of cmds) {
      expect(checkBuild(s, 0, c.kind === Kind.Build ? c.x : 0, c.kind === Kind.Build ? c.y : 0).refusal).toBe(Refusal.None)
      s = tick(s, [c])
    }
    expect(s.lanes[0]!.towers.count).toBe(cmds.length)
    const f = s.lanes[0]!.field
    expect(f.dist[tileIndex({ x: 2, y: R + 4 })]).not.toBe(UNREACHABLE)
    expect(f.dist[tileIndex({ x: 1, y: R + 4 })]).toBe(UNREACHABLE)
    expect(f.dist[tileIndex({ x: 3, y: R + 4 })]).toBe(UNREACHABLE)

    // A creep from the far right of the zone walks the whole width to the
    // slot, through it, and out the other side. Spawn cells are scrambled
    // (ADR-0030), so find a release that lands in the last column rather than
    // assuming release GRID_W - 1 does, as the row-fill order used to.
    let release = 0
    while (Math.floor(spawnPointFor(release, f).x) !== GRID_W - 1) release += 1
    ;(s.lanes[0] as { released: number }).released = release
    s = tick(s, [send(DASHER_HOUND)])
    expect(Math.floor(s.lanes[0]!.creeps.x[0] as number)).toBe(GRID_W - 1)
    // Unkillable: the wall's towers shoot, and this is a test of the route.
    s.lanes[0]!.creeps.hp[0] = 1e9
    let passedSlot = false
    const next = stepper(s)
    for (let t = 0; t < 1500 && (s.lanes[0]!.creeps.y[0] as number) < R + 8; t++) {
      s = next()
      const cx = Math.floor(s.lanes[0]!.creeps.x[0] as number)
      const cy = Math.floor(s.lanes[0]!.creeps.y[0] as number)
      if (cx === 2 && (cy === R + 4 || cy === R + 5)) passedSlot = true
    }
    expect(passedSlot).toBe(true)
    expect(s.lanes[0]!.creeps.y[0] as number).toBeGreaterThanOrEqual(R + 8)
    expect(s.players[0]!.leaks).toBe(0)
  })

  it('lets a full row of towers stand, because the spare column is the slot', () => {
    // Eight towers from the left edge cover sixteen of the seventeen tiles
    // (ADR-0027). The row is legal as it stands: column 16 is one creep wide
    // and open. What seals is covering that column in the rows below.
    let s = createState()
    for (let a = 0; a < TOWERS_ACROSS; a++) {
      expect(checkBuild(s, 0, a * TOWER_SIZE, R + 4).refusal, `tower ${a}`).toBe(Refusal.None)
      s = tick(s, [build(a * TOWER_SIZE, R + 4)])
    }
    expect(s.lanes[0]!.towers.count).toBe(TOWERS_ACROSS)
    expect(s.lanes[0]!.field.dist[tileIndex({ x: GRID_W - 1, y: R + 4 })]).not.toBe(UNREACHABLE)
    // Directly below the wall the plug shares an edge with it: sealed.
    expect(checkBuild(s, 0, GRID_W - TOWER_SIZE, R + 4 + TOWER_SIZE).refusal).toBe(Refusal.WouldSealLane)
    // One row further down there is a corridor between wall and plug: legal.
    expect(checkBuild(s, 0, GRID_W - TOWER_SIZE, R + 5 + TOWER_SIZE).refusal).toBe(Refusal.None)
  })

  it('treats a corner touch as sealed: no diagonal squeezing', () => {
    // A pocket under the right end of a wall whose only way out is between
    // two towers that touch at a corner. Built so it does not depend on the
    // lane's width being even: the wall stops three tiles short of the edge,
    // a tower two rows down covers the two tiles next to the wall's end, and
    // the tower two rows below THAT covers the edge tiles. Its top-left cell
    // and the previous tower's bottom-right cell meet at a corner, and that
    // corner is the pocket's last exit.
    let s = createState()
    wall(s, 0, R + 2, [GRID_W - 3, GRID_W - 2, GRID_W - 1])
    expect(checkBuild(s, 0, GRID_W - 4, R + 2 + TOWER_SIZE).refusal).toBe(Refusal.None)
    s = tick(s, [build(GRID_W - 4, R + 2 + TOWER_SIZE)])
    expect(checkBuild(s, 0, GRID_W - 2, R + 2 + 2 * TOWER_SIZE).refusal).toBe(Refusal.WouldSealLane)
    // The same tower one row lower leaves an open cell between the corners.
    expect(checkBuild(s, 0, GRID_W - 2, R + 3 + 2 * TOWER_SIZE).refusal).toBe(Refusal.None)
  })
})

describe('placement bookkeeping', () => {
  it('allows a placement that only lengthens the maze, and reports by how much', () => {
    const s = createState()
    wall(s, 0, R + 4, [0, 1, GRID_W - 2, GRID_W - 1])
    const before = mazeLength(buildField(s.lanes[0]!.blocked))
    const check = checkBuild(s, 0, 0, R + 4)
    expect(check.refusal).toBe(Refusal.None)
    expect(check.mazeAfter).toBeGreaterThan(before)
  })

  it('leaves state untouched — the probe must not mutate', () => {
    const s = createState()
    place(s, 0, 4, R + 4)
    const before = hashState(s)
    checkBuild(s, 0, 4, R + 8)
    checkBuild(s, 0, 4, R + 4)
    checkBuild(s, 0, -5, -5)
    checkBuild(s, 0, 6, R + 4)
    expect(hashState(s)).toBe(before)
  })

  it('keeps the tower list sorted by anchor and the cell cache consistent', () => {
    // Built out of order; stored in anchor order. Every cell of every
    // footprint knows its tower, and nothing else does.
    let s = run(3, { 0: [build(8, R + 6)], 1: [build(2, R + 2)], 2: [build(4, R + 6)] })
    const t = s.lanes[0]!.towers
    expect(t.count).toBe(3)
    expect([t.anchorX[0], t.anchorY[0]]).toEqual([2, R + 2])
    expect([t.anchorX[1], t.anchorY[1]]).toEqual([4, R + 6])
    expect([t.anchorX[2], t.anchorY[2]]).toEqual([8, R + 6])
    // Ids are handed out in build order and never reused.
    expect(Array.from(t.id.subarray(0, 3))).toEqual([2, 3, 1])
    let covered = 0
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const slot = towerSlotAt(s.lanes[0]!, x, y)
        const blocked = s.lanes[0]!.blocked[tileIndex({ x, y })]
        expect(blocked).toBe(slot === -1 ? 0 : 1)
        if (slot !== -1) {
          covered += 1
          expect(footprintContains(t.anchorX[slot] as number, t.anchorY[slot] as number, x, y)).toBe(true)
        }
      }
    }
    expect(covered).toBe(3 * TOWER_SIZE * TOWER_SIZE)

    // Selling the middle one compacts the rest and clears its cells.
    s = tick(s, [sell(5, R + 7)])
    expect(s.lanes[0]!.towers.count).toBe(2)
    expect(Array.from(s.lanes[0]!.towers.id.subarray(0, 2))).toEqual([2, 1])
    expect(towerSlotAt(s.lanes[0]!, 4, R + 6)).toBe(-1)
    expect(towerSlotAt(s.lanes[0]!, 9, R + 7)).toBe(1)
  })

  it('addresses upgrade and sell by any cell of the footprint', () => {
    let s = run(2, { 0: [build(4, R + 4)] })
    expect(checkUpgrade(s, 0, 5, R + 5)).toBe(Refusal.None)
    s = tick(s, [upgrade(5, R + 5)])
    expect(s.lanes[0]!.towers.level[0]).toBe(2)
    expect(checkSell(s, 0, 4, R + 5)).toBe(Refusal.None)
    expect(checkSell(s, 0, 6, R + 4)).toBe(Refusal.NoTowerHere)
    s = tick(s, [sell(5, R + 4)])
    expect(s.lanes[0]!.towers.count).toBe(0)
  })

  it('reopens the path when a tower is sold', () => {
    const s = createState()
    wall(s, 0, R + 4, [])
    // By hand, past the rule: plug the spare column below the row, which
    // seals the lane (ADR-0027), then sell the plug.
    const plugY = R + 4 + TOWER_SIZE
    const sealSlot = place(s, 0, GRID_W - TOWER_SIZE, plugY)
    expect(s.lanes[0]!.field.dist[0]).toBe(UNREACHABLE)
    const out = tick(s, [sell(s.lanes[0]!.towers.anchorX[sealSlot] as number, plugY)])
    expect(out.lanes[0]!.field.dist[0]).not.toBe(UNREACHABLE)
  })

  it('builds only in your own lane', () => {
    const s = run(3, {
      0: [build(4, R + 4, TowerKind.Single, 0), build(6, R + 8, TowerKind.Single, 1)],
    })
    expect(towerSlotAt(s.lanes[0]!, 4, R + 4)).not.toBe(-1)
    expect(towerSlotAt(s.lanes[0]!, 6, R + 8)).toBe(-1)
    expect(towerSlotAt(s.lanes[1]!, 6, R + 8)).not.toBe(-1)
  })
})

describe('command ordering', () => {
  it('applies in (player, kind) order regardless of arrival order', () => {
    const forward = run(3, {
      0: [build(4, R + 4, TowerKind.Single, 0), build(6, R + 6, TowerKind.Single, 1)],
    })
    const reversed = run(3, {
      0: [build(6, R + 6, TowerKind.Single, 1), build(4, R + 4, TowerKind.Single, 0)],
    })
    expect(hashState(forward)).toBe(hashState(reversed))
  })
})

describe('leaking', () => {
  it('leaks on the tick the position enters the exit zone, not the next', () => {
    // A creep a hair above the seam with a partial step to make: the crossing
    // happens mid-step, and the leak must land on this tick.
    const s = tick(createState(), [send(DASHER_HOUND)])
    const c = s.lanes[0]!.creeps
    c.x[0] = 0.5
    c.y[0] = EXIT_ROW_MIN - 0.05
    const speed = c.speed[0] as number
    expect(speed).toBeGreaterThan(0.05)
    expect(speed).toBeLessThan(0.5)
    const out = tick(s)
    expect(out.players[0]!.leaks).toBe(1)
    expect(out.players[0]!.lives).toBe(STARTING_LIVES - 1)
    expect(out.lanes[0]!.creeps.laps[0]).toBe(1)
    // And it is back in the spawn zone, with its HP.
    expect(out.lanes[0]!.creeps.y[0] as number).toBeLessThan(SPAWN_ROWS)
    expect(out.lanes[0]!.creeps.hp[0]).toBe(creepSpec(DASHER_HOUND).hp)
  })

  it('leaks exactly once per lap', () => {
    // Watched tick by tick: leaks and laps move together, one at a time.
    let s = tick(createState(), [send(DASHER_HOUND)])
    let leaks = 0
    const next = stepper(s)
    for (let t = 0; t < 4000; t++) {
      s = next()
      const now = s.players[0]!.leaks
      expect(now - leaks).toBeLessThanOrEqual(1)
      if (now > leaks) {
        expect(s.lanes[0]!.creeps.laps[0]).toBe(now)
        expect(s.lanes[0]!.creeps.y[0] as number).toBeLessThan(SPAWN_ROWS)
      }
      leaks = now
    }
    expect(leaks).toBeGreaterThanOrEqual(2)
  })

  it('never leaves a creep parked in the exit zone', () => {
    const s = runUntil((x) => x.players[0]!.leaks >= 1, 4000, { 0: [send(DASHER_HOUND)] })
    const c = s.lanes[0]!.creeps
    for (let i = 0; i < c.count; i++) expect(tileY(Math.floor(c.y[i] as number) * GRID_W)).toBeLessThan(EXIT_ROW_MIN)
  })
})

describe('stranded creeps', () => {
  it('returns a pathless creep to the spawn zone', () => {
    let s = runUntil((x) => (x.lanes[0]!.creeps.y[0] as number) > R + 6, 2000, { 0: [send(BOG_BRUTE)] })
    const walked = s.lanes[0]!.creeps.y[0] as number
    expect(walked).toBeGreaterThan(R + 6)

    // Seal the lane by hand above and below the creep, bypassing the rules.
    // This is the state the respawn exists to recover from. Each seal is a
    // row plus its plug two rows further down, so the upper one starts five
    // rows up to keep its plug off the creep's row.
    const row = Math.floor(walked)
    seal(s, 0, row + 2)
    seal(s, 0, row - 5)
    expect(s.lanes[0]!.field.dist[tileIndex({ x: Math.floor(s.lanes[0]!.creeps.x[0] as number), y: row })]).toBe(UNREACHABLE)

    s = tick(s)
    expect(s.lanes[0]!.creeps.y[0] as number).toBeLessThan(SPAWN_ROWS)
    // Not a leak: no life moved.
    expect(s.players[0]!.leaks).toBe(0)
  })
})
