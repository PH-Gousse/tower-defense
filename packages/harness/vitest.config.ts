import { defineConfig } from 'vitest/config'

/**
 * These tests run whole bot-vs-bot matches, tens of thousands of ticks each,
 * and a round robin runs nine of them. The default 5s timeout was written for
 * unit tests and started failing the moment step 8 made matches last a real
 * fifteen minutes of game time.
 */
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 120_000 },
})
