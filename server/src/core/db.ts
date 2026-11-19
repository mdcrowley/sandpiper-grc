import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { TIME_ZONE } from './timezone.ts';

/**
 * Database access. The prototype uses PGlite (embedded Postgres). To move to a real
 * PostgreSQL server, reimplement `openDb` with `pg` - nothing else imports PGlite.
 */
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Inside the callback use ONLY the `tx` argument: the outer handle waits for the transaction. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** The folder the database lives in, or 'memory'. Files that belong beside the database (the secret key) go here. */
  dataDir: string;
}

// Postgres type OIDs: keep dates as 'YYYY-MM-DD' strings, numerics and bigints as numbers.
const parsers = {
  1082: (v: string) => v,
  1700: (v: string) => Number(v),
  20: (v: string) => Number(v),
};

function wrap(q: { query: Function; exec: Function }): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await q.query(sql, params);
      return res.rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const res = await q.query(sql, params);
      return res.rows[0] as T | undefined;
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  };
}

export async function openDb(dataDir: string): Promise<Db> {
  let pg: PGlite;
  if (dataDir === 'memory') {
    pg = new PGlite({ parsers });
  } else {
    mkdirSync(dataDir, { recursive: true });
    pg = new PGlite(`${dataDir}/pg`, { parsers });
  }
  await pg.waitReady;
  await pg.exec(`set timezone to '${TIME_ZONE.replace(/'/g, '')}'`);
  return {
    ...wrap(pg),
    tx: (fn) => pg.transaction((tx) => fn(wrap(tx))) as Promise<any>,
    close: () => pg.close(),
    dataDir,
  };
}
