// A throw-away Sandpiper GRC instance for the browser tests and the accessibility audit: its own
// data folder, a free port, the dev seed (invented sample data), a first administrator created
// through /api/setup, and one user per default role (switched-off roles are switched on).
//
//   const app = await startInstance({ dir, log });
//   app.base, app.admin = { username, password, token }, await app.userFor('agent'), await app.stop()
//
// Environment:
//   E2E_WEB_DIST   a web build to serve (a folder holding index.html); default: build one into
//                  <dir>/dist with Vite (about a minute). CI builds first and passes dist/web.
//   E2E_PORT       the port to use (default: a free one picked by the operating system)
//   E2E_DATABASE_URL  run the instance on a PostgreSQL server instead of the embedded database: a
//                  connection string for an account that may create databases (for example
//                  postgres://grc:secret@127.0.0.1:5432/grc). Each run creates a fresh database
//                  named grc_e2e_<time>_<random> on that server, passes it to the server as
//                  GRC_DATABASE_URL, and drops it when the run ends (kept with --keep). A
//                  GRC_DATABASE_URL (or _FILE, or GRC_DATABASE_MIGRATE_URL) in the environment is
//                  never passed on, so the tests cannot write to a real database by accident.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { sleep, totp } from './browser.mjs';

export const repoRoot = resolve(import.meta.dirname, '../../..');
const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const viteCli = join(repoRoot, 'node_modules/vite/bin/vite.js');

/** Passwords meet the default policy (14 characters or more). Invented, local, throw-away. */
export const PASSWORD = 'Harbour-Tram-Signal-42';

/** The default roles, in the order they are toured. */
export const ROLES = ['administrator', 'agent', 'security_lead', 'project_manager', 'approver', 'executive_viewer', 'auditor', 'requester'];

async function freePort() {
  if (process.env.E2E_PORT) return Number(process.env.E2E_PORT);
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}

/** The environment of a child process: ours without any database setting, plus `env`. */
function childEnv(env) {
  const out = { ...process.env };
  for (const k of ['GRC_DATABASE_URL', 'GRC_DATABASE_URL_FILE', 'GRC_DATABASE_MIGRATE_URL', 'GRC_DATABASE_MIGRATE_URL_FILE']) delete out[k];
  return { ...out, ...env };
}

/** A fresh, uniquely named database on the server E2E_DATABASE_URL points at; { url, name, drop() }. */
async function freshDatabase(adminUrl, log) {
  const { default: pg } = await import('pg');
  const name = `grc_e2e_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Byte-order sorting, as the embedded database and the unit tests on a server have.
    await admin.query(`create database "${name}" template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  log(`using a fresh PostgreSQL database ${name} on ${url.host}`);
  return {
    url: url.toString(), name,
    async drop() {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try { await c.query(`drop database if exists "${name}" with (force)`); } finally { await c.end(); }
    },
  };
}

function run(args, env, log, what) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, args, { cwd: repoRoot, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`${what} failed (exit ${code}):\n${out.slice(-3000)}`))));
  });
}

/** Builds the web application into `outDir` unless E2E_WEB_DIST points at a build. */
export async function webBuild(dir, log) {
  const given = process.env.E2E_WEB_DIST;
  if (given) {
    if (!existsSync(join(given, 'index.html'))) throw new Error(`E2E_WEB_DIST has no index.html: ${given}`);
    return resolve(given);
  }
  const out = join(dir, 'dist');
  if (existsSync(join(out, 'index.html')) && process.env.E2E_REUSE_BUILD === '1') return out;
  log('building the web application (set E2E_WEB_DIST to reuse a build)');
  await run([viteCli, 'build', '--logLevel', 'warn'], { GRC_WEB_DIST: out }, log, 'web build');
  return out;
}

export class Api {
  constructor(base, token = null) { this.base = base; this.token = token; }
  async call(method, path, body) {
    const r = await fetch(this.base + path, {
      method,
      headers: { 'x-grc-csrf': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.token ? { cookie: `grc_session=${this.token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const cookie = /grc_session=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1];
    return { status: r.status, body: json, text, cookie };
  }
  get(p) { return this.call('GET', p); }
  post(p, b = {}) { return this.call('POST', p, b); }
  patch(p, b = {}) { return this.call('PATCH', p, b); }
  del(p) { return this.call('DELETE', p); }
  /** Like call, but throws unless the status is 2xx. */
  async must(method, path, body) {
    const r = await this.call(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${r.text.slice(0, 300)}`);
    return r.body;
  }
}

/** Signs in through the API; returns the session token. */
export async function signIn(base, username, password, secret) {
  const body = { username, password, ...(secret ? { totp: totp(secret) } : {}) };
  const r = await new Api(base).post('/api/auth/login', body);
  if (!r.cookie) throw new Error(`sign-in failed for ${username}: ${r.status} ${r.text.slice(0, 200)}`);
  return r.cookie;
}

/**
 * E2E_BASE=http://127.0.0.1:<port>: use an instance already started by tools/e2e/serve.mjs (same
 * accounts and password) instead of starting one; much faster while writing a test.
 */
async function attachInstance(base, log, roles) {
  log(`using the running instance at ${base}`);
  const admin = { username: 'e2e.admin', password: PASSWORD, role: 'administrator' };
  admin.token = await signIn(base, admin.username, admin.password);
  const users = { administrator: admin };
  const adminApi = new Api(base, admin.token);
  if (roles) {
    for (const key of ROLES.filter((k) => k !== 'administrator')) {
      const username = `e2e.${key.replace(/_/g, '-')}`;
      users[key] = { username, password: PASSWORD, role: key, token: await signIn(base, username, PASSWORD) };
    }
  }
  return {
    base, admin, users, attached: true,
    api: (token = admin.token) => new Api(base, token),
    serverLog: () => '',
    async newUser(username, roleKeys) {
      const adminApi = new Api(base, admin.token); // the current session (tests refresh it)
      await adminApi.must('POST', '/api/auth/confirm', { password: PASSWORD });
      const made = await adminApi.must('POST', '/api/admin/users', { username, email: `${username}@example.test`, displayName: `Test ${username}`, roles: roleKeys });
      const token = new URL(made.setupLink, base).searchParams.get('token');
      await new Api(base).must('POST', '/api/auth/redeem', { token, password: PASSWORD });
      return { username, password: PASSWORD, id: made.user.id, token: await signIn(base, username, PASSWORD) };
    },
    async stop() {},
  };
}

export async function startInstance({ dir, log = console.log, roles = true }) {
  if (process.env.E2E_BASE) return attachInstance(process.env.E2E_BASE.replace(/\/$/, ''), log, roles);
  mkdirSync(dir, { recursive: true });
  const dataDir = join(dir, 'data');
  rmSync(dataDir, { recursive: true, force: true });
  const webDist = await webBuild(dir, log);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { GRC_DATA_DIR: dataDir, GRC_WEB_DIST: webDist, GRC_SEED_DIR: join(dir, 'no-seed'), GRC_PORT: String(port), GRC_MODULES: process.env.GRC_MODULES ?? '' };
  if (!env.GRC_MODULES) delete env.GRC_MODULES;
  const database = process.env.E2E_DATABASE_URL ? await freshDatabase(process.env.E2E_DATABASE_URL, log) : null;
  if (database) env.GRC_DATABASE_URL = database.url;

  let server = null;
  let serverLog = '';
  const startServer = async () => {
    serverLog = '';
    server = spawn(process.execPath, [tsxCli, 'server/src/main.ts'], { cwd: repoRoot, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (d) => { serverLog += d; });
    server.stderr.on('data', (d) => { serverLog += d; });
    const exited = new Promise((res) => server.once('exit', res));
    for (let i = 0; i < 240; i++) {
      const ok = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
      if (ok) return;
      if (server.exitCode !== null) break;
      await Promise.race([sleep(250), exited]);
    }
    throw new Error(`the server did not start on ${base}:\n${serverLog.slice(-3000)}`);
  };
  const stopServer = async () => {
    if (!server || server.exitCode !== null) return;
    const exited = new Promise((res) => server.once('exit', res));
    writeFileSync(join(dataDir, 'grc.stop'), '');
    const done = await Promise.race([exited.then(() => true), sleep(20000).then(() => false)]);
    if (!done) server.kill();
    server = null;
  };

  log(`starting a scratch instance on ${base} (data in ${dataDir})`);
  await startServer();
  const anon = new Api(base);
  const setup = await anon.post('/api/setup', { username: 'e2e.admin', email: 'e2e.admin@example.test', displayName: 'Test Administrator', password: PASSWORD, secondFactor: 'notice' });
  if (setup.status !== 200) throw new Error(`setup failed: ${setup.status} ${setup.text}`);
  await stopServer();
  log('loading the dev seed (invented sample data)');
  await run([tsxCli, 'server/src/cli.ts', 'seed', '--profile', 'dev'], env, log, 'dev seed');
  await startServer();

  const admin = { username: 'e2e.admin', password: PASSWORD, role: 'administrator' };
  admin.token = await signIn(base, admin.username, admin.password);
  const adminApi = new Api(base, admin.token);
  await adminApi.must('POST', '/api/auth/confirm', { password: PASSWORD });

  const users = { administrator: admin };
  if (roles) {
    const all = (await adminApi.must('GET', '/api/admin/roles'));
    const list = Array.isArray(all) ? all : all.rows ?? all.roles ?? [];
    for (const r of list) {
      if (!r.enabled && ROLES.includes(r.key)) await adminApi.must('POST', `/api/admin/roles/${r.id}/enable`, {});
    }
    for (const key of ROLES.filter((k) => k !== 'administrator')) {
      const username = `e2e.${key.replace(/_/g, '-')}`;
      const made = await adminApi.must('POST', '/api/admin/users', {
        username, email: `${username}@example.test`, displayName: `Test ${key.replace(/_/g, ' ')}`, roles: [key],
      });
      const token = new URL(made.setupLink, base).searchParams.get('token');
      await anon.must('POST', '/api/auth/redeem', { token, password: PASSWORD });
      users[key] = { username, password: PASSWORD, role: key, id: made.user.id, token: await signIn(base, username, PASSWORD) };
    }
  }

  return {
    base, port, dir, dataDir, webDist, admin, users,
    api: (token = admin.token) => new Api(base, token),
    serverLog: () => serverLog,
    /** Makes a fresh user holding `roles`; returns { username, password, id, token }. */
    async newUser(username, roleKeys) {
      const adminApi = new Api(base, admin.token); // the current session (tests refresh it)
      await adminApi.must('POST', '/api/auth/confirm', { password: PASSWORD });
      const made = await adminApi.must('POST', '/api/admin/users', { username, email: `${username}@example.test`, displayName: `Test ${username}`, roles: roleKeys });
      const token = new URL(made.setupLink, base).searchParams.get('token');
      await anon.must('POST', '/api/auth/redeem', { token, password: PASSWORD });
      return { username, password: PASSWORD, id: made.user.id, token: await signIn(base, username, PASSWORD) };
    },
    async stop({ keep = false } = {}) {
      await stopServer();
      if (!keep) rmSync(dataDir, { recursive: true, force: true });
      if (database && !keep) await database.drop().catch((err) => log(`(could not drop the database ${database.name}: ${err.message})`));
    },
  };
}
