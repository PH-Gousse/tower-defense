import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

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

// GitHub Pages serves this repo at /tower-defense/. Change `base` to '/' if the
// client moves to Cloudflare Pages, Vercel or Netlify at a custom domain.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/tower-defense/',
  build: { outDir: 'dist', sourcemap: true },
  define: { __BUILD__: JSON.stringify(buildId()) },
})
