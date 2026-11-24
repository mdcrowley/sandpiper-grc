import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from './module.ts';
import { testApp } from '../test/helpers.ts';
import { DatabaseBusyError, isPoolTimeout, openServerDb, type Db } from './db.ts';

// E40-12: running out of database connections answers 503 with Retry-After, not a 500.
describe('a pool with every connection busy', () => {
  let server: { stop(): Promise<void>; getServerConn(): string };
  let lite: PGlite;
  let db: Db;
  const saved = { max: process.env.GRC_DATABASE_POOL_MAX, wait: process.env.GRC_DATABASE_CONNECT_TIMEOUT };

  beforeAll(async () => {
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    lite = new PGlite();
    await lite.waitReady;
    server = new PGLiteSocketServer({ db: lite, host: '127.0.0.1', port: 0, maxConnections: 10 }) as never;
    await (server as unknown as { start(): Promise<void> }).start();
    process.env.GRC_DATABASE_POOL_MAX = '1';
    process.env.GRC_DATABASE_CONNECT_TIMEOUT = '300';
    db = await openServerDb({ connectionString: `postgres://postgres@${server.getServerConn()}/postgres`, dataDir: 'memory', ssl: false });
  });
  afterAll(async () => {
    for (const [k, v] of [['GRC_DATABASE_POOL_MAX', saved.max], ['GRC_DATABASE_CONNECT_TIMEOUT', saved.wait]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await db?.close();
    await server?.stop();
    await lite?.close();
  });

  it('throws DatabaseBusyError after the wait, and counts it', async () => {
    let release!: () => void;
    const held = db.tx(async (tx) => { await tx.query('select 1'); await new Promise<void>((r) => { release = r; }); });
    await new Promise((r) => setTimeout(r, 50));
    const started = Date.now();
    const err = await db.query('select 1').catch((e) => e);
    expect(err).toBeInstanceOf(DatabaseBusyError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(db.poolStats!()).toMatchObject({ max: 1, exhausted: 1 });
    release();
    await held;
    expect(await db.one<{ ok: number }>('select 1 as ok')).toEqual({ ok: 1 });
  });

  it('recognizes only the pool\'s own time-out', () => {
    expect(isPoolTimeout(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isPoolTimeout(new Error('Connection terminated due to connection timeout'))).toBe(false);
  });
});

describe('the answer when the database is busy', () => {
  const busy: ModuleDef = {
    key: 'testbusy',
    async register(ctx) {
      ctx.app.get('/api/test-busy', { config: { public: true } }, async () => { throw new DatabaseBusyError(); });
      ctx.describeRoute({ method: 'GET', path: '/api/test-busy', summary: 'Test only', public: true });
    },
  };
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp({ extraModules: [busy] }); });
  afterAll(async () => { await t.close(); });

  it('is 503 with Retry-After and a plain message', async () => {
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (...a: unknown[]) => { logged.push(a.join(' ')); };
    try {
      const res = await t.app.inject({ method: 'GET', url: '/api/test-busy' });
      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('5');
      expect(res.json()).toEqual({ error: { code: 'busy', message: 'The server is busy. Try again in a few seconds.' } });
      expect(logged.join('\n')).toMatch(/Answered 503/);
    } finally {
      console.warn = warn;
    }
  });
});
