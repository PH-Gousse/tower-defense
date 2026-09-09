import {
  createState,
  step,
  botCommand,
  Kind,
  TICK_MS,
  BOT_NORMAL,
  HashRing,
  InputBuffer,
  watermarkCadence,
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

export type GhostState = 'pending' | 'confirmed' | 'refused' | 'lost'

export interface Ghost {
  readonly cmd: Command
  readonly stampedFor: number
  state: GhostState
  reason: string | null
}

/** Same seat, same tick, same action. Enough to match a frame we sent. */
function sameCommand(a: Command, b: Command): boolean {
  if (a.player !== b.player || a.kind !== b.kind || a.tick !== b.tick) return false
  if (a.kind === Kind.Send && b.kind === Kind.Send) return a.creep === b.creep
  if ('x' in a && 'x' in b) return a.x === b.x && a.y === b.y
  return true
}

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
    private meSeat: 0 | 1 = 0,
    private bot: BotConfig | null = BOT_NORMAL,
  ) {}

  /** The player this client controls. Lane `me` is the one you defend. */
  get me(): 0 | 1 {
    return this.meSeat
  }

  /**
   * Adopt the seat the relay assigned.
   *
   * The scene is built before anyone knows which seat they will get -- it has
   * to be, so that a missing WebGL context fails before the player invests
   * anything -- so the seat arrives later, in `welcome`. Defaulting to 0 and
   * never updating it meant the second player to join sent every command
   * stamped `player: 0`, and the relay refused all of them as speaking for the
   * other seat. On screen that was a ghost tower that appeared and then faded
   * with a refusal, every single time.
   *
   * Only legal before the first tick: changing seats mid-match would mean the
   * two clients disagree about who owns which lane.
   */
  setSeat(seat: 0 | 1): void {
    if (this.a.tick > 0) throw new Error('the seat cannot change once a match has started')
    this.meSeat = seat
  }

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
    this.queue({ tick: 0, player: this.meSeat, kind: Kind.Build, tower, x, y })
  }

  /**
   * Stamp a local command and route it.
   *
   * Against a bot it goes straight into the next tick. In lockstep it is
   * stamped `delay` ticks ahead and handed to the relay, which returns it to
   * both clients -- including this one. The local client does NOT apply its own
   * command early: doing so would mean the two clients applied the same command
   * at different ticks, which is the desync this whole design exists to avoid.
   * The lag that creates is what prediction covers over.
   */
  private queue(cmd: Command): void {
    if (this.buffer && this.emit) {
      // Stamp for a tick this client has not simulated and cannot have promised
      // to be empty -- and one the relay will accept, which means one this seat
      // has not already claimed. The relay takes exactly one input per player
      // per tick, so two clicks inside the same 50ms would silently lose the
      // second. Drag-placing a run of towers is the core verb of the game, so
      // the extra clicks move to the next free tick rather than vanishing.
      let at = this.a.tick + this.delay
      while (this.claimed.has(at)) at += 1
      this.claimed.add(at)
      const stamped = { ...cmd, tick: at }
      this.pendingGhosts.push({ cmd: stamped, stampedFor: at, state: 'pending', reason: null })
      this.emit(stamped)
      return
    }
    this.pending.push({ ...cmd, tick: this.a.tick + 1 })
  }

  /** Predicted commands still in flight, for the renderer to draw as ghosts. */
  get ghosts(): readonly Ghost[] {
    return this.pendingGhosts
  }

  /**
   * The relay refused one of our frames. Fade that ghost with the reason.
   *
   * Matched by tick because a seat may only have one command per tick, so the
   * tick identifies the frame uniquely without the relay having to echo it back.
   */
  refuseGhost(tick: number, reason: string): void {
    for (const g of this.pendingGhosts) {
      if (g.stampedFor === tick && g.state === 'pending') {
        g.state = 'refused'
        g.reason = reason
      }
    }
  }

  /** Drop a ghost the UI has finished animating out. */
  clearGhost(g: Ghost): void {
    const i = this.pendingGhosts.indexOf(g)
    if (i >= 0) this.pendingGhosts.splice(i, 1)
  }

  /**
   * Resolve ghosts against a tick that has just been simulated.
   *
   * Three outcomes, not two, and the third is the one worth not skipping. Once
   * the sim has passed the tick a ghost was stamped for with no matching
   * command applied, that command is provably gone — the relay dropped it or
   * the socket ate it — and saying so beats leaving a translucent tower on
   * screen forever, which looks exactly like a game ignoring your clicks.
   *
   * No timer is needed: the client knows the delay and the tick, so expiry is
   * a comparison.
   */
  private resolveGhosts(tick: number, applied: readonly Command[]): void {
    for (const g of this.pendingGhosts) {
      if (g.stampedFor !== tick || g.state !== 'pending') continue
      const landed = applied.some((c) => sameCommand(c, g.cmd))
      g.state = landed ? 'confirmed' : 'lost'
    }
    this.claimed.delete(tick)
  }

  queueUpgrade(x: number, y: number): void {
    this.queue({ tick: 0, player: this.meSeat, kind: Kind.Upgrade, x, y })
  }

  queueSell(x: number, y: number): void {
    this.queue({ tick: 0, player: this.meSeat, kind: Kind.Sell, x, y })
  }

  /** Send a creep into the opponent's lane. Raises your income permanently. */
  queueSend(creep: number): void {
    this.queue({ tick: 0, player: this.meSeat, kind: Kind.Send, creep })
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

  // --- lockstep -------------------------------------------------------------

  /**
   * Set when this driver is playing a real opponent instead of a local bot.
   *
   * The two modes differ in one thing only, and it is the thing that matters:
   * against a bot the driver decides when to advance, and in lockstep the
   * inputs decide. Everything else -- the fixed timestep, the hashing, the
   * command log -- is identical, which is what makes a bot match a genuine
   * rehearsal for a networked one rather than a different program.
   */
  private buffer: InputBuffer | null = null
  private delay = 0
  private lastWatermarkSent = -1
  private emit: ((cmd: Command) => void) | null = null
  private emitWatermark: ((tick: number) => void) | null = null
  /**
   * Commands sent to the relay that have not come back yet.
   *
   * Inputs apply `delay` ticks late — 200ms on a good connection, up to a
   * second on a bad one — and `step()` is the only authority on whether they
   * were legal. Without prediction the game ignores your click for a fifth of a
   * second in the mechanic you use most, which does not read as latency; it
   * reads as broken.
   */
  private readonly pendingGhosts: Ghost[] = []

  /** Ticks this client has already stamped a command for, in lockstep. */
  private readonly claimed = new Set<number>()

  /**
   * Switch into lockstep. Called on `start` from the relay, before tick 0.
   *
   * `delay` is negotiated per match and never changes during one: a delay that
   * moved would change how far ahead each client stamps its inputs, and the two
   * would disagree about which tick a command belongs to. That is a desync
   * wearing a network feature's clothes.
   */
  goLockstep(
    delay: number,
    send: (cmd: Command) => void,
    sendWatermark: (tick: number) => void,
  ): void {
    this.buffer = new InputBuffer(delay)
    this.delay = delay
    this.emit = send
    this.emitWatermark = sendWatermark
    this.lastWatermarkSent = -1
    this.bot = null
  }

  get lockstep(): boolean {
    return this.buffer !== null
  }

  /** A command from the relay, ours or the peer's. */
  receive(cmd: Command): void {
    this.buffer?.add(cmd)
  }

  /** "Nothing through tick N from that seat." */
  receiveWatermark(player: 0 | 1, tick: number): void {
    this.buffer?.mark(player, tick)
  }

  /**
   * Ticks the peer is behind us, or 0 when it is keeping up.
   *
   * Under strict wait a slow peer stops both simulations, so this is what the
   * `peer-stalled` overlay reads. It is a number of ticks rather than a clock
   * because the client already knows the tick and reading a clock here would be
   * a second source of truth about time.
   */
  peerLag(me: 0 | 1): number {
    if (!this.buffer) return 0
    const peer = (1 - me) as 0 | 1
    // Their promise against ours, NOT against our current tick. Measuring
    // against the tick cannot work and quietly always returned zero: strict
    // wait means the tick never exceeds either seat's mark, so the difference
    // was never positive and the stall overlay could never appear -- the exact
    // situation it exists for would have shown nothing at all.
    const behind = this.buffer.markOf(me) - this.buffer.markOf(peer)
    return behind > 0 ? behind : 0
  }

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
      // Strict wait. A client simulates tick T only once it holds both
      // players' inputs for T, so an input can never arrive for a tick already
      // simulated: the failure mode is a stall, which is visible and
      // recoverable, rather than a desync, which is neither.
      if (this.buffer) {
        if (!this.buffer.ready(this.a.tick)) break
      }

      const atTick = this.a.tick
      const commands = this.buffer ? this.buffer.take(atTick) : this.pending
      if (!this.buffer) this.pending = []

      // The bot is just another command source. It runs inside the same tick
      // loop as the player, gets no extra information and no bent rules, and
      // its commands land in the same log — so a bot match replays exactly like
      // a human one.
      if (this.bot) {
        const opponent = (1 - this.me) as 0 | 1
        for (const cmd of botCommand(this.a, opponent, this.bot)) commands.push(cmd)
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

      // Prediction is client-only and never enters the state hash, so this runs
      // strictly after the hash is taken.
      if (this.buffer) this.resolveGhosts(atTick, commands)

      this.promise()
    }
    return ran
  }

  /**
   * Re-state how far ahead we are known to be empty.
   *
   * On its own cadence, and never folded into "I just sent a command". Treating
   * a sent command as a promise looks free and deadlocks: the relay can drop a
   * frame, and then the peer never receives the promise this client believes it
   * made and waits on that tick forever. A redundant watermark is one small
   * message and is monotonic, so it can never do harm.
   */
  private promise(): void {
    if (!this.buffer || !this.emitWatermark) return
    const at = this.a.tick + this.delay
    if (at - this.lastWatermarkSent < watermarkCadence(this.delay)) return
    this.lastWatermarkSent = at
    this.emitWatermark(at)
  }
}
