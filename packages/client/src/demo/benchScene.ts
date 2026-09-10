import { BOT_EASY, BOT_NORMAL, MAX_CREEPS, MatchResult, botCommand, Kind, type Command } from '@ltw/sim'
import { createScene, WebGLUnavailable } from '../scene'

/**
 * The benchmark scene: two full mazes and a heavy creep population, rendered
 * flat out, reporting fps, draw calls and per-frame allocation.
 *
 * It is the real game scene, not a mock. `createScene` is the same function
 * `main.ts` calls, so a number measured here is a number the game would
 * actually produce. A synthetic scene that merely looked similar would be
 * measuring the benchmark rather than the game — and the most likely render
 * regressions (an InstancedMesh rebuilt per frame, a material recompiled on a
 * state change) live in exactly the code a mock would replace.
 *
 * How it gets to a heavy state: it runs the real simulation forward at
 * accelerated wall-clock until both lanes are saturated, then starts measuring.
 * Two hard bots reach a few hundred creeps and near-saturated mazes on their
 * own — no state is hand-constructed, so the population it measures is one the
 * game can genuinely produce.
 *
 * Results land on `window.__BENCH__` as well as the console, so a headless
 * runner can read them without scraping text. See
 * `packages/harness/tools/bench-scene.ts` for the runner (currently a stub —
 * no browser automation is installed).
 */

/**
 * The matchup, and it is chosen from measurement rather than by taste.
 *
 * A hard-vs-hard mirror is the obvious pick and it is the wrong one: it decides
 * in ~4,400 ticks with 18 creeps on the board, because two aggressive bots kill
 * each other before a population builds. Measured.
 *
 * This pairing is the one `pnpm headless-match --seed 1` runs, which reaches a
 * peak of ~880 creeps over ~23,000 ticks. The asymmetry is the point: the
 * weaker seat leaks steadily without dying quickly, so creeps accumulate.
 */
const LOCAL_BOT = { ...BOT_EASY, template: 1 }
const OPPONENT_BOT = { ...BOT_NORMAL, template: 1 }

/** What the scene must reach before measurement starts. */
const TARGET_CREEPS = 300
/** Give up warming up after this much simulated time; report what we got. */
const WARMUP_TICK_CEILING = 30_000
/** Frames to sample once warm. ~5s at 60fps. */
const SAMPLE_FRAMES = 300
/**
 * Wall-clock ceiling on the measurement phase.
 *
 * Without it a throttled tab never finishes: Chrome drops a background tab's
 * rAF to roughly 1Hz, so 300 frames becomes five minutes and the page appears
 * to hang. A deadline turns that into a result that SAYS it was throttled,
 * which is the difference between a benchmark that fails usefully and one that
 * just stops.
 */
const SAMPLE_DEADLINE_MS = 15_000
/** Below this, the tab was almost certainly throttled rather than slow. */
const THROTTLED_FPS = 10

export interface BenchBudgets {
  readonly fps: number
  readonly drawCalls: number
  /** Bytes per frame. Anything above this means the render loop allocates. */
  readonly bytesPerFrame: number
}

/**
 * Budgets, and every one of them is `[proposed]`.
 *
 * They are placeholders with the right shape, not measured targets — nobody has
 * profiled this on the machines it has to run on. Treat a breach as "look at
 * it", not as "this is broken".
 */
export const BUDGETS: BenchBudgets = {
  fps: 60,
  drawCalls: 200,
  bytesPerFrame: 1024,
}

export interface BenchResult {
  readonly ok: boolean
  /** The tab was backgrounded or throttled, so the fps figure is meaningless. */
  readonly throttled: boolean
  readonly warmupTicks: number
  readonly creeps: number
  readonly towers: number
  readonly frames: number
  readonly fps: { readonly mean: number; readonly p1: number; readonly p50: number }
  readonly drawCalls: number
  readonly triangles: number
  readonly geometries: number
  readonly textures: number
  readonly bytesPerFrame: number | null
  readonly budgets: BenchBudgets
  readonly breaches: readonly string[]
  readonly notes: readonly string[]
}

declare global {
  interface Window {
    __BENCH__?: BenchResult | { running: true; phase: string }
  }
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id)
  if (!e) throw new Error(`missing #${id}`)
  return e
}

function report(phase: string, detail = ''): void {
  el('benchhud').textContent = `${phase}\n${detail}`
  window.__BENCH__ = { running: true, phase }
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number
}

/**
 * `performance.memory` is Chromium-only and needs a flag to be precise, so a
 * null here means "not measured", never "zero". Reporting an unavailable
 * measurement as 0 would read as a perfect score.
 */
interface MaybeMemory {
  memory?: { usedJSHeapSize: number }
}

function heapNow(): number | null {
  const m = (performance as unknown as MaybeMemory).memory
  return m ? m.usedJSHeapSize : null
}

function main(): void {
  const parent = el('bench')
  let scene: ReturnType<typeof createScene>
  try {
    scene = createScene(parent, OPPONENT_BOT)
  } catch (e) {
    if (e instanceof WebGLUnavailable) {
      el('benchhud').textContent = 'No WebGL context. The benchmark needs a GPU-backed browser.'
      window.__BENCH__ = undefined
      return
    }
    throw e
  }

  const driver = scene.driver
  const notes: string[] = []

  // --- warm up ---------------------------------------------------------------
  //
  // Drive the real sim with a fake accelerated clock. `advance` clamps a large
  // dt to MAX_CATCHUP_TICKS, so this feeds it many small steps rather than one
  // huge one — which is also what keeps the bot's per-tick decisions intact.
  report('warming up', 'running the sim to a saturated board')

  /**
   * Play the LOCAL seat with the bot too.
   *
   * The Driver runs a bot for the opponent only; seat `me` is the human and
   * does nothing without input. A benchmark left in that state builds eight
   * towers and four creeps in thirty thousand ticks, which is not a board worth
   * measuring — measured, and that is exactly what it did.
   *
   * So the page drives its own seat through the SAME public queue API a click
   * would use. Nothing privileged, nothing injected into sim state: the bench
   * is a very fast player, which is the only way the numbers stay comparable to
   * a real match.
   */
  function playLocalSeat(): void {
    const state = driver.current
    for (const cmd of botCommand(state, driver.me, LOCAL_BOT) as readonly Command[]) {
      switch (cmd.kind) {
        case Kind.Build:
          driver.queueBuild(cmd.x, cmd.y, cmd.tower)
          break
        case Kind.Upgrade:
          driver.queueUpgrade(cmd.x, cmd.y)
          break
        case Kind.Sell:
          driver.queueSell(cmd.x, cmd.y)
          break
        case Kind.Send:
          driver.queueSend(cmd.creep)
          break
        default:
          break
      }
    }
  }

  let fakeNow = 0
  const TICK_MS = 1000 / 20
  let warmupTicks = 0

  function creepCount(): number {
    let n = 0
    for (const lane of driver.current.lanes) n += lane.creeps.count
    return n
  }

  function towerCount(): number {
    let n = 0
    for (const lane of driver.current.lanes) {
      for (let i = 0; i < lane.towers.kind.length; i++) if (lane.towers.kind[i] !== -1) n++
    }
    return n
  }

  /**
   * Chunked so the page can paint a progress line rather than locking up for
   * several seconds with no explanation.
   *
   * Scheduled with `setTimeout`, NOT `requestAnimationFrame`, and that is not a
   * style choice: Chrome throttles rAF to approximately zero in a background
   * tab, so an rAF-driven warm-up never finishes unless a human is watching it.
   * This was found by driving the page from a headless-ish runner and watching
   * it sit on "warming up" forever. Warm-up is pure computation and has no
   * reason to be frame-aligned; only the measurement phase does.
   */
  function ended(): boolean {
    return driver.current.result !== MatchResult.Playing
  }

  function warmChunk(): void {
    const until = Math.min(warmupTicks + 2000, WARMUP_TICK_CEILING)
    while (warmupTicks < until && creepCount() < TARGET_CREEPS && !ended()) {
      playLocalSeat()
      fakeNow += TICK_MS
      warmupTicks += driver.advance(fakeNow)
    }

    const creeps = creepCount()
    report('warming up', `${warmupTicks} ticks, ${creeps} creeps, ${towerCount()} towers`)

    if (creeps >= TARGET_CREEPS || warmupTicks >= WARMUP_TICK_CEILING || ended()) {
      // A finished match is frozen by `step`, so warming past the end burns
      // ticks doing literally nothing — which is what it used to do, quietly,
      // for twenty thousand of them. Stopping at the end and SAYING so is the
      // difference between a small board and a small board you understand.
      if (ended()) {
        notes.push(
          `the match ENDED at tick ${warmupTicks} with ${creeps} creeps on the board. ` +
            'A finished match is frozen, so this is the heaviest board these bots reached ' +
            'before somebody won — not a snapshot of peak load.',
        )
      }
      if (creeps < TARGET_CREEPS) {
        notes.push(
          `warm-up reached ${creeps} creeps, short of the ${TARGET_CREEPS} target. ` +
            'The benchmark below is therefore measuring a LIGHT board and does not ' +
            'exercise the render budget it exists to test.',
        )
      }
      if (creeps >= MAX_CREEPS) notes.push('the lane hit MAX_CREEPS — Refusal.LaneFull is active')
      setTimeout(() => measure(creeps), 0)
      return
    }
    setTimeout(warmChunk, 0)
  }

  // --- measure ---------------------------------------------------------------

  function measure(creeps: number): void {
    report('measuring', `${SAMPLE_FRAMES} frames`)

    const frameMs: number[] = []
    const heapStart = heapNow()
    let heapEnd: number | null = null
    const deadline = performance.now() + SAMPLE_DEADLINE_MS
    let last = performance.now()
    let frames = 0

    // The scene owns its own animation loop, so start it and piggy-back a
    // sampler on rAF rather than replacing it. Measuring a loop we substituted
    // would measure the substitute.
    //
    // This half DOES need rAF — it is measuring frames — which means the
    // measurement phase, unlike the warm-up, genuinely requires a foregrounded
    // tab. A headless runner must pass --disable-background-timer-throttling
    // and --disable-renderer-backgrounding, or it will measure a throttled
    // renderer and report a catastrophic fps that is an artefact.
    scene.start()

    // Whichever of these two fires first wins, and `done` makes sure only one
    // of them reports. The rAF sampler cannot be trusted to enforce its own
    // deadline: a fully backgrounded tab fires NO frames at all, so the check
    // inside `sample` never runs and the page hangs on "measuring" forever.
    // The watchdog is what guarantees a result exists either way.
    let done = false

    function report_(): void {
      if (done) return
      done = true
      if (frames < SAMPLE_FRAMES) {
        notes.push(
          `measurement stopped at ${frames}/${SAMPLE_FRAMES} frames on the ` +
            `${SAMPLE_DEADLINE_MS}ms deadline — the tab was too slow, or got no frames at all`,
        )
      }
      heapEnd = heapNow()
      finish(creeps, frameMs, heapStart, heapEnd)
    }

    function sample(): void {
      if (done) return
      const now = performance.now()
      frameMs.push(now - last)
      last = now
      frames++

      if (frames < SAMPLE_FRAMES && now < deadline) {
        requestAnimationFrame(sample)
        return
      }
      report_()
    }

    requestAnimationFrame(sample)
    setTimeout(report_, SAMPLE_DEADLINE_MS)
  }

  function finish(
    creeps: number,
    frameMs: number[],
    heapStart: number | null,
    heapEnd: number | null,
  ): void {
    // Drop the first few frames: the first sync after warm-up rebuilds every
    // instance buffer, which is real work but not per-frame work.
    // A run that got almost no frames has nothing to drop.
    const settled = frameMs.length > 20 ? frameMs.slice(10) : frameMs
    const fps = settled.map((ms) => (ms > 0 ? 1000 / ms : 0)).sort((a, b) => a - b)
    const mean = fps.reduce((a, b) => a + b, 0) / Math.max(1, fps.length)

    // three.js exposes render stats on the renderer it owns. Reading the
    // scene's own renderer is the point: a second one would be a second GL
    // context measuring the wrong thing.
    const rinfo = scene.renderer.info

    const bytesPerFrame =
      heapStart !== null && heapEnd !== null && settled.length > 0
        ? Math.max(0, (heapEnd - heapStart) / frameMs.length)
        : null

    if (bytesPerFrame === null) {
      notes.push('performance.memory is unavailable, so per-frame allocation was not measured')
    }

    const drawCalls = rinfo.render.calls
    const triangles = rinfo.render.triangles

    /**
     * A throttled tab is not a slow renderer, and reporting it as one would be
     * the most misleading thing this page could do. Below ~10fps in a scene
     * this small, the environment is the finding.
     */
    const throttled = settled.length === 0 || quantile(fps, 0.5) < THROTTLED_FPS
    if (throttled) {
      notes.push(
        `median fps ${quantile(fps, 0.5).toFixed(1)} is below ${THROTTLED_FPS} — this is almost ` +
          'certainly a backgrounded or throttled tab, NOT a render regression. Foreground the ' +
          'tab, or launch the browser with --disable-background-timer-throttling ' +
          '--disable-renderer-backgrounding.',
      )
    }

    const breaches: string[] = []
    if (!throttled && quantile(fps, 0.5) < BUDGETS.fps) {
      breaches.push(`median fps ${quantile(fps, 0.5).toFixed(1)} < budget ${BUDGETS.fps}`)
    }
    if (drawCalls > BUDGETS.drawCalls) {
      breaches.push(`draw calls ${drawCalls} > budget ${BUDGETS.drawCalls}`)
    }
    if (bytesPerFrame !== null && bytesPerFrame > BUDGETS.bytesPerFrame) {
      breaches.push(`${bytesPerFrame.toFixed(0)} bytes/frame > budget ${BUDGETS.bytesPerFrame}`)
    }

    const result: BenchResult = {
      // A throttled run is not a pass, whatever the other numbers say.
      ok: breaches.length === 0 && !throttled,
      throttled,
      warmupTicks,
      creeps,
      towers: towerCount(),
      frames: settled.length,
      fps: { mean, p1: quantile(fps, 0.01), p50: quantile(fps, 0.5) },
      drawCalls,
      triangles,
      geometries: rinfo.memory.geometries,
      textures: rinfo.memory.textures,
      bytesPerFrame,
      budgets: BUDGETS,
      breaches,
      notes,
    }

    window.__BENCH__ = result

    const lines = [
      `bench-scene — ${result.creeps} creeps, ${result.towers} towers, ${result.warmupTicks} warm-up ticks`,
      ``,
      `fps      mean ${result.fps.mean.toFixed(1)}   p50 ${result.fps.p50.toFixed(1)}   p1 ${result.fps.p1.toFixed(1)}   (budget ${BUDGETS.fps})`,
      `draws    ${result.drawCalls}   (budget ${BUDGETS.drawCalls})`,
      `tris     ${result.triangles}`,
      `geo/tex  ${result.geometries} / ${result.textures}`,
      `alloc    ${result.bytesPerFrame === null ? 'not measured' : `${result.bytesPerFrame.toFixed(0)} B/frame (budget ${BUDGETS.bytesPerFrame})`}`,
      ``,
      result.throttled
        ? 'THROTTLED — the fps figure above is an artefact, not a measurement'
        : result.ok
          ? 'within budget'
          : `BREACHED:\n  ${result.breaches.join('\n  ')}`,
      ...(notes.length > 0 ? ['', 'notes:', ...notes.map((n) => `  ${n}`)] : []),
    ]
    el('benchhud').textContent = lines.join('\n')
    console.log(lines.join('\n'))
    console.log('BENCH_JSON ' + JSON.stringify(result))
  }

  setTimeout(warmChunk, 0)
}

main()
