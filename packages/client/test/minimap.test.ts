import { describe, it, expect } from 'vitest'
import { GRID_H, GRID_W, SPAWN_ROWS, EXIT_ROW_MIN, createState, insertTower, TowerKind } from '@ltw/sim'
import {
  minimapLayout, worldToMinimap, minimapToWorld, paintMinimap,
  MINIMAP_SCALE_MAX, MINIMAP_SCALE_MIN, MINIMAP_COLOURS,
} from '../src/minimap'
import { CONTENT_W } from '../src/chrome'

/**
 * The minimap's mapping (ADR-0024).
 *
 * A click on the thumbnail that lands a row off is invisible in a screenshot
 * and maddening in play, so the mapping is pure and pinned here. The painter
 * is checked against a recording context: what it drew, how many times, in
 * what order -- the zones under the towers under the creeps.
 */
describe('minimapLayout', () => {
  it('uses 2px per tile when the height allows, 1px when it does not', () => {
    // A 1080p screen minus chrome has room for (213 + 2) * 2 = 430px.
    const desktop = minimapLayout(CONTENT_W, 120, 900)
    expect(desktop.scale).toBe(MINIMAP_SCALE_MAX)
    expect(desktop.height).toBe((GRID_H + 2) * 2)
    expect(desktop.width).toBe((CONTENT_W + 2) * 2)
    // A phone's usable height does not, and a creep must stay a pixel.
    const phone = minimapLayout(CONTENT_W, 120, 300)
    expect(phone.scale).toBe(MINIMAP_SCALE_MIN)
    expect(phone.height).toBe(GRID_H + 2)
  })

  it('steps in half pixels between the two', () => {
    const laptop = minimapLayout(CONTENT_W, 120, 380)
    expect(laptop.scale).toBe(1.5)
    expect(laptop.height).toBeLessThanOrEqual(380)
  })

  it('never exceeds the room it is given, in either axis', () => {
    for (const [w, h] of [[120, 900], [120, 380], [60, 900], [120, 220], [30, 200]] as const) {
      const l = minimapLayout(CONTENT_W, w, h)
      if (l.scale > MINIMAP_SCALE_MIN) {
        expect(l.width).toBeLessThanOrEqual(w)
        expect(l.height).toBeLessThanOrEqual(h)
      }
    }
  })
})

describe('the mapping', () => {
  const layout = minimapLayout(CONTENT_W, 120, 900)
  const p = { x: 0, y: 0 }
  const w = { x: 0, z: 0 }

  it('round-trips world to pixels and back', () => {
    for (const [x, z] of [[0, 0], [7.5, 100.25], [GRID_W, GRID_H], [CONTENT_W - 1, EXIT_ROW_MIN]] as const) {
      worldToMinimap(layout, x, z, p)
      minimapToWorld(layout, p.x, p.y, w)
      expect(w.x).toBeCloseTo(x, 9)
      expect(w.z).toBeCloseTo(z, 9)
    }
  })

  it('puts the spawn zone at the top and the exit zone at the bottom', () => {
    // Same way up as the screen: north is up, creeps walk down.
    const spawn = worldToMinimap(layout, 0, 0, { x: 0, y: 0 })
    const exit = worldToMinimap(layout, 0, EXIT_ROW_MIN, { x: 0, y: 0 })
    expect(spawn.y).toBeLessThan(exit.y)
    expect(exit.y).toBeLessThan(layout.height)
  })

  it('maps a click in the margin to a point just outside the content', () => {
    minimapToWorld(layout, 0, 0, w)
    expect(w.x).toBe(-1)
    expect(w.z).toBe(-1)
  })

  it('maps the far edge of the thumbnail to the far edge of the content', () => {
    minimapToWorld(layout, layout.width, layout.height, w)
    expect(w.x).toBeCloseTo(CONTENT_W + 1, 9)
    expect(w.z).toBeCloseTo(GRID_H + 1, 9)
  })

  it('maps the middle of your lane on the thumbnail to the middle of your lane', () => {
    worldToMinimap(layout, GRID_W / 2, GRID_H / 2, p)
    minimapToWorld(layout, p.x, p.y, w)
    expect(w.x).toBeCloseTo(GRID_W / 2, 9)
    expect(w.z).toBeCloseTo(GRID_H / 2, 9)
  })
})

/** A 2D context that records what was drawn. */
function recorder() {
  const calls: Array<{ op: string; style: string; args: number[] }> = []
  const ctx = {
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 1,
    fillRect(...args: number[]) { calls.push({ op: 'fill', style: this.fillStyle, args }) },
    strokeRect(...args: number[]) { calls.push({ op: 'stroke', style: this.strokeStyle, args }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('paintMinimap', () => {
  const layout = minimapLayout(CONTENT_W, 120, 900)
  const laneX = (lane: number) => (lane === 0 ? 0 : GRID_W + 4)
  const view = { minX: -1, minZ: -1, maxX: 35, maxZ: 19 }

  it('draws zones, then towers, then creeps, then the viewport', () => {
    const s = createState()
    insertTower(s.lanes[0]!, 1, 4, SPAWN_ROWS + 6, TowerKind.Single)
    insertTower(s.lanes[1]!, 2, 0, SPAWN_ROWS + 10, TowerKind.Splash)
    const c = s.lanes[0]!.creeps
    c.count = 3
    c.x[0] = 2.5; c.y[0] = 3.5; c.owner[0] = 1
    c.x[1] = 9.5; c.y[1] = 50.5; c.owner[1] = 1
    c.x[2] = 4.5; c.y[2] = 60.5; c.owner[2] = 0
    const { ctx, calls } = recorder()
    paintMinimap(ctx, layout, s, laneX, view)

    const fills = calls.filter((k) => k.op === 'fill')
    // Frame, then per lane: turf, spawn, exit. Then towers and creeps.
    expect(fills[0]!.style).toBe(MINIMAP_COLOURS.frame)
    const towers = fills.filter((k) => k.style === MINIMAP_COLOURS.tower)
    expect(towers).toHaveLength(2)
    // A 2x2 footprint is 2 * scale pixels a side.
    expect(towers[0]!.args[2]).toBe(2 * layout.scale)
    expect(towers[0]!.args[3]).toBe(2 * layout.scale)
    const theirs = fills.filter((k) => k.style === MINIMAP_COLOURS.creep[1])
    const mine = fills.filter((k) => k.style === MINIMAP_COLOURS.creep[0])
    expect(theirs).toHaveLength(2)
    expect(mine).toHaveLength(1)
    // Within a lane, creeps come after towers, so they draw on top. Lane 0
    // holds the first tower and all three creeps.
    const laneTower = fills.indexOf(towers[0]!)
    const firstCreep = fills.findIndex((k) => k.style === MINIMAP_COLOURS.creep[1])
    expect(firstCreep).toBeGreaterThan(laneTower)
    // The viewport is the one stroke, and it is last.
    const strokes = calls.filter((k) => k.op === 'stroke')
    expect(strokes).toHaveLength(1)
    expect(calls[calls.length - 1]!.op).toBe('stroke')
  })

  it('places a tower at its anchor, scaled, offset by its lane', () => {
    const s = createState()
    insertTower(s.lanes[1]!, 1, 6, SPAWN_ROWS + 3, TowerKind.Single)
    const { ctx, calls } = recorder()
    paintMinimap(ctx, layout, s, laneX, view)
    const t = calls.find((k) => k.style === MINIMAP_COLOURS.tower)!
    const expect0 = worldToMinimap(layout, laneX(1) + 6, SPAWN_ROWS + 3, { x: 0, y: 0 })
    expect(t.args[0]).toBeCloseTo(expect0.x, 9)
    expect(t.args[1]).toBeCloseTo(expect0.y, 9)
  })

  it('keeps the viewport rectangle inside the canvas when the view overhangs', () => {
    const s = createState()
    const { ctx, calls } = recorder()
    paintMinimap(ctx, layout, s, laneX, { minX: -30, minZ: -40, maxX: 80, maxZ: 300 })
    const r = calls.find((k) => k.op === 'stroke')!
    const [x, y, w, h] = r.args as [number, number, number, number]
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(x + w).toBeLessThanOrEqual(layout.width)
    expect(y + h).toBeLessThanOrEqual(layout.height)
  })
})
