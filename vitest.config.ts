import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/src/**/*.test.ts'],
    environment: 'node',
    // Fixed so date arithmetic in tests does not depend on the machine running them.
    env: { GRC_TIMEZONE: 'America/New_York' },
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
