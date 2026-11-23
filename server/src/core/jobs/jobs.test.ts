import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { testApp } from '../../test/helpers.ts';
import { DeferJobError, ensureJobs, PermanentJobError, RetryLaterError, requestedWait, scheduleWork } from './index.ts';
import { makeJobQueue } from './queue.ts';

// Starts the queue without relying on any module being loaded (GRC_MODULES may be anything).
const starter: ModuleDef = { key: 'testjobs', async seedDefaults(ctx) { await ensureJobs(ctx); } };

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ extraModules: [starter] }); });
afterAll(async () => { await t.close(); });

const job = (id: string) => t.db.one<any>('select * from jobs where id = $1', [id]);
const makeDue = (id: string) => t.db.query(`update jobs set run_at = now() - interval '1 second' where id = $1`, [id]);

describe('job queue', () => {
  it('waits as long as a handler asks before the next attempt, within bounds (E14-30)', async () => {
    let calls = 0;
    t.app.jobs.register('test.throttled', async () => {
      calls += 1;
      if (calls === 1) throw new RetryLaterError('Busy: try again in 2 minutes', 120);
      if (calls === 2) throw Object.assign(new Error('Busy for a day'), { retryAfterSeconds: 86_400 });
      return 'sent';
    }, { maxAttempts: 3, backoffSeconds: 5 });
    const { id } = await t.app.jobs.enqueue('test.throttled', {});
    await t.app.jobs.runDue({ types: ['test.throttled'] });
    let row = await job(id!);
    expect(row).toMatchObject({ status: 'failed', attempts: 1, last_error: 'Busy: try again in 2 minutes' });
    const wait = (new Date(row.run_at).getTime() - Date.now()) / 1000;
    expect(wait).toBeGreaterThan(110);
    expect(wait).toBeLessThan(121);
    await makeDue(id!);
    await t.app.jobs.runDue({ types: ['test.throttled'] });
    row = await job(id!);
    // At most six hours, however long the service asks for.
    const capped = (new Date(row.run_at).getTime() - Date.now()) / 1000;
    expect(capped).toBeGreaterThan(6 * 3600 - 15);
    expect(capped).toBeLessThanOrEqual(6 * 3600 + 1);
    await makeDue(id!);
    await t.app.jobs.runDue({ types: ['test.throttled'] });
    expect(await job(id!)).toMatchObject({ status: 'done', attempts: 3 });
  });

  it('still gives up after the last attempt, even when asked to wait', async () => {
    t.app.jobs.register('test.always_busy', async () => { throw new RetryLaterError('Still busy', 30); }, { maxAttempts: 1 });
    const { id } = await t.app.jobs.enqueue('test.always_busy', {});
    await t.app.jobs.runDue({ types: ['test.always_busy'] });
    expect(await job(id!)).toMatchObject({ status: 'dead', attempts: 1 });
    expect(requestedWait(new Error('plain'))).toBeNull();
    expect(requestedWait({ retryAt: new Date(Date.now() - 5000) })).toBe(1);
    expect(requestedWait({ retryAt: new Date(Date.now() + 90_500) })).toBeGreaterThanOrEqual(90);
  });


  it('runs a queued job once and keeps its result', async () => {
    let calls = 0;
    t.app.jobs.register('test.ok', async (payload) => { calls += 1; return { doubled: payload.n * 2 }; });
    const { id } = await t.app.jobs.enqueue('test.ok', { n: 21 });
    await t.app.jobs.runDue({ types: ['test.ok'] });
    await t.app.jobs.runDue({ types: ['test.ok'] });
    expect(calls).toBe(1);
    expect(await job(id!)).toMatchObject({ status: 'done', attempts: 1, result: { doubled: 42 }, locked_by: null });
  });

  it('waits for run_at', async () => {
    let calls = 0;
    t.app.jobs.register('test.later', async () => { calls += 1; });
    const { id } = await t.app.jobs.enqueue('test.later', {}, { delayMs: 60_000 });
    await t.app.jobs.runDue({ types: ['test.later'] });
    expect(calls).toBe(0);
    await makeDue(id!);
    await t.app.jobs.runDue({ types: ['test.later'] });
    expect(calls).toBe(1);
  });

  it('retries a failure with a growing wait, then gives up (dead), and an administrator can retry it', async () => {
    let fail = true;
    t.app.jobs.register('test.flaky', async () => { if (fail) throw new Error('Remote end busy'); return 'fine'; }, { maxAttempts: 3, backoffSeconds: 30 });
    const { id } = await t.app.jobs.enqueue('test.flaky', {});
    await t.app.jobs.runDue({ types: ['test.flaky'] });
    let row = await job(id!);
    expect(row).toMatchObject({ status: 'failed', attempts: 1, last_error: 'Remote end busy' });
    const firstWait = (new Date(row.run_at).getTime() - Date.now()) / 1000;
    expect(firstWait).toBeGreaterThan(20);
    expect(firstWait).toBeLessThan(31);
    // Not due yet: nothing happens.
    await t.app.jobs.runDue({ types: ['test.flaky'] });
    expect((await job(id!)).attempts).toBe(1);

    await makeDue(id!);
    await t.app.jobs.runDue({ types: ['test.flaky'] });
    row = await job(id!);
    expect(row.attempts).toBe(2);
    const secondWait = (new Date(row.run_at).getTime() - Date.now()) / 1000;
    expect(secondWait).toBeGreaterThan(50); // doubled

    await makeDue(id!);
    await t.app.jobs.runDue({ types: ['test.flaky'] });
    expect(await job(id!)).toMatchObject({ status: 'dead', attempts: 3 });

    // Visible to administrators, and only to them.
    const agent = await t.as('agent');
    expect((await agent.get('/api/admin/jobs')).status).toBe(403);
    const dead = await t.api.get('/api/admin/jobs?status=dead');
    expect(dead.body.rows.map((r: any) => r.id)).toContain(id);
    expect(dead.body.counts.dead).toBeGreaterThanOrEqual(1);
    expect((await t.api.get(`/api/admin/jobs/${id}`)).body).toMatchObject({ type: 'test.flaky', handled: true });

    fail = false;
    const retried = await t.api.post(`/api/admin/jobs/${id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ status: 'done', attempts: 1, result: 'fine' });
    expect((await t.db.query(`select 1 from audit_events where action = 'job.retry' and record_id = $1`, [id])).length).toBe(1);
    expect((await t.api.post(`/api/admin/jobs/${id}/retry`)).status).toBe(409);
  });

  it('sends a permanent error straight to dead', async () => {
    t.app.jobs.register('test.permanent', async () => { throw new PermanentJobError('Address does not exist'); });
    const { id } = await t.app.jobs.enqueue('test.permanent', {});
    await t.app.jobs.runDue({ types: ['test.permanent'] });
    expect(await job(id!)).toMatchObject({ status: 'dead', attempts: 1, last_error: 'Address does not exist' });
  });

  it('skips a duplicate key while the first is waiting', async () => {
    t.app.jobs.register('test.keyed', async () => 'ok');
    const a = await t.app.jobs.enqueue('test.keyed', {}, { key: 'same' });
    const b = await t.app.jobs.enqueue('test.keyed', {}, { key: 'same' });
    expect(a.queued).toBe(true);
    expect(b).toEqual({ id: null, queued: false });
    await t.app.jobs.runDue({ types: ['test.keyed'] });
    expect((await t.app.jobs.enqueue('test.keyed', {}, { key: 'same' })).queued).toBe(true);
  });

  it('answers 409 already_queued when a dead job is retried while a newer run of its key waits (W17 review)', async () => {
    t.app.jobs.register('test.keyfail', async () => { throw new Error('Service down'); }, { maxAttempts: 1 });
    const a = await t.app.jobs.enqueue('test.keyfail', {}, { key: 'schedule:test.keyfail' });
    await t.app.jobs.runNow(a.id!);
    expect((await job(a.id!)).status).toBe('dead');
    // The next run of the same key fails too and waits for its back-off.
    const b = await t.app.jobs.enqueue('test.keyfail', {}, { key: 'schedule:test.keyfail', maxAttempts: 3 });
    await t.app.jobs.runNow(b.id!);
    expect((await job(b.id!)).status).toBe('failed');
    // Before the fix: 500 (duplicate key value violates unique constraint "jobs_dedupe_ix").
    const res = await t.api.post(`/api/admin/jobs/${a.id}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'already_queued', message: 'A newer run of this job is waiting or running.' });
    expect((await job(a.id!)).status).toBe('dead');
    // Once the newer run is over, the dead one can be tried again.
    await t.db.query(`update jobs set status = 'dead', finished_at = now() where id = $1`, [b.id]);
    t.app.jobs.register('test.keyfail', async () => 'fine', { maxAttempts: 1 });
    expect((await t.api.post(`/api/admin/jobs/${a.id}/retry`)).body).toMatchObject({ status: 'done', result: 'fine' });
  });

  it('rerunIfRunning asks a running job of the key to run once more, instead of skipping (W17 review)', async () => {
    const items: string[] = [];
    const sent: string[][] = [];
    let during: unknown;
    t.app.jobs.register('test.rerun', async () => {
      const due = [...items]; // read when the run starts, like push delivery
      if (!sent.length) {
        // Something arrives while this run is working.
        items.push('late');
        during = await t.app.jobs.enqueue('test.rerun', {}, { key: 'rerun', rerunIfRunning: true });
      }
      sent.push(due);
      return due.length;
    });
    items.push('first');
    const a = await t.app.jobs.enqueue('test.rerun', { n: 1 }, { key: 'rerun', rerunIfRunning: true });
    await t.app.jobs.runNow(a.id!);
    expect(during).toEqual({ id: null, queued: false, rerun: true });
    expect(sent).toEqual([['first']]);
    // The finished run queued its follow-up, with the same key and payload.
    const next = await t.db.query<any>(`select id, status, payload, rerun from jobs where type = 'test.rerun' and id <> $1`, [a.id]);
    expect(next).toEqual([expect.objectContaining({ status: 'queued', payload: { n: 1 }, rerun: false })]);
    expect((await job(a.id!)).status).toBe('done');
    await t.app.jobs.runDue({ types: ['test.rerun'] });
    expect(sent).toEqual([['first'], ['first', 'late']]);
    // No further run: the follow-up was not asked to run again.
    expect((await t.db.query(`select 1 from jobs where type = 'test.rerun' and status <> 'done'`)).length).toBe(0);

    // A waiting job of the key reads the current state when it runs: nothing more is queued.
    const w = await t.app.jobs.enqueue('test.rerun', {}, { key: 'rerun', delayMs: 60_000 });
    expect(await t.app.jobs.enqueue('test.rerun', {}, { key: 'rerun', rerunIfRunning: true })).toEqual({ id: null, queued: false });
    expect((await job(w.id!)).rerun).toBe(false);
    // Without the option, an enqueue while the key runs is skipped as before.
    await t.db.query(`update jobs set status = 'running', locked_by = 'other:1', locked_until = now() + interval '5 minutes' where id = $1`, [w.id]);
    expect(await t.app.jobs.enqueue('test.rerun', {}, { key: 'rerun' })).toEqual({ id: null, queued: false });
    expect((await job(w.id!)).rerun).toBe(false);
    // A run taken over after its lease ran out starts afresh: the claim clears the flag, no extra run follows.
    await t.db.query(`update jobs set rerun = true, locked_until = now() - interval '1 second' where id = $1`, [w.id]);
    await t.app.jobs.runDue({ types: ['test.rerun'] });
    expect(await job(w.id!)).toMatchObject({ status: 'done', rerun: false });
  });

  it('takes over a job whose process stopped (lease expired), and not one still leased', async () => {
    let calls = 0;
    t.app.jobs.register('test.lease', async () => { calls += 1; return 'recovered'; });
    const { id } = await t.app.jobs.enqueue('test.lease', {});
    await t.db.query(`update jobs set status = 'running', attempts = 1, locked_by = 'gone:1', locked_until = now() + interval '5 minutes' where id = $1`, [id]);
    await t.app.jobs.runDue({ types: ['test.lease'] });
    expect(calls).toBe(0);
    await t.db.query(`update jobs set locked_until = now() - interval '1 second' where id = $1`, [id]);
    await t.app.jobs.runDue({ types: ['test.lease'] });
    expect(calls).toBe(1);
    expect(await job(id!)).toMatchObject({ status: 'done', attempts: 2, result: 'recovered' });
  });

  it('runs each job once when two queues share the database', async () => {
    const seen: string[] = [];
    const other = makeJobQueue(t.db);
    const handler = async (p: any) => { seen.push(p.n); await new Promise((r) => setTimeout(r, 2)); };
    t.app.jobs.register('test.shared', handler);
    other.register('test.shared', handler);
    for (let n = 0; n < 12; n += 1) await t.app.jobs.enqueue('test.shared', { n });
    await Promise.all([t.app.jobs.runDue({ types: ['test.shared'] }), other.runDue({ types: ['test.shared'] }), other.runDue({ types: ['test.shared'] })]);
    await t.app.jobs.runDue({ types: ['test.shared'] });
    expect(seen.length).toBe(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('leaves job types that no handler here knows', async () => {
    const { id } = await t.app.jobs.enqueue('test.nobody', {});
    await t.app.jobs.runDue();
    expect((await job(id!)).status).toBe('queued');
  });

  it('queues a schedule once per interval, and an administrator can run it now', async () => {
    let calls = 0;
    t.app.jobs.register('test.tick', async () => { calls += 1; return { calls }; });
    await t.app.jobs.schedule('test.tick', { type: 'test.tick', every: 3_600_000, firstRunInMs: 0 });
    await t.app.jobs.runDue({ types: ['test.tick'] });
    await t.app.jobs.runDue({ types: ['test.tick'] });
    expect(calls).toBe(1);
    const s = await t.db.one<any>(`select next_run_at from job_schedules where name = 'test.tick'`);
    expect(new Date(s.next_run_at).getTime()).toBeGreaterThan(Date.now() + 3_500_000);

    // A second queue sharing the database does not queue it again.
    const other = makeJobQueue(t.db);
    other.register('test.tick', async () => { calls += 1; });
    await other.runDue();
    expect(calls).toBe(1);

    const listed = await t.api.get('/api/admin/jobs');
    expect(listed.body.schedules.find((x: any) => x.name === 'test.tick')).toMatchObject({ handled: true, last_status: 'done' });
    const now = await t.api.post('/api/admin/jobs/schedules/test.tick/run');
    expect(now.body).toMatchObject({ status: 'done', schedule: 'test.tick' });
    expect(calls).toBe(2);
    expect((await t.api.post('/api/admin/jobs/schedules/nothing/run')).status).toBe(404);
  });
});

describe('recurring work and progress', () => {
  it('scheduleWork registers the handler and a schedule of the same name', async () => {
    let runs = 0;
    await scheduleWork(t.ctx, 'test.recurring', async () => { runs += 1; return { runs }; }, { every: 6 * 3_600_000, firstRunInMs: 0 });
    const s = await t.db.one<any>(`select type, every_seconds from job_schedules where name = 'test.recurring'`);
    expect(s).toEqual({ type: 'test.recurring', every_seconds: 6 * 3600 });
    await t.app.jobs.runDue({ types: ['test.recurring'] });
    expect(runs).toBe(1);
    const last = await t.db.one<any>(`select status, result, schedule from jobs where type = 'test.recurring'`);
    expect(last).toMatchObject({ status: 'done', result: { runs: 1 }, schedule: 'test.recurring' });
    // Calling it again (a second start) keeps one schedule and its next run time.
    await scheduleWork(t.ctx, 'test.recurring', async () => undefined, { every: 6 * 3_600_000 });
    expect((await t.db.query(`select 1 from job_schedules where name = 'test.recurring'`)).length).toBe(1);
  });

  it('records progress while a job runs', async () => {
    const seen: unknown[] = [];
    t.app.jobs.register('test.progress', async (_p, info) => {
      await info.progress({ done: 1, of: 2 });
      seen.push((await job(info.id)).result);
      return { done: 2, of: 2 };
    });
    const { id } = await t.app.jobs.enqueue('test.progress', {});
    await t.app.jobs.runDue({ types: ['test.progress'] });
    expect(seen).toEqual([{ done: 1, of: 2 }]);
    expect(await job(id!)).toMatchObject({ status: 'done', result: { done: 2, of: 2 } });
  });

  it('cleans up finished runs of a schedule after two days, other finished jobs after thirty', async () => {
    t.app.jobs.register('test.old', async () => 'ok');
    const a = await t.app.jobs.enqueue('test.old', {});
    const b = await t.app.jobs.enqueue('test.old', {});
    await t.app.jobs.runDue({ types: ['test.old'] });
    await t.db.query(`update jobs set finished_at = now() - interval '3 days' where id = any($1::uuid[])`, [[a.id, b.id]]);
    await t.db.query(`update jobs set schedule = 'test.old' where id = $1`, [a.id]);
    const cleanup = await t.app.jobs.enqueue('jobs.cleanup', {});
    await t.app.jobs.runNow(cleanup.id!);
    expect(await job(a.id!)).toBeUndefined();
    expect((await job(b.id!)).status).toBe('done');
  });
});

// OP-09: one slow kind of work (mail to a server that does not answer) held up every other job.
describe('lanes and deferral (OP-09)', () => {
  it('runs other lanes while a slow lane is still at work', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    t.app.jobs.register('test.slow_lane', async () => { await gate; return 'slow done'; }, { lane: 'slowtest' });
    t.app.jobs.register('test.main_lane', async () => 'quick done');
    const slow = await t.app.jobs.enqueue('test.slow_lane', {});
    const first = await t.app.jobs.enqueue('test.main_lane', {});
    const types = ['test.slow_lane', 'test.main_lane'];
    const pending = t.app.jobs.runDue({ types });
    // The main lane finishes although the slow lane's job is still running.
    const started = Date.now();
    while ((await job(first.id!)).status !== 'done' && Date.now() - started < 10_000) await new Promise((r) => setTimeout(r, 20));
    expect((await job(first.id!)).status).toBe('done');
    expect((await job(slow.id!)).status).toBe('running');
    // A later poll runs new main-lane work too, and leaves the busy lane alone.
    const second = await t.app.jobs.enqueue('test.main_lane', {});
    expect(await t.app.jobs.runDue({ types })).toBe(1);
    expect((await job(second.id!)).status).toBe('done');
    release();
    expect(await pending).toBe(2);
    expect(await job(slow.id!)).toMatchObject({ status: 'done', result: 'slow done' });
  });

  it('puts a deferred job back without using up an attempt', async () => {
    let calls = 0;
    t.app.jobs.register('test.deferred', async () => {
      calls += 1;
      if (calls <= 3) throw new DeferJobError('Paused for now', 90);
      return 'went';
    }, { maxAttempts: 1 });
    const { id } = await t.app.jobs.enqueue('test.deferred', {});
    for (let i = 0; i < 3; i++) {
      await makeDue(id!);
      await t.app.jobs.runDue({ types: ['test.deferred'] });
      const row = await job(id!);
      expect(row).toMatchObject({ status: 'queued', attempts: 0, last_error: 'Paused for now' });
      expect((new Date(row.run_at).getTime() - Date.now()) / 1000).toBeGreaterThan(80);
    }
    await makeDue(id!);
    await t.app.jobs.runDue({ types: ['test.deferred'] });
    expect(await job(id!)).toMatchObject({ status: 'done', attempts: 1, result: 'went' });
  });
});
