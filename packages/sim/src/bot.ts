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
  SEND_UNLOCK_TICKS,
} from './data'
import { opponentOf, SPAWN_PERIOD, type GameState, type Lane, type Player } from './state'
import { Kind, Refusal, checkBuild, checkUpgrade, checkSend, type Command } from './step'
import { templateAt } from './maze'
import { buildField, createField, spawnsReachable } from './field'
import { routeOf, waveLeaks, laneThreat, type TowerOverride } from './threat'

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
 * Two things sit in front of that loop when the bot reads the board with the
 * maze-strength model in `threat.ts`, which it does by default: a wave that
 * the model says ends the match is sent at once, and a flood the model says
 * will leak from the bot's own lane is answered before it does. See `Reader`
 * and `decideByEstimate` for what was measured and what was rejected.
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

/**
 * HOW the bot reads a board, as distinct from which sides of it (`adaptive`).
 *
 * `table` is the original: a maze is summarised as its dominant tower kind and
 * answered from a three-row lookup, a lane as its dominant creep kind likewise.
 * `estimate` runs the maze-strength model in `threat.ts` instead -- route
 * length, towers in reach, levels, fire rates, wave size -- and picks the send
 * that is predicted to leak most per gold, the fix that is predicted to stop
 * the most leaks per gold, and the wave that ends the match when one exists.
 * See the head-to-head figures on DEFAULT_READER before treating either as the
 * better one.
 */
export type Reader = 'table' | 'estimate'

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
  /** See Reader. */
  readonly reader?: Reader
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
 * single-target towers is 3600g against 6000g of starting gold: an opening a
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
 *
 * ITS UNITS ARE TOWERS PER GOLD, so it is the one constant here that the x10
 * gold rescale had to move -- 0.16 became 0.016. Everything else in this file
 * counts towers, periods or ticks and was scale-free, which is exactly why this
 * one is easy to miss: nothing fails loudly. Left at 0.16 both spend ratios
 * simply saturate the tower ceiling, build the identical fifteen-tower maze,
 * and the ratio silently stops meaning anything at all. `spends the ratio` in
 * test/bot.test.ts is the test that catches it.
 */
const TOWERS_PER_INCOME = 0.016


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

/**
 * See AdaptiveMode. Under the table reader, reading the board paid off on
 * offence only and `send` was the default. Under the estimate reader the
 * defence half is the whole gain -- predicting a flood beats reacting to a
 * lap -- and `both` is what the figures on DEFAULT_READER were measured with.
 * `estimate` with `send` alone only draws with the table.
 */
const DEFAULT_ADAPTIVE: AdaptiveMode = 'both'

/**
 * See Reader. Measured before it was chosen, both seats, templates 0 and 1,
 * 30,000-tick ceiling (template 2 collapses for every bot inside two minutes
 * and draws, so it measures nothing):
 *
 *   estimate vs table, same ratio and template:
 *     easy    4-0-2     normal  4-0-2     hard  2-0-4 (the hard t0 pair is a
 *                                               mutual collapse either way)
 *   estimate on template 1 vs table on template 0 -- the shipped change:
 *     easy    6-0-0     normal  6-0-0     hard  6-0-0, all 20 lives to 0
 *   ladder under estimate, template 1:
 *     hard > normal 6-0, normal > easy 6-0, hard > easy 6-0, mirror 0-0-6
 *
 * What the model does NOT do is choose sends; see decideByEstimate.
 */
const DEFAULT_READER: Reader = 'estimate'

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
/**
 * Template 1, the tight serpentine: a wall every other row, one corridor
 * between, which is the maze a player actually builds. Template 0 walled
 * every third row and wasted a row per wall; the full tight serpentine walks
 * 100 tiles for 77 towers where template 0 walks 72 for 49, and at 45 towers
 * it deals 13,290 damage a lap to a tank against 11,400 -- 17% more per tower
 * for the same gold. Head to head the same bot on template 1 beats itself on
 * template 0 six matches out of six, 20 lives to 0.
 *
 * The cost is in the mirror: two equal defenders on a proper maze leak
 * nothing until the economy outgrows it, so the easy mirror runs 22.7
 * minutes with the first leak at minute 18 and peaks at 2,620 creeps. That
 * is issue #8 -- the bounded ladder has no valve -- showing through a better
 * defence, and the harness pins it as such rather than pinning the bot to a
 * worse maze.
 *
 * Template 2 ("posts") loses 0-6 in under two minutes and stays in the list
 * only so the harness can keep saying so.
 */
export const BOT_EASY: BotConfig = { sendRatio: 0.3, reactionTicks: 10, template: 1 }
export const BOT_NORMAL: BotConfig = { sendRatio: 0.5, reactionTicks: 10, template: 1 }
export const BOT_HARD: BotConfig = { sendRatio: 0.75, reactionTicks: 10, template: 1 }

/**
 * One decision. Returns the commands it wants applied this tick, empty when it
 * chooses to do nothing.
 *
 * A decision yields at most one BUILD or one UPGRADE, because a maze is placed
 * a tile at a time and the next tile depends on the last. Sends are different:
 * one purchase is one creep, so wanting a wave means saying so once per creep,
 * and the array is how the bot says it -- see `sendBurst` for why a single
 * command per decision would have quietly crippled its economy.
 *
 * Pure: a function of (state, player, config) plus the deterministic tick
 * counter. No clock, no randomness — the roster and template scans are ordered,
 * so ties break by index rather than by chance.
 */
export function botCommand(
  state: GameState,
  player: 0 | 1,
  config: BotConfig = BOT_NORMAL,
): readonly Command[] {
  // Reaction delay. Acting on every tick would make the bot inhumanly quick to
  // punish a leak, which is a difficulty knob rather than an intelligence one.
  if (state.tick % config.reactionTicks !== 0) return NONE

  const lane = state.lanes[player] as Lane
  const me = state.players[player] as Player

  const emergency = findLoopingCreep(lane)
  if (emergency !== -1) {
    const cmd = reinforceRoute(state, player, lane)
    if (cmd) return [cmd]
    // Nothing affordable to reinforce with. Fall through rather than idling:
    // sending back is still better than doing nothing.
  }

  // Build the opening before anything else. Sending with an empty lane is how
  // the bot ends up with no maze at all, and it loses nothing by waiting: gold
  // only arrives faster once the towers exist to keep it alive.
  if (towerCount(lane) < OPENING_TOWERS) {
    const opening = nextTemplateTile(state, player, lane, config, me.gold)
    if (opening) return [opening]
    // Cannot afford it yet. Hold rather than spending the gold on a creep --
    // that fall-through is exactly what stops the maze from ever being built.
    return NONE
  }

  if ((config.reader ?? DEFAULT_READER) === 'estimate') {
    return decideByEstimate(state, player, lane, me, config, emergency)
  }
  return decideByTable(state, player, lane, me, config, emergency)
}

/**
 * The decision as the table reader makes it, past the opening: build to the
 * tier's target, then bank toward the heaviest creep a few income periods
 * buy, then send it as a burst. Every comment in here records a measurement
 * that moved it; read them before moving anything.
 */
function decideByTable(
  state: GameState,
  player: 0 | 1,
  lane: Lane,
  me: Player,
  config: BotConfig,
  emergency: number,
): readonly Command[] {
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
  // Nothing to save toward during the opening build phase. `checkSend` would
  // refuse the send anyway and `step` would drop it, so the bot would not cheat
  // -- but it would BANK for a purchase it cannot make, and banking is a branch
  // that forbids everything below it from spending. The bot would sit on its
  // 600 opening gold doing nothing for the whole phase while the human built a
  // maze. Zeroing the target here puts that gold into towers instead, which is
  // what the phase is for.
  const target = sendsOpen(state)
    ? affordableSoon(
        state,
        me.income * (config.savingPeriods ?? MAX_SAVING_PERIODS),
        unlocked,
        prefer,
      )
    : -1

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
    if (build) return [build]
    const upgrade = bestUpgrade(state, player, lane, buildBudget)
    if (upgrade) return [upgrade]
  }

  if (emergency === -1 && target !== -1) {
    if (me.gold >= creepSpec(target).cost) {
      // Spend the bank, not the purse.
      //
      // `target` was chosen as the heaviest creep `savingPeriods` of income can
      // reach, so that same figure is what the bot was banking FOR, and it is
      // the honest budget for this branch. Anything above it belongs to the
      // maze, and handing the whole purse to creeps is the mistake the two
      // comments above are about -- a branch below the saving logic spending
      // its savings.
      //
      // It mostly buys one, and that is the budget working rather than a
      // coincidence: the target is by construction the priciest creep the
      // budget reaches, so the division usually comes out at one. It comes out
      // higher exactly when the bot is rich enough that its target is cheap for
      // it, which is when a wave is the right answer.
      //
      // Capping this at one instead looked safer and was the bug: the easy
      // bot's tower target grows with income, so `canBuild` is nearly always
      // true, and a cap tied to it left the bot buying a sixth of what it used
      // to buy per decision for the whole match. Measured, the first life did
      // not leave the board until 92% of the way through.
      const bank = me.income * (config.savingPeriods ?? MAX_SAVING_PERIODS)
      return sendBurst(state, player, target, Math.min(me.gold, bank), MAX_SEND_BURST)
    }
    // Not yet. Bank -- and bank nothing below may spend.
    return NONE
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
  if (target !== -1) return NONE

  // Nothing to save toward at all. Now an upgrade is genuinely free money.
  const upgrade = bestUpgrade(state, player, lane, me.gold)
  if (upgrade) return [upgrade]

  // Nothing is being saved for and the maze is done: the whole purse is spare.
  const send = bestSend(state, player, me.gold)
  if (send !== -1) return sendBurst(state, player, send, me.gold, MAX_SEND_BURST)
  return NONE
}

/** No command this decision. Shared and frozen so the empty case allocates nothing. */
const NONE: readonly Command[] = Object.freeze([])

/**
 * Most creeps one decision may buy.
 *
 * Not a balance number -- gold runs out long before this in any measured match.
 * It exists for two reasons. A single decision must not append an unbounded run
 * to the command log, which is replayed and hashed and which a late-game income
 * could otherwise make arbitrarily long. And it is pinned to SPAWN_PERIOD
 * because creeps spawning at the same point on the same tick are welded
 * together for the rest of the match: `spawnPointFor` can give 22 arrivals
 * distinct starting points, so 22 is what a decision may buy. Raise them
 * together or not at all.
 */
const MAX_SEND_BURST = SPAWN_PERIOD

/**
 * Buy as many of one creep as the purse allows, as separate commands.
 *
 * One purchase is one creep and one command, so a decision that wants a wave has
 * to say so N times -- exactly as a player does by clicking N times. This used
 * to be a single command, and that was correct while a purchase was a PACK: one
 * command bought six swarm, and the bot and the player got the same six from it.
 *
 * With the pack gone, one command per decision would have capped the bot at two
 * purchases a second -- one per `reactionTicks` -- against the nine a player
 * gets from holding a send card. Income grows only by buying, so the cap would
 * not have made the bot merely slower to attack: its economy would have
 * compounded roughly six times slower for the rest of the match, and every
 * balance number measured afterwards would have been measured against an
 * opponent that could not play.
 *
 * `max` is how the caller keeps the other phase's gold out of it. Spending the
 * whole purse is right only once the maze has met its target and the gold is
 * genuinely spare; while the build phase still wants it, the caller passes 1 and
 * the leftover keeps accumulating toward the next tile, exactly as it did when a
 * decision could only ever buy one thing. Getting this wrong does not look like
 * a bug, it looks like a bot that stopped building -- measured, both spend
 * ratios settled on the same fifteen-tower maze.
 */
function sendBurst(
  state: GameState,
  player: 0 | 1,
  creep: number,
  gold: number,
  max: number,
): readonly Command[] {
  const cost = creepSpec(creep).cost
  if (cost <= 0) return NONE
  const affordable = Math.floor(gold / cost)
  const capped = affordable > MAX_SEND_BURST ? MAX_SEND_BURST : affordable
  const n = capped > max ? max : capped
  const out: Command[] = []
  for (let i = 0; i < n; i++) {
    out.push({ tick: state.tick, player, kind: Kind.Send, creep })
  }
  return out
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
  threat: CreepArchetypeKind | null = tableThreat(lane, config),
): Command | null {
  const template = templateAt(config.template)
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
 * What the table reader answers the next tile with: the dominant creep in
 * the lane, when the mode reads the lane at all. With nothing to read -- an
 * empty lane in the opening -- null, and the fixed mix applies, which is at
 * least balanced.
 */
function tableThreat(lane: Lane, config: BotConfig): CreepArchetypeKind | null {
  const mode = config.adaptive ?? DEFAULT_ADAPTIVE
  return mode === 'defence' || mode === 'both' ? readThreat(lane) : null
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

// ---- the estimating reader ---------------------------------------------------

const KINDS: readonly TowerKind[] = [TowerKind.Single, TowerKind.Splash, TowerKind.Slow]
const routeA: number[] = []
const routeB: number[] = []
const routeC: number[] = []
const probeBlocked = new Uint8Array(TILE_COUNT)
const probeField = createField()
const seen = new Uint8Array(TILE_COUNT)

interface Wave {
  readonly creep: number
  readonly count: number
  readonly leaks: number
}

/**
 * The decision, when the bot reads the board with the model in `threat.ts`.
 *
 * The table reader's play, with two things put in front of it that the table
 * cannot do:
 *
 *   1. A wave predicted to take the opponent's last lives is sent at once,
 *      whatever phase the bot is in. Holding a winning hand to finish a maze
 *      is how a bot loses a match it had won.
 *   2. A flood predicted to leak from the bot's own lane is answered BEFORE
 *      it leaks, with whichever build or upgrade is predicted to stop the
 *      most of it per gold. The table reader only ever reacts to a creep that
 *      has already lapped, and it answers with the tower that counters the
 *      lane's dominant creep -- which the model says is the wrong question:
 *      what stops a flood is splash and a longer route, whatever is in it.
 *
 * What it deliberately does NOT do is choose sends by the model. That was
 * built and measured: picking the wave predicted to leak most, and sending
 * every decision instead of banking, lost 0-4 to the table's bank-and-burst
 * rhythm at normal, because it dribbled the cheapest creep between income
 * lumps where the table waited and sent the heaviest tier as one wave. The
 * table's send rule stays. Nor does it hold gold for a fix it cannot afford:
 * that stalled the build branch too, and a hard bot with a thin maze died in
 * four minutes holding six hundred gold.
 *
 * Measured against the table reader, both seats, templates 0 and 1 (template
 * 2 is a mutual collapse for every bot): see DEFAULT_READER.
 */
function decideByEstimate(
  state: GameState,
  player: 0 | 1,
  lane: Lane,
  me: Player,
  config: BotConfig,
  emergency: number,
): readonly Command[] {
  const adaptive = config.adaptive ?? DEFAULT_ADAPTIVE

  // 1. Finish it.
  if (sendsOpen(state) && emergency === -1) {
    const opp = state.lanes[opponentOf(player)] as Lane
    const wave = bestWave(state, player, opp, routeOf(opp, routeA), me.gold)
    if (wave && wave.leaks >= (state.players[opponentOf(player)] as Player).lives) {
      return sendBurst(state, player, wave.creep, me.gold, wave.count)
    }
  }

  // 2. Stop the flood that is coming, before it arrives.
  if (adaptive === 'defence' || adaptive === 'both') {
    const fix = shoreUp(state, player, lane, routeOf(lane, routeB), me.gold, config)
    if (fix) return [fix]
  }

  // 3. Otherwise play the table's game, reading the lane for the next tile
  // only as the table would.
  return decideByTable(state, player, lane, me, config, emergency)
}

/**
 * The wave a budget buys that the model predicts leaks most against this
 * maze, or null when nothing affordable is predicted to leak at all.
 *
 * Absolute leaks rather than per gold: a decision may buy at most
 * MAX_SEND_BURST creeps, so per gold would pick twenty-two of the cheapest
 * creep and leave a rich bot unable to spend. Used only to ask whether a
 * wave ends the match; see decideByEstimate for why it does not choose the
 * ordinary send.
 */
function bestWave(
  state: GameState,
  player: 0 | 1,
  opp: Lane,
  oppRoute: readonly number[],
  budget: number,
): Wave | null {
  let best: Wave | null = null
  for (let i = 0; i < CREEPS.length; i++) {
    if (checkSend(state, player, i) !== Refusal.None) continue
    const spec = creepSpec(i)
    if (spec.cost <= 0) continue
    let count = Math.floor(budget / spec.cost)
    if (count > MAX_SEND_BURST) count = MAX_SEND_BURST
    if (count < 1) continue
    const leaks = waveLeaks(opp, oppRoute, i, count)
    if (leaks >= 1 && (best === null || leaks > best.leaks)) best = { creep: i, count, leaks }
  }
  return best
}

/**
 * Answer a flood the model says will leak from this lane.
 *
 * Returns the affordable build or upgrade predicted to stop the most leaks
 * per gold, or null when nothing is predicted to leak or nothing affordable
 * would change that. It never asks the caller to hold gold for a fix it
 * cannot yet afford: that was tried, and holding also stalled the ordinary
 * build branch, which is the fix that was actually affordable.
 *
 * Candidates are every upgrade of a tower beside the route, and the next
 * template tile under each tower kind. That is the whole search: a tower off
 * the route changes nothing, and a tile off the template is a maze the
 * template did not plan for.
 */
function shoreUp(
  state: GameState,
  player: 0 | 1,
  lane: Lane,
  route: readonly number[],
  gold: number,
  config: BotConfig,
): Command | null {
  const threat = laneThreat(lane, route)
  if (threat < 1) return null

  let best: Command | null = null
  let bestScore = 0
  const consider = (cmd: Command, cost: number, after: number): void => {
    const stopped = threat - after
    if (stopped <= 0 || cost > gold) return
    const score = stopped / cost
    if (score > bestScore) {
      bestScore = score
      best = cmd
    }
  }

  seen.fill(0)
  for (const tile of route) {
    for (const n of neighbours(tile)) {
      if (seen[n] === 1) continue
      seen[n] = 1
      const kind = lane.towers.kind[n] as number
      if (kind === -1) continue
      const level = lane.towers.level[n] as number
      if (level >= MAX_LEVEL) continue
      const cost = levelOf(kind as TowerKind, level + 1).cost
      if (cost > gold) continue
      if (checkUpgrade(state, player, tileX(n), tileY(n)) !== Refusal.None) continue
      const override: TowerOverride = { tile: n, kind: kind as TowerKind, level: level + 1 }
      const after = laneThreat(lane, route, override)
      consider({ tick: state.tick, player, kind: Kind.Upgrade, x: tileX(n), y: tileY(n) }, cost, after)
    }
  }

  const tile = nextFreeTemplateTile(lane, config)
  if (tile !== -1) {
    // The candidate's route, without touching the lane: a copy of the blocked
    // map with the tile set, and a probe field built from it.
    probeBlocked.set(lane.blocked)
    probeBlocked[tile] = 1
    buildField(probeBlocked, probeField)
    if (spawnsReachable(probeField)) {
      const newRoute = pathFrom(probeField, SPAWN_INDICES[0] as number, routeC)
      for (const kind of KINDS) {
        if (levelOf(kind, 1).cost > gold) continue
        const after = laneThreat(lane, newRoute, { tile, kind, level: 1 })
        consider(
          { tick: state.tick, player, kind: Kind.Build, tower: kind, x: tileX(tile), y: tileY(tile) },
          levelOf(kind, 1).cost,
          after,
        )
      }
    }
  }

  return best
}

/** First template tile with nothing on it, regardless of gold or sealing. */
function nextFreeTemplateTile(lane: Lane, config: BotConfig): number {
  const template = templateAt(config.template)
  for (let i = 0; i < template.tiles.length; i++) {
    const idx = tileIndex(template.tiles[i] as Tile)
    if (lane.blocked[idx] === 0) return idx
  }
  return -1
}

/** Whether the opening build phase has ended and creeps may be sent. */
function sendsOpen(state: GameState): boolean {
  return state.tick >= SEND_UNLOCK_TICKS
}
