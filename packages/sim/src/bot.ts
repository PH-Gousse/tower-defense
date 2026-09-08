import { GRID_W, TILE_COUNT, tileIndex, tileX, tileY, SPAWN_INDICES, type Tile } from './grid'
import { pathFrom } from './path'
import {
  TowerKind,
  CREEPS,
  CreepArchetypeKind,
  creepSpec,
  investedIn,
  levelOf,
  MAX_LEVEL,
  MAX_TIER,
  tierUnlockTick,
} from './data'
import { opponentOf, type GameState, type Lane, type Player } from './state'
import { Kind, Refusal, checkBuild, checkUpgrade, checkSend, type Command } from './step'
import { templateAt } from './maze'

/**
 * The AI opponent.
 *
 * It emits `Command`s, exactly like a player, and never touches state. That
 * matters for two reasons beyond tidiness: a bot match then replays on any
 * future version from its command log alone, and the bot becomes testable by
 * asserting on what it emits from a given board rather than by running a match
 * and squinting at the result.
 *
 *   every `reactionTicks`:
 *
 *     is a creep looping in my lane? ──yes──▶ EMERGENCY
 *     │                                       stack damage on the live route
 *     no
 *     ▼
 *     spend ratio says send?  ──yes──▶ best creep I can afford
 *     │
 *     no
 *     ▼
 *     next legal tile in my template, else upgrade the tower nearest the route
 *
 * Difficulty is the spend ratio and the reaction delay, and nothing else — no
 * extra gold, no vision the player lacks, no rule bent in its favour.
 *
 * Known limitation, priced honestly: the templates do not react to what is
 * being sent. The knobs make the bot flood harder and respond sooner; they
 * never make it maze *smarter*. If it reads flat in play, adaptive template
 * selection is the first thing to build after this.
 */

/**
 * `defence` answers what is in your lane with the tower that counters it.
 * `send` picks the creep that exploits the opponent's maze.
 *
 * **Only `send` is worth having, and that is a measured result rather than a
 * design.** Against the fixed-template bot over twelve matches -- six spend
 * ratios, both seats -- `send` wins 10-2, `both` wins 8-4, and `defence` loses
 * 0-12. Reactive tower choice is not merely neutral; it is worse than not
 * looking at all, and it drags the combination down below the half that works.
 *
 * The design doc predicted the opposite: adaptive *mazing* was named as the
 * first thing to build after v1. The reason it fails is worth keeping. The
 * fixed 3:1:1 mix answers all three creep shapes adequately, and specialising
 * against the wave currently in your lane answers the wave that is already
 * dying -- while the bot only ever ADDS towers, never sells, so every
 * over-commitment is permanent. Sending has neither problem: the maze you are
 * exploiting is standing there, it changes slowly, and each purchase is
 * independent.
 */
export type AdaptiveMode = 'off' | 'defence' | 'send' | 'both'

export interface BotConfig {
  /**
   * Share of decisions spent attacking rather than defending, 0..1.
   * 0 turtles and never sends; 1 sends whenever it can afford to.
   */
  readonly sendRatio: number
  /** Ticks between decisions. Higher is slower and easier. */
  readonly reactionTicks: number
  /**
   * Income periods banked before attacking.
   *
   * Sets the rhythm of the match: small and the bot sends often with light
   * waves, large and it sends rarely with heavy ones. It is a knob because the
   * two produce genuinely different games and only measurement can say which is
   * the better one.
   */
  readonly savingPeriods?: number
  /**
   * How much of the board the bot reads, rather than following a template.
   *
   * Four modes rather than a boolean, because the two halves had to be measured
   * apart and the result was not what it looked like: reactive tower choice on
   * its own is WORSE than the fixed template, and every bit of the gain comes
   * from counter-picking what to send. A flag pair keeps that finding runnable
   * instead of buried in a commit message.
   *
   * "Smarter" is an opinion until it wins head to head, and more than one
   * change to this bot that looked obviously better measured backwards.
   */
  readonly adaptive?: AdaptiveMode
  /** Index into MAZE_TEMPLATES. */
  readonly template: number
}

/**
 * Towers the bot builds before the spend ratio starts applying.
 *
 * Without this floor the hard bot never builds anything at all. The reason is
 * arithmetic, not strategy: a creep is cheaper than a tower, so on every
 * decision where it wants to send it can afford to, and on every decision where
 * it wants to build it cannot — gold never survives long enough to reach a
 * tower price. The templates were dead code at high spend ratios.
 *
 * A fixed opening costs every difficulty exactly the same gold, so unlike the
 * `reserve` knob it replaces it cannot tilt the ladder, and it is bounded, so
 * it cannot produce the never-ending match that knob also produced. Six
 * single-target towers is 360g against 600g of starting gold: an opening a
 * human would recognise, paid for before the first income tick.
 */
const OPENING_TOWERS = 6

/**
 * How much maze one point of income justifies.
 *
 * The tower target has to be tied to the ECONOMY, not to the clock, and getting
 * that wrong produced the worst behaviour in the project. Sized by tier, the bot
 * aimed at 45 towers from minute two and then spent twenty minutes buying them
 * one at a time on starting income -- because income only grows by sending, and
 * it was not sending, because it was still building. A deadlock: 45 towers at
 * 32 income is twenty minutes of nothing, and the measured match had both
 * players untouched on 20 lives for 29 of its 31 minutes.
 *
 * Tied to income it self-corrects. A poor bot wants a small maze, sends to get
 * richer, and can then afford a bigger one. Which is how a person plays: you do
 * not open by building forty-five towers.
 */
const TOWERS_PER_INCOME = 0.16


/**
 * Ceiling on the maze the bot will build before it starts banking.
 *
 * Without it a defensive bot's build phase never ends: the target grows with
 * every tier, so it keeps finding a tile worth filling, never banks, never
 * sends anything that can get through, and the match runs out the clock with
 * both sides untouched. The ceiling guarantees the banking phase arrives.
 */
const MAX_TOWER_TARGET = 45

/**
 * Income periods the bot will bank before it gives up and sends what it has.
 *
 * Saving is the whole difference between a bot that applies pressure and one
 * that does not. Spending on every chance to spend keeps its gold pinned near
 * its income, and a creep bought out of one income period dies in a maze built
 * out of forty of them — two bots ran 33 minutes and 1,478 sends without a
 * single leak that way, which reads exactly like a balance problem and is not.
 *
 * The ceiling is the other half. An earlier attempt saved for a fixed tier
 * instead and spiralled: refusing to send cost it the income that sends pay,
 * so it got poorer, so the tier receded further. Saving has to be bounded by
 * something the bot already has, and its own income is that thing.
 */
const MAX_SAVING_PERIODS = 2

/** Creeps that must be in the lane before their mix counts as information. */
const MIN_THREAT_SAMPLE = 3

/** See AdaptiveMode: reading the board pays off on offence only. */
const DEFAULT_ADAPTIVE: AdaptiveMode = 'send'

/**
 * Difficulty is how much of its economy the bot commits to attacking.
 *
 * It was the reaction delay, and that was a symptom of a broken economy rather
 * than a design. Back then a higher spend ratio measurably played *worse*, so
 * shipping it as "hard" would have shipped a weaker opponent under a stronger
 * name, and the only axis left pointing the right way was latency.
 *
 * Attacking pays now, and a sweep of the ratio comes out perfectly monotone:
 * 0.8 beats 0.65 beats 0.5 beats 0.4 beats 0.3 beats 0.2, with no exceptions.
 * That is both a better ladder and a far better answer to "what makes this one
 * hard" than a number of milliseconds -- the hard bot sends more, which is what
 * a stronger opponent does in a game about sending.
 *
 * Verified transitive by a round robin in the harness: every off-diagonal goes
 * to the more aggressive bot and every mirror is a draw, which also proves the
 * sim gives neither seat an edge.
 */
export const BOT_EASY: BotConfig = { sendRatio: 0.3, reactionTicks: 10, template: 0 }
export const BOT_NORMAL: BotConfig = { sendRatio: 0.5, reactionTicks: 10, template: 0 }
export const BOT_HARD: BotConfig = { sendRatio: 0.75, reactionTicks: 10, template: 0 }

/**
 * One decision. Returns `null` when the bot chooses to do nothing this tick,
 * which the caller should treat as `Kind.None`.
 *
 * Pure: a function of (state, player, config) plus the deterministic tick
 * counter. No clock, no randomness — the roster and template scans are ordered,
 * so ties break by index rather than by chance.
 */
export function botCommand(
  state: GameState,
  player: 0 | 1,
  config: BotConfig = BOT_NORMAL,
): Command | null {
  // Reaction delay. Acting on every tick would make the bot inhumanly quick to
  // punish a leak, which is a difficulty knob rather than an intelligence one.
  if (state.tick % config.reactionTicks !== 0) return null

  const lane = state.lanes[player] as Lane
  const me = state.players[player] as Player

  const emergency = findLoopingCreep(lane)
  if (emergency !== -1) {
    const cmd = reinforceRoute(state, player, lane)
    if (cmd) return cmd
    // Nothing affordable to reinforce with. Fall through rather than idling:
    // sending back is still better than doing nothing.
  }

  // Build the opening before anything else. Sending with an empty lane is how
  // the bot ends up with no maze at all, and it loses nothing by waiting: gold
  // only arrives faster once the towers exist to keep it alive.
  if (towerCount(lane) < OPENING_TOWERS) {
    const opening = nextTemplateTile(state, player, lane, config, me.gold)
    if (opening) return opening
    // Cannot afford it yet. Hold rather than spending the gold on a creep --
    // that fall-through is exactly what stops the maze from ever being built.
    return null
  }

  // The split, applied to GOLD rather than to whichever decision came up.
  //
  // Per-decision looked equivalent and was not. A decision is only a chance to
  // spend, so acting more often spent more gold, and the reaction delay quietly
  // became a second economy knob. The harness measured the result and it was
  // backwards: a bot reacting every 2 seconds beat the same bot reacting every
  // 0.3 seconds, because the fast one's build branch found an affordable tile
  // on nearly every decision and starved its own sends. Splitting the gold
  // instead leaves reaction delay meaning only what it says — the same mix of
  // spending, sooner.
  const unlocked = unlockedTier(state.tick)
  // What it is saving for: the heaviest creep a few income periods will buy,
  // not the heaviest the ladder offers.
  //
  // Aiming at the top of the ladder looked ambitious and was paralysis. By
  // minute seven the newest tier's tank cost 2.3 million gold on an income of
  // 25, so the bot banked toward it forever and sent one creep in twenty-two
  // minutes -- which also meant its income never grew, because income only
  // comes from sending. Aiming at what the next few income ticks can actually
  // buy produces the opposite loop: send, earn, afford more, send bigger.
  // Counter-pick: send into their maze what their maze is worst at. This is
  // the reason their board is drawn on your screen at all.
  const adaptive = config.adaptive ?? DEFAULT_ADAPTIVE
  const wantsCounter = adaptive === 'send' || adaptive === 'both'
  const theirMaze = wantsCounter ? readMaze(state.lanes[opponentOf(player)]!) : null
  const prefer = theirMaze === null ? null : (EXPLOITS[theirMaze] as CreepArchetypeKind)
  const target = affordableSoon(
    state,
    me.income * (config.savingPeriods ?? MAX_SAVING_PERIODS),
    unlocked,
    prefer,
  )

  // Two phases per tier: build the maze this tier needs, then bank for the
  // creep this tier offers. It is how a person plays and it is the only shape
  // that gives both, because saving and building compete for the same gold.
  //
  // Splitting the purse instead does not work, and both ways of splitting it
  // failed here first. A fraction for each let the build half spend the gold
  // the send half was saving, so the bot held 642 gold against a maze dealing
  // 128,861 damage a lap. Reserving the creep's price instead reserved more
  // than the bot owned, so the build budget was zero all match, the maze never
  // grew past its opening, and every spend ratio played a byte-identical game.
  //
  // The ratio now sets how big a maze counts as enough for the tier: a
  // defensive bot builds more towers per tier and banks later, an aggressive
  // one settles for a thinner maze and buys a heavier creep.
  const defensiveness = (1 - config.sendRatio) * 2
  const towerTarget = Math.min(
    MAX_TOWER_TARGET,
    OPENING_TOWERS + Math.round(me.income * TOWERS_PER_INCOME * defensiveness),
  )
  const canBuild = towerCount(lane) < towerTarget
  // In the build phase gold is for towers; in the banking phase it is not.
  const buildBudget = canBuild ? me.gold : 0

  // There is no send/build alternation any more, and removing it was the fix
  // for a ladder that kept coming out backwards.
  //
  // The old scheme let the ratio decide which decisions were send decisions,
  // which quietly made the reaction delay a spending knob as well as a latency
  // one -- the window it carved out of each cycle was a different shape at
  // every reaction speed, so a bot that reacted faster sent at different
  // moments rather than simply sooner, and reacted its way into worse
  // purchases. Each knob now does one thing: the ratio sets how big a maze
  // counts as enough (above), the delay sets how quickly the bot notices.
  // Phase order, and it is load-bearing: build first, then bank.
  //
  // With the send/build alternation gone, whichever branch is tested first
  // wins outright, because at every tier there is always some creep the bot can
  // afford. Testing sends first meant it never built past its opening six
  // towers in a whole match. Build until the maze meets the target for this
  // tier, then let everything else go into the next creep.
  if (canBuild) {
    const build = nextTemplateTile(state, player, lane, config, buildBudget)
    if (build) return build
    const upgrade = bestUpgrade(state, player, lane, buildBudget)
    if (upgrade) return upgrade
  }

  if (emergency === -1 && target !== -1) {
    if (me.gold >= creepSpec(target).cost) {
      return { tick: state.tick, player, kind: Kind.Send, creep: target }
    }
    // Not yet. Bank -- and bank nothing below may spend.
    return null
  }

  // Banking means banking. Nothing below may spend the gold the branch above is
  // saving.
  //
  // This branch used to read "deepen the maze rather than idle -- an upgrade is
  // never wasted" and spend the whole purse on upgrades whenever the target
  // creep was out of reach, which is most of the time. So the bank never
  // filled, the maze grew on every spare coin for the entire match, and nothing
  // ever got through: measured, both players sat on all 20 lives for 29 minutes
  // of a 31-minute match and then collapsed in 90 seconds once the geometric
  // creep ladder finally outran a fully upgraded maze. It is the same mistake
  // the build branch made earlier -- a branch below the saving logic quietly
  // spending its savings -- and it is worth stating the rule rather than the
  // fix: only ONE phase may spend.
  if (target !== -1) return null

  // Nothing to save toward at all. Now an upgrade is genuinely free money.
  const upgrade = bestUpgrade(state, player, lane, me.gold)
  if (upgrade) return upgrade

  const send = bestSend(state, player, me.gold)
  if (send !== -1) return { tick: state.tick, player, kind: Kind.Send, creep: send }
  return null
}

/**
 * The heaviest creep within reach of a budget, preferring the highest tier.
 *
 * Tier first, then cost: HP per gold rises as you buy up, so a tier-6 swarm is
 * a better use of the same gold than a tier-3 tank, and the ladder is the only
 * thing that ever breaks a maze.
 */
function affordableSoon(
  state: GameState,
  budget: number,
  maxTier: number,
  prefer: CreepArchetypeKind | null,
): number {
  // Two passes rather than a weighted score. The preferred archetype wins only
  // if it can be had at the same tier the budget already reaches -- dropping a
  // tier to get the right shape is a bad trade, because HP per gold rises with
  // the ladder and a tier is worth more than a matchup.
  const pick = (want: CreepArchetypeKind | null): number => {
    let best = -1
    let bestTier = -1
    let bestCost = -1
    for (let i = 0; i < CREEPS.length; i++) {
      const spec = creepSpec(i)
      if (want !== null && spec.archetype !== want) continue
      if (spec.tier > maxTier) continue
      if (spec.cost > budget) continue
      if (state.tick < tierUnlockTick(spec.tier)) continue
      if (spec.tier > bestTier || (spec.tier === bestTier && spec.cost > bestCost)) {
        best = i
        bestTier = spec.tier
        bestCost = spec.cost
      }
    }
    return best
  }
  const any = pick(null)
  if (prefer === null || any === -1) return any
  const wanted = pick(prefer)
  if (wanted === -1) return any
  return creepSpec(wanted).tier === creepSpec(any).tier ? wanted : any
}

/** Highest creep tier buyable at this tick. */
function unlockedTier(tick: number): number {
  let tier = 0
  while (tier + 1 <= MAX_TIER && tick >= tierUnlockTick(tier + 1)) tier += 1
  return tier
}

/** How many towers stand in a lane. */
function towerCount(lane: Lane): number {
  let n = 0
  for (let i = 0; i < lane.towers.kind.length; i++) {
    if (lane.towers.kind[i] !== -1) n += 1
  }
  return n
}

/** Index of the creep that has already leaked at least once, or -1. */
function findLoopingCreep(lane: Lane): number {
  const c = lane.creeps
  let worst = -1
  let worstLaps = 0
  for (let i = 0; i < c.count; i++) {
    const laps = c.laps[i] as number
    if (laps > worstLaps) {
      worstLaps = laps
      worst = i
    }
  }
  return worst
}

/**
 * Emergency: put damage where the creeps actually walk.
 *
 * Upgrading a tower already covering the route beats building a new one — it is
 * immediate, it cannot fail the no-block check, and it cannot lengthen the path
 * in a way that invalidates the reasoning that chose it.
 */
function reinforceRoute(state: GameState, player: 0 | 1, lane: Lane): Command | null {
  const route = pathFrom(lane.field, SPAWN_INDICES[0] as number)
  if (route.length === 0) return null

  // Upgrade the strongest-value tower adjacent to the route.
  let bestTile = -1
  let bestLevel = MAX_LEVEL + 1
  for (const tile of route) {
    for (const n of neighbours(tile)) {
      if (lane.towers.kind[n] === -1) continue
      const level = lane.towers.level[n] as number
      if (level >= MAX_LEVEL) continue
      if (checkUpgrade(state, player, tileX(n), tileY(n)) !== Refusal.None) continue
      // Prefer the least-upgraded tower: levelling a 1 to a 2 is the cheapest
      // damage available, and spreading levels beats maxing one tower early.
      if (level < bestLevel) {
        bestLevel = level
        bestTile = n
      }
    }
  }
  if (bestTile !== -1) {
    return { tick: state.tick, player, kind: Kind.Upgrade, x: tileX(bestTile), y: tileY(bestTile) }
  }

  // No upgrade available: drop a new tower beside the route.
  for (const tile of route) {
    for (const n of neighbours(tile)) {
      const x = tileX(n)
      const y = tileY(n)
      if (checkBuild(state, player, x, y, TowerKind.Single).refusal !== Refusal.None) continue
      return { tick: state.tick, player, kind: Kind.Build, tower: TowerKind.Single, x, y }
    }
  }
  return null
}

/** Four-connected neighbours, in the same N,E,S,W order the field uses. */
function neighbours(tile: number): number[] {
  const x = tileX(tile)
  const y = tileY(tile)
  const out: number[] = []
  if (y > 0) out.push(tile - GRID_W)
  if (x < GRID_W - 1) out.push(tile + 1)
  out.push(tile + GRID_W)
  if (x > 0) out.push(tile - 1)
  return out.filter((t) => t >= 0 && t < TILE_COUNT)
}

/**
 * The next tile from the template that is legal and affordable.
 *
 * Tower choice rotates by position rather than by need, which is the honest
 * limit of a template bot: it produces a mixed maze, not a considered one.
 */
function nextTemplateTile(
  state: GameState,
  player: 0 | 1,
  lane: Lane,
  config: BotConfig,
  budget: number,
): Command | null {
  const template = templateAt(config.template)
  // Answer what is actually in the lane. With nothing to read -- an empty lane
  // in the opening -- fall back to the fixed mix, which is at least balanced.
  const mode = config.adaptive ?? DEFAULT_ADAPTIVE
  const threat = mode === 'defence' || mode === 'both' ? readThreat(lane) : null
  for (let i = 0; i < template.tiles.length; i++) {
    const t = template.tiles[i] as Tile
    if (lane.blocked[tileIndex(t)] === 1) continue
    // Skew toward the answer, do not monopolise. A maze of one tower type has
    // no answer to the wave after this one, and the bot only ever adds towers
    // -- it never tears the wrong ones down -- so over-committing is permanent.
    const tower =
      threat === null || i % 3 === 2 ? towerForIndex(i) : (ANSWERS[threat] as TowerKind)
    if (levelOf(tower, 1).cost > budget) continue
    if (checkBuild(state, player, t.x, t.y, tower).refusal !== Refusal.None) continue
    return { tick: state.tick, player, kind: Kind.Build, tower, x: t.x, y: t.y }
  }
  return null
}

/**
 * Roughly 3 single-target to 1 splash to 1 slow, by template position.
 *
 * The fallback when the bot has nothing to react to -- an empty lane in the
 * opening, before anyone has sent anything.
 */
function towerForIndex(i: number): TowerKind {
  const m = i % 5
  if (m === 3) return TowerKind.Splash
  if (m === 4) return TowerKind.Slow
  return TowerKind.Single
}

/**
 * What is actually coming down my lane, weighted by HP.
 *
 * Weighted, not counted: eight swarm creeps and one tank are not the same
 * problem even when the tank is outnumbered eight to one, and the thing a maze
 * has to chew through is hit points rather than bodies.
 *
 * Returns null when the lane is empty, which the caller must treat as "no
 * information" rather than "no threat" -- answering an empty lane by building
 * anti-swarm towers would just be a differently arbitrary template.
 */
function readThreat(lane: Lane): CreepArchetypeKind | null {
  const c = lane.creeps
  // One creep is not a read. Adapting to a sample of one made the bot skitter
  // between tower types on whatever happened to be walking past, and it
  // measurably LOST to the fixed template at low send rates -- where lanes are
  // usually near-empty and the "threat" was almost always a sample of one.
  if (c.count < MIN_THREAT_SAMPLE) return null

  const hp = [0, 0, 0]
  let total = 0
  for (let i = 0; i < c.count; i++) {
    const spec = creepSpec(c.spec[i] as number)
    hp[spec.archetype] = (hp[spec.archetype] as number) + (c.hp[i] as number)
    total += c.hp[i] as number
  }
  let best: CreepArchetypeKind = CreepArchetypeKind.Swarm
  for (let k = 1; k < hp.length; k++) {
    if ((hp[k] as number) > (hp[best] as number)) best = k as CreepArchetypeKind
  }
  // A plurality is not enough either: answering a mixed wave by specialising
  // against its largest third is worse than staying balanced.
  return (hp[best] as number) * 2 > total ? best : null
}

/**
 * The tower that answers a threat.
 *
 * Straight from the data: each tower archetype declares what it `answers`, and
 * the three form a cycle -- splash for swarms, slow for runners, single-target
 * for tanks. Hard-coding the pairing here rather than reading the string keeps
 * it out of the hot path; `assertData` pins the file order it depends on.
 */
const ANSWERS: readonly TowerKind[] = [
  TowerKind.Splash, // swarms
  TowerKind.Slow, // runners
  TowerKind.Single, // tanks
]

/**
 * The creep that exploits a maze.
 *
 * The inverse of the table above, and the reason the opponent's board is drawn
 * on your screen at all: counter-picking is premise-level, so a bot that never
 * looks at the maze it is sending into is not playing the same game as its
 * opponent. A maze of anti-tank towers kills one target at a time and drowns in
 * swarm; a maze of splash does little to a single fat creep.
 */
const EXPLOITS: readonly CreepArchetypeKind[] = [
  CreepArchetypeKind.Swarm, // vs single-target
  CreepArchetypeKind.Tank, // vs splash
  CreepArchetypeKind.Tank, // vs slow
]

/** The dominant tower archetype in a lane, weighted by gold sunk into it. */
function readMaze(lane: Lane): TowerKind | null {
  const t = lane.towers
  const worth = [0, 0, 0]
  let any = false
  for (let i = 0; i < t.kind.length; i++) {
    const kind = t.kind[i] as number
    if (kind === -1) continue
    any = true
    worth[kind] = (worth[kind] as number) + investedIn(kind as TowerKind, t.level[i] as number)
  }
  if (!any) return null
  let best = 0
  for (let k = 1; k < worth.length; k++) {
    if ((worth[k] as number) > (worth[best] as number)) best = k
  }
  return best as TowerKind
}

/** Cheapest useful upgrade anywhere in the lane, preferring low levels. */
function bestUpgrade(
  state: GameState,
  player: 0 | 1,
  lane: Lane,
  budget: number,
): Command | null {
  let bestTile = -1
  let bestLevel = MAX_LEVEL + 1
  for (let i = 0; i < lane.towers.kind.length; i++) {
    const kind = lane.towers.kind[i] as number
    if (kind === -1) continue
    const level = lane.towers.level[i] as number
    if (level >= bestLevel) continue
    if (level < MAX_LEVEL && levelOf(kind as TowerKind, level + 1).cost > budget) continue
    if (checkUpgrade(state, player, tileX(i), tileY(i)) !== Refusal.None) continue
    bestLevel = level
    bestTile = i
  }
  if (bestTile === -1) return null
  return { tick: state.tick, player, kind: Kind.Upgrade, x: tileX(bestTile), y: tileY(bestTile) }
}

/**
 * Which creep to send, given a budget.
 *
 * Escalates: prefers the highest unlocked tier it can afford, and within a tier
 * the most expensive one, because a bot that only ever spams the cheapest creep
 * never becomes threatening no matter how much income it accumulates.
 */
function bestSend(state: GameState, player: 0 | 1, budget: number): number {
  let best = -1
  let bestTier = -1
  let bestCost = -1
  for (let i = 0; i < CREEPS.length; i++) {
    const spec = creepSpec(i)
    if (spec.cost > budget) continue
    if (state.tick < tierUnlockTick(spec.tier)) continue
    if (checkSend(state, player, i) !== Refusal.None) continue
    if (spec.tier > bestTier || (spec.tier === bestTier && spec.cost > bestCost)) {
      best = i
      bestTier = spec.tier
      bestCost = spec.cost
    }
  }
  return best
}

export { opponentOf, levelOf }
