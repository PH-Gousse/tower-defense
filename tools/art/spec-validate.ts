import { parseArgs, flag, say, emit, fail, selectIds } from './lib/cli'
import { listSpecIds, resolveSpec, loadSchema, loadRegistry, SPECS_DIR, REPO_ROOT } from './lib/spec'

/**
 * spec-validate <id|all> [--print] [--quiet]
 *
 * The fast check: schema, defaults, inheritance, and that every generator,
 * part, rig, animation and palette name the spec uses exists in the registry.
 * No Blender, well under a second for the whole catalogue. Runs from the hook
 * after every spec edit, and first in every build.
 *
 * `--print` writes the RESOLVED spec (inheritance applied, defaults filled) so
 * a person can see what the builder will actually get.
 */

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const ids = selectIds(argv, listSpecIds)
if (ids.length === 0) fail(`no specs found in ${SPECS_DIR.slice(REPO_ROOT.length + 1)}`)

const schema = loadSchema()
const registry = loadRegistry()
const results: { id: string; ok: boolean; hash: string; chain: string[]; problems: { path: string; message: string }[] }[] = []

for (const id of ids) {
  try {
    const r = resolveSpec(id, { schema, registry })
    results.push({ id, ok: r.problems.length === 0, hash: r.hash, chain: [...r.chain], problems: [...r.problems] })
    if (flag(args, 'print')) say(JSON.stringify(r.spec, null, 2))
  } catch (err) {
    results.push({ id, ok: false, hash: '', chain: [], problems: [{ path: '/', message: err instanceof Error ? err.message : String(err) }] })
  }
}

const bad = results.filter((r) => !r.ok)
if (!flag(args, 'quiet')) {
  for (const r of results) {
    const lineage = r.chain.length ? `  ← ${r.chain.join(' ← ')}` : ''
    say(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}  ${r.hash}${lineage}`)
    for (const p of r.problems) say(`       ${p.path}: ${p.message}`)
  }
  say()
}
say(`${results.length - bad.length}/${results.length} specs valid`)
emit('spec-validate', bad.length === 0, bad.length === 0 ? `${results.length} spec(s) valid` : `${bad.length} of ${results.length} spec(s) invalid`, {
  registryVersion: registry.version,
  specs: results,
})
