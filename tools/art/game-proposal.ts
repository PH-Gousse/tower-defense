import { join } from 'node:path'
import { parseArgs, say, emit, fail, selectIds } from './lib/cli'
import { listSpecIds, resolveSpec, loadSchema, loadRegistry } from './lib/spec'
import { REPORTS, rel } from './lib/paths'
import { propose, type Result } from './lib/proposal'

/**
 * game-proposal <id|all>
 *
 * The factory PREPARES a game-data change; /rule-change DECIDES it. From a
 * spec's `game:` block this writes, under reports/art/<id>/game-proposal/:
 *
 *   constants.patch   a unified diff against packages/sim/data/*.json
 *   gdd-stub.md       the paragraph for docs/gdd.md, marked [proposed]
 *   tests.md          the Vitest cases that would pin the unit's rules,
 *                     refusal paths included
 *   handoff.md        what to run, in order
 *
 * It never edits the constants, the sim or the GDD (docs/invariants.md
 * rule 12): everything lands in reports/, and the patch is applied only by
 * /rule-change with the constants guard disarmed. A creep tier has no
 * constants of its own -- the roster is base × growth^tier -- so a tier
 * spec's block is checked against the derived numbers and any mismatch is
 * reported as a change to the growth rule, which is a different decision.
 */

const argv = process.argv.slice(2)
parseArgs(argv)
const ids = selectIds(argv, listSpecIds)
if (ids.length === 0) fail('game-proposal <id|all>')
const schema = loadSchema()
const registry = loadRegistry()
const results: Result[] = []
for (const id of ids) {
  const r = resolveSpec(id, { schema, registry })
  const dir = join(REPORTS, id, 'game-proposal')
  if (r.problems.length) { results.push({ id, kind: 'none', status: 'no-game-block', dir, notes: ['invalid spec'] }); continue }
  results.push(propose(id, r.spec, dir))
}
for (const r of results) {
  say(`${r.status.padEnd(16)} ${r.id}${r.kind !== 'none' ? `  → ${rel(r.dir)}/` : ''}`)
  for (const n of r.notes) say(`                 ${n}`)
}
emit('game-proposal', true, `${results.length} proposal(s) written; nothing applied`, { results })
