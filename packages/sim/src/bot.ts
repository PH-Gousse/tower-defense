import { GRID_W, tileIndex, tileX, tileY, SPAWN_INDICES, type Tile } from './grid'
import { pathFrom } from './path'
import { TowerKind, CREEPS, creepSpec, levelOf, MAX_LEVEL, MAX_TIER, tierUnlockTick } from './data'
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

export interface BotConfig {
  /**
   * Share of decisions spent attacking rather than defending, 0..1.
   * 0 turtles and never sends; 1 sends whenever it can afford to.
   */
  readonly sendRatio: number
  /** Ticks between decisions. Higher is slower and easier. */
  readonly reactionTicks: number
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
 * Towers the bot adds per tier that has unlocked, past the opening.
 *
 * A cap on building is what lets the bot SAVE. Without one it found an
 * affordable tile on nearly every decision, so its gold never rose above its
 * income, so it could never afford a creep big enough to threaten anything --
 * and a harness measuring an opponent that cannot execute the winning strategy
 * measures nothing. Two bots ran 33 minutes and 1,891 sends without a single
 * leak because of this, which reads exactly like a balance problem and is not.
 */
const TOWERS_PER_TIER = 7

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
const MAX_SAVING_PERIODS = 15

/**
 * Difficulty is the reaction delay. The other two knobs are held constant, and
 * that is a measured decision rather than a design one.
 *
 * The first draft varied all three, on the reasonable-sounding theory that a
 * harder bot sends more and mazes differently. A round robin in the harness
 * said otherwise, twice over:
 *
 *   - **Spend ratio is not a difficulty axis.** Sweeping it 0.2 to 0.8 put the
 *     low end on top: in the current tuning, gold spent on towers beats gold
 *     spent on creeps. A bot that "attacks harder" is a bot playing worse, so
 *     shipping 0.8 as *hard* would have shipped a weaker opponent under a
 *     stronger name. 0.25 is the band where the reaction ladder comes out
 *     monotone.
 *
 *   - **Templates are not either.** `posts` measured so much weaker that every
 *     config using it sank to the bottom of a 50-way ranking regardless of its
 *     other settings — its first six tiles lengthen the walk by literally zero.
 *     It was sandbagging *easy* by accident. All three now maze the same way.
 *
 * That defence beats offence at all is a balance finding, not a bot finding,
 * and it belongs to the tuning step rather than to this file.
 *
 * The three are verified transitive by a round robin in the harness tests:
 * every off-diagonal goes to the faster bot, margins widen with the gap, and
 * every mirror is a draw — which also proves the sim gives player 0 no edge.
 */
export const BOT_EASY: BotConfig = { sendRatio: 0.25, reactionTicks: 14, template: 0 }
export const BOT_NORMAL: BotConfig = { sendRatio: 0.25, reactionTicks: 10, template: 0 }
export const BOT_HARD: BotConfig = { sendRatio: 0.25, reactionTicks: 3, template: 0 }

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
  const target = strongestAt(unlocked)

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
    OPENING_TOWERS + Math.round(TOWERS_PER_TIER * unlocked * defensiveness),
  )
  const canBuild = towerCount(lane) < towerTarget
  // In the build phase gold is for towers; in the banking phase it is not.
  const buildBudget = canBuild ? me.gold : 0
  const sendBudget = me.gold

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

  if (emergency === -1) {
    // What it is saving for: the heaviest creep the ladder currently offers.
    if (target !== -1 && me.gold >= creepSpec(target).cost) {
      return { tick: state.tick, player, kind: Kind.Send, creep: target }
    }
    // Not there yet. Keep banking, unless the bank is already deep enough that
    // waiting longer costs more income than the bigger creep is worth.
    if (me.gold >= me.income * MAX_SAVING_PERIODS) {
      const send = bestSend(state, player, sendBudget)
      if (send !== -1) return { tick: state.tick, player, kind: Kind.Send, creep: send }
    }
  }

  // Maze is at its target and the next creep is out of reach. Deepen the maze
  // rather than idle -- an upgrade is never wasted.
  const upgrade = bestUpgrade(state, player, lane, me.gold)
  if (upgrade) return upgrade

  // Nothing to build and nothing worth saving toward. Send what it can.
  const send = bestSend(state, player, me.gold)
  if (send !== -1) return { tick: state.tick, player, kind: Kind.Send, creep: send }
  return null
}

/** The most expensive creep at a given tier: the heaviest thing money can buy. */
function strongestAt(tier: number): number {
  let best = -1
  let bestCost = -1
  for (let i = 0; i < CREEPS.length; i++) {
    const spec = creepSpec(i)
    if (spec.tier !== tier) continue
    if (spec.cost > bestCost) {
      bestCost = spec.cost
      best = i
    }
  }
  return best
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
  return out.filter((t) => t >= 0 && t < GRID_W * 24)
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
  for (let i = 0; i < template.tiles.length; i++) {
    const t = template.tiles[i] as Tile
    if (lane.blocked[tileIndex(t)] === 1) continue
    const tower = towerForIndex(i)
    if (levelOf(tower, 1).cost > budget) continue
    if (checkBuild(state, player, t.x, t.y, tower).refusal !== Refusal.None) continue
    return { tick: state.tick, player, kind: Kind.Build, tower, x: t.x, y: t.y }
  }
  return null
}

/** Roughly 3 single-target to 1 splash to 1 slow, by template position. */
function towerForIndex(i: number): TowerKind {
  const m = i % 5
  if (m === 3) return TowerKind.Splash
  if (m === 4) return TowerKind.Slow
  return TowerKind.Single
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
