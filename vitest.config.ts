import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // shared/: code used by the server, the web application and the mobile app (mobile/ has its own Jest tests).
    include: ['server/src/**/*.test.ts', 'web/src/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    // Fixed so date arithmetic in tests does not depend on the machine running them.
    env: { GRC_TIMEZONE: 'America/New_York' },
    // Generous: the export round trip runs every module's migrations and is slow when all test files run in parallel.
    testTimeout: 240000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
