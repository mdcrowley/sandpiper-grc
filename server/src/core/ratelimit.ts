import type { Queryable } from './db.ts';

/**
 * Sliding-window limiter kept in the database (table rate_limit_hits), so the counts survive a
 * restart and are shared by every process using the same database. Callers record failures only.
 */
export function makeDbLimiter(db: Queryable, bucket: string, max: number, windowMs: number) {
  const seconds = Math.ceil(windowMs / 1000);
  const clean = (key: string) => String(key).slice(0, 200);
  return {
    async blocked(key: string): Promise<boolean> {
      const row = await db.one<{ c: number }>(
        `select count(*)::int as c from rate_limit_hits
         where bucket = $1 and key = $2 and at > now() - make_interval(secs => $3::int)`,
        [bucket, clean(key), seconds],
      );
      return (row?.c ?? 0) >= max;
    },
    async hit(key: string): Promise<void> {
      await db.query('insert into rate_limit_hits (bucket, key) values ($1, $2)', [bucket, clean(key)]);
      // Old entries are of no use once outside the window; remove them as we go.
      await db.query(`delete from rate_limit_hits where bucket = $1 and at < now() - make_interval(secs => $2::int)`, [bucket, seconds]);
    },
    async clear(key: string): Promise<void> {
      await db.query('delete from rate_limit_hits where bucket = $1 and key = $2', [bucket, clean(key)]);
    },
  };
}

export type Limiter = ReturnType<typeof makeDbLimiter>;