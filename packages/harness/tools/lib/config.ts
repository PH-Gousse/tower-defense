import { BOT_EASY, BOT_NORMAL, BOT_HARD, MAZE_TEMPLATES, type BotConfig } from '@ltw/sim'

/**
 * What a `--seed` actually selects.
 *
 * Read ADR-0010 before changing anything here.
 *
 * Nothing in the simulation consumes a seed. There is no randomness in the v1
 * rules — no crits, no spawn jitter, no random targeting — and the bot breaks
 * ties by index. `mulberry32` exists in the sim and is explicitly unused. So
 * every `normal vs normal` match is byte-identical, and running it under twenty
 * different seed values would produce twenty identical matches.
 *
 * Rather than pretend, a seed selects a CONFIGURATION from the variation the
 * game genuinely has: three maze templates x three bot presets. Nine distinct
 * matchups exist, and every tool prints the configuration a seed resolved to so
 * a reader is never misled about how much independent variation a run covered.
 *
 * When something does start consuming a seed, this is the one file that has to
 * change, and `seedValue` below is what it should consume.
 */

export const PRESETS: Readonly<Record<string, BotConfig>> = {
  easy: BOT_EASY,
  normal: BOT_NORMAL,
  hard: BOT_HARD,
}

export const PRESET_NAMES: readonly string[] = ['easy', 'normal', 'hard']

/** Distinct matchups a seed can reach. Nine, not infinity. */
export const DISTINCT_CONFIGS = MAZE_TEMPLATES.length * PRESET_NAMES.length

export interface MatchConfig {
  readonly seed: number
  /** Index into MAZE_TEMPLATES, shared by both seats. */
  readonly template: number
  readonly templateName: string
  readonly aiA: string
  readonly aiB: string
  readonly bots: readonly [BotConfig, BotConfig]
  /** Human-readable, and printed by every tool that resolves a seed. */
  readonly label: string
}

/**
 * Resolve a seed into the configuration it names.
 *
 * `aiA` / `aiB` override the preset half when given explicitly, which is what
 * `headless-match --ai-a hard` does. The template half still comes from the
 * seed, so `--seed 3 --ai-a hard --ai-b hard` is a hard mirror on template 0.
 */
export function configFor(seed: number, aiA?: string, aiB?: string): MatchConfig {
  const s = Math.abs(Math.floor(seed))
  const template = s % MAZE_TEMPLATES.length
  const presetIndex = Math.floor(s / MAZE_TEMPLATES.length) % PRESET_NAMES.length

  // Without an override, the two seats face each other across the preset ladder
  // rather than mirroring: a mirror is always a draw and measures nothing.
  const a = aiA ?? (PRESET_NAMES[presetIndex] as string)
  const b = aiB ?? (PRESET_NAMES[(presetIndex + 1) % PRESET_NAMES.length] as string)

  const botA = PRESETS[a]
  const botB = PRESETS[b]
  if (!botA) throw new Error(`unknown bot "${a}". Options: ${PRESET_NAMES.join(', ')}`)
  if (!botB) throw new Error(`unknown bot "${b}". Options: ${PRESET_NAMES.join(', ')}`)

  const templateName = MAZE_TEMPLATES[template]?.name ?? String(template)

  return {
    seed,
    template,
    templateName,
    aiA: a,
    aiB: b,
    bots: [
      { ...botA, template },
      { ...botB, template },
    ],
    label: `${a} vs ${b} on "${templateName}"`,
  }
}

/**
 * The value a seeded generator WOULD be given, if anything consumed one.
 *
 * Kept so that the day the bot gains seeded tie-breaking, the seed already
 * flows to the right place and only `bot.ts` has to change.
 */
export function seedValue(seed: number): number {
  return Math.abs(Math.floor(seed)) >>> 0
}

/** The note every tool prints, so nobody over-reads a seed count. */
export const SEED_CAVEAT =
  `note: nothing in the sim consumes a seed (ADR-0010). A seed selects one of ` +
  `${DISTINCT_CONFIGS} distinct configurations (${MAZE_TEMPLATES.length} templates x ` +
  `${PRESET_NAMES.length} presets); seeds beyond that repeat.`
