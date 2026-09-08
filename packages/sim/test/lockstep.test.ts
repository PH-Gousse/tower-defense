import { describe, it, expect } from 'vitest'
import { Kind, TowerKind, type Command } from '../src/index'
import { InputBuffer } from '../src/lockstep'

const build = (tick: number, player: 0 | 1, x: number): Command => ({
  tick, player, kind: Kind.Build, tower: TowerKind.Single, x, y: 11,
})

describe('lockstep input buffer', () => {
  it('bootstraps the delay window so tick 0 is not a deadlock', () => {
    // Inputs are stamped `delay` ticks ahead, so nobody can ever have sent one
    // for tick 0. Without treating 0..delay-1 as known-empty, strict wait never
    // starts at all.
    const b = new InputBuffer(4)
    expect(b.ready(0)).toBe(true)
    expect(b.ready(3)).toBe(true)
    expect(b.ready(4)).toBe(false)
  })

  it('waits for the slower seat, not the faster one', () => {
    const b = new InputBuffer(4)
    b.mark(0, 100)
    expect(b.readyThrough).toBe(3)
    b.mark(1, 20)
    expect(b.readyThrough).toBe(20)
  })

  it('treats a command as its sender’s watermark', () => {
    const b = new InputBuffer(4)
    b.add(build(9, 0, 5))
    b.mark(1, 9)
    expect(b.ready(9)).toBe(true)
  })

  it('never moves a watermark backwards', () => {
    // A backwards mark would let a client un-promise ticks the peer has already
    // simulated, which is the one thing strict wait guarantees cannot happen.
    const b = new InputBuffer(4)
    b.mark(0, 50)
    b.mark(0, 10)
    expect(b.markOf(0)).toBe(50)
  })

  it('orders a tick by player then kind, whatever order it arrived in', () => {
    // Both clients must hand step() the same array. Arrival order over a
    // network is not a shared fact; this sort is.
    const b = new InputBuffer(4)
    b.add({ tick: 7, player: 1, kind: Kind.Send, creep: 0 })
    b.add(build(7, 0, 3))
    const got = b.take(7)
    expect(got.map((c) => [c.player, c.kind])).toEqual([
      [0, Kind.Build],
      [1, Kind.Send],
    ])
  })

  it('empties a tick once taken, so a replayed tick cannot double-apply', () => {
    const b = new InputBuffer(4)
    b.add(build(7, 0, 3))
    expect(b.take(7)).toHaveLength(1)
    expect(b.take(7)).toHaveLength(0)
  })

  it('a None command marks without queueing anything to apply', () => {
    const b = new InputBuffer(4)
    b.add({ tick: 30, player: 0, kind: Kind.None })
    expect(b.markOf(0)).toBe(30)
    expect(b.take(30)).toHaveLength(0)
  })
})
