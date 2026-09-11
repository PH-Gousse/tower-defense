import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from './spec'
import type { AssetSpec } from './spec.generated'
import { REPORTS, rel } from './paths'

/**
 * The game-data proposal: a spec's `game:` block against the live constants,
 * written as a patch, a GDD stub and a test list. Never applies anything.
 * See game-proposal.ts for the reader's summary.
 */

const TICK_HZ = 20
const CREEPS_JSON = join(REPO_ROOT, 'packages', 'sim', 'data', 'creeps.json')
const TOWERS_JSON = join(REPO_ROOT, 'packages', 'sim', 'data', 'towers.json')

interface CreepsFile { growth: { cost: number; hp: number; income: number; bounty: number }; archetypes: { key: string; name: string; answers: string; cost: number; count: number; hp: number; speed: number; incomeBonus: number; bounty: number }[] }
interface TowersFile { archetypes: { key: string; name: string; answers: string; splashRadius?: number; slowTicks?: number; levels: Record<string, number>[] }[] }

export interface Result { id: string; kind: 'creep' | 'tower' | 'none'; status: 'matches' | 'new' | 'changes' | 'growth-mismatch' | 'no-game-block'; dir: string; notes: string[] }
/**
 * The constants files are hand-formatted (one level per line, comments as
 * `_comment` keys) and a patch that re-serialised the whole file would
 * touch every line. So changes are made to the TEXT: the archetype block is
 * found by its `"key"`, and inside it the level line or the field is
 * rewritten in place. A new archetype is appended before the closing `]`
 * in the file's own style.
 */
function archetypeBlock(text: string, key: string): [number, number] | null {
  const start = text.indexOf(`"key": "${key}"`)
  if (start < 0) return null
  const open = text.lastIndexOf('{', start)
  // Walk to the matching close brace.
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return [open, i + 1] }
  }
  return null
}

function setField(block: string, field: string, value: number): string {
  const re = new RegExp(`("${field}":\\s*)(-?[\\d.]+)`)
  if (!re.test(block)) return block.replace(/\n(\s*)"bounty"/, (m, ws: string) => `\n${ws}"${field}": ${value},${m}`)
  return block.replace(re, `$1${value}`)
}

function setLevelFields(block: string, level: number, want: Record<string, number>): string {
  const lines = block.split('\n')
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\{\s*"cost"/.test(lines[i] ?? '')) {
      n++
      if (n === level) {
        let line = lines[i] as string
        for (const [k, v] of Object.entries(want)) {
          const re = new RegExp(`("${k}":\\s*)(-?[\\d.]+)`)
          line = re.test(line) ? line.replace(re, `$1${v}`) : line.replace(/\s*\}/, `, "${k}": ${v} }`)
        }
        lines[i] = line
      }
    }
  }
  return lines.join('\n')
}

function appendArchetype(text: string, entryText: string): string {
  const end = text.lastIndexOf(']')
  const before = text.slice(0, end).replace(/\s+$/, '')
  return `${before},\n${entryText}\n  ]${text.slice(end + 1)}`
}

function creepEntryText(e: Record<string, unknown>): string {
  return ['    {', ...Object.entries(e).map(([k, v], i, a) => `      "${k}": ${JSON.stringify(v)}${i < a.length - 1 ? ',' : ''}`), '    }'].join('\n')
}

function towerEntryText(e: { key: string; name: string; answers: string; splashRadius?: number; slowTicks?: number; levels: Record<string, number>[] }): string {
  const head = [`      "key": "${e.key}",`, `      "name": "${e.name}",`, `      "answers": "${e.answers}",`]
  if (e.splashRadius !== undefined) head.push(`      "splashRadius": ${e.splashRadius},`)
  if (e.slowTicks !== undefined) head.push(`      "slowTicks": ${e.slowTicks},`)
  const levels = e.levels.map((L, i) => `        { ${Object.entries(L).map(([k, v]) => `"${k}": ${v}`).join(', ')} }${i < e.levels.length - 1 ? ',' : ''}`)
  return ['    {', ...head, '      "levels": [', ...levels, '      ]', '    }'].join('\n')
}

function unifiedDiff(path: string, before: string, after: string): string {
  mkdirSync(REPORTS, { recursive: true })
  const tmpA = join(REPORTS, '.diff-a.json')
  const tmpB = join(REPORTS, '.diff-b.json')
  writeFileSync(tmpA, before)
  writeFileSync(tmpB, after)
  const r = spawnSync('diff', ['-u', '--label', `a/${rel(path)}`, '--label', `b/${rel(path)}`, tmpA, tmpB], { encoding: 'utf8' })
  rmSync(tmpA, { force: true })
  rmSync(tmpB, { force: true })
  return r.stdout
}

export function creepProposal(id: string, spec: AssetSpec, dir: string): Result {
  const game = (spec.game ?? {}) as Record<string, number | string>
  const notes: string[] = []
  const file = JSON.parse(readFileSync(CREEPS_JSON, 'utf8')) as CreepsFile
  const key = spec.archetype
  const tier = (spec.tier ?? 1) - 1
  const live = file.archetypes.find((a) => a.key === key)
  const want = {
    hp: typeof game['hp'] === 'number' ? game['hp'] : undefined,
    cost: typeof game['cost'] === 'number' ? game['cost'] : undefined,
    speed: typeof game['speed_tiles_per_s'] === 'number' ? Number((game['speed_tiles_per_s'] / TICK_HZ).toFixed(4)) : undefined,
    incomeBonus: typeof game['income'] === 'number' ? game['income'] : undefined,
    bounty: typeof game['bounty'] === 'number' ? game['bounty'] : undefined,
  }
  if (Object.values(want).every((v) => v === undefined)) return { id, kind: 'creep', status: 'no-game-block', dir, notes: ['spec has no game: numbers'] }
  let status: Result['status'] = 'matches'
  let patch = ''
  const before = readFileSync(CREEPS_JSON, 'utf8')
  if (!live) {
    // A new archetype: a base entry, derived from the tier this spec describes.
    const g = file.growth
    const base = {
      key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      answers: String(game['answers'] ?? '[proposed]'),
      cost: Math.round((want.cost ?? 0) / Math.pow(g.cost, tier)),
      count: 1,
      hp: Math.round((want.hp ?? 0) / Math.pow(g.hp, tier)),
      speed: want.speed ?? 0.1,
      incomeBonus: Math.round((want.incomeBonus ?? 0) / Math.pow(g.income, tier)),
      bounty: Math.round((want.bounty ?? 0) / Math.pow(g.bounty, tier)),
    }
    patch = unifiedDiff(CREEPS_JSON, before, appendArchetype(before, creepEntryText(base)))
    status = 'new'
    notes.push(`new archetype "${key}": base entry derived from the tier ${tier + 1} numbers by dividing out growth`)
    if (tier > 0) notes.push('the spec describes a higher tier; the base is what the roster rule needs, check the rounding')
  } else {
    const g = file.growth
    const derived = { hp: live.hp * Math.pow(g.hp, tier), cost: live.cost * Math.pow(g.cost, tier), speed: live.speed, incomeBonus: live.incomeBonus * Math.pow(g.income, tier), bounty: live.bounty * Math.pow(g.bounty, tier) }
    const diffs: string[] = []
    for (const k of ['hp', 'cost', 'speed', 'incomeBonus', 'bounty'] as const) {
      const w = want[k]
      if (w === undefined) continue
      if (Math.abs(w - derived[k]) > 1e-6) diffs.push(`${k}: spec ${w}, live (base × growth^${tier}) ${derived[k]}`)
    }
    if (diffs.length === 0) notes.push(`every game: number matches the live roster for ${key} at tier ${tier + 1}; no constant moves`)
    else if (tier === 0) {
      const span = archetypeBlock(before, key)!
      let block = before.slice(span[0], span[1])
      for (const k of ['hp', 'cost', 'speed', 'incomeBonus', 'bounty'] as const) if (want[k] !== undefined) block = setField(block, k, want[k]!)
      patch = unifiedDiff(CREEPS_JSON, before, before.slice(0, span[0]) + block + before.slice(span[1]))
      status = 'changes'
      notes.push(...diffs)
    } else {
      status = 'growth-mismatch'
      notes.push(...diffs, `tier ${tier + 1} has no constants of its own: the roster is base × growth^tier. Either the base entry or the growth rule changes, and that is a /rule-change on its own terms; no patch is written`)
    }
  }
  const unlockSeconds = tier * 300
  const gdd = [
    `### ${key} (creep) — \`[proposed]\` by the asset factory from \`art/specs/${id}.yaml\``,
    '',
    `- **${key}** at tier ${tier + 1}: ${want.hp ?? '?'} HP, ${want.cost ?? '?'} gold, ${typeof game['speed_tiles_per_s'] === 'number' ? game['speed_tiles_per_s'] : '?'} tiles/s, +${want.incomeBonus ?? '?'} income, ${want.bounty ?? '?'} bounty. \`[proposed]\``,
    `- Answers: ${String(game['answers'] ?? '[proposed]')}. Unlocks at ${unlockSeconds === 0 ? 'match start' : `${unlockSeconds / 60}:00`} (\`tierUnlockTick\`). \`[proposed]\``,
    live ? `- Tier ${tier + 1} of an existing archetype: stats come from base × growth^${tier}; nothing in §11 moves unless the numbers above disagree with the rule.` : '- A new archetype: a base row in §11 "Creeps — tier 0 base".',
    '',
  ].join('\n')
  const tests = [
    `# Vitest cases that would pin \`${id}\` (for \`test-author\`)`,
    '',
    `File: \`packages/sim/test/roster.test.ts\` (or the archetype's own file). Every case names the rule, not the function.`,
    '',
    `- **buying a ${key} spawns exactly one creep at the opponent's entrance** — \`send\` at tier ${tier + 1} after \`tierUnlockTick(${tier})\`; assert count +1, position on a spawn tile, \`spec\` index resolves to \`${key}\`.`,
    `- **a ${key} costs ${want.cost ?? '?'} gold and raises income by ${want.incomeBonus ?? '?'}** — gold before/after, income before/after.`,
    `- **a ${key} moves ${typeof game['speed_tiles_per_s'] === 'number' ? game['speed_tiles_per_s'] : '?'} tiles per second** — step 20 ticks on an empty lane, compare flow-field progress within one tile of \`speed × 20\`.`,
    `- **a ${key} dies at ${want.hp ?? '?'} damage and pays ${want.bounty ?? '?'} bounty to the defender** — place towers that deal exactly that; assert the id is gone and gold moved.`,
    `- **a ${key} at tier ${tier + 1} is refused before its unlock with \`Refusal.TierLocked\`** — send at \`tierUnlockTick(${tier}) - 1\`; assert refusal and that no gold moved.`,
    `- **a ${key} is refused with \`Refusal.NotEnoughGold\` and nothing moves** — gold set to cost − 1.`,
    `- **hashState changes when a ${key} exists** — the golden fixture must move if the roster changed (and only then).`,
    '',
  ].join('\n')
  write(dir, patch, gdd, tests, id, status, notes, live ? CREEPS_JSON : CREEPS_JSON)
  return { id, kind: 'creep', status, dir, notes }
}

export function towerProposal(id: string, spec: AssetSpec, dir: string): Result {
  const game = (spec.game ?? {}) as Record<string, number | string>
  const notes: string[] = []
  const file = JSON.parse(readFileSync(TOWERS_JSON, 'utf8')) as TowersFile
  const key = spec.archetype
  const level = spec.level ?? 1
  const live = file.archetypes.find((a) => a.key === key)
  const fields = ['cost', 'damage', 'range', 'cooldownTicks', 'slowPercent'] as const
  const want: Record<string, number> = {}
  for (const f of fields) if (typeof game[f] === 'number') want[f] = game[f] as number
  if (Object.keys(want).length === 0) return { id, kind: 'tower', status: 'no-game-block', dir, notes: ['spec has no game: numbers'] }
  const before = readFileSync(TOWERS_JSON, 'utf8')
  let status: Result['status'] = 'matches'
  let patch = ''
  if (!live) {
    const levels: Record<string, number>[] = []
    for (let l = 1; l <= 3; l++) levels.push(l === level ? { ...want } : { cost: 0, damage: 0, range: 0, cooldownTicks: 0 })
    const entry = { key, name: key.charAt(0).toUpperCase() + key.slice(1), answers: String(game['answers'] ?? '[proposed]'), ...(typeof game['splashRadius'] === 'number' ? { splashRadius: game['splashRadius'] } : {}), ...(typeof game['slowTicks'] === 'number' ? { slowTicks: game['slowTicks'] } : {}), levels }
    patch = unifiedDiff(TOWERS_JSON, before, appendArchetype(before, towerEntryText(entry)))
    status = 'new'
    notes.push(`new tower archetype "${key}": only level ${level} is specified; the other levels are zero placeholders and need their own specs (ADR-0013: three archetypes, three levels)`)
  } else {
    const lv = live.levels[level - 1] ?? {}
    const diffs: string[] = []
    for (const [k, v] of Object.entries(want)) if (Math.abs((lv[k] ?? NaN) - v) > 1e-9) diffs.push(`${k}: spec ${v}, live ${lv[k] ?? 'absent'}`)
    if (diffs.length === 0) notes.push(`every game: number matches ${key} level ${level}; no constant moves`)
    else {
      const span = archetypeBlock(before, key)!
      const block = setLevelFields(before.slice(span[0], span[1]), level, want)
      patch = unifiedDiff(TOWERS_JSON, before, before.slice(0, span[0]) + block + before.slice(span[1]))
      status = 'changes'
      notes.push(...diffs)
    }
  }
  const gdd = [
    `### ${key} (tower) level ${level} — \`[proposed]\` by the asset factory from \`art/specs/${id}.yaml\``,
    '',
    `- **${key}** level ${level}: ${want['cost'] ?? '?'} gold, ${want['damage'] ?? '?'} damage, range ${want['range'] ?? '?'}, ${want['cooldownTicks'] ?? '?'} ticks between shots${want['slowPercent'] !== undefined ? `, slows ${want['slowPercent']}%` : ''}. \`[proposed]\``,
    '',
  ].join('\n')
  const tests = [
    `# Vitest cases that would pin \`${id}\` (for \`test-author\`)`,
    '',
    `- **building a ${key} costs ${want['cost'] ?? '?'} gold and occupies one tile** — build, assert gold and \`towers.kind\` at the tile.`,
    `- **a ${key} level ${level} deals ${want['damage'] ?? '?'} damage every ${want['cooldownTicks'] ?? '?'} ticks to the in-range creep nearest the exit** — one creep in range, step, assert hp and cooldown.`,
    `- **a ${key} level ${level} reaches ${want['range'] ?? '?'} tiles and not further** — a creep at range + 0.01 is untouched.`,
    ...(want['slowPercent'] !== undefined ? [`- **a ${key} slows by ${want['slowPercent']}% and the strongest slow wins** — two towers of different levels; the creep carries the larger slow (issue #17).`] : []),
    `- **upgrading past level 3 is refused with \`Refusal.AlreadyMaxLevel\`, and with \`NotEnoughGold\` when short** — no gold moves either time.`,
    `- **selling refunds \`sellRefund\` of the total invested, floored** — build, upgrade to ${level}, sell.`,
    '',
  ].join('\n')
  write(dir, patch, gdd, tests, id, status, notes, TOWERS_JSON)
  return { id, kind: 'tower', status, dir, notes }
}

function write(dir: string, patch: string, gdd: string, tests: string, id: string, status: string, notes: string[], constantsFile: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'constants.patch'), patch || `# no change to ${rel(constantsFile)}: ${notes.join('; ')}\n`)
  writeFileSync(join(dir, 'gdd-stub.md'), gdd)
  writeFileSync(join(dir, 'tests.md'), tests)
  writeFileSync(join(dir, 'handoff.md'), [
    `# Hand-off for \`${id}\` — ${status}`,
    '',
    ...notes.map((n) => `- ${n}`),
    '',
    'The factory stops here. Nothing under `packages/sim` or `docs/gdd.md` was touched.',
    '',
    patch ? '## To apply' : '## Nothing to apply',
    '',
    ...(patch
      ? [
          '```',
          '/rule-change <state the rule in one sentence>',
          '```',
          '',
          'which will, in order: `pnpm rule-change:begin`, `git apply reports/art/' + id + '/game-proposal/constants.patch`, paste `gdd-stub.md` into docs/gdd.md §11, hand `tests.md` to `test-author`, `pnpm determinism-check`, `pnpm replay-verify`, `pnpm rule-change:end`.',
          '',
          'A golden fixture going red after this is expected (a balance change), not a bug — but say so in the /rule-change output.',
        ]
      : ['The spec agrees with the live constants. `gdd-stub.md` can still be pasted if the GDD lacks the row.']),
    '',
  ].join('\n'))
}


/** Dispatch by class. Classes without game data return a no-game-block result. */
export function propose(id: string, spec: AssetSpec, dir: string): Result {
  if (spec.class === 'creep') return creepProposal(id, spec, dir)
  if (spec.class === 'tower') return towerProposal(id, spec, dir)
  return { id, kind: 'none', status: 'no-game-block', dir, notes: [`a ${spec.class} has no game data`] }
}
