import {
  createState,
  step,
  botCommand,
  Kind,
  TICK_MS,
  BOT_NORMAL,
  type BotConfig,
  type Command,
  type GameState,
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

  /**
   * @param me   the player this client controls; lane `me` is the one you defend
   * @param bot  config for the opponent, or null for an idle opponent
   */
  constructor(
    readonly me: 0 | 1 = 0,
    private bot: BotConfig | null = BOT_NORMAL,
  ) {}

  /**
   * Swap the opponent. Meant to be called once, before `start()`, from the
   * difficulty picker — the scene is built at load so a missing WebGL context
   * fails loudly before the player has chosen anything.
   */
  setBot(bot: BotConfig | null): void {
    this.bot = bot
  }

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

  queueBuild(x: number, y: number, tower: TowerKind): void {
    this.pending.push({ tick: this.a.tick + 1, player: this.me, kind: Kind.Build, tower, x, y })
  }

  queueUpgrade(x: number, y: number): void {
    this.pending.push({ tick: this.a.tick + 1, player: this.me, kind: Kind.Upgrade, x, y })
  }

  queueSell(x: number, y: number): void {
    this.pending.push({ tick: this.a.tick + 1, player: this.me, kind: Kind.Sell, x, y })
  }

  /** Send a creep into the opponent's lane. Raises your income permanently. */
  queueSend(creep: number): void {
    this.pending.push({ tick: this.a.tick + 1, player: this.me, kind: Kind.Send, creep })
  }

  /** The lane you defend. */
  get myLane() {
    return this.a.lanes[this.me]!
  }

  /** Your gold, income and lives. */
  get mySide() {
    return this.a.players[this.me]!
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

      // The bot is just another command source. It runs inside the same tick
      // loop as the player, gets no extra information and no bent rules, and
      // its commands land in the same log — so a bot match replays exactly like
      // a human one.
      if (this.bot) {
        const opponent = (1 - this.me) as 0 | 1
        const cmd = botCommand(this.a, opponent, this.bot)
        if (cmd) commands.push(cmd)
      }

      const out = step(this.a, commands, this.b)
      this.b = this.a
      this.a = out
      this.acc -= TICK_MS
      ran += 1
    }
    return ran
  }
}
