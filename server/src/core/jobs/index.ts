// The job queue as a service: `app.jobs` (E14-12).
//
// Any module registers handlers and queues work without importing the module that started
// the queue:
//
//   const jobs = await ensureJobs(ctx);                 // or, guarded: ctx.app.hasDecorator('jobs')
//   jobs.register('contracts.reminders', async (payload, job) => { ...; return { sent: 3 }; },
//     { maxAttempts: 3, backoffSeconds: 120 });
//   await jobs.schedule('contracts.reminders', { type: 'contracts.reminders', every: 6 * 3_600_000 });
//   await jobs.enqueue('contracts.reminder-one', { contractId }, { key: `contract:${contractId}` });
//
// `ensureJobs` is idempotent: the first caller applies the queue's migrations, decorates the
// application and adds the administration routes. The poller starts when the server starts
// listening (never under the test runner, in commands such as `seed`, or with GRC_JOBS=off);
// tests call `app.jobs.runDue()` themselves.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UUID_RE } from '../errors.ts';
import { featureState } from '../features.ts';
import { migrate } from '../migrate.ts';
import type { ModuleContext, Row } from '../module.ts';
import { makeJobQueue, type JobQueue } from './queue.ts';

export { DeferJobError, PermanentJobError, RetryLaterError, requestedWait, type EnqueueOptions, type HandlerOptions, type JobHandler, type JobInfo, type JobQueue, type ScheduleOptions } from './queue.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** The background job queue. Present once `ensureJobs` has run: guard with `app.hasDecorator('jobs')`. */
    jobs: JobQueue;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const STATUSES = ['queued', 'running', 'failed', 'dead', 'done'];

/** Long values (file contents in a mail job, for example) are not sent to the browser. */
function shorten(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 400 ? `(${value.length} characters)` : value;
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => shorten(v, depth + 1));
  if (value && typeof value === 'object') {
    // Values a module keeps encrypted (named sealed…) are not shown at all.
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([k, v]) => [k, /^sealed/i.test(k) && v ? '(encrypted)' : shorten(v, depth + 1)]));
  }
  return value;
}

export interface RecurringWork {
  /** How often the work runs, in milliseconds (at least one minute). */
  every: number;
  /** First run this long after the schedule is first created (default one minute). */
  firstRunInMs?: number;
  /** Attempts before a run is given up (default 3; the next scheduled run tries again anyway). */
  maxAttempts?: number;
  /** How long one run may take before another process may take it over, in seconds (default 300). */
  leaseSeconds?: number;
}

/**
 * Recurring work on the job queue in one call, in place of a module's own `setInterval`
 * (E14-22): registers `run` as job type `type` and a schedule of the same name, so the work
 * shows on Background jobs and runs once however many server processes share the database.
 * `run` throws to fail (the run is retried). Work that must happen at a time of day checks
 * the time itself: the schedule only says how often to look.
 *
 *   await scheduleWork(ctx, 'projects.reminders', () => svc.runReminders(), { every: 6 * HOUR });
 */
export async function scheduleWork(ctx: ModuleContext, type: string, run: () => Promise<unknown>, opts: RecurringWork): Promise<JobQueue> {
  const jobs = await ensureJobs(ctx);
  jobs.register(type, async () => (await run()) ?? null, { maxAttempts: opts.maxAttempts ?? 3, leaseSeconds: opts.leaseSeconds });
  await jobs.schedule(type, { type, every: opts.every, firstRunInMs: opts.firstRunInMs ?? 60_000 });
  return jobs;
}

export async function ensureJobs(ctx: ModuleContext): Promise<JobQueue> {
  const { app, db } = ctx;
  if (app.hasDecorator('jobs')) return app.jobs;
  await migrate(db, [{ scope: 'core.jobs', dir: join(here, 'migrations') }]);
  const jobs = makeJobQueue(db);
  app.decorate('jobs', jobs);

  // Housekeeping: finished jobs are kept for 30 days, dead ones for 90. Finished runs of a
  // schedule (some run every minute) are kept for two days: the schedule shows its last result.
  jobs.register('jobs.cleanup', async () => {
    const done = await db.query(
      `delete from jobs where status = 'done' and (finished_at < now() - interval '30 days'
         or (schedule is not null and finished_at < now() - interval '2 days')) returning 1`,
    );
    const dead = await db.query(`delete from jobs where status = 'dead' and finished_at < now() - interval '90 days' returning 1`);
    return { removed: done.length + dead.length };
  }, { maxAttempts: 2 });
  await jobs.schedule('jobs.cleanup', { type: 'jobs.cleanup', every: DAY, firstRunInMs: 10 * 60_000 });

  const autoRun = !process.env.VITEST && ctx.dataDir !== 'memory' && process.env.GRC_JOBS !== 'off';
  app.addHook('onListen', async () => {
    if (autoRun) jobs.start(Math.max(1000, Number(process.env.GRC_JOBS_POLL_MS) || 10_000));
  });
  app.addHook('onClose', async () => jobs.stop());

  // ---------- administration ----------

  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const A = 'admin.administer';

  app.get('/api/admin/jobs', admin, async (req) => {
    const q = req.query as Record<string, string>;
    const status = STATUSES.includes(q.status) ? q.status : null;
    const type = typeof q.type === 'string' && q.type ? q.type.slice(0, 80) : null;
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const page = Math.min(100000, Math.max(1, Math.trunc(Number(q.page)) || 1));
    // Work of a switched-off area (Administration > Features) is skipped, and not shown here either (E14-34).
    const offPrefixes = (await featureState(db)).offJobs;
    const where = `($1::text is null or status = $1) and ($2::text is null or type = $2) and not (type like any($3::text[]))`;
    const offLike = offPrefixes.map((p) => `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const total = (await db.one<{ c: number }>(`select count(*)::int c from jobs where ${where}`, [status, type, offLike]))!.c;
    const rows = await db.query<Row>(
      `select id, type, status, attempts, max_attempts, run_at, created_at, started_at, finished_at, locked_until, last_error, schedule
       from jobs where ${where} order by created_at desc, id limit ${pageSize} offset ${(page - 1) * pageSize}`,
      [status, type, offLike],
    );
    const isOff = (t: string) => offPrefixes.some((p) => t.startsWith(p));
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<string, number>;
    for (const c of await db.query<{ status: string; c: number }>('select status, count(*)::int c from jobs group by status')) counts[c.status] = c.c;
    const schedules = await db.query<Row>(
      `select s.name, s.type, s.every_seconds, s.next_run_at, s.last_run_at, s.enabled,
         (select j.status from jobs j where j.schedule = s.name order by j.created_at desc limit 1) as last_status
       from job_schedules s order by s.name`,
    );
    const known = new Set(jobs.types());
    return {
      rows, total, page, pageSize, counts,
      schedules: schedules.filter((s) => !isOff(String(s.type))).map((s) => ({ ...s, handled: known.has(s.type) })),
      types: (await db.query<{ type: string }>('select distinct type from jobs order by type')).map((r) => r.type).filter((t) => !isOff(t)),
      pollerRunning: jobs.started,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/jobs', tag: 'Background jobs', permission: A, summary: 'Background jobs, newest first, with counts and schedules',
    query: { status: 'queued, running, failed, dead or done', type: 'One job type', page: 'Page number', pageSize: 'Rows a page (max 200)' },
    response: '{ rows, total, page, pageSize, counts, schedules, types, pollerRunning }',
  });

  const oneJob = async (id: string) => {
    const row = UUID_RE.test(id) ? await db.one<Row>('select * from jobs where id = $1', [id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Job not found.');
  };

  app.get('/api/admin/jobs/:id', admin, async (req) => {
    const job = await oneJob((req.params as Row).id);
    return { ...job, payload: shorten(job.payload), result: shorten(job.result), handled: jobs.types().includes(job.type) };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/admin/jobs/:id', tag: 'Background jobs', permission: A, summary: 'One job, with its payload and result (long values shortened)' });

  // A failed or dead job goes back in the queue with its attempts counted from nothing.
  app.post('/api/admin/jobs/:id/retry', admin, async (req) => {
    const before = await oneJob((req.params as Row).id);
    // A dead job of a key (a schedule, push delivery) may have a newer run waiting or running: the
    // key allows one at a time (jobs_dedupe_ix), so this one cannot go back in the queue (W17 review).
    const newer = () => ctx.fail(409, 'already_queued', 'A newer run of this job is waiting or running.');
    if (before.status === 'dead' && before.dedupe_key
      && await db.one(`select 1 from jobs where dedupe_key = $1 and id <> $2 and status in ('queued', 'failed', 'running')`, [before.dedupe_key, before.id])) newer();
    let row: Row | undefined;
    try {
      row = await db.one<Row>(
        `update jobs set status = 'queued', attempts = 0, run_at = now(), finished_at = null
         where id = $1 and status in ('failed', 'dead') returning id, type`,
        [before.id],
      );
    } catch (err) {
      // A newer run was queued between the check and the update.
      if ((err as { code?: string }).code === '23505' || /jobs_dedupe_ix|duplicate key/i.test(String((err as Error)?.message ?? ''))) newer();
      throw err;
    }
    if (!row) ctx.fail(409, 'not_retryable', 'Only a failed or dead job can be tried again.');
    await ctx.audit(req, { action: 'job.retry', recordType: 'job', recordId: before.id, summary: `Background job ${before.type} queued again (was ${before.status})` });
    return (await jobs.runNow(before.id)) ?? before;
  });
  ctx.describeRoute({ method: 'POST', path: '/api/admin/jobs/:id/retry', tag: 'Background jobs', permission: A, summary: 'Try a failed or dead job again now' });

  app.post('/api/admin/jobs/schedules/:name/run', admin, async (req) => {
    const name = String((req.params as Row).name ?? '');
    const s = await db.one<Row>('select name, type, payload from job_schedules where name = $1', [name]);
    if (!s) ctx.fail(404, 'not_found', 'Schedule not found.');
    if (!jobs.types().includes(s!.type)) ctx.fail(409, 'not_handled', 'The module that runs this schedule is not loaded.');
    const queued = await jobs.enqueue(s!.type, s!.payload ?? {},{ key: `schedule:${s!.name}` });
    if (!queued.id) ctx.fail(409, 'already_queued', 'This schedule already has a run waiting or in progress.');
    await db.query('update jobs set schedule = $2 where id = $1', [queued.id, s!.name]);
    await ctx.audit(req, { action: 'job.run_now', recordType: 'job', recordId: queued.id!, summary: `Scheduled job ${s!.name} run by hand` });
    return (await jobs.runNow(queued.id!))!;
  });
  ctx.describeRoute({ method: 'POST', path: '/api/admin/jobs/schedules/:name/run', tag: 'Background jobs', permission: A, summary: 'Run a scheduled job now' });

  return jobs;
}
