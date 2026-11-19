import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildApp, repoRoot } from './app.ts';
import { databaseUrl, redactUrl } from './core/db.ts';
import { defaultCookieSecure, ListenError, type ListenPlan, planListen } from './core/http.ts';

const dataDir = process.env.GRC_DATA_DIR ?? resolve(repoRoot, 'data');

// Where and how to listen. Plain HTTP is allowed only on the loopback address unless a TLS
// proxy is declared in front (GRC_ALLOW_INSECURE=1); see docs/installation.md.
let plan: ListenPlan;
try {
  plan = planListen();
} catch (err) {
  if (err instanceof ListenError) {
    console.error(`Sandpiper GRC did not start: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
// On HTTPS, or behind a trusted proxy, the session cookie is marked Secure whenever the request is HTTPS (E02-14).
const cookieDefault = defaultCookieSecure(plan);
if (cookieDefault) process.env.GRC_COOKIE_SECURE = cookieDefault;

const { app, modules, close } = await buildApp({ dataDir, https: plan.tls ? { cert: plan.tls.cert, key: plan.tls.key } : undefined });

await app.listen({ host: plan.host, port: plan.port });

const pidFile = dataDir === 'memory' ? null : join(dataDir, 'grc.pid');
if (pidFile) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(pidFile, String(process.pid));
}
const url = databaseUrl();
const database = url ? `PostgreSQL server ${redactUrl(url)}` : 'embedded database';
console.log(`Sandpiper GRC running at ${plan.url}  (${database}; modules: ${modules.map((m) => m.key).join(', ') || 'none'})`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // Stops accepting requests, lets those in progress finish, then closes the database
  // (flushes the embedded one, or ends the server connection pool).
  const force = setTimeout(() => {
    console.error('Shutdown took longer than 20 seconds; exiting.');
    if (pidFile) rmSync(pidFile, { force: true });
    process.exit(1);
  }, 20_000);
  force.unref();
  try {
    await close();
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
