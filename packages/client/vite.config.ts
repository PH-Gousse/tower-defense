import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Build identity, stamped into every desync dump.
 *
 * Two peers on different builds is the likeliest cause of a desync that is not
 * a real bug, and the cheapest to rule out -- but only if the dump says which
 * build produced it. Falls back to "dev" when git is unavailable, which is the
 * case in some CI images and is not worth failing a build over.
 */
function buildId(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return dirty ? `${sha}-dirty` : sha
  } catch {
    return 'dev'
  }
}

/**
 * Serve `camera.html` at `/camera` and `bench.html` at `/bench`.
 *
 * Vite's own HTML fallback only rewrites URLs ending in `/` or `.html`, so
 * without this the camera demo is reachable at `/camera.html` and 404s at
 * `/camera` -- which is the URL everyone actually types. The rewrite is
 * dev-only; the built pages are plain `.html` files that any static host
 * serves at either URL according to its own rules.
 */
function extensionlessRoutes(): Plugin {
  const pages = ['camera', 'bench', 'assets']
  return {
    name: 'ltw:extensionless-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        for (const page of pages) {
          if (req.url === `/${page}` || req.url?.startsWith(`/${page}?`)) {
            req.url = `/${page}.html` + req.url.slice(page.length + 1)
            break
          }
        }
        next()
      })
    },
  }
}

/**
 * The asset catalogue, served and shipped.
 *
 * `assets/manifest.json` and `assets/build/` live at the repository root
 * (ADR-0018) so the art tooling, the gate and the client all read one
 * place. In dev this serves them at `/assets/...` straight from the repo;
 * in a build it copies them into `dist/assets/`. `assets/raw/` is never
 * served: it is the un-gated intermediate and can be large.
 *
 * The KTX2 transcoder (basis_transcoder.js + .wasm from three's examples)
 * is served at `/basis/` the same way, because KTX2Loader fetches it at
 * runtime and a bundler cannot see that fetch.
 *
 * In dev only, `POST /__art/regenerate?id=<id>` runs asset-build and
 * asset-gate for one asset so the /assets viewer can rebuild what it is
 * looking at. Never in a build, and never for an id that is not a spec.
 */
function assetCatalogue(): Plugin {
  const repo = resolve(import.meta.dirname, '..', '..')
  const assetsDir = join(repo, 'assets')
  const basisDir = resolve(import.meta.dirname, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis')
  const MIME: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.js': 'text/javascript', '.wasm': 'application/wasm', '.md': 'text/markdown', '.png': 'image/png' }
  const serve = (root: string, file: string, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: (s?: string) => void }) => {
    const path = join(root, file)
    if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) { res.statusCode = 404; res.end('not found'); return }
    res.setHeader('Content-Type', MIME[extname(path)] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-cache')
    createReadStream(path).pipe(res as never)
  }
  return {
    name: 'ltw:asset-catalogue',
    configureServer(server) {
      // Requests arrive with the configured base (`/tower-defense/...`) still on them.
      const base = server.config.base.replace(/\/$/, '')
      server.middlewares.use((req, res, next) => {
        let url = (req.url ?? '').split('?')[0] ?? ''
        if (base && url.startsWith(base + '/')) url = url.slice(base.length)
        if (url === '/assets/manifest.json' || url === '/assets/LICENSES.md') return serve(assetsDir, url.slice('/assets/'.length), res)
        if (url.startsWith('/assets/build/')) return serve(assetsDir, url.slice('/assets/'.length), res)
        if (url.startsWith('/basis/')) return serve(basisDir, url.slice('/basis/'.length), res)
        if (url === '/__art/regenerate' && req.method === 'POST') {
          const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? ''
          if (!/^[a-z0-9_]+$/.test(id) || !existsSync(join(repo, 'art', 'specs', `${id}.yaml`))) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'no such spec' })); return }
          const steps = [['asset-build', id], ['asset-gate', id], ['manifest-types']]
          let out = ''
          const run = (i: number) => {
            const step = steps[i]
            if (!step) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, output: out })); return }
            const p = spawn('pnpm', step, { cwd: repo })
            p.stdout.on('data', (d) => (out += String(d)))
            p.stderr.on('data', (d) => (out += String(d)))
            p.on('close', (code) => { if (code === 0) run(i + 1); else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, output: out })) } })
          }
          run(0)
          return
        }
        next()
      })
    },
    closeBundle() {
      const out = resolve(import.meta.dirname, 'dist')
      if (!existsSync(out)) return
      mkdirSync(join(out, 'assets'), { recursive: true })
      for (const f of ['manifest.json', 'LICENSES.md']) if (existsSync(join(assetsDir, f))) cpSync(join(assetsDir, f), join(out, 'assets', f))
      if (existsSync(join(assetsDir, 'build'))) cpSync(join(assetsDir, 'build'), join(out, 'assets', 'build'), { recursive: true, filter: (src) => !src.endsWith('README.md') })
      mkdirSync(join(out, 'basis'), { recursive: true })
      for (const f of readdirSync(basisDir)) if (f.startsWith('basis_transcoder')) cpSync(join(basisDir, f), join(out, 'basis', f))
    },
  }
}

// GitHub Pages serves this repo at /tower-defense/. Change `base` to '/' if the
// client moves to Cloudflare Pages, Vercel or Netlify at a custom domain.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/tower-defense/',
  plugins: [extensionlessRoutes(), assetCatalogue()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Two entry points, or the camera demo is simply absent from a production
    // build -- Vite only walks `index.html` unless told otherwise.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        camera: resolve(import.meta.dirname, 'camera.html'),
        // The render benchmark. Built rather than dev-only so `bench-scene`
        // can point a browser runner at a deployed URL, not just a dev server.
        bench: resolve(import.meta.dirname, 'bench.html'),
        // The dev asset viewer. Built so a deployed URL can show the catalogue too.
        assets: resolve(import.meta.dirname, 'assets.html'),
      },
    },
  },
  define: { __BUILD__: JSON.stringify(buildId()) },
})
