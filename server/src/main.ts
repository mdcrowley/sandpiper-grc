import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import { join, resolve } from 'node:path';
import { buildApp, repoRoot } from './app.ts';
import { acquireDataLock, DataLockError } from './core/datalock.ts';
import { resolveGatewayKeyword, trustsAllPrivate } from './core/gateway.ts';
import { databaseUrl, redactUrl } from './core/db.ts';
import { defaultCookieSecure, ListenError, type ListenPlan, parseTrustProxy, planListen, tlsReloadSeconds, watchTlsFiles } from './core/http.ts';
import { migrateAsOwner } from './ops/db-roles.ts';
import { captureConsole, createLogger, type Logger, logRequests, logSettings } from './ops/logging.ts';
import { buildCommit } from './ops/version.ts';
import { appVersion } from './ops/files.ts';

const dataDir = process.env.GRC_DATA_DIR ?? resolve(repoRoot, 'data');

// Logging first (E16-16), so everything after it, including module messages written with
// console.*, is leveled, redacted and written to the rotating log file.
const consoleOut = { out: console.log.bind(console), err: console.error.bind(console) };
let logger: Logger;
try {
  logger = createLogger(logSettings(dataDir), consoleOut);
} catch (err) {
  consoleOut.err(`Sandpiper GRC did not start: ${(err as Error).message}`);
  process.exit(1);
}
const log = logger;
captureConsole(log);
process.on('uncaughtException', (err) => {
  log.error('Uncaught error; the server stops', { error: err });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { error: reason instanceof Error ? reason : new Error(String(reason)) });
});

// One process per data folder (OP-06): taken before the database is opened or migrated, so a
// second server (or a command) on the same folder stops here and changes nothing. Released when
// the process exits.
if (dataDir !== 'memory') {
  try {
    acquireDataLock(dataDir, 'server');
  } catch (err) {
    if (err instanceof DataLockError) {
      log.error(`Sandpiper GRC did not start: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

// Where and how to listen. Plain HTTP is allowed only on the loopback address unless a TLS
// proxy is declared in front (GRC_ALLOW_INSECURE=1); see docs/installation.md.
let plan: ListenPlan;
let reloadSeconds: number;
try {
  plan = planListen();
  reloadSeconds = tlsReloadSeconds();
} catch (err) {
  if (err instanceof ListenError) {
    log.error(`Sandpiper GRC did not start: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
// GRC_TRUST_PROXY=gateway (the container default, SP-03): the address of the container's gateway,
// which is where a reverse proxy on the Docker host connects from. Resolved once, before anything reads it.
{
  const resolved = resolveGatewayKeyword(process.env.GRC_TRUST_PROXY);
  if (resolved.note) {
    process.env.GRC_TRUST_PROXY = resolved.value;
    log.info(resolved.note, { console: true });
  }
  if (plan.tls && trustsAllPrivate(process.env.GRC_TRUST_PROXY)) {
    log.warn('GRC_TRUST_PROXY=private while this server speaks HTTPS itself: anyone with a private address can set the ' +
      'client address it records and rate-limits by. Name the proxy\'s own address instead, or leave GRC_TRUST_PROXY unset.', { console: true });
  }
}
// On HTTPS, or behind a trusted proxy, the session cookie is marked Secure whenever the request is HTTPS (E02-14).
const cookieDefault = defaultCookieSecure(plan);
if (cookieDefault) process.env.GRC_COOKIE_SECURE = cookieDefault;

// With a separate owner account for the schema (E16-31), migrate as the owner first; the server
// itself then runs as the least-privileged account in GRC_DATABASE_URL.
try {
  const owner = await migrateAsOwner(dataDir, (dir) => buildApp({ dataDir: dir, serveWeb: false }));
  if (owner) {
    log.info(`Migrations run as the owner account: ${owner.applied.length ? owner.applied.join(', ') : 'none pending'}` +
      (owner.granted ? `; run-time role "${owner.granted}" granted on ${owner.tables} tables` : ''), { console: true });
  }
} catch (err) {
  log.error(`Sandpiper GRC did not start: ${(err as Error).message}`);
  process.exit(1);
}

const { app, modules, close } = await buildApp({ dataDir, https: plan.tls ? { cert: plan.tls.cert, key: plan.tls.key } : undefined });

// One line per request, with the client address the same way the application sees it.
const trusted = parseTrustProxy(process.env.GRC_TRUST_PROXY);
const clientIp = (req: IncomingMessage) => {
  const peer = req.socket.remoteAddress;
  const forwarded = req.headers['x-forwarded-for'];
  if (!peer || !forwarded || !trusted(peer, 0)) return peer;
  const hops = String(forwarded).split(',').map((s) => s.trim()).filter(Boolean);
  // Walk back from the nearest hop while each one is a trusted proxy.
  for (let i = hops.length - 1, hop = 1; i >= 0; i--, hop++) if (i === 0 || !trusted(hops[i], hop)) return hops[i];
  return peer;
};
logRequests(app.server as unknown as Server, log, clientIp);

await app.listen({ host: plan.host, port: plan.port });

// A renewed certificate is used for new connections without a restart (E16-33): the files are
// looked at every GRC_TLS_RELOAD_SECONDS, and at once on SIGHUP (Linux and macOS).
if (plan.tls) {
  const reloader = watchTlsFiles(app.server as unknown as { setSecureContext(o: { cert: Buffer; key: Buffer }): void }, plan.tls, {
    intervalMs: reloadSeconds * 1000,
    onResult: (r) => (r.ok ? log.info(r.message, { console: true }) : log.error(r.message)),
  });
  if (process.platform !== 'win32') process.on('SIGHUP', () => reloader.check(true));
}

const pidFile = dataDir === 'memory' ? null : join(dataDir, 'grc.pid');
if (pidFile) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(pidFile, String(process.pid));
}
const url = databaseUrl();
const database = url ? `PostgreSQL server ${redactUrl(url)}` : 'embedded database';
const commit = buildCommit();
log.info(
  `Sandpiper GRC ${appVersion()}${commit ? ` (${commit.slice(0, 12)})` : ''} running at ${plan.url}  (${database}; modules: ${modules.map((m) => m.key).join(', ') || 'none'})`,
  { console: true, version: appVersion(), commit, pid: process.pid, logFile: log.file?.path ?? null },
);

let stopping = false;
async function shutdown(reason: string) {
  if (stopping) return;
  stopping = true;
  log.info(`Stopping (${reason})`, { console: true });
  // Stops accepting requests, lets those in progress finish, then closes the database
  // (flushes the embedded one, or ends the server connection pool).
  const force = setTimeout(() => {
    log.error('Shutdown took longer than 20 seconds; exiting.');
    if (pidFile) rmSync(pidFile, { force: true });
    process.exit(1);
  }, 20_000);
  force.unref();
  try {
    await close();
  } finally {
    if (pidFile) rmSync(pidFile, { force: true });
    log.info('Stopped');
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
      void shutdown('stop file');
    }
  }, 500).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
