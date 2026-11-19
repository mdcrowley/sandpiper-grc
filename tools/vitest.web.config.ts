// Tests for the web code that need no browser (pure helpers: the QR encoder, Help's route map
// and search, the Overview layout store). Run with:
//   npx vitest run --config tools/vitest.web.config.ts
// The main vitest.config.ts covers the server; these are kept apart so they run in Node without
// the server's environment.
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  test: {
    include: ['web/src/**/*.test.ts'],
    environment: 'node',
  },
});
