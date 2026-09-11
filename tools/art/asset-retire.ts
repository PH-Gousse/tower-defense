import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs, say, emit, fail } from './lib/cli'
import { listSpecIds, resolveSpec, loadSchema, loadRegistry, REPO_ROOT } from './lib/spec'
import { loadManifest, saveManifest } from './lib/manifest'
import { BUILD, SPECS, rel } from './lib/paths'

/**
 * asset-retire <id> [--force]
 *
 * Remove an asset from the manifest and assets/build/, and move its spec to
 * art/specs/retired/ (history keeps it; the catalogue forgets it). REFUSES
 * when anything still references the id:
 *
 *   - another spec's `derived_from`
 *   - the client's event binding table or any client source (an id string)
 *   - a sound id it owns that another asset's `audio:` block names
 *
 * Game data never references an asset id (assets are looked up by
 * archetype and tier), so there is nothing to check there -- but the
 * archetype's OTHER tiers are reported, because retiring t2 of three tiers
 * leaves a hole the match draws procedurally.
 */

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const id = argv.find((a) => !a.startsWith('--'))
if (!id) fail('asset-retire <id>')
const schema = loadSchema()
const registry = loadRegistry()
const manifest = loadManifest()
const specExists = existsSync(join(SPECS, `${id}.yaml`))
const entry = manifest.assets[id]
if (!specExists && !entry) fail(`${id}: no spec and not in the manifest`)

const refs: string[] = []
for (const other of listSpecIds()) {
  if (other === id) continue
  const r = resolveSpec(other, { schema, registry })
  if (r.spec.derived_from === id) refs.push(`art/specs/${other}.yaml derives from it`)
}
const grep = spawnSync('grep', ['-rn', '--include=*.ts', `'${id}'`, join(REPO_ROOT, 'packages', 'client', 'src')], { encoding: 'utf8' })
for (const line of (grep.stdout ?? '').split('\n').filter(Boolean)) {
  if (line.includes('manifest.generated.ts')) continue
  refs.push(`client: ${rel(line)}`)
}
const siblings = Object.keys(manifest.assets).filter((o) => o !== id && entry && manifest.assets[o]!.archetype === entry.archetype && manifest.assets[o]!.class === entry.class)

if (refs.length && !args['force']) {
  say(`REFUSED  ${id} is still referenced:`)
  for (const r of refs) say(`           ${r}`)
  say('           remove the references first (or --force, which leaves them dangling on purpose)')
  emit('asset-retire', false, `${id} is referenced by ${refs.length} place(s)`, { id, refs })
}

if (entry) delete manifest.assets[id]
const glb = join(BUILD, `${id}.glb`)
if (existsSync(glb)) rmSync(glb)
if (specExists) {
  mkdirSync(join(SPECS, 'retired'), { recursive: true })
  renameSync(join(SPECS, `${id}.yaml`), join(SPECS, 'retired', `${id}.yaml`))
}
saveManifest(manifest)
spawnSync('npx', ['vite-node', 'manifest-types.ts'], { cwd: import.meta.dirname, encoding: 'utf8' })
say(`retired  ${id}: manifest entry removed, ${existsSync(glb) ? '' : 'build file deleted, '}spec moved to art/specs/retired/`)
if (siblings.length) say(`note     ${entry?.archetype} still has ${siblings.join(', ')}; the match draws the missing tier procedurally`)
emit('asset-retire', true, `${id} retired`, { id, siblings, forced: Boolean(args['force']) })
