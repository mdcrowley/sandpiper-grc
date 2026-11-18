import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildApp, repoRoot } from './app.ts';

const port = Number(process.env.GRC_PORT ?? 8080);
const dataDir = process.env.GRC_DATA_DIR ?? resolve(repoRoot, 'data');

const { app, modules, close } = await buildApp({ dataDir });

// Local only: never listen on an external interface in the prototype.
await app.listen({ host: '127.0.0.1', port });

const pidFile = dataDir === 'memory' ? null : join(dataDir, 'grc.pid');
if (pidFile) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(pidFile, String(process.pid));
}
console.log(`GRC Platform running at http://127.0.0.1:${port}  (modules: ${modules.map((m) => m.key).join(', ') || 'none'})`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await close(); // flushes the embedded database
  } finally {
    if (pidFile) rmSync(pidFile, { force: true });
    process.exit(0);
  }
}
// Windows has no SIGTERM, so `grc.ps1 stop` asks for a clean shutdown by creating data/grc.stop.
if (pidFile) {
  const stopFile = join(dataDir, 'grc.stop');
  rmSync(stopFile, { force: true });
  setInterval(() => {
    if (existsSync(stopFile)) {
      rmSync(stopFile, { force: true });
      void shutdown();
    }
  }, 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);
