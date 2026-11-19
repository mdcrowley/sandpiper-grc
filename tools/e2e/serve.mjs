// Starts the same throw-away instance the browser tests use and keeps it running until Ctrl+C,
// printing the address and one account per default role. Handy for writing a new test.
//
//   node tools/e2e/serve.mjs [scratch folder]      (default: <temp>/sandpiper-e2e-serve)
//
// E2E_WEB_DIST and E2E_PORT work as for the tests (see lib/instance.mjs).
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startInstance } from './lib/instance.mjs';

const dir = process.argv[2] ?? join(tmpdir(), 'sandpiper-e2e-serve');
const app = await startInstance({ dir, log: (m) => console.log(`- ${m}`) });
console.log(`\nRunning at ${app.base}  (password for every account: ${app.admin.password})`);
for (const [role, u] of Object.entries(app.users)) console.log(`  ${role.padEnd(18)} ${u.username}`);
console.log('\nCtrl+C stops it.');
const stop = async () => { await app.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
