import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { ADMIN } from '../test/helpers.ts';
import { createSession, SESSION_COOKIE } from './auth.ts';
import { countRequest, pruneRequestCounts } from './ratelimit.ts';

// E16-43: the per-token request counts (tokens.rate_per_minute, the RateLimit headers and
// mcp.rate_per_minute) are kept in the database, so two application processes on one PostgreSQL
// database share them. Two applications are built here on one database reached through the
// PostgreSQL wire protocol: a PGlite behind a socket, or, when GRC_TEST_DATABASE_URL names a real
// server (the PostgreSQL 17 leg of continuous integration), a fresh database there.

type App = Awaited<ReturnType<typeof buildApp>>;

async function sharedDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  const adminUrl = process.env.GRC_TEST_DATABASE_URL?.trim();
  if (adminUrl) {
    const name = `grc_test_counts_${randomBytes(4).toString('hex')}`;
    const run = async (sql: string) => {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try { await c.query(sql); } finally { await c.end(); }
    };
    await run(`create database ${name} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    return { url: url.toString(), stop: () => run(`drop database if exists ${name} with (force)`) };
  }
  const lite = new PGlite({ extensions: { pg_trgm } });
  await lite.waitReady;
  const server = new PGLiteSocketServer({ db: lite, host: '127.0.0.1', port: 0, maxConnections: 100 });
  await server.start();
  return {
    url: `postgres://postgres@${server.getServerConn()}/postgres`,
    async stop() { await server.stop(); await lite.close(); },
  };
}

const ENV = ['GRC_DATABASE_URL', 'GRC_DATABASE_URL_FILE', 'GRC_DATABASE_PASSWORD', 'GRC_DATABASE_SSL', 'GRC_SECRET_KEY', 'GRC_SECRET_KEY_FILE', 'GRC_MODULES'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const dirs: string[] = [];
let db: Awaited<ReturnType<typeof sharedDatabase>>;
let a: App;
let b: App;
let token = '';
let mcpToken = '';

async function call(app: App, method: 'GET' | 'POST', url: string, bearer: string, payload?: unknown) {
  return app.app.inject({
    method, url,
    headers: { authorization: `Bearer ${bearer}`, ...(payload ? { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } : {}) },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
}

/** Waits, when the database's clock is in the last seconds of a minute, until the next one begins. */
async function freshMinute(): Promise<void> {
  const s = Number((await a.db.one<{ s: number }>('select extract(second from now())::float8 as s'))!.s);
  if (s > 45) await new Promise((r) => setTimeout(r, (60.5 - s) * 1000));
}

beforeAll(async () => {
  db = await sharedDatabase();
  for (const k of ENV) delete process.env[k];
  process.env.GRC_DATABASE_URL = db.url;
  process.env.GRC_DATABASE_SSL = 'off';
  process.env.GRC_SECRET_KEY = randomBytes(32).toString('hex'); // the same key in both, as on a real cluster
  process.env.GRC_MODULES = 'admin,mcp';
  const dir = () => { const d = mkdtempSync(join(tmpdir(), 'grc-counts-')); dirs.push(d); return d; };
  // One after the other: the second finds the schema the first migrated.
  a = await buildApp({ dataDir: dir(), serveWeb: false });
  b = await buildApp({ dataDir: dir(), serveWeb: false });

  const setup = await a.app.inject({ method: 'POST', url: '/api/setup', headers: { 'x-grc-csrf': '1' }, payload: ADMIN });
  expect(setup.statusCode, setup.body).toBe(200);
  const user = (await a.db.one<{ id: string }>(`select id from users where username = 'admin'`))!;
  const cookie = `${SESSION_COOKIE}=${await createSession(a.db, user.id)}`;
  const headers = { cookie, 'x-grc-csrf': '1' };
  const made = await a.app.inject({ method: 'POST', url: '/api/me/tokens', headers, payload: { name: 'Shared count', scopes: ['admin.administer'], expiresInDays: 1 } });
  expect(made.statusCode, made.body).toBe(201);
  token = made.json().token;
  await a.ctx.settings.set('mcp.enabled', true);
  const assistant = await a.app.inject({ method: 'POST', url: '/api/mcp/tokens', headers, payload: { name: 'Shared assistant', access: 'read', expiresInDays: 1 } });
  expect(assistant.statusCode, assistant.body).toBe(201);
  mcpToken = assistant.json().token;
}, 240_000);

afterAll(async () => {
  await b?.close();
  await a?.close();
  await db?.stop();
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('per-token request counts shared by every server process (E16-43)', () => {
  it('holds the token limit across two applications on one database, with one count in the RateLimit headers', async () => {
    await a.ctx.settings.set('tokens.rate_per_minute', 4);
    await freshMinute();
    const first = await call(a, 'GET', '/api/admin/settings', token);
    expect(first.statusCode).toBe(200);
    expect([first.headers['ratelimit-limit'], first.headers['ratelimit-remaining']]).toEqual(['4', '3']);
    // The second process continues the first one's count.
    const second = await call(b, 'GET', '/api/admin/settings', token);
    expect([second.statusCode, second.headers['ratelimit-remaining']]).toEqual([200, '2']);
    expect((await call(a, 'GET', '/api/admin/settings', token)).headers['ratelimit-remaining']).toBe('1');
    expect((await call(b, 'GET', '/api/admin/settings', token)).headers['ratelimit-remaining']).toBe('0');
    // The fifth request of the minute is refused, whichever process it reaches.
    for (const app of [a, b]) {
      const refused = await call(app, 'GET', '/api/admin/settings', token);
      expect([refused.statusCode, refused.json().error.code]).toEqual([429, 'rate_limited']);
      expect(refused.headers['ratelimit-remaining']).toBe('0');
      const reset = Number(refused.headers['ratelimit-reset']);
      expect(reset).toBeGreaterThanOrEqual(1);
      expect(reset).toBeLessThanOrEqual(60);
      expect(refused.headers['retry-after']).toBe(String(reset));
    }
    const row = await b.db.one<{ hits: number }>(`select hits from request_counts where bucket = 'token'`);
    expect(row!.hits).toBe(6);
    await a.ctx.settings.set('tokens.rate_per_minute', 600);
  });

  it('holds the AI assistant limit (mcp.rate_per_minute) across them too', async () => {
    await a.ctx.settings.set('mcp.rate_per_minute', 2);
    await freshMinute();
    const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } };
    expect((await call(a, 'POST', '/mcp', mcpToken, INIT)).statusCode).toBe(200);
    expect((await call(b, 'POST', '/mcp', mcpToken, INIT)).statusCode).toBe(200);
    const refused = await call(a, 'POST', '/mcp', mcpToken, INIT);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.message).toMatch(/2 AI assistant requests a minute/);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await call(b, 'POST', '/mcp', mcpToken, INIT)).statusCode).toBe(429);
    await a.ctx.settings.set('mcp.rate_per_minute', 120);
  });

  it('counts each minute apart and removes minutes that have passed', async () => {
    await countRequest(a.db, 'test', 'k');
    await countRequest(b.db, 'test', 'k');
    expect((await countRequest(a.db, 'test', 'k')).count).toBe(3);
    await a.db.query(`update request_counts set minute = minute - 2 where bucket = 'test'`);
    expect((await countRequest(b.db, 'test', 'k')).count).toBe(1); // a new minute starts at one
    expect(await pruneRequestCounts(a.db)).toBeGreaterThanOrEqual(1);
    expect((await a.db.query(`select 1 from request_counts where bucket = 'test'`)).length).toBe(1);
    // The recurring job does the same.
    expect((await a.db.query(`select 1 from job_schedules where name = 'core.request_counts'`)).length).toBe(1);
  });
});
