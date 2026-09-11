import { join } from 'node:path'
import { REPO_ROOT } from './spec'

/** Every directory the pipeline reads or writes, in one place. */
export const ART = join(REPO_ROOT, 'art')
export const SPECS = join(ART, 'specs')
export const SOUNDS = join(ART, 'sounds')
export const GENERATORS = join(ART, 'generators')
export const SCRIPTS = join(ART, 'scripts')
export const SOURCE = join(ART, 'source')
export const ASSETS = join(REPO_ROOT, 'assets')
export const RAW = join(ASSETS, 'raw')
export const BUILD = join(ASSETS, 'build')
export const MANIFEST = join(ASSETS, 'manifest.json')
export const LICENSES = join(ASSETS, 'LICENSES.md')
export const REPORTS = join(REPO_ROOT, 'reports', 'art')

export const rel = (p: string): string => (p.startsWith(REPO_ROOT) ? p.slice(REPO_ROOT.length + 1) : p)
