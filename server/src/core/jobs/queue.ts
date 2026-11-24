// The background job queue (E14-12): jobs are rows in `jobs`, worked through by a poller.
//
// A job is claimed with a conditional update that also sets a lease (`locked_until`), so two
// processes sharing one database never run the same job, and a job whose process died is
// claimed again once its lease runs out. A failure is retried after a wait that doubles each
// time; after `max_attempts`, or on a `PermanentJobError`, the job is "dead" and waits for an
// administrator (Administration > Background jobs). Recurring work is a row in `job_schedules`.
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { afterCommit, inTrial, type Db } from '../db.ts';
import { featureState, jobOff, SWITCHED_OFF } from '../features.ts';
import type { Row } from '../module.ts';

const MAX_WAIT_SECONDS = 6 * 3600;

export interface JobInfo {
  id: string;
  type: string;
  /** 1 on the first run. */
  attempt: number;
  maxAttempts: number;
  /**
   * Records how far the job has got (a small JSON value), shown on Background jobs and kept
   * as the job's result until it finishes. Also renews the job's lease.
   */
  progress(value: unknown): Promise<void>;
}

/** Does the work. Resolve with a small JSON value (kept as the job's result); throw to fail. */
export type JobHandler = (payload: any, job: JobInfo) => Promise<unknown>;

export interface HandlerOptions {
  /** Attempts before the job is dead (default 5). */
  maxAttempts?: number;
  /** First wait after a failure, doubled each time, at most six hours (default 60). */
  backoffSeconds?: number;
  /** How long a run may hold the job before another poller may take it over (default 300). */
  leaseSeconds?: number;
  /**
   * The lane the job type runs in (default "main"). Each lane works through its own due jobs, one
   * after another, alongside the other lanes, so slow work in one lane (sending email to a mail
   * server that does not answer, OP-09) never holds up the others (alerts, timers, schedules).
   */
  lane?: string;
}

export interface EnqueueOptions {
  /** Not before this time. */
  runAt?: Date | string;
  /** Not before this many milliseconds from now. */
  delayMs?: number;
  maxAttempts?: number;
  backoffSeconds?: number;
  /** At most one waiting or running job per key: a second enqueue with the same key is skipped. */
  key?: string;
  /**
   * With `key`: when the job with that key is already running (rather than waiting), ask it to
   * run once more after it finishes instead of skipping (W17 review). For hook-triggered work that
   * reads its list when it starts (push delivery, tracker sends), so something added during a run
   * is not left for the next sweep. The follow-up run has the running job's type, payload and key.
   */
  rerunIfRunning?: boolean;
}

export interface ScheduleOptions {
  /** The job type to queue (its handler must be registered). */
  type: string;
  /** Interval in milliseconds (at least one minute). */
  every: number;
  payload?: Row;
  /** First run this long after the schedule is first created (default: one interval). */
  firstRunInMs?: number;
}

/** Throw this from a handler when trying again cannot help: the job goes straight to dead. */
export class PermanentJobError extends Error {
  readonly permanent = true;
}

/**
 * Throw this from a handler to fail this attempt and ask for the next one no sooner than `retryAt`
 * (E14-30), for example when a service answered "busy, try again in 120 seconds". The wait replaces
 * the doubling back-off for this attempt only; it is at least one second and at most six hours, and
 * the attempt still counts towards `maxAttempts`. Any error with a `retryAt` date (or
 * `retryAfterSeconds` number) property is treated the same way.
 */
export class RetryLaterError extends Error {
  readonly retryAt: Date;
  constructor(message: string, retryAt: Date | number) {
    super(message);
    this.retryAt = retryAt instanceof Date ? retryAt : new Date(Date.now() + Math.max(0, retryAt) * 1000);
  }
}

/**
 * Throw this from a handler to put the job back until `retryAt` without using up an attempt
 * (OP-09): the work was not tried, for example because the mail server is known to be down and
 * sending is paused for a few minutes. The job goes back to "queued" and never goes dead this way.
 */
export class DeferJobError extends RetryLaterError {
  readonly deferred = true;
}

/** The wait, in seconds, an error asks for before the next attempt; null when it asks for none. */
export function requestedWait(err: unknown, now = Date.now()): number | null {
  const e = err as { retryAt?: unknown; retryAfterSeconds?: unknown } | null;
  if (!e || typeof e !== 'object') return null;
  let seconds: number | null = null;
  if (e.retryAt instanceof Date || typeof e.retryAt === 'string') {
    const at = new Date(e.retryAt as Date | string).getTime();
    if (Number.isFinite(at)) seconds = (at - now) / 1000;
  } else if (typeof e.retryAfterSeconds === 'number' && Number.isFinite(e.retryAfterSeconds)) {
    seconds = e.retryAfterSeconds;
  }
  if (seconds === null) return null;
  return Math.min(MAX_WAIT_SECONDS, Math.max(1, Math.ceil(seconds)));
}

export interface JobQueue {
  /** Registers the handler for a job type. Call it from a module's `register()`. */
  register(type: string, handler: JobHandler, opts?: HandlerOptions): void;
  /**
   * Queues a job. Never throws for a duplicate `key`: `queued` is then false, and `rerun` is true
   * when `rerunIfRunning` asked the running job with that key to run once more.
   */
  enqueue(type: string, payload?: Row, opts?: EnqueueOptions): Promise<{ id: string | null; queued: boolean; rerun?: boolean }>;
  /** Creates or updates a recurring schedule (keeps its next run time when it already exists). */
  schedule(name: string, opts: ScheduleOptions): Promise<void>;
  /** Runs every job that is due (and queues due schedules). Returns how many ran. */
  runDue(opts?: { limit?: number; types?: string[] }): Promise<number>;
  /** Claims and runs one job now, whatever its run time, if it is waiting. Returns the row afterwards. */
  runNow(id: string): Promise<Row | undefined>;
  /** Job types with a handler in this process. */
  types(): string[];
  /** Starts the poller (the server does this when it starts listening). */
  start(intervalMs?: number): void;
  stop(): void;
  readonly started: boolean;
  /**
   * The poller in this process (E40-04): whether it runs, how often it polls, and when a poll last
   * finished (null before the first). A poll that never finishes leaves `lastPollAt` behind.
   */
  poller(): { started: boolean; intervalMs: number; lastPollAt: Date | null; startedAt: Date | null };
}

const clip = (s: unknown, n = 2000) => String(s ?? '').slice(0, n);

export function makeJobQueue(db: Db): JobQueue {
  const handlers = new Map<string, { fn: JobHandler; opts: Required<HandlerOptions> }>();
  const worker = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  /** Lanes being worked through in this process (OP-09). */
  const busy = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let kick: NodeJS.Immediate | null = null;
  let pollEvery = 0;
  let lastPollAt: Date | null = null;
  let startedAt: Date | null = null;

  const due = `((status in ('queued', 'failed') and run_at <= now()) or (status = 'running' and locked_until < now()))`;

  async function finish(job: Row, outcome: { ok: true; result: unknown } | { ok: false; error: unknown }) {
    if (outcome.ok) {
      // Reads the rerun flag in the same statement: an enqueue that sets it after this update
      // no longer finds the job running and queues a new job itself.
      const done = await db.one<Row>(
        `update jobs set status = 'done', result = $2::jsonb, last_error = null, finished_at = now(), locked_by = null, locked_until = null
         where id = $1 and locked_by = $3
         returning rerun, type, payload, max_attempts, backoff_seconds, dedupe_key`,
        [job.id, JSON.stringify(outcome.result ?? null), worker],
      );
      if (done?.rerun && done.dedupe_key) {
        await queue.enqueue(done.type, done.payload ?? {}, { key: done.dedupe_key, maxAttempts: done.max_attempts, backoffSeconds: done.backoff_seconds });
      }
      return;
    }
    const err = outcome.error as Error & { permanent?: boolean; deferred?: boolean };
    const message = clip(err?.message ?? err, 1000) || 'The job failed without saying why.';
    if (err?.deferred === true) {
      // Not tried: back in the queue without using up an attempt.
      await db.query(
        `update jobs set status = 'queued', attempts = greatest(0, attempts - 1), last_error = $2, locked_by = null, locked_until = null,
           run_at = now() + make_interval(secs => $3::int)
         where id = $1 and locked_by = $4`,
        [job.id, message, requestedWait(err) ?? 60, worker],
      );
      return;
    }
    const dead = err?.permanent === true || job.attempts >= job.max_attempts;
    // The handler may ask for a given time (RetryLaterError); otherwise the wait doubles each time.
    const wait = requestedWait(err) ?? Math.min(MAX_WAIT_SECONDS, job.backoff_seconds * 2 ** Math.max(0, job.attempts - 1));
    await db.query(
      `update jobs set status = $2, last_error = $3, locked_by = null, locked_until = null,
         finished_at = case when $2 = 'dead' then now() else null end,
         run_at = case when $2 = 'dead' then run_at else now() + make_interval(secs => $4::int) end
       where id = $1 and locked_by = $5`,
      [job.id, dead ? 'dead' : 'failed', message, wait, worker],
    );
    if (dead) console.error(`[jobs] ${job.type} ${job.id} gave up after ${job.attempts} attempt(s): ${message}`);
  }

  async function claim(id: string, any = false): Promise<Row | undefined> {
    const types = [...handlers.keys()];
    return db.one<Row>(
      // A fresh run reads the current state, which answers any earlier request to run again.
      `update jobs set status = 'running', attempts = attempts + 1, locked_by = $2, started_at = now(), rerun = false,
         locked_until = now() + make_interval(secs => $3::int)
       where id = $1 and type = any($4::text[]) and ${any ? `(status in ('queued', 'failed') or (status = 'running' and locked_until < now()))` : due}
       returning *`,
      [id, worker, 300, types],
    );
  }

  async function execute(job: Row): Promise<void> {
    const h = handlers.get(job.type);
    if (!h) return; // cannot happen: claim only takes registered types
    // The lease the handler asked for (claim used the default).
    if (h.opts.leaseSeconds !== 300) {
      await db.query('update jobs set locked_until = now() + make_interval(secs => $2::int) where id = $1 and locked_by = $3', [job.id, h.opts.leaseSeconds, worker]);
    }
    if (job.attempts > job.max_attempts) {
      // Claimed again after its process stopped, with no attempts left.
      await finish(job, { ok: false, error: Object.assign(new Error(clip(job.last_error) || 'The process running this job stopped before it finished.'), { permanent: true }) });
      return;
    }
    // Work of a switched-off area (core/features.ts) is skipped, and the run recorded as such.
    if (jobOff(await featureState(db), job.type)) {
      await finish(job, { ok: true, result: { skipped: 'switched_off', message: SWITCHED_OFF } });
      return;
    }
    try {
      const progress = async (value: unknown) => {
        await db.query(
          `update jobs set result = $2::jsonb, locked_until = now() + make_interval(secs => $4::int) where id = $1 and locked_by = $3`,
          [job.id, JSON.stringify(value ?? null), worker, h.opts.leaseSeconds],
        );
      };
      const result = await h.fn(job.payload ?? {}, { id: job.id, type: job.type, attempt: job.attempts, maxAttempts: job.max_attempts, progress });
      await finish(job, { ok: true, result });
    } catch (error) {
      await finish(job, { ok: false, error });
    }
  }

  async function promoteSchedules(types: string[]) {
    const rows = await db.query<Row>(
      // As text: a JavaScript date would lose the microseconds the comparison below needs.
      `select name, type, payload, every_seconds, next_run_at::text as next_at from job_schedules
       where enabled and next_run_at <= now() and type = any($1::text[])`,
      [types],
    );
    for (const s of rows) {
      // Whoever moves next_run_at on queues the run; another process's update then matches nothing.
      const won = await db.one(
        `update job_schedules set next_run_at = now() + make_interval(secs => every_seconds), last_run_at = now(), updated_at = now()
         where name = $1 and next_run_at = $2::timestamptz returning name`,
        [s.name, s.next_at],
      );
      if (won) await queue.enqueue(s.type, s.payload ?? {}, { key: `schedule:${s.name}` }).then(async (r) => {
        if (r.id) await db.query('update jobs set schedule = $2 where id = $1', [r.id, s.name]);
      });
    }
  }

  const queue: JobQueue = {
    register(type, fn, opts = {}) {
      if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(type)) throw new Error(`Job type "${type}" must be lower case letters, digits, dots, dashes or underscores.`);
      handlers.set(type, {
        fn,
        opts: {
          maxAttempts: Math.max(1, Math.min(50, opts.maxAttempts ?? 5)),
          backoffSeconds: Math.max(1, Math.min(MAX_WAIT_SECONDS, opts.backoffSeconds ?? 60)),
          leaseSeconds: Math.max(10, Math.min(3600, opts.leaseSeconds ?? 300)),
          lane: opts.lane && /^[a-z][a-z0-9_.-]{0,39}$/.test(opts.lane) ? opts.lane : 'main',
        },
      });
    },

    async enqueue(type, payload = {}, opts = {}) {
      const h = handlers.get(type)?.opts;
      const runAt = opts.runAt ? new Date(opts.runAt) : new Date(Date.now() + Math.max(0, opts.delayMs ?? 0));
      const insert = () => db.one<{ id: string }>(
        `insert into jobs (type, payload, run_at, max_attempts, backoff_seconds, dedupe_key)
         values ($1, $2::jsonb, $3, $4, $5, $6)
         on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'failed', 'running') do nothing
         returning id`,
        [type, JSON.stringify(payload ?? {}), runAt.toISOString(), opts.maxAttempts ?? h?.maxAttempts ?? 5,
          opts.backoffSeconds ?? h?.backoffSeconds ?? 60, opts.key ?? null],
      );
      let row = await insert();
      if (!row && opts.key && opts.rerunIfRunning) {
        // The key is taken. A waiting (queued or failed) job will read the current state when it
        // runs; a running one may already have read it, so it is asked to run once more. When it
        // finished in between (the flag matches nothing and nothing waits), try the insert again.
        for (let i = 0; i < 3 && !row; i++) {
          const flagged = await db.one(`update jobs set rerun = true where dedupe_key = $1 and status = 'running' returning id`, [opts.key]);
          if (flagged) return { id: null, queued: false, rerun: true };
          if (await db.one(`select 1 from jobs where dedupe_key = $1 and status in ('queued', 'failed')`, [opts.key])) break;
          row = await insert();
        }
      }
      // Not from inside a trial (E13-22): its rows are rolled back, and the job must not run in it.
      // After the save that queued it commits (E40-03); a trial's rows are rolled back, so never from one.
      if (row && timer && runAt.getTime() <= Date.now()) {
        await afterCommit(() => { if (!kick) kick = setImmediate(() => { kick = null; void queue.runDue().catch((err) => console.error('[jobs]', err)); }); });
      }
      return { id: row?.id ?? null, queued: Boolean(row) };
    },

    async schedule(name, opts) {
      const every = Math.max(60, Math.round(opts.every / 1000));
      const first = Math.max(0, Math.round((opts.firstRunInMs ?? opts.every) / 1000));
      await db.query(
        `insert into job_schedules (name, type, payload, every_seconds, next_run_at)
         values ($1, $2, $3::jsonb, $4, now() + make_interval(secs => $5::int))
         on conflict (name) do update set type = excluded.type, payload = excluded.payload, every_seconds = excluded.every_seconds,
           next_run_at = least(job_schedules.next_run_at, now() + make_interval(secs => excluded.every_seconds)), updated_at = now()`,
        [name, opts.type, JSON.stringify(opts.payload ?? {}), every, first],
      );
    },

    async runDue(opts = {}) {
      if (inTrial()) return 0;
      const types = (opts.types ?? [...handlers.keys()]).filter((t) => handlers.has(t));
      // Job types by lane; a lane still at work from an earlier call is left to finish (OP-09).
      const lanes = new Map<string, string[]>();
      for (const t of types) {
        const lane = handlers.get(t)!.opts.lane;
        if (!busy.has(lane)) (lanes.get(lane) ?? lanes.set(lane, []).get(lane)!).push(t);
      }
      if (!lanes.size) return 0;
      for (const lane of lanes.keys()) busy.add(lane);
      const limit = Math.max(1, Math.min(200, opts.limit ?? 25));
      // Each lane is free again as soon as its own work is done.
      const runLane = async ([lane, laneTypes]: [string, string[]]) => {
        try {
          const ids = await db.query<{ id: string }>(
            `select id from jobs where type = any($1::text[]) and ${due} order by run_at, created_at limit $2`,
            [laneTypes, limit],
          );
          let ran = 0;
          for (const { id } of ids) {
            const job = await claim(id);
            if (!job) continue; // another poller took it
            await execute(job);
            ran += 1;
          }
          return ran;
        } finally {
          busy.delete(lane);
        }
      };
      try {
        await promoteSchedules([...lanes.values()].flat());
      } catch (err) {
        for (const lane of lanes.keys()) busy.delete(lane);
        throw err;
      }
      const counts = await Promise.all([...lanes.entries()].map(runLane));
      return counts.reduce((a, b) => a + b, 0);
    },

    async runNow(id) {
      const job = await claim(id, true);
      if (job) await execute(job);
      return db.one<Row>('select * from jobs where id = $1', [id]);
    },

    types: () => [...handlers.keys()].sort(),

    start(intervalMs = 10_000) {
      if (timer) return;
      pollEvery = Math.max(1000, intervalMs);
      startedAt = new Date();
      // A poll that finishes (whatever it found) moves lastPollAt on; one that hangs does not (E40-04).
      const tick = () => {
        void queue.runDue().then(() => { lastPollAt = new Date(); }, (err) => console.error('[jobs] poll failed:', err));
      };
      timer = setInterval(tick, pollEvery);
      timer.unref();
      setTimeout(tick, 2000).unref();
    },

    stop() {
      if (timer) clearInterval(timer);
      if (kick) clearImmediate(kick);
      timer = null;
      kick = null;
    },

    get started() { return timer !== null; },

    poller: () => ({ started: timer !== null, intervalMs: pollEvery, lastPollAt, startedAt }),
  };
  return queue;
}
