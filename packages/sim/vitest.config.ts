import { defineConfig } from 'vitest/config'

/**
 * A few of these run whole simulated matches rather than a unit of logic, and
 * the default 5s was written for the latter. It passed locally and failed on a
 * slower CI runner, which is the worst way to find a timeout.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The sim has no DOM. If a test ever needs one, that test belongs in the
    // client package, not here.
    environment: 'node',
    testTimeout: 30_000,
  },
})
