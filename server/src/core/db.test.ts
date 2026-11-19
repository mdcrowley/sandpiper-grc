import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Db, envOrFile, makeAutoAnalyze, openDb, redactUrl, sessionSql, slowQueryMs, slowStatementLog, sslOptions } from './db.ts';

const withEnv = async <T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> => {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};

// The same checks against both drivers: the embedded database, and the server driver talking the
// Postgres wire protocol (to a PGlite behind a socket, as GRC_TEST_DATABASE=pg does for the suite).
const drivers: [string, () => Promise<Db>][] = [
  ['embedded', () => withEnv({ GRC_TEST_DATABASE: undefined, GRC_TEST_DATABASE_URL: undefined }, () => openDb('memory'))],
  ['server', () => withEnv({ GRC_TEST_DATABASE: 'pg', GRC_TEST_DATABASE_URL: undefined }, () => openDb('memory'))],
];

describe.each(drivers)('%s driver (E16-05)', (name, open) => {
  let db: Db;
  beforeAll(async () => {
    db = await open();
    await db.exec(`
      create table t (id serial primary key, d date, n numeric, b bigint, j jsonb, tags text[], ns bigint[], ds date[], at timestamptz, iv interval);
    `);
  });
  afterAll(async () => { await db?.close(); });

  it('says which driver it is', () => {
    expect(db.driver).toBe(name);
  });

  it('returns the same JavaScript values', async () => {
    await db.query(
      `insert into t (d, n, b, j, tags, ns, ds, at, iv) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      ['2026-03-01', 12.5, 9007199254740991, JSON.stringify({ a: [1, 2] }), ['x', 'y'], [1, 2], ['2026-01-02', '2026-01-03'], new Date('2026-03-01T12:00:00Z'), '2 days'],
    );
    const row = await db.one('select * from t order by id desc limit 1');
    expect(row).toMatchObject({
      d: '2026-03-01', n: 12.5, b: 9007199254740991, j: { a: [1, 2] }, tags: ['x', 'y'], ns: [1, 2], ds: ['2026-01-02', '2026-01-03'], iv: '2 days',
    });
    expect(row.at).toBeInstanceOf(Date);
    expect((row.at as Date).toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(await db.one(`select count(*) as c, sum(n) as s, avg(n)::numeric(10,2) as a from t`)).toEqual({ c: 1, s: 12.5, a: 12.5 });
  });

  it('sends a JavaScript array or object bound for jsonb as JSON, and for text[] as an array', async () => {
    await db.query('insert into t (j, tags) values ($1, $2)', [['one', { two: 2 }], ['p', 'q']]);
    await db.query('insert into t (j) values ($1)', [{ k: 'v' }]);
    const rows = await db.query(`select j, tags from t where j is not null order by id desc limit 2`);
    expect(rows).toEqual([{ j: { k: 'v' }, tags: null }, { j: ['one', { two: 2 }], tags: ['p', 'q'] }]);
    // Same statement again: the parameter types are remembered.
    await db.query('insert into t (j, tags) values ($1, $2)', [[3], ['r']]);
    expect((await db.one(`select j from t order by id desc limit 1`)).j).toEqual([3]);
  });

  it('runs a script of several statements with exec', async () => {
    await db.exec(`create table s (v int); insert into s values (1); insert into s values (2);`);
    expect(await db.query('select v from s order by v')).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it('commits a transaction, and rolls back everything when it throws', async () => {
    const before = (await db.one('select count(*) as c from t')).c;
    const out = await db.tx(async (tx) => {
      await tx.query('insert into t (d) values ($1)', ['2026-01-01']);
      return (await tx.one('select count(*) as c from t')).c;
    });
    expect(out).toBe(before + 1);
    await expect(db.tx(async (tx) => {
      await tx.query('insert into t (d) values ($1)', ['2026-01-02']);
      await tx.query('insert into t (d) values ($1)', ['2026-01-03']);
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect((await db.one('select count(*) as c from t')).c).toBe(before + 1);
    // A failed statement inside a transaction rolls it back too, and the next one starts clean.
    await expect(db.tx(async (tx) => {
      await tx.query('insert into t (d) values ($1)', ['2026-01-04']);
      await tx.query('insert into no_such_table values (1)');
    })).rejects.toThrow(/no_such_table/);
    expect((await db.one('select count(*) as c from t')).c).toBe(before + 1);
  });

  it('keeps the transaction on one connection while other queries run', async () => {
    const results = await Promise.all([
      db.tx(async (tx) => {
        await tx.exec('create temporary table if not exists tmp_one (v int)');
        await tx.query('insert into tmp_one values ($1)', [7]);
        return (await tx.one('select v from tmp_one')).v;
      }),
      ...Array.from({ length: 5 }, (_, i) => db.one('select $1::int as v', [i]).then((r) => r.v)),
    ]);
    expect(results).toEqual([7, 0, 1, 2, 3, 4]);
  });

  it('uses the configured time zone', async () => {
    expect((await db.one('show timezone')).TimeZone).toBe(process.env.GRC_TIMEZONE || 'America/New_York');
  });
});

describe('server driver settings (E16-05)', () => {
  it('builds the session settings from the environment', async () => {
    await withEnv({ GRC_DATABASE_STATEMENT_TIMEOUT: '5000', GRC_DATABASE_IDLE_TX_TIMEOUT: undefined, GRC_DATABASE_SCHEMA: 'grc"app' }, () => {
      const sql = sessionSql();
      expect(sql).toContain('set statement_timeout = 5000');
      expect(sql).toContain('set idle_in_transaction_session_timeout = 300000');
      expect(sql).toContain('set search_path to "grc""app"');
    });
    await withEnv({ GRC_DATABASE_STATEMENT_TIMEOUT: 'soon' }, () => expect(() => sessionSql()).toThrow(/GRC_DATABASE_STATEMENT_TIMEOUT/));
  });

  it('chooses TLS for the connection from GRC_DATABASE_SSL', async () => {
    await withEnv({ GRC_DATABASE_SSL: undefined, GRC_DATABASE_SSL_CA: undefined }, () => expect(sslOptions()).toBeUndefined());
    await withEnv({ GRC_DATABASE_SSL: 'off' }, () => expect(sslOptions()).toBe(false));
    await withEnv({ GRC_DATABASE_SSL: 'require' }, () => expect(sslOptions()).toEqual({ rejectUnauthorized: false }));
    await withEnv({ GRC_DATABASE_SSL: 'verify' }, () => expect(sslOptions()).toEqual({ rejectUnauthorized: true }));
    await withEnv({ GRC_DATABASE_SSL: 'maybe' }, () => expect(() => sslOptions()).toThrow(/GRC_DATABASE_SSL/));
  });

  it('hides the password in messages', () => {
    expect(redactUrl('postgres://grc:s3cret@db.example.test:5432/grc')).toBe('postgres://grc:***@db.example.test:5432/grc');
    expect(redactUrl('postgres://db.example.test/grc')).toBe('postgres://db.example.test/grc');
  });

  it('reads a setting from a file named by NAME_FILE (container secrets)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grc-db-'));
    try {
      writeFileSync(join(dir, 'url'), 'postgres://from-file/grc\n');
      await withEnv({ GRC_DATABASE_URL: undefined, GRC_DATABASE_URL_FILE: join(dir, 'url') }, () =>
        expect(envOrFile('GRC_DATABASE_URL')).toBe('postgres://from-file/grc'));
      await withEnv({ GRC_DATABASE_URL: 'postgres://direct/grc', GRC_DATABASE_URL_FILE: join(dir, 'url') }, () =>
        expect(envOrFile('GRC_DATABASE_URL')).toBe('postgres://direct/grc'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens the server named by GRC_DATABASE_URL for a data folder, with the password from its own setting', async () => {
    const lite = new PGlite();
    const server = new PGLiteSocketServer({ db: lite, host: '127.0.0.1', port: 0, maxConnections: 10 });
    await server.start();
    const dir = mkdtempSync(join(tmpdir(), 'grc-db-'));
    try {
      const db = await withEnv(
        { GRC_DATABASE_URL: `postgres://postgres@${server.getServerConn()}/postgres`, GRC_DATABASE_PASSWORD: 'unused-by-this-server', GRC_DATABASE_SSL: 'off' },
        () => openDb(dir),
      );
      expect(db.driver).toBe('server');
      expect(db.dataDir).toBe(dir);
      expect(await db.one('select 1 as one')).toEqual({ one: 1 });
      await db.close();
      await db.close(); // closing twice is harmless
    } finally {
      await server.stop();
      await lite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the server it could not reach, without the password', async () => {
    await withEnv({ GRC_DATABASE_URL: 'postgres://grc:hunter2@127.0.0.1:1/grc', GRC_DATABASE_CONNECT_TIMEOUT: '2000', GRC_DATABASE_SSL: 'off' }, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'grc-db-'));
      const err = (await openDb(dir).then(() => null, (e) => e)) as Error;
      rmSync(dir, { recursive: true, force: true });
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/Could not connect to the database at postgres:\/\/grc:\*\*\*@127\.0\.0\.1:1\/grc/);
      expect(err.message).not.toContain('hunter2');
    });
  });
});

describe('performance aids (E16-36)', () => {
  it('logs a slow statement with its time and text, never its parameters', async () => {
    const lines: string[] = [];
    const timed = slowStatementLog(5, (l) => lines.push(l));
    await timed('select 1', async () => 1);
    await timed('select   pg_sleep(0.01)\n  from x', () => new Promise((r) => setTimeout(r, 15)));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[db\] slow statement, \d+ ms: select pg_sleep\(0\.01\) from x$/);
    // Off: the work is only run.
    expect(await slowStatementLog(0, () => { throw new Error('logged'); })('select 1', async () => 2)).toBe(2);
    expect(await withEnv({ GRC_SLOW_QUERY_MS: '250' }, () => slowQueryMs())).toBe(250);
    expect(await withEnv({ GRC_SLOW_QUERY_MS: 'x' }, () => slowQueryMs())).toBe(0);
  });

  it('analyzes the embedded database after it opens and after many writes, at most so often', async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const auto = makeAutoAnalyze(async () => { runs++; }, { every: 3, minGapMs: 60_000, firstAfterMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(runs).toBe(1);
      auto.wrote(); auto.wrote();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(runs).toBe(1); // two writes: not yet
      auto.wrote();
      await vi.advanceTimersByTimeAsync(1000);
      expect(runs).toBe(2); // the gap since the first run has passed
      for (let i = 0; i < 3; i++) auto.wrote();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(runs).toBe(2); // within the minimum gap
      await vi.advanceTimersByTimeAsync(30_000);
      expect(runs).toBe(3);
      await auto.stop();
      for (let i = 0; i < 9; i++) auto.wrote();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(runs).toBe(3); // stopped
      const off = makeAutoAnalyze(async () => { runs++; }, { every: 0 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(runs).toBe(3);
      await off.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the embedded database with pg_trgm, which migration 009 uses for substring search', async () => {
    const db = await withEnv({ GRC_TEST_DATABASE: undefined, GRC_TEST_DATABASE_URL: undefined }, () => openDb('memory'));
    try {
      await db.exec('create extension if not exists pg_trgm');
      expect((await db.one<{ s: number }>(`select similarity('validator', 'validators') as s`))!.s).toBeGreaterThan(0.5);
    } finally {
      await db.close();
    }
  });
});
