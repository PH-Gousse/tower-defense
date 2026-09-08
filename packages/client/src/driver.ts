import {
  createState,
  step,
  botCommand,
  Kind,
  TICK_MS,
  BOT_NORMAL,
  HashRing,
  findDivergence,
  buildDump,
  type BotConfig,
  type Command,
  type GameState,
  type HashEntry,
  type Divergence,
  type DesyncDump,
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
   * Every command the simulation has applied, from tick 0.
   *
   * This is what makes a desync reproducible. Without it the dump can say which
   * tick broke but not what was happening, and a match that only exists in a
   * closed tab is a bug report nobody can act on. `None` is never recorded --
   * it is the absence of a command.
   */
  private readonly log: Command[] = []

  /** Rolling window of per-tick state hashes, exchanged with the peer. */
  readonly hashes = new HashRing()

  /**
   * Set when a peer's hashes disagreed with ours. Once set, the driver stops
   * advancing: the two players are already watching different matches, and
   * every tick after the first mismatch widens the gap while making the cause
   * harder to find. There is no resync, deliberately -- adopting the peer's
   * state would hide the bug that caused this.
   */
  private divergence: Divergence | null = null

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

  /** Non-null once a peer disagreed with us. The driver is frozen. */
  get desync(): Divergence | null {
    return this.divergence
  }

  /**
   * Compare a peer's hash window with ours.
   *
   * Called by the relay when the peer's hashes arrive (step 10). Returns what
   * was found so a caller can report `no-overlap` as the stall it is rather
   * than as a desync.
   */
  checkPeer(peer: readonly HashEntry[]): Divergence {
    const result = findDivergence(this.hashes.entries(), peer)
    if (result.reason === 'diverged' && !this.divergence) {
      this.divergence = result
      this.peerHashes = peer.slice()
    }
    return result
  }

  private peerHashes: HashEntry[] | null = null

  /** The match as a reproducible file. */
  dump(trigger: 'desync' | 'manual', build: string): DesyncDump {
    return buildDump({
      build,
      trigger,
      me: this.me,
      ticks: this.a.tick,
      commands: this.log,
      localHashes: this.hashes.entries(),
      peerHashes: this.peerHashes,
      divergedAtTick: this.divergence ? this.divergence.tick : -1,
    })
  }

  /** Advance by real elapsed time. Returns how many ticks actually ran. */
  advance(nowMs: number): number {
    // A frozen driver stays frozen. Returning early rather than throwing keeps
    // the render loop alive, so the player still sees the board and the notice
    // explaining why it stopped.
    if (this.divergence) return 0
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

      // Log with `tick` rewritten to the tick the command is actually applied
      // on. The field was never authoritative: `step()` does not read it, it
      // applies whatever it is handed at the current tick, and the producers
      // disagree -- the local queue stamps `tick + 1` while the bot stamps
      // `tick`. A replay that trusted the field would place half the log a tick
      // late and diverge from the match it was meant to reproduce.
      for (const c of commands) this.log.push({ ...c, tick: this.a.tick })

      const out = step(this.a, commands, this.b)
      this.b = this.a
      this.a = out
      this.acc -= TICK_MS
      ran += 1

      // Hash after the step, so the entry for tick N is the state at the end of
      // tick N -- the same convention on both peers, which is the only thing
      // that matters and the easiest thing to get subtly wrong.
      this.hashes.record(this.a)
    }
    return ran
  }
}
