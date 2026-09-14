import {
  GRID_W,
  TILE_COUNT,
  MAX_TOWERS,
  TOWER_SIZE,
  FOOTPRINT_CELLS,
  tileIndex,
  tileX,
  tileY,
  footprintCells,
  footprintInBuildArea,
  SPAWN_INDICES,
  type Tile,
} from './grid'
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
  suddenDeathScale,
  type CreepSpec,
} from './data'
import {
  INCOME_EVERY_TICKS,
  opponentOf,
  footprintOverlapsTower,
  type GameState,
  type Lane,
  type Player,
} from './state'
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

/**
 * How the counter-pick chooses WHICH archetype to send.
 *
 * `table` reads the opponent's maze as one word -- "mostly single-target" --
 * and answers from EXPLOITS. `model` asks the flood model what a bank's worth
 * of each archetype would leak against the maze that is actually standing
 * there, and sends the archetype that leaks most per gold; when nothing
 * affordable is predicted to leak, it sends the archetype that earns the
 * most income per gold, because a send that cannot hurt is an investment.
 *
 * The table was measured wrong on the 16-wide lane. "Swarm beats a
 * single-target maze" is true of a maze with NO mortar and false of one
 * with a mortar in every five towers, and the bot's own template is 3:1:1,
 * so both seats sent 82-99% of their gold as Swarm III whatever stood in
 * the other lane, and the first balance batches flagged Swarm as the
 * winner's main send in every match. Kept runnable so the two can be
 * measured against each other; the figures are on DEFAULT_COUNTER_PICK.
 */
export type CounterPick = 'table' | 'model'

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
  /** See CounterPick. */
  readonly counterPick?: CounterPick
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
 * See CounterPick. `model`, measured twice on the 16-wide lane.
 *
 * Before sudden death (splash 1.8, presets 0.2 / 0.4 / 0.5) the model pick
 * was 6-6 against the table but could not be the default: it broke the
 * ladder on the shipped template, ran every mirror to 31-35 minutes at
 * 5,000-7,000 creeps, and moved the batch's degenerate flag to Runner
 * rather than removing it. Mixed sends leak less on both sides, so both
 * sides held until income went exponential.
 *
 * Under sudden death (ADR-0026, presets 0.2 / 0.4 / 0.6), 2026-09-15:
 *
 *   harness 24/24 -- ladder transitive, mirrors 20-24 minutes, peak creeps
 *   814-2,072 against the 3,000 pin, 64-107 sends a minute.
 *   batch: normal beats easy 6-0, hard beats normal 6-0, hard beats easy
 *   6-0; 18/18 decided, none past 24,561 ticks, peak 943.
 *   mirror send mix by gold: easy 97% Swarm III; normal 81% Swarm III,
 *   17% Tank II; hard 44% Tank II, 29% Runner III, 26% Swarm III.
 *
 * The batch's flag still reads Swarm in every decided match, and by gold.
 * That is the fallback doing its job: when nothing affordable is predicted
 * to leak -- most of every match -- the model sends the best earner, and
 * both winner and loser do. A pattern both sides play is not a pattern
 * that is winning; the flag cannot tell the two apart, and that is its
 * limit rather than the roster's.
 */
const DEFAULT_COUNTER_PICK: CounterPick = 'model'

/**
 * Difficulty is how much of its economy the bot commits to attacking.
 *
 * It was the reaction delay, and that was a symptom of a broken economy rather
 * than a design. Back then a higher spend ratio measurably played *worse*, so
 * shipping it as "hard" would have shipped a weaker opponent under a stronger
 * name, and the only axis left pointing the right way was latency.
 *
 * Attacking pays now, but not without limit, and the ratio is NOT monotone
 * on the 16-wide lane. On the 8-wide one a sweep came out perfectly ordered
 * (0.8 beat 0.65 beat 0.5 beat 0.4 beat 0.3 beat 0.2); here the same sweep
 * is a tangle, and it changes shape with every balance rule, so the presets
 * are chosen the way the harness test says to: by searching the sweep for an
 * ordered triple that is transitive on the shipped template, never by
 * assuming more aggressive is harder. Six ratios pairwise, 9,000 starting
 * gold, splash 1.8, sudden death at 15:00, the model counter-pick,
 * 2026-09-15 -- "beats" reads row over column:
 *
 *   template 0 (shipped)   beats                  loses to
 *     0.2                  0.3                    0.4 0.5 0.6 0.75
 *     0.3                  nothing                everything
 *     0.4                  0.2 0.3 0.5            0.6 0.75
 *     0.5                  0.2 0.3 0.6 0.75       0.4
 *     0.6                  0.2 0.3 0.4            0.5 0.75
 *     0.75                 0.2 0.3 0.4 0.6        0.5
 *
 * 0.2 / 0.4 / 0.6 is transitive on all three templates in that sweep -- the
 * first triple to be since the lane grew -- with the winner keeping 15 to
 * 20 lives on the shipped one. Note what 0.75 losing to 0.5 means: the
 * hardest bot is not the most aggressive one that exists, it is the most
 * aggressive one that still beats everything below it, and a thin maze dies
 * in three minutes to a flood the ratio cannot cover.
 */
/**
 * Template 0, the half-slot serpentine with a two-row corridor (maze.ts).
 *
 * Template 1, the tight one with a one-row corridor, shipped from the 8-wide
 * lane on measurements that are history now: there it walked 100 tiles for
 * 77 towers where template 0 walked 72 for 49, and beat it six out of six.
 * On the 16-wide lane under sudden death, with the model counter-pick, the
 * same head-to-head goes the other way and it is not close (2026-09-15,
 * both seats, every preset, 40,000-tick ceiling):
 *
 *   template 0 vs template 1:  0 wins 6-0, 20 lives to 0 every time
 *   template 0 vs template 2:  0 wins 6-0, 20 lives to 0 every time
 *   template 1 vs template 2:  1 wins at easy and normal, 2 wins at hard
 *
 * A longer route per tower is not worth a corridor a creep crosses in a
 * fifth of a second: with ranges of nine tiles every tower already fires
 * for the whole lap, and what the tight maze buys is fewer towers in reach
 * of any one point of it. The bot builds template 0.
 *
 * Choosing the template by reading the opponent (issue #27) was measured
 * before it was built, and there is nothing to choose: one template wins
 * whatever the other seat sends or builds. The templates stay in the list
 * so the harness can keep saying so, and so a template can be re-measured
 * after the next balance rule without re-writing it.
 */
export const BOT_EASY: BotConfig = { sendRatio: 0.2, reactionTicks: 10, template: 0 }
export const BOT_NORMAL: BotConfig = { sendRatio: 0.4, reactionTicks: 10, template: 0 }
export const BOT_HARD: BotConfig = { sendRatio: 0.6, reactionTicks: 10, template: 0 }

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
  const prefer = !wantsCounter
    ? null
    : (config.counterPick ?? DEFAULT_COUNTER_PICK) === 'model'
      ? modelPick(state, player, me, config, unlocked)
      : tablePick(state, player)
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
 * could otherwise make arbitrarily long. And creeps spawning at the same point
 * on the same tick are welded together for the rest of the match, so it must
 * never exceed `SPAWN_PERIOD`, the number of distinct starting points
 * `spawnPointFor` can hand out.
 *
 * It used to BE `SPAWN_PERIOD`, when that was 22. The spawn zone made the
 * period 1760 (ADR-0022), and a decision that appends 1760 commands to the log
 * every ten ticks is the log-length problem the cap exists to prevent -- so
 * the two are decoupled and this stays at the measured 22. Every balance
 * figure in this file was recorded with a 22-creep burst; raising it is a
 * `/balance` question, not a consequence of the geometry.
 */
const MAX_SEND_BURST = 22

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
  return lane.towers.count
}

/** The anchor tile index of the tower in `slot`. */
function anchorOf(lane: Lane, slot: number): number {
  return (lane.towers.anchorY[slot] as number) * GRID_W + (lane.towers.anchorX[slot] as number)
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

  // Upgrade the strongest-value tower adjacent to the route. A neighbour cell
  // resolves to whichever tower's footprint covers it.
  let bestSlot = -1
  let bestLevel = MAX_LEVEL + 1
  for (const tile of route) {
    for (const n of neighbours(tile)) {
      const slot = lane.towers.at[n] as number
      if (slot === -1) continue
      const level = lane.towers.level[slot] as number
      if (level >= MAX_LEVEL) continue
      if (checkUpgrade(state, player, tileX(n), tileY(n)) !== Refusal.None) continue
      // Prefer the least-upgraded tower: levelling a 1 to a 2 is the cheapest
      // damage available, and spreading levels beats maxing one tower early.
      if (level < bestLevel) {
        bestLevel = level
        bestSlot = slot
      }
    }
  }
  if (bestSlot !== -1) {
    const a = anchorOf(lane, bestSlot)
    return { tick: state.tick, player, kind: Kind.Upgrade, x: tileX(a), y: tileY(a) }
  }

  // No upgrade available: drop a new tower beside the route. A 2x2 footprint
  // touches a cell from four anchors; try them in row-major order and take the
  // first the rules allow.
  for (const tile of route) {
    for (const n of neighbours(tile)) {
      for (const a of anchorsCovering(n)) {
        const x = tileX(a)
        const y = tileY(a)
        if (checkBuild(state, player, x, y, TowerKind.Single).refusal !== Refusal.None) continue
        return { tick: state.tick, player, kind: Kind.Build, tower: TowerKind.Single, x, y }
      }
    }
  }
  return null
}

/**
 * Anchors whose footprint would cover `tile`, row-major, inside the build
 * area. TOWER_SIZE squared of them at most.
 */
function anchorsCovering(tile: number): number[] {
  const x = tileX(tile)
  const y = tileY(tile)
  const out: number[] = []
  for (let dy = TOWER_SIZE - 1; dy >= 0; dy--) {
    for (let dx = TOWER_SIZE - 1; dx >= 0; dx--) {
      const ax = x - dx
      const ay = y - dy
      if (footprintInBuildArea(ax, ay)) out.push(ay * GRID_W + ax)
    }
  }
  return out
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
    if (footprintOverlapsTower(lane, t.x, t.y)) continue
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
/** The table's answer: the archetype EXPLOITS names for the opponent's dominant tower. */
function tablePick(state: GameState, player: 0 | 1): CreepArchetypeKind | null {
  const theirMaze = readMaze(state.lanes[opponentOf(player)] as Lane)
  return theirMaze === null ? null : (EXPLOITS[theirMaze] as CreepArchetypeKind)
}

/**
 * The model's answer: of the archetypes a bank buys at the tier the bank
 * reaches, the one predicted to leak most per gold against the opponent's
 * actual maze; failing any predicted leak, the best earner. See CounterPick.
 *
 * Per gold rather than absolute, because the bank buys twenty-two swarm or
 * one tank and the question is which spends the gold better. Ties go to the
 * lower archetype index, which is the roster's order and never a clock.
 */
function modelPick(
  state: GameState,
  player: 0 | 1,
  me: Player,
  config: BotConfig,
  unlocked: number,
): CreepArchetypeKind | null {
  if (!sendsOpen(state)) return null
  const bank = me.income * (config.savingPeriods ?? MAX_SAVING_PERIODS)
  const any = affordableSoon(state, bank, unlocked, null)
  if (any === -1) return null
  const tier = creepSpec(any).tier
  const opp = state.lanes[opponentOf(player)] as Lane
  const route = routeOf(opp, routeA)
  let best: CreepArchetypeKind | null = null
  let bestScore = 0
  for (let k = 0; k < ARCHETYPE_KINDS.length; k++) {
    const kind = ARCHETYPE_KINDS[k] as CreepArchetypeKind
    const creep = affordableSoon(state, bank, unlocked, kind)
    if (creep === -1) continue
    const spec = creepSpec(creep)
    if (spec.archetype !== kind || spec.tier !== tier) continue
    let count = Math.floor(bank / spec.cost)
    if (count > MAX_SEND_BURST) count = MAX_SEND_BURST
    if (count < 1) continue
    const leaks = waveLeaks(opp, route, creep, count, suddenDeathScale(state.tick, INCOME_EVERY_TICKS))
    const score = leaks / (count * spec.cost)
    if (score > bestScore) {
      bestScore = score
      best = kind
    }
  }
  return best !== null ? best : BEST_EARNER
}

const ARCHETYPE_KINDS: readonly CreepArchetypeKind[] = [
  CreepArchetypeKind.Swarm,
  CreepArchetypeKind.Runner,
  CreepArchetypeKind.Tank,
]

/** The tier-0 archetype with the most income per gold; the send when nothing can hurt. */
const BEST_EARNER: CreepArchetypeKind = (() => {
  let best = CreepArchetypeKind.Swarm
  let bestRate = -1
  for (let i = 0; i < CREEPS.length; i++) {
    const spec = CREEPS[i] as CreepSpec
    if (spec.tier !== 0 || spec.cost <= 0) continue
    const rate = spec.incomeBonus / spec.cost
    if (rate > bestRate) {
      bestRate = rate
      best = spec.archetype
    }
  }
  return best
})()

const EXPLOITS: readonly CreepArchetypeKind[] = [
  CreepArchetypeKind.Swarm, // vs single-target
  CreepArchetypeKind.Tank, // vs splash
  CreepArchetypeKind.Tank, // vs slow
]

/** The dominant tower archetype in a lane, weighted by gold sunk into it. */
function readMaze(lane: Lane): TowerKind | null {
  const t = lane.towers
  const worth = [0, 0, 0]
  if (t.count === 0) return null
  for (let i = 0; i < t.count; i++) {
    const kind = t.kind[i] as number
    worth[kind] = (worth[kind] as number) + investedIn(kind as TowerKind, t.level[i] as number)
  }
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
  let bestSlot = -1
  let bestLevel = MAX_LEVEL + 1
  for (let i = 0; i < lane.towers.count; i++) {
    const kind = lane.towers.kind[i] as number
    const level = lane.towers.level[i] as number
    if (level >= bestLevel) continue
    if (level < MAX_LEVEL && levelOf(kind as TowerKind, level + 1).cost > budget) continue
    const ax = lane.towers.anchorX[i] as number
    const ay = lane.towers.anchorY[i] as number
    if (checkUpgrade(state, player, ax, ay) !== Refusal.None) continue
    bestLevel = level
    bestSlot = i
  }
  if (bestSlot === -1) return null
  const a = anchorOf(lane, bestSlot)
  return { tick: state.tick, player, kind: Kind.Upgrade, x: tileX(a), y: tileY(a) }
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
const probeCells = new Int32Array(FOOTPRINT_CELLS)
/** Towers already costed this decision, by slot. */
const seen = new Uint8Array(MAX_TOWERS)

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
    const leaks = waveLeaks(opp, oppRoute, i, count, suddenDeathScale(state.tick, INCOME_EVERY_TICKS))
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
  // The flood is read at the HP sudden death gives it now (ADR-0026).
  const hpScale = suddenDeathScale(state.tick, INCOME_EVERY_TICKS)
  const threat = laneThreat(lane, route, null, hpScale)
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
      const slot = lane.towers.at[n] as number
      if (slot === -1) continue
      if (seen[slot] === 1) continue
      seen[slot] = 1
      const kind = lane.towers.kind[slot] as number
      const level = lane.towers.level[slot] as number
      if (level >= MAX_LEVEL) continue
      const cost = levelOf(kind as TowerKind, level + 1).cost
      if (cost > gold) continue
      const a = anchorOf(lane, slot)
      if (checkUpgrade(state, player, tileX(a), tileY(a)) !== Refusal.None) continue
      const override: TowerOverride = { tile: a, kind: kind as TowerKind, level: level + 1 }
      const after = laneThreat(lane, route, override, hpScale)
      consider({ tick: state.tick, player, kind: Kind.Upgrade, x: tileX(a), y: tileY(a) }, cost, after)
    }
  }

  const tile = nextFreeTemplateTile(lane, config)
  if (tile !== -1) {
    // The candidate's route, without touching the lane: a copy of the blocked
    // map with the footprint set, and a probe field built from it.
    probeBlocked.set(lane.blocked)
    footprintCells(tileX(tile), tileY(tile), probeCells)
    for (let k = 0; k < FOOTPRINT_CELLS; k++) probeBlocked[probeCells[k] as number] = 1
    buildField(probeBlocked, probeField)
    if (spawnsReachable(probeField)) {
      const newRoute = pathFrom(probeField, SPAWN_INDICES[0] as number, routeC)
      for (const kind of KINDS) {
        if (levelOf(kind, 1).cost > gold) continue
        // The probe answered "would it seal"; the rules also ask about gold
        // and about creeps standing on the footprint (ADR-0023). A candidate
        // the sim would refuse is not a fix, and emitting it would be the bot
        // sending a command a player could not.
        if (checkBuild(state, player, tileX(tile), tileY(tile), kind).refusal !== Refusal.None) continue
        const after = laneThreat(lane, newRoute, { tile, kind, level: 1 }, hpScale)
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

/** First template anchor whose footprint is free, regardless of gold or sealing. */
function nextFreeTemplateTile(lane: Lane, config: BotConfig): number {
  const template = templateAt(config.template)
  for (let i = 0; i < template.tiles.length; i++) {
    const t = template.tiles[i] as Tile
    if (!footprintOverlapsTower(lane, t.x, t.y)) return tileIndex(t)
  }
  return -1
}

/** Whether the opening build phase has ended and creeps may be sent. */
function sendsOpen(state: GameState): boolean {
  return state.tick >= SEND_UNLOCK_TICKS
}
