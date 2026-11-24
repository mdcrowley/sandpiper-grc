import { mkdirSync, readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import pg from 'pg';
import { TIME_ZONE } from './timezone.ts';

/**
 * Database access. Two drivers sit behind one interface, and nothing else imports either:
 *
 * - **embedded** (default): PGlite, an embedded Postgres in the data folder (`<data>/pg`), or in
 *   memory for tests.
 * - **server**: a PostgreSQL server reached with `pg`, chosen by `GRC_DATABASE_URL` (or
 *   `GRC_DATABASE_URL_FILE`). See `docs/installation.md` for the settings.
 *
 * Both return the same JavaScript values: dates as 'YYYY-MM-DD' strings, numerics and bigints as
 * numbers, json/jsonb parsed, timestamps as Date objects, intervals as text.
 *
 * Tests: `openDb('memory')` never touches a configured server. With `GRC_TEST_DATABASE=pg` each
 * in-memory database is a fresh PGlite exposed over the Postgres wire protocol on a random port
 * and reached through the server driver, so the whole suite exercises that driver. With
 * `GRC_TEST_DATABASE_URL` each one is a fresh, uniquely named database on that server, dropped
 * on close.
 */
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Inside the callback use ONLY the `tx` argument: the outer handle waits for the transaction. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /**
   * Runs `fn` inside a transaction that is always rolled back (E13-22: the import check). While it
   * runs, every query made on this handle from `fn`'s own work (the resource engine, hooks, audit,
   * lookups) goes into that transaction, so nothing waits for it and nothing it writes is kept; a
   * `tx` inside it is a savepoint. Code with effects outside the database checks `inTrial()`.
   */
  trial?<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Runs `fn` as one transaction that commits (E40-03: a record save). As in a trial, every query on
   * this handle from `fn`'s own work goes into it and a `tx` inside it is a savepoint; atomic work
   * inside other atomic work (or a trial) is a savepoint too. Effects outside the database wait for
   * the commit (`afterCommit`); `inTrial()` is true while the transaction is open.
   */
  atomic?<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** The folder the database lives in, or 'memory'. Files that belong beside the database (the secret key) go here. */
  dataDir: string;
  /** Which driver is in use: the embedded database, or a PostgreSQL server. */
  driver?: 'embedded' | 'server';
  /**
   * A number that grows whenever this handle changes a row (and again when a transaction ends), so a
   * cache can tell that nothing was written since it was filled (E16-38). Writes made by another
   * process on the same PostgreSQL server are not seen; such caches also expire by time.
   */
  generation?(): number;
  /** Called once the server has started: background upkeep (the embedded database's analyze) may begin. */
  started?(): void;
  /**
   * PostgreSQL server only: the connection pool of this process (E40-04 metrics, E40-12). `exhausted`
   * counts requests that waited GRC_DATABASE_CONNECT_TIMEOUT for a connection and got none.
   */
  poolStats?(): { total: number; idle: number; waiting: number; max: number; exhausted: number };
}

/**
 * No database connection came free in time (E40-12): every connection of the pool
 * (GRC_DATABASE_POOL_MAX) stayed busy for GRC_DATABASE_CONNECT_TIMEOUT. The request is answered 503
 * with Retry-After (app.ts), so browsers, the mobile app and integrations try again, not a 500.
 */
export class DatabaseBusyError extends Error {
  readonly databaseBusy = true;
  readonly retryAfterSeconds = 5;
  constructor(message = 'Every database connection is busy.') {
    super(message);
    this.name = 'DatabaseBusyError';
  }
}

/** pg-pool's words for "waited for a free connection and none came" (not "the server did not answer"). */
export const isPoolTimeout = (err: unknown) => /timeout exceeded when trying to connect/i.test(String((err as Error)?.message ?? ''));

// ---------------------------------------------------------------------------------------------
// Trials (E13-22) and atomic work (E40-03): work whose queries on the shared handle all go into one
// transaction, rolled back (a trial) or committed (atomic)

interface TrialScope {
  owner: Db;
  tx: Queryable;
  open: boolean;
  kind: 'trial' | 'atomic';
  /** Atomic work: what waits for the commit (afterCommit). */
  after: (() => Promise<void> | void)[];
}
const trials = new AsyncLocalStorage<TrialScope>();
class TrialRollback extends Error {}

/**
 * True while the current work runs inside `Db.trial` (and in anything it scheduled meanwhile), and
 * while atomic work (`Db.atomic`, a record save) has its transaction open. Work with effects outside
 * the database (sending, delivering, running queued jobs) is skipped then; inside atomic work it is
 * started after the commit instead (`afterCommit`).
 */
export function inTrial(): boolean {
  const s = trials.getStore();
  return s !== undefined && (s.kind === 'trial' || s.open);
}

/**
 * Runs `fn` once the atomic work in progress commits (E40-03): at once when there is none, never when
 * it is rolled back or inside a trial. Work started this way runs outside the transaction, so it may
 * talk to the outside world (webhooks, mail, push, the job queue) and its own failure (logged) never
 * undoes the saved change.
 */
export async function afterCommit(fn: () => Promise<void> | void): Promise<void> {
  const s = trials.getStore();
  if (s?.kind === 'trial') return;
  if (s && s.open) { s.after.push(fn); return; }
  await fn();
}

/**
 * Adds `trial` and `atomic` to a handle. Queries on the handle from work running inside either go to
 * its transaction: the embedded database serves one transaction at a time, so a query on the outer
 * handle there would wait for ever, and on a server it would not see the transaction's own rows.
 */
export function withTrials(db: Db): Db {
  const base = { query: db.query, one: db.one, exec: db.exec, tx: db.tx };
  let savepoints = 0;
  const current = (): Queryable | null => {
    const s = trials.getStore();
    if (!s || s.owner !== routed) return null;
    if (!s.open) {
      // Work a trial started but did not wait for (a promise left running) is discarded with it;
      // work atomic work left running continues on its own after the commit.
      if (s.kind === 'trial') throw new Error('The check has finished; work it started is discarded.');
      return null;
    }
    return s.tx;
  };
  const routed: Db = {
    ...db,
    query: (sql, params) => (current() ?? base).query(sql, params),
    one: (sql, params) => (current() ?? base).one(sql, params),
    exec: (sql) => (current() ?? base).exec(sql),
    async tx(fn) {
      const t = current();
      if (!t) return base.tx(fn);
      const name = `grc_trial_${++savepoints}`;
      await t.exec(`savepoint ${name}`);
      try {
        const result = await fn(t);
        await t.exec(`release savepoint ${name}`);
        return result;
      } catch (err) {
        await t.exec(`rollback to savepoint ${name}`);
        throw err;
      }
    },
    async atomic<T>(fn: () => Promise<T>): Promise<T> {
      const s = trials.getStore();
      if (s && s.owner === routed && s.open) {
        // Inside a trial or other atomic work: a savepoint of it. What this part left for the commit
        // is dropped when the part is rolled back.
        const mark = s.after.length;
        try {
          return await routed.tx(() => fn());
        } catch (err) {
          s.after.length = mark;
          throw err;
        }
      }
      const scope: TrialScope = { owner: routed, tx: null as unknown as Queryable, open: true, kind: 'atomic', after: [] };
      let result: T | undefined;
      await base.tx(async (tx) => {
        scope.tx = tx;
        try {
          result = await trials.run(scope, fn);
        } finally {
          scope.open = false;
        }
      });
      // Committed: what waited for it runs now, outside the transaction, in order.
      for (const later of scope.after) {
        try { await later(); } catch (err) { console.error('[db] work after a commit failed:', err); }
      }
      return result as T;
    },
    async trial<T>(fn: () => Promise<T>): Promise<T> {
      if (trials.getStore()?.open) throw new Error('A trial cannot start inside another one, or inside atomic work.');
      let result: T | undefined;
      try {
        await base.tx(async (tx) => {
          const scope: TrialScope = { owner: routed, tx, open: true, kind: 'trial', after: [] };
          try {
            result = await trials.run(scope, fn);
          } finally {
            scope.open = false;
          }
          throw new TrialRollback();
        });
      } catch (err) {
        if (!(err instanceof TrialRollback)) throw err;
      }
      return result as T;
    },
  };
  return routed;
}

/** Counts this handle's writes (see Db.generation). */
export function makeWriteCounter() {
  let n = 0;
  return {
    get: () => n,
    bump: () => { n++; },
    /**
     * After a statement: counts it when it changed at least one row, or may have (a write inside a
     * `with`, whose count is that of its final select).
     */
    after(sql: string, changed: number | null | undefined) {
      if (WRITE_RE.test(sql) ? changed !== 0 : isWrite(sql)) n++;
    },
  };
}
export type WriteCounter = ReturnType<typeof makeWriteCounter>;

/** Whether a statement can change rows: insert, update or delete, alone or inside a `with`. */
export function isWrite(sql: string): boolean {
  return WRITE_RE.test(sql) || (/^\s*with\b/i.test(sql) && /\b(insert\s+into|update\s+\w|delete\s+from)\b/i.test(sql));
}

// ---------------------------------------------------------------------------------------------
// Settings

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());

/** `NAME`, or the trimmed contents of the file named by `NAME_FILE` (for container secrets). */
export function envOrFile(name: string): string | undefined {
  const direct = process.env[name];
  if (direct && direct.trim()) return direct.trim();
  const file = process.env[`${name}_FILE`];
  if (file && file.trim()) return readFileSync(file.trim(), 'utf8').trim();
  return undefined;
}

/** The configured PostgreSQL server, or undefined for the embedded database. */
export function databaseUrl(): string | undefined {
  return envOrFile('GRC_DATABASE_URL');
}

/** The connection string with any password replaced, for messages and logs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'postgres://(unparseable connection string)';
  }
}

function intSetting(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min} (got "${raw}").`);
  return n;
}

/** TLS options for the server connection, from GRC_DATABASE_SSL / GRC_DATABASE_SSL_CA. Undefined leaves it to the URL's `sslmode`. */
export function sslOptions(): pg.PoolConfig['ssl'] {
  const mode = String(process.env.GRC_DATABASE_SSL ?? '').trim().toLowerCase();
  const caFile = process.env.GRC_DATABASE_SSL_CA?.trim();
  const ca = caFile ? readFileSync(caFile, 'utf8') : undefined;
  if (!mode) return ca ? { ca, rejectUnauthorized: true } : undefined;
  if (['off', 'disable', 'false', '0', 'no'].includes(mode)) return false;
  if (mode === 'require' || mode === 'no-verify') return { rejectUnauthorized: false, ...(ca ? { ca } : {}) };
  if (mode === 'verify' || mode === 'verify-full' || truthy(mode)) return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  throw new Error(`GRC_DATABASE_SSL must be off, require or verify (got "${mode}").`);
}

/** A double-quoted SQL identifier. */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** A single-quoted SQL literal. */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Statements run on every new server connection, so each session behaves like the embedded one. */
export function sessionSql(): string {
  const parts = [`set timezone to ${literal(TIME_ZONE)}`];
  parts.push(`set statement_timeout = ${intSetting('GRC_DATABASE_STATEMENT_TIMEOUT', 120000)}`);
  parts.push(`set idle_in_transaction_session_timeout = ${intSetting('GRC_DATABASE_IDLE_TX_TIMEOUT', 300000)}`);
  const schema = process.env.GRC_DATABASE_SCHEMA?.trim();
  if (schema) parts.push(`set search_path to ${ident(schema)}`);
  return parts.join('; ');
}

// ---------------------------------------------------------------------------------------------
// Value conversion, identical in both drivers

// Postgres type OIDs: keep dates as 'YYYY-MM-DD' strings, numerics and bigints as numbers.
const parsers = {
  1082: (v: string) => v,
  1700: (v: string) => Number(v),
  20: (v: string) => Number(v),
};

const textArray = pg.types.getTypeParser(1009 as any, 'text') as (v: string) => (string | null)[];
const numberArray = (v: string) => textArray(v).map((x) => (x === null ? null : Number(x)));
/** Overrides for `pg` so its values match what PGlite (with `parsers` above) returns. */
const serverParsers: Record<number, (v: string) => unknown> = {
  ...parsers,
  1016: numberArray, // int8[]
  1231: numberArray, // numeric[]
  1182: textArray, // date[]
  1186: (v) => v, // interval: text, as PGlite
  1187: textArray, // interval[]
};
const serverTypes = {
  getTypeParser: ((oid: number, format?: string) =>
    (format ?? 'text') === 'text' && serverParsers[oid] ? serverParsers[oid] : pg.types.getTypeParser(oid as any, format as any)) as any,
};

/**
 * PGlite learns each parameter's type from the server and so sends a JavaScript array bound
 * for a json/jsonb parameter as JSON. `pg` does not know the type and would send it as a
 * Postgres array literal. For a statement with an array parameter, ask the server for the
 * parameter types once (PREPARE + pg_prepared_statements, standard since PostgreSQL 9) and
 * JSON-encode those arrays. Cached by statement text.
 */
const paramTypeCache = new Map<string, string[]>();
const describePrefix = `grc_describe_${randomBytes(4).toString('hex')}_`;
let describeSeq = 0;

async function paramTypes(client: pg.ClientBase, sql: string): Promise<string[]> {
  const cached = paramTypeCache.get(sql);
  if (cached) return cached;
  const name = `${describePrefix}${++describeSeq}`;
  await client.query(`prepare ${name} as ${sql}`);
  try {
    const res = await client.query(`select parameter_types::text[] as t from pg_prepared_statements where name = $1`, [name]);
    const types: string[] = res.rows[0]?.t ?? [];
    if (paramTypeCache.size > 5000) paramTypeCache.clear();
    paramTypeCache.set(sql, types);
    return types;
  } finally {
    await client.query(`deallocate ${name}`);
  }
}

const isPlainArray = (v: unknown) => Array.isArray(v);

async function prepareParams(client: pg.ClientBase, sql: string, params: unknown[]): Promise<unknown[]> {
  if (!params.some(isPlainArray)) return params;
  const types = await paramTypes(client, sql);
  return params.map((v, i) => (isPlainArray(v) && /^jsonb?$/.test(types[i] ?? '') ? JSON.stringify(v) : v));
}

// ---------------------------------------------------------------------------------------------
// Slow statement log (E16-36)

/**
 * `GRC_SLOW_QUERY_MS`: statements that take this many milliseconds or longer are written to the
 * error log with their time and text (never their parameter values, which can hold personal
 * data). Unset or 0: off.
 */
export function slowQueryMs(): number {
  const n = Number(process.env.GRC_SLOW_QUERY_MS ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A wrapper that runs a statement and logs it when it was slow (see slowQueryMs). */
export function slowStatementLog(threshold = slowQueryMs(), log: (line: string) => void = (l) => console.warn(l)) {
  return async <T>(sql: string, work: () => Promise<T>): Promise<T> => {
    if (!threshold) return work();
    const started = performance.now();
    try {
      return await work();
    } finally {
      const ms = performance.now() - started;
      if (ms >= threshold) log(`[db] slow statement, ${Math.round(ms)} ms: ${sql.replace(/\s+/g, ' ').trim().slice(0, 500)}`);
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Embedded driver

/** Extensions loaded into the embedded database: pg_trgm indexes substring search (migration 009). */
const EXTENSIONS = { pg_trgm };

const WRITE_RE = /^\s*(insert|update|delete)\b/i;

function wrapLite(q: { query: Function; exec: Function }, onWrite: (() => void) | undefined, writes: WriteCounter): Queryable {
  const timed = slowStatementLog();
  const run = async (sql: string, params: unknown[]) => {
    const res: any = await timed(sql, () => q.query(sql, params));
    writes.after(sql, res.affectedRows);
    if (onWrite && WRITE_RE.test(sql)) onWrite();
    return res;
  };
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await run(sql, params)).rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return (await run(sql, params)).rows[0] as T | undefined;
    },
    async exec(sql: string) {
      await timed(sql, () => q.exec(sql));
      writes.bump();
      onWrite?.();
    },
  };
}

/**
 * Planner statistics for the embedded database (E16-36). PGlite runs no autovacuum, so without
 * this its tables are never analyzed and the planner guesses every row count (21 rows for a table
 * of 6,000), choosing poor plans as the data grows. `analyze` reads a bounded sample of each
 * table (under a second at 30,000 records). It runs shortly after the database opens (with
 * `waitForStart`: shortly after `start()`, once the server has finished starting, E16-39: an
 * analyze in the middle of start-up held up its steps), then again after every `GRC_ANALYZE_AFTER_WRITES` write statements (default 2,000; 0 switches it off), at
 * most once every ten minutes. A PostgreSQL server does this itself (autovacuum).
 */
export function makeAutoAnalyze(run: () => Promise<void>, opts: { every?: number; minGapMs?: number; firstAfterMs?: number; waitForStart?: boolean } = {}) {
  const every = opts.every ?? intSetting('GRC_ANALYZE_AFTER_WRITES', 2000);
  const minGapMs = opts.minGapMs ?? 10 * 60_000;
  let writes = 0;
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let closed = false;
  let started = !opts.waitForStart;
  const fire = () => {
    timer = null;
    if (closed || running) return;
    writes = 0;
    last = Date.now();
    running = run().catch((err) => console.warn(`[db] analyze failed: ${(err as Error).message}`)).finally(() => { running = null; });
  };
  const schedule = (ms: number) => {
    if (closed || timer || !every || !started) return;
    timer = setTimeout(fire, ms);
    timer.unref?.();
  };
  schedule(opts.firstAfterMs ?? 5000);
  return {
    /** With `waitForStart`: the first run is due from now (writes counted until now still count). */
    start() {
      if (started) return;
      started = true;
      schedule(opts.firstAfterMs ?? 5000);
    },
    wrote() {
      if (!every || ++writes < every) return;
      schedule(Math.max(1000, last + minGapMs - Date.now()));
    },
    /** Stops the schedule and waits for a run in progress. */
    async stop() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await running;
    },
  };
}

async function openEmbedded(dataDir: string): Promise<Db> {
  let lite: PGlite;
  if (dataDir === 'memory') {
    lite = new PGlite({ parsers, extensions: EXTENSIONS });
  } else {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 }); // the owner only (SP-07)
    lite = new PGlite(`${dataDir}/pg`, { parsers, extensions: EXTENSIONS });
  }
  await lite.waitReady;
  await lite.exec(`set timezone to ${literal(TIME_ZONE)}`);
  // Throw-away test databases are left alone: their plans do not matter and timers would outlive them.
  const analyze = dataDir === 'memory' ? null : makeAutoAnalyze(async () => { await lite.exec('analyze'); }, { waitForStart: true });
  const wrote = analyze ? () => analyze.wrote() : undefined;
  const writes = makeWriteCounter();
  return withTrials({
    ...wrapLite(lite, wrote, writes),
    tx: async (fn) => {
      try {
        return await lite.transaction((tx) => fn(wrapLite(tx, wrote, writes))) as any;
      } finally {
        writes.bump(); // committed or rolled back: whatever was read meanwhile is stale either way
      }
    },
    generation: writes.get,
    started: () => analyze?.start(),
    close: async () => {
      await analyze?.stop();
      await lite.close();
    },
    dataDir,
    driver: 'embedded',
  });
}

// ---------------------------------------------------------------------------------------------
// Server driver

type WithClient = <T>(work: (client: pg.ClientBase) => Promise<T>) => Promise<T>;

function wrapPg(withClient: WithClient, writes: WriteCounter): Queryable {
  const timed = slowStatementLog();
  const run = (sql: string, params: unknown[]) =>
    withClient(async (client) => {
      const values = params.length ? await prepareParams(client, sql, params) : undefined;
      const res = await timed(sql, () => client.query(values ? { text: sql, values } : sql));
      writes.after(sql, res.rowCount);
      return res;
    });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await run(sql, params)).rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return (await run(sql, params)).rows[0] as T | undefined;
    },
    async exec(sql: string) {
      // No parameters: the simple protocol, so a script of several statements runs as one.
      await withClient((client) => timed(sql, () => client.query(sql)));
      writes.bump();
    },
  };
}

export interface ServerDbOptions {
  connectionString: string;
  dataDir: string;
  /** Called after the pool has closed (used by the test harness to stop its server). */
  onClose?: () => Promise<void>;
  /** Overrides the GRC_DATABASE_SSL settings. */
  ssl?: pg.PoolConfig['ssl'];
}

/** Opens a pool on a PostgreSQL server. Exported for the test harness and the operations commands. */
export async function openServerDb(opts: ServerDbOptions): Promise<Db> {
  const init = sessionSql();
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    ssl: opts.ssl !== undefined ? opts.ssl : sslOptions(),
    max: intSetting('GRC_DATABASE_POOL_MAX', 10, 1),
    idleTimeoutMillis: intSetting('GRC_DATABASE_IDLE_TIMEOUT', 30000),
    connectionTimeoutMillis: intSetting('GRC_DATABASE_CONNECT_TIMEOUT', 10000),
    application_name: 'sandpiper-grc',
    types: serverTypes,
  });
  // An idle connection dropped by the server must not crash the process; the pool replaces it.
  pool.on('error', (err) => console.error(`[db] connection error: ${err.message}`));

  // Every connection gets the session settings (time zone, timeouts, schema) before first use.
  const configured = new WeakSet<pg.ClientBase>();
  let exhausted = 0;
  const acquire = async (): Promise<pg.PoolClient> => {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch (err) {
      // Every connection busy for the whole wait: a 503 with Retry-After, not a 500 (E40-12).
      if (isPoolTimeout(err) && pool.totalCount >= (pool.options.max ?? 10)) {
        exhausted += 1;
        throw new DatabaseBusyError(`Every database connection (${pool.options.max}) stayed busy for ${pool.options.connectionTimeoutMillis} ms.`);
      }
      throw err;
    }
    if (!configured.has(client)) {
      try {
        await client.query(init);
      } catch (err) {
        client.release(err as Error);
        throw err;
      }
      configured.add(client);
    }
    return client;
  };
  const fromPool: WithClient = async (work) => {
    const client = await acquire();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  };

  // Fail at start-up, with a readable message, rather than at the first request.
  try {
    (await acquire()).release();
  } catch (err) {
    await pool.end().catch(() => {});
    await opts.onClose?.().catch(() => {});
    throw new Error(`Could not connect to the database at ${redactUrl(opts.connectionString)}: ${(err as Error).message}`);
  }

  let closed = false;
  const writes = makeWriteCounter();
  return withTrials({
    ...wrapPg(fromPool, writes),
    generation: writes.get,
    async tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      // A transaction needs one connection for its whole life.
      const client = await acquire();
      let broken: Error | undefined;
      try {
        await client.query('begin');
        const result = await fn(wrapPg((work) => work(client), writes));
        await client.query('commit');
        return result;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch (rollbackErr) {
          broken = rollbackErr as Error;
        }
        throw err;
      } finally {
        client.release(broken);
        // Other connections read the transaction's rows only from its commit: a figure computed
        // meanwhile must not be kept as current.
        writes.bump();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
      await opts.onClose?.();
    },
    dataDir: opts.dataDir,
    driver: 'server',
    poolStats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options.max ?? 10, exhausted }),
  });
}

// ---------------------------------------------------------------------------------------------
// Test harnesses (used only for in-memory databases under GRC_TEST_DATABASE / GRC_TEST_DATABASE_URL)

/** A fresh PGlite served over the Postgres wire protocol on a random local port. */
async function openSocketTestDb(): Promise<Db> {
  // A development dependency: imported only in this test mode.
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const lite = new PGlite({ extensions: EXTENSIONS });
  await lite.waitReady;
  const server = new PGLiteSocketServer({ db: lite, host: '127.0.0.1', port: 0, maxConnections: 100 });
  await server.start();
  return openServerDb({
    connectionString: `postgres://postgres@${server.getServerConn()}/postgres`,
    dataDir: 'memory',
    ssl: false,
    async onClose() {
      await server.stop();
      await lite.close();
    },
  });
}

/** A fresh database on a real server, created for this handle and dropped when it closes. */
async function openServerTestDb(adminUrl: string): Promise<Db> {
  const name = `grc_test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Byte-order sorting, as the embedded database has, so ordering in tests is the same in both.
    await admin.query(`create database ${ident(name)} template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return openServerDb({
    connectionString: url.toString(),
    dataDir: 'memory',
    async onClose() {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try {
        await c.query(`drop database if exists ${ident(name)} with (force)`);
      } finally {
        await c.end();
      }
    },
  });
}

// ---------------------------------------------------------------------------------------------

/**
 * Opens the database. `dataDir` is the data folder (for files and the embedded database), or
 * 'memory' for a throwaway database. With GRC_DATABASE_URL set, a data folder's database is the
 * server instead; 'memory' never uses the configured server.
 */
export async function openDb(dataDir: string): Promise<Db> {
  if (dataDir === 'memory') {
    const testUrl = process.env.GRC_TEST_DATABASE_URL?.trim();
    if (testUrl) return openServerTestDb(testUrl);
    if (String(process.env.GRC_TEST_DATABASE ?? '').trim().toLowerCase() === 'pg') return openSocketTestDb();
    return openEmbedded('memory');
  }
  const url = databaseUrl();
  if (url) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 }); // still holds attached files and the key file
    return openServerDb({ connectionString: withPassword(url), dataDir });
  }
  return openEmbedded(dataDir);
}

/** GRC_DATABASE_PASSWORD (or _FILE) replaces the password in the URL, so the URL itself need not be secret. */
function withPassword(url: string): string {
  const password = envOrFile('GRC_DATABASE_PASSWORD');
  if (!password) return url;
  const u = new URL(url);
  u.password = encodeURIComponent(password);
  return u.toString();
}
