import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// shared/: code used by the server, the web application and the mobile app (mobile/ has its own Jest tests).
// tools/: the change-based CI's own rules (tools/ci, tools/e2e/suite-map.mjs).
const ALL = ['server/src/**/*.test.ts', 'web/src/**/*.test.ts', 'shared/**/*.test.ts', 'tools/**/*.test.ts'];

// GRC_TEST_LIST: a file naming the test files to run, one per line (written by tools/ci/run.mjs and
// the GitHub workflow for a change-based run); every test otherwise.
const listed = process.env.GRC_TEST_LIST
  ? readFileSync(process.env.GRC_TEST_LIST, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  : null;

export default defineConfig({
  test: {
    include: listed ?? ALL,
    exclude: ['**/node_modules/**', 'mobile/**', 'tools/sr/**'],
    environment: 'node',
    // Fixed so date arithmetic in tests does not depend on the machine running them.
    env: { GRC_TIMEZONE: 'America/New_York' },
    // Generous: the export round trip runs every module's migrations and is slow when all test files run in parallel.
    testTimeout: 240000,
    hookTimeout: 60000,
    pool: 'forks',
    // Makes the migrated template database every in-memory test database starts from, once per run
    // (server/src/test/global-setup.ts, core/db-template.ts).
    globalSetup: ['server/src/test/global-setup.ts'],
  },
});
