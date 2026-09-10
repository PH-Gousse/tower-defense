import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs, str, say, emit } from './lib/cli'
import { REPO_ROOT } from './lib/scan'

/**
 * `bench-scene` — STUB. The scene is real; the runner that drives it is not.
 *
 * What exists:
 *   packages/client/bench.html            the benchmark page
 *   packages/client/src/demo/benchScene.ts  warms the real sim to ~300 creeps
 *                                           on two saturated mazes, samples 300
 *                                           frames, reports fps / draw calls /
 *                                           per-frame allocation against budgets
 *
 * What does not exist: any way to open that page without a human.
 *
 * There is no browser automation in this repo — no Playwright, no Puppeteer,
 * nothing in the lockfile — and installing one was deliberately NOT done
 * unprompted. A browser runner is a ~200MB download, a CI image change and a
 * new flake surface, and that is a decision to take deliberately rather than
 * to discover in a diff.
 *
 * So this script does the honest thing: it verifies the scene is present and
 * buildable, prints exactly how to run it by hand, prints what installing a
 * runner would involve, and exits NON-ZERO so nothing downstream mistakes a
 * stub for a passing benchmark.
 *
 * To run the benchmark today:
 *   pnpm dev
 *   open http://localhost:5173/tower-defense/bench
 *   read the overlay, or the console line beginning "BENCH_JSON"
 *
 * To make this script real, someone has to decide to add Playwright:
 *   pnpm add -Dw @playwright/test && pnpm exec playwright install chromium
 * then replace the body below with: launch chromium (with
 * --enable-precise-memory-info so per-frame allocation is measurable at all),
 * navigate to the bench URL, poll `window.__BENCH__` until it is not
 * `{running:true}`, and emit it.
 *
 * Tracked as an issue. Do not quietly make this pass.
 */

const args = parseArgs(process.argv.slice(2))
const url = str(args, 'url', 'http://localhost:5173/tower-defense/bench')

const SCENE = 'packages/client/src/demo/benchScene.ts'
const PAGE = 'packages/client/bench.html'

const scenePresent = existsSync(join(REPO_ROOT, SCENE))
const pagePresent = existsSync(join(REPO_ROOT, PAGE))

// Look for a browser runner the way a person would: is it in the lockfile.
const lockfile = join(REPO_ROOT, 'pnpm-lock.yaml')
let runner: string | null = null
if (existsSync(lockfile)) {
  const text = readFileSync(lockfile, 'utf8')
  if (text.includes('playwright')) runner = 'playwright'
  else if (text.includes('puppeteer')) runner = 'puppeteer'
}

say('bench-scene — STUB, not a benchmark result')
say()
say('  the scene exists:')
say(`    ${scenePresent ? 'ok  ' : 'MISSING'} ${SCENE}`)
say(`    ${pagePresent ? 'ok  ' : 'MISSING'} ${PAGE}`)
say()
say('  the runner does not:')
say(`    no browser automation is installed (searched pnpm-lock.yaml${runner ? `, found ${runner}` : ''})`)
say()
say('  what the scene measures, once something can open it:')
say('    - median / p1 fps over 300 settled frames')
say('    - draw calls and triangles, from the real renderer.info')
say('    - bytes allocated per frame (Chromium only, needs')
say('      --enable-precise-memory-info; reported as "not measured" otherwise)')
say('    all against budgets in benchScene.ts, which are [proposed] placeholders')
say('    — nobody has profiled this on the hardware it has to run on.')
say()
say('  run it by hand:')
say('    pnpm dev')
say(`    open ${url}`)
say('    read the overlay, or the console line beginning "BENCH_JSON"')
say()
say('  to make this script real, someone has to decide to add a runner:')
say('    pnpm add -Dw @playwright/test && pnpm exec playwright install chromium')
say('    then drive the page, poll window.__BENCH__, and emit it.')
say('    That is a ~200MB download and a CI image change — a decision, not a chore.')
say()
say('  exiting non-zero on purpose: a stub must not read as a passing benchmark.')
say()

emit('bench-scene', false, 'stub — no browser runner installed', {
  stub: true,
  scenePresent,
  pagePresent,
  runner,
  url,
  measures: ['fps.p50', 'fps.p1', 'drawCalls', 'triangles', 'bytesPerFrame'],
  manualSteps: ['pnpm dev', `open ${url}`, 'read the BENCH_JSON console line'],
  toImplement: 'pnpm add -Dw @playwright/test && pnpm exec playwright install chromium',
})
