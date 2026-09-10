import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
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
  const pages = ['camera', 'bench']
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

// GitHub Pages serves this repo at /tower-defense/. Change `base` to '/' if the
// client moves to Cloudflare Pages, Vercel or Netlify at a custom domain.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/tower-defense/',
  plugins: [extensionlessRoutes()],
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
      },
    },
  },
  define: { __BUILD__: JSON.stringify(buildId()) },
})
