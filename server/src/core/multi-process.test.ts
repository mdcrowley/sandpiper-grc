import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.ts';
import { ADMIN } from '../test/helpers.ts';
import { createSession, SESSION_COOKIE } from './auth.ts';
import { migrate } from './migrate.ts';
import type { ModuleDef, Row } from './module.ts';

// E40-01 and E40-02: two server processes on one PostgreSQL database. Two applications are built on
// one database reached through the PostgreSQL wire protocol: a PGlite behind a socket, or, when
// GRC_TEST_DATABASE_URL names a real server (the PostgreSQL 17 leg of continuous integration), a
// fresh database there. The socket serves one embedded session, so two transactions at the same
// moment are not isolated there: the tests that need real concurrency run on a real server only.

type App = Awaited<ReturnType<typeof buildApp>>;
const REAL = Boolean(process.env.GRC_TEST_DATABASE_URL?.trim());

async function sharedDatabase(): Promise<{ url: string; stop: () => Promise<void> }> {
  const adminUrl = process.env.GRC_TEST_DATABASE_URL?.trim();
  if (adminUrl) {
    const name = `grc_test_multi_${randomBytes(4).toString('hex')}`;
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

/** An invented record type: lost-property parcels, with custom fields. */
const parcels: ModuleDef = {
  key: 'multiparcels',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists multi_parcels (
      id uuid primary key default gen_random_uuid(), name text not null, shelf text, custom jsonb not null default '{}',
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'multi_parcel', table: 'multi_parcels', module: 'admin', label: 'Parcel', plural: 'Parcels',
      path: '/api/multi-parcels', route: '/multi-parcels', titleField: 'name',
      fields: { name: { label: 'Name', type: 'text', required: true }, shelf: { label: 'Shelf', type: 'text' } },
    });
  },
};

const ENV = ['GRC_DATABASE_URL', 'GRC_DATABASE_URL_FILE', 'GRC_DATABASE_PASSWORD', 'GRC_DATABASE_SSL', 'GRC_SECRET_KEY', 'GRC_SECRET_KEY_FILE', 'GRC_MODULES'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const dirs: string[] = [];
const dir = (prefix = 'grc-multi-') => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
let shared: Awaited<ReturnType<typeof sharedDatabase>>;
let a: App;
let b: App;
let headers: Record<string, string>;

const call = (app: App, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, extra: Record<string, string> = {}) =>
  app.app.inject({ method, url, headers: { ...headers, ...extra }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  shared = await sharedDatabase();
  for (const k of ENV) delete process.env[k];
  process.env.GRC_DATABASE_URL = shared.url;
  process.env.GRC_DATABASE_SSL = 'off';
  process.env.GRC_SECRET_KEY = randomBytes(32).toString('hex'); // the same key in both, as on a real cluster
  process.env.GRC_MODULES = 'admin';
  // One after the other: the second finds the schema the first migrated.
  a = await buildApp({ dataDir: dir(), serveWeb: false, extraModules: [parcels] });
  b = await buildApp({ dataDir: dir(), serveWeb: false, extraModules: [parcels] });
  await a.app.ready();
  await b.app.ready();
  const setup = await a.app.inject({ method: 'POST', url: '/api/setup', headers: { 'x-grc-csrf': '1' }, payload: ADMIN });
  expect(setup.statusCode, setup.body).toBe(200);
  const user = (await a.db.one<{ id: string }>(`select id from users where username = 'admin'`))!;
  // A session is a row in the database: the same cookie works in both processes.
  headers = { cookie: `${SESSION_COOKIE}=${await createSession(a.db, user.id)}`, 'x-grc-csrf': '1' };
  const cf = await call(a, 'POST', '/api/admin/custom-fields', { record_type: 'multi_parcel', label: 'Claim number', type: 'text' });
  expect(cf.statusCode, cf.body).toBe(201);
  expect((await call(a, 'POST', '/api/admin/custom-fields', { record_type: 'multi_parcel', label: 'Bin', type: 'text' })).statusCode).toBe(201);
}, 240_000);

afterAll(async () => {
  await b?.close();
  await a?.close();
  await shared?.stop();
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const make = async (name: string): Promise<Row> => {
  const res = await call(a, 'POST', '/api/multi-parcels', { name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
};

describe('If-Match across two server processes (E40-01)', () => {
  it('one process refuses a stale If-Match after the other changed the record', async () => {
    const p = await make('Umbrella left on route 12');
    const tag = (await call(a, 'GET', `/api/multi-parcels/${p.id}`)).headers.etag as string;
    expect((await call(b, 'PATCH', `/api/multi-parcels/${p.id}`, { shelf: 'B2' }, { 'if-match': tag })).statusCode).toBe(200);
    const stale = await call(a, 'PATCH', `/api/multi-parcels/${p.id}`, { shelf: 'A1' }, { 'if-match': tag });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('version_conflict');
    expect((await call(a, 'DELETE', `/api/multi-parcels/${p.id}`, undefined, { 'if-match': tag })).statusCode).toBe(409);
    expect((await b.db.one<Row>('select shelf, deleted_at from multi_parcels where id = $1', [p.id]))).toMatchObject({ shelf: 'B2', deleted_at: null });
  });

  it('checks the version in the save itself: a change made after the early check, by the other process, is not overwritten', async () => {
    const p = await make('Gloves');
    const tag = (await call(a, 'GET', `/api/multi-parcels/${p.id}`)).headers.etag as string;
    // The early check in process A reads the record; process B saves it just afterwards.
    const realFind = a.core.resources.registry.find;
    const spy = vi.spyOn(a.core.resources.registry, 'find').mockImplementation(async (type, id, user) => {
      const row = await realFind(type, id, user);
      if (type === 'multi_parcel' && id === p.id) {
        expect((await call(b, 'PATCH', `/api/multi-parcels/${p.id}`, { shelf: 'From B' })).statusCode).toBe(200);
      }
      return row;
    });
    try {
      const res = await call(a, 'PATCH', `/api/multi-parcels/${p.id}`, { shelf: 'From A' }, { 'if-match': tag });
      expect(res.statusCode, res.body).toBe(409);
    } finally {
      spy.mockRestore();
    }
    expect((await a.db.one<Row>('select shelf from multi_parcels where id = $1', [p.id]))!.shelf).toBe('From B');
    // Neither the refused save nor its audit event was kept.
    const audits = await a.db.query<Row>(`select summary from audit_events where record_type = 'multi_parcel' and record_id = $1 and action = 'multi_parcel.update'`, [p.id]);
    expect(audits).toHaveLength(1);
  });

  it('learns within seconds of a custom field the other process added, and keeps custom values changed in both', async () => {
    // The custom fields were added through process A; B read the definitions before that.
    const known = async () => Object.keys(await b.core.custom.defs('multi_parcel')).includes('cf_bin');
    const until = Date.now() + 8000;
    while (!(await known()) && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    expect(await known()).toBe(true);
    const p = await make('Keys');
    expect((await call(a, 'PATCH', `/api/multi-parcels/${p.id}`, { cf_claim_number: 'LP-1' })).statusCode).toBe(200);
    expect((await call(b, 'PATCH', `/api/multi-parcels/${p.id}`, { cf_bin: 'B-7' })).statusCode).toBe(200);
    expect((await call(a, 'PATCH', `/api/multi-parcels/${p.id}`, { cf_claim_number: null })).statusCode).toBe(200);
    expect((await a.db.one<Row>('select custom from multi_parcels where id = $1', [p.id]))!.custom).toEqual({ bin: 'B-7' });
  });

  it.skipIf(!REAL)('lets exactly one of two saves with the same If-Match through when both run at once', async () => {
    const p = await make('Scarf');
    const tag = (await call(a, 'GET', `/api/multi-parcels/${p.id}`)).headers.etag as string;
    for (let round = 0; round < 5; round++) {
      const now = (await call(a, 'GET', `/api/multi-parcels/${p.id}`)).headers.etag as string;
      const results = await Promise.all([
        call(a, 'PATCH', `/api/multi-parcels/${p.id}`, { shelf: `A${round}` }, { 'if-match': now }),
        call(b, 'PATCH', `/api/multi-parcels/${p.id}`, { shelf: `B${round}` }, { 'if-match': now }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    }
    expect(tag).toBeTruthy();
  });

  it.skipIf(!REAL)('keeps every custom value when the two processes change different ones at the same moment', async () => {
    const p = await make('Lunch box');
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        call(a, 'PATCH', `/api/multi-parcels/${p.id}`, { cf_claim_number: `LP-${round}` }),
        call(b, 'PATCH', `/api/multi-parcels/${p.id}`, { cf_bin: `B-${round}` }),
      ]);
      expect((await a.db.one<Row>('select custom from multi_parcels where id = $1', [p.id]))!.custom).toEqual({ claim_number: `LP-${round}`, bin: `B-${round}` });
    }
  });
});

describe('webhook deliveries across two server processes (E40-01)', () => {
  let receiver: Server;
  const received: string[] = [];
  beforeAll(async () => {
    receiver = createServer((req, res) => {
      received.push(String(req.headers['x-grc-delivery']));
      req.resume();
      // A slow receiver, so both processes are sending at the same time.
      setTimeout(() => { res.writeHead(200); res.end('ok'); }, 20);
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
    const port = (receiver.address() as AddressInfo).port;
    await a.ctx.settings.set('integrations.outbound_enabled', true);
    await a.ctx.settings.set('integrations.allowed_hosts', [`127.0.0.1:${port}`]);
    const hook = await call(a, 'POST', '/api/admin/webhooks', { name: 'Invented dispatch board', url: `http://127.0.0.1:${port}/hook`, events: ['multi_parcel.create'] });
    expect(hook.statusCode, hook.body).toBe(201);
  });
  afterAll(async () => { await new Promise((r) => receiver?.close(r)); });

  it('sends each delivery once when both processes send at the same moment', async () => {
    for (let i = 0; i < 12; i++) await make(`Bag ${i}`);
    const queued = await a.db.query<{ id: string }>(`select id from webhook_deliveries where status = 'pending'`);
    expect(queued).toHaveLength(12);
    const [fromA, fromB] = await Promise.all([a.core.webhooks.processDue(), b.core.webhooks.processDue()]);
    expect(fromA + fromB).toBe(12);
    expect([...received].sort()).toEqual(queued.map((q) => q.id).sort());
    expect(new Set(received).size).toBe(received.length);
    const left = await a.db.query<Row>(`select status, attempts from webhook_deliveries`);
    expect(left.every((d) => d.status === 'delivered' && d.attempts === 1)).toBe(true);
  });
});

describe('migrations from two server processes (E40-02)', () => {
  const folder = (files: Record<string, string>) => {
    const d = dir('grc-multi-mig-');
    mkdirSync(d, { recursive: true });
    for (const [f, sql] of Object.entries(files)) writeFileSync(join(d, f), sql);
    return d;
  };

  it('the second process finds nothing to do once the first has migrated', async () => {
    const d = folder({ '001_a.sql': 'create table multi_mig_a (id int);', '002_b.sql': 'create table multi_mig_b (id int);' });
    expect(await migrate(a.db, [{ scope: 'multi1', dir: d }])).toEqual(['multi1/001_a.sql', 'multi1/002_b.sql']);
    expect(await migrate(b.db, [{ scope: 'multi1', dir: d }])).toEqual([]);
  });

  it.skipIf(!REAL)('applies each migration once when both processes start at the same moment: the second waits, then finds it done', async () => {
    const d = folder({
      '001_slow.sql': 'create table multi_mig_slow (id int); select pg_sleep(1);',
      '002_next.sql': 'create table multi_mig_next (id int);',
    });
    const [fromA, fromB] = await Promise.all([migrate(a.db, [{ scope: 'multi2', dir: d }]), migrate(b.db, [{ scope: 'multi2', dir: d }])]);
    expect([...fromA, ...fromB].sort()).toEqual(['multi2/001_slow.sql', 'multi2/002_next.sql']);
    expect((await a.db.query(`select name from schema_migrations where name like 'multi2/%'`))).toHaveLength(2);
  });

  it.skipIf(!REAL)('runs a migration with no statement timeout, and leaves the timeout of other work as it was', async () => {
    await a.close();
    process.env.GRC_DATABASE_STATEMENT_TIMEOUT = '300';
    try {
      a = await buildApp({ dataDir: dir(), serveWeb: false, extraModules: [parcels] });
      await expect(a.db.query('select pg_sleep(1)')).rejects.toThrow(/statement timeout/);
      const d = folder({ '001_long.sql': 'select pg_sleep(1); create table multi_mig_long (id int);' });
      expect(await migrate(a.db, [{ scope: 'multi3', dir: d }])).toEqual(['multi3/001_long.sql']);
      expect((await a.db.one<{ statement_timeout: string }>('show statement_timeout'))!.statement_timeout).toBe('300ms');
    } finally {
      delete process.env.GRC_DATABASE_STATEMENT_TIMEOUT;
    }
  });
});
