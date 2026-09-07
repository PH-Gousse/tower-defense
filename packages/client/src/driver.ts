import {
  createState,
  step,
  Kind,
  TICK_MS,
  DEFAULT_CONFIG,
  type Command,
  type GameState,
  type SimConfig,
  TowerKind,
} from '@ltw/sim'

/**
 * Fixed-timestep driver.
 *
 * The sim reads no clock — that is why `Date.now` is banned inside it. Time
 * lives here instead: this accumulates real elapsed milliseconds and calls
 * `step()` a whole number of times, so the simulation advances at exactly 20Hz
 * regardless of display refresh rate.
 *
 *   frame ──▶ accumulate dt ──▶ while (acc >= TICK_MS) step()  ──▶ alpha
 *                                      (max 10 per frame)          │
 *                                                                  ▼
 *                                                        renderer interpolates
 *                                                        prev -> curr by alpha
 *
 * Two states are kept and swapped, never reallocated: at 20Hz for twenty
 * minutes that is two allocations instead of 24,000. `prev` is also what the
 * renderer interpolates from, so double-buffering is not just an optimisation.
 */

/** Catch-up ceiling. Without it, a long stall tries to replay every missed tick at once. */
const MAX_CATCHUP_TICKS = 10

export class Driver {
  private a: GameState = createState()
  private b: GameState = createState()
  private acc = 0
  private last = 0
  private pending: Command[] = []
  private started = false

  constructor(private readonly config: SimConfig = DEFAULT_CONFIG) {}

  /** The state being rendered. */
  get current(): GameState {
    return this.a
  }

  /** The tick before it. The renderer interpolates from here. */
  get previous(): GameState {
    return this.b
  }

  /**
   * How far between `previous` and `current` we are, in 0..1.
   *
   * **Clamped at 1.0, and that clamp is load-bearing.** When the sim stops
   * advancing — a stalled peer under lockstep, or a backgrounded tab — an
   * unclamped alpha keeps climbing and the renderer glides creeps toward a tick
   * that never happened, straight through towers, then snaps them back when the
   * real tick lands. That reads as broken pathfinding rather than as a slow
   * network. Freezing is honest; drifting is not.
   */
  get alpha(): number {
    const raw = this.acc / TICK_MS
    return raw > 1 ? 1 : raw
  }

  queueBuild(x: number, y: number, tower: TowerKind, player: 0 | 1 = 0): void {
    this.pending.push({ tick: this.a.tick + 1, player, kind: Kind.Build, tower, x, y })
  }

  queueUpgrade(x: number, y: number, player: 0 | 1 = 0): void {
    this.pending.push({ tick: this.a.tick + 1, player, kind: Kind.Upgrade, x, y })
  }

  queueSell(x: number, y: number, player: 0 | 1 = 0): void {
    this.pending.push({ tick: this.a.tick + 1, player, kind: Kind.Sell, x, y })
  }

  /** Advance by real elapsed time. Returns how many ticks actually ran. */
  advance(nowMs: number): number {
    if (!this.started) {
      this.started = true
      this.last = nowMs
      return 0
    }
    let dt = nowMs - this.last
    this.last = nowMs
    // A tab that was backgrounded for a minute reports a huge dt. Clamp it
    // rather than trying to replay 1,200 ticks in one frame.
    if (dt > TICK_MS * MAX_CATCHUP_TICKS) dt = TICK_MS * MAX_CATCHUP_TICKS
    if (dt < 0) dt = 0
    this.acc += dt

    let ran = 0
    while (this.acc >= TICK_MS && ran < MAX_CATCHUP_TICKS) {
      const commands = this.pending
      this.pending = []
      const out = step(this.a, commands, this.b, this.config)
      this.b = this.a
      this.a = out
      this.acc -= TICK_MS
      ran += 1
    }
    return ran
  }
}
