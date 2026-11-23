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
    /**
     * Claims an attempt atomically (wave 9, SA-3): records it first and counts after, so attempts
     * made at the same moment all count; `blocked()` then `hit()` lets them all through. `ok` is
     * false when the attempt is over the limit (it is then not kept). Call `release()` when the
     * attempt turns out not to be a failure (a successful sign-in), so only failures count.
     */
    async take(key: string): Promise<{ ok: boolean; release: () => Promise<void> }> {
      const k = clean(key);
      const row = await db.one<{ id: string }>('insert into rate_limit_hits (bucket, key) values ($1, $2) returning id', [bucket, k]);
      const count = await db.one<{ c: number }>(
        `select count(*)::int as c from rate_limit_hits
         where bucket = $1 and key = $2 and at > now() - make_interval(secs => $3::int)`,
        [bucket, k, seconds],
      );
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        await db.query('delete from rate_limit_hits where id = $1', [row!.id]);
      };
      const ok = (count?.c ?? 0) <= max;
      if (!ok) await release();
      else await db.query(`delete from rate_limit_hits where bucket = $1 and at < now() - make_interval(secs => $2::int)`, [bucket, seconds]);
      return { ok, release };
    },
    async clear(key: string): Promise<void> {
      await db.query('delete from rate_limit_hits where bucket = $1 and key = $2', [bucket, clean(key)]);
    },
  };
}

export type Limiter = ReturnType<typeof makeDbLimiter>;

/** Requests a key has made in the current clock minute, and seconds until that minute ends. */
export interface RequestCount {
  count: number;
  resetSeconds: number;
  /** The stored value of the setting named in the call (undefined when it is not stored). */
  setting?: unknown;
}

/**
 * Counts one request for `key` in the current minute (E16-43) and returns the count so far, with
 * this request. Kept in table request_counts, so every server process on the database counts
 * together: one upsert per request, and the minute is the database's, so processes whose clocks
 * differ still agree. Used for `tokens.rate_per_minute` (bucket `token`, the same count the
 * RateLimit headers report) and `mcp.rate_per_minute` (bucket `mcp`).
 *
 * `settingKey` reads that setting in the same statement (the limit, which the caller would
 * otherwise read with a query of its own), so counting adds no round trip to the database.
 */
export async function countRequest(db: Queryable, bucket: string, key: string, settingKey?: string): Promise<RequestCount> {
  const row = await db.one<{ hits: number; reset: number; setting: unknown }>(
    `with c as (
       insert into request_counts as c (bucket, key, minute) values ($1, $2, floor(extract(epoch from now()) / 60)::bigint)
       on conflict (bucket, key, minute) do update set hits = c.hits + 1
       returning c.hits, c.minute)
     select c.hits, ceil((c.minute + 1) * 60 - extract(epoch from now()))::int as reset,
            (select s.value from settings s where s.key = $3::text) as setting
     from c`,
    [bucket, String(key).slice(0, 200), settingKey ?? null],
  );
  return { count: row?.hits ?? 1, resetSeconds: Math.min(60, Math.max(1, row?.reset ?? 60)), setting: row?.setting ?? undefined };
}

/** Removes the counts of minutes that have passed (the recurring job `core.request_counts`). */
export async function pruneRequestCounts(db: Queryable): Promise<number> {
  return (await db.query('delete from request_counts where minute < floor(extract(epoch from now()) / 60)::bigint returning 1')).length;
}

/** A token request's limit and count (set by the token check in core/tokens.ts), for the RateLimit headers. */
export interface TokenRate extends RequestCount {
  limit: number;
}

const tokenRates = new WeakMap<object, TokenRate>();

/** Records the token count a request was checked against, so its answer reports the same count. */
export function setTokenRate(req: object, rate: TokenRate): void {
  tokenRates.set(req, rate);
}

/** The token count a request was checked against, if it was made with a token. */
export function tokenRateOf(req: object): TokenRate | undefined {
  return tokenRates.get(req);
}
