import { defineConfig } from 'vitest/config'

/**
 * These tests run whole bot-vs-bot matches, tens of thousands of ticks each,
 * and a round robin runs nine of them. The default 5s timeout was written for
 * unit tests and started failing the moment step 8 made matches last a real
 * fifteen minutes of game time.
 *
 * 300s since 2026-09-17: on the fourteen-creep ladder the shared round robin
 * took 63s on a laptop and 122.7s on the GitHub runner, 2.7s past the old
 * 120s. A wall-clock budget, not a game pin: the matches it runs are the
 * measurement and did not change.
 */
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 300_000 },
})
