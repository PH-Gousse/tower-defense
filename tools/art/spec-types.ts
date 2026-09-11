import { readFileSync, writeFileSync } from 'node:fs'
import { emit, say } from './lib/cli'
import { REPO_ROOT, SCHEMA_PATH } from './lib/spec'
import { generateTypes, generateDoc, TYPES_PATH, DOC_PATH } from './lib/generate'

/**
 * spec-types — regenerate the TypeScript type and the field reference from
 * art/spec.schema.json. See lib/generate.ts for what and why.
 */
const ts = await generateTypes()
const doc = generateDoc()
const changed: string[] = []
for (const [path, content] of [[TYPES_PATH, ts], [DOC_PATH, doc]] as const) {
  let before = ''
  try { before = readFileSync(path, 'utf8') } catch { /* first run */ }
  if (before !== content) { writeFileSync(path, content); changed.push(path.slice(REPO_ROOT.length + 1)) }
}
say(`schema: ${SCHEMA_PATH.slice(REPO_ROOT.length + 1)}`)
say(changed.length ? `updated: ${changed.join(', ')}` : 'up to date')
emit('spec-types', true, changed.length ? `${changed.length} file(s) regenerated` : 'up to date', { changed })
