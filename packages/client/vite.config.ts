import { defineConfig } from 'vite'

// GitHub Pages serves this repo at /tower-defense/. Change `base` to '/' if the
// client moves to Cloudflare Pages, Vercel or Netlify at a custom domain.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/tower-defense/',
  build: { outDir: 'dist', sourcemap: true },
})
