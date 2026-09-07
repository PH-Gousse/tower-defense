import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The sim has no DOM. If a test ever needs one, that test belongs in the
    // client package, not here.
    environment: 'node',
  },
})
