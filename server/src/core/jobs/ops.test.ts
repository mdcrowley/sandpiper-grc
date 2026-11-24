import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { testApp } from '../../test/helpers.ts';
import { ensureJobs } from './index.ts';
import { makeOpsAlerts } from './alerts.ts';
import { makeWatch, pollerStalled, queueStalled } from './watch.ts';
import { cleanupSessions } from './ops.ts';
import { metricsText } from '../monitoring.ts';
import type { JobQueue } from './queue.ts';

// E40-04 (alerts when background work fails, /api/ready, metrics) and E40-07 (session clean-up).
const starter: ModuleDef = { key: 'testops', async seedDefaults(ctx) { await ensureJobs(ctx); } };

let t: Awaited<ReturnType<typeof testApp>>;
const told: { notify: any[]; mail: any[] } = { notify: [], mail: [] };
beforeAll(async () => {
  t = await testApp({ extraModules: [starter] });
  // Record what reaches the administrators, whichever modules provide notify and sendMail.
  if (t.app.hasDecorator('notify')) {
    const real = t.app.notify.bind(t.app);
    (t.app as any).notify = async (input: any) => { told.notify.push(input); return real(input); };
  } else (t.app as any).decorate('notify', async (input: any) => { told.notify.push(input); return { sent: 1, skipped: 0 }; });
  const realMail = t.app.sendMail.bind(t.app);
  (t.app as any).sendMail = async (input: any) => { told.mail.push(input); return realMail(input); };
});
afterAll(async () => { await t.close(); });

const reset = () => { told.notify.length = 0; told.mail.length = 0; };
const openKeys = async () => (await t.db.query<{ key: string }>('select key from ops_alerts where cleared_at is null order by key')).map((r) => r.key);
const watch = () => t.app.opsState.watch;
const dead = (type: string, minutesAgo = 1) => t.db.one<{ id: string }>(
  `insert into jobs (type, status, attempts, max_attempts, finished_at, last_error) values ($1, 'dead', 3, 3, now() - make_interval(mins => $2::int), 'an invented failure') returning id`,
  [type, minutesAgo]);
const done = (type: string) => t.db.query(`insert into jobs (type, status, attempts, finished_at) values ($1, 'done', 1, now())`, [type]);

describe('alerts when background work keeps failing (E40-04)', () => {
  it('tells the administrators once per problem, in the application and by email, until it clears', async () => {
    reset();
    await dead('test.reports');
    let r = await watch().check();
    expect(r.told).toEqual(['job.dead:test.reports']);
    expect(told.notify).toEqual([expect.objectContaining({ permission: 'admin.administer', title: 'Background job test.reports gave up', route: '/admin/jobs' })]);
    expect(told.mail).toEqual([expect.objectContaining({ permission: 'admin.administer', template: 'message', purpose: 'alerts' })]);
    expect(told.mail[0].data.subject).toBe('Background job test.reports gave up');
    // No personal data and no error text in what is sent: where to look instead.
    expect(JSON.stringify([told.notify, told.mail])).not.toContain('an invented failure');

    // Seen again: not told again.
    reset();
    await dead('test.reports');
    r = await watch().check();
    expect(r.open).toContain('job.dead:test.reports');
    expect(r.told).toEqual([]);
    expect(told.notify).toEqual([]);

    // A later run that finished clears it; the problem coming back is told again.
    await done('test.reports');
    r = await watch().check();
    expect(r.cleared).toEqual(['job.dead:test.reports']);
    expect(await openKeys()).toEqual([]);
    await dead('test.reports', 0);
    await t.db.query(`update jobs set finished_at = now() + interval '1 second' where type = 'test.reports' and status = 'dead' and finished_at > now() - interval '1 minute'`);
    reset();
    r = await watch().check();
    expect(r.told).toEqual(['job.dead:test.reports']);
    expect((await t.db.one<any>(`select occurrences from ops_alerts where key = 'job.dead:test.reports'`)).occurrences).toBe(2);
    const audit = await t.db.query<{ action: string }>(`select action from audit_events where record_type = 'ops_alert' order by id`);
    expect(audit.map((a) => a.action)).toEqual(['ops.alert', 'ops.alert_clear', 'ops.alert']);
    await t.db.query(`insert into jobs (type, status, attempts, finished_at) values ('test.reports', 'done', 1, now() + interval '5 seconds')`);
    await watch().check();
    expect(await openKeys()).toEqual([]);
  });

  it('says plainly when the safety notification clock check gives up', async () => {
    reset();
    await dead('safety.clocks');
    await watch().check();
    expect(told.notify[0].title).toBe('The safety notification clock check has stopped: deadline alerts may be missed');
    await done('safety.clocks');
    await watch().check();
  });

  it('watches email, webhooks and audit-log forwarders that keep failing', async () => {
    reset();
    // Email: on, and the last three messages failed.
    await t.db.query(`update mail_config set enabled = true where id = 1`);
    if (!(await t.db.one('select 1 from mail_config where id = 1'))) {
      await t.db.query(`insert into mail_config (id, enabled) values (1, true)`);
    }
    for (let i = 0; i < 3; i++) {
      await t.db.query(`insert into mail_log (purpose, to_address, status, created_at) values ('notification', 'someone@example.invalid', 'dead', now() - make_interval(secs => $1::int))`, [10 - i]);
    }
    expect(await watch().mailState()).toBe('failing');
    // A webhook whose latest delivery failed for good.
    const hook = await t.db.one<{ id: string }>(`insert into webhooks (name, url, secret, events) values ('Invented receiver', 'https://receiver.example.invalid/x', 's', '["*"]') returning id`);
    await t.db.query(`insert into webhook_deliveries (webhook_id, event, payload, status, attempts, last_attempt_at) values ($1, 'ticket.create', '{}', 'failed', 6, now())`, [hook!.id]);
    let forwarder: { id: string } | undefined;
    const hasForwarders = Boolean((await t.db.one<{ t: string | null }>(`select to_regclass('audit_forwarders')::text as t`))?.t);
    if (hasForwarders) {
      forwarder = await t.db.one<{ id: string }>(`insert into audit_forwarders (name, kind, host, port, active, failures) values ('Invented collector', 'syslog_tcp', 'collector.example.invalid', 6514, true, 4) returning id`);
    }
    const r = await watch().check();
    expect(r.told).toEqual(expect.arrayContaining(['mail.failing', `webhook:${hook!.id}`, ...(forwarder ? [`forwarder:${forwarder.id}`] : [])]));
    expect(told.notify.map((n) => n.title)).toEqual(expect.arrayContaining(['Email is not being delivered', 'Webhook "Invented receiver" keeps failing']));
    // The alerts list for Background jobs.
    const listed = await t.api.get('/api/admin/jobs/alerts');
    expect(listed.status).toBe(200);
    expect(listed.body.alerts.map((a: any) => a.key)).toEqual(expect.arrayContaining(['mail.failing', `webhook:${hook!.id}`]));
    expect((await (await t.as('requester')).get('/api/admin/jobs/alerts')).status).toBe(403);

    // All three recover.
    await t.db.query(`insert into mail_log (purpose, to_address, status, created_at) values ('notification', 'someone@example.invalid', 'sent', now())`);
    await t.db.query(`insert into webhook_deliveries (webhook_id, event, payload, status, attempts, last_attempt_at) values ($1, 'ticket.create', '{}', 'delivered', 1, now() + interval '1 second')`, [hook!.id]);
    if (forwarder) await t.db.query(`update audit_forwarders set failures = 0 where id = $1`, [forwarder.id]);
    const after = await watch().check();
    expect(after.cleared).toEqual(expect.arrayContaining(['mail.failing', `webhook:${hook!.id}`]));
    expect(await openKeys()).toEqual([]);
    await t.db.query(`update mail_config set enabled = false where id = 1`);
  });

  it('notices a poller that has stopped, and a queue that nobody works through', async () => {
    const fake = (p: Partial<ReturnType<JobQueue['poller']>>) => ({
      ...t.app.jobs, poller: () => ({ started: true, intervalMs: 10_000, lastPollAt: null, startedAt: new Date(), ...p }),
    }) as JobQueue;
    expect(pollerStalled(fake({ lastPollAt: new Date() }))).toBe(false);
    expect(pollerStalled(fake({ lastPollAt: new Date(Date.now() - 10 * 60_000) }))).toBe(true);
    expect(pollerStalled(fake({ started: false }))).toBe(false);

    reset();
    const w = makeWatch(t.ctx, fake({ lastPollAt: new Date(Date.now() - 10 * 60_000) }), makeOpsAlerts(t.ctx));
    let r = await w.checkPoller();
    expect(r.told).toEqual([expect.stringMatching(/^jobs\.poller:/)]);
    expect(told.notify[0].title).toBe('A server process has stopped running background jobs');
    expect(await w.jobsState()).toBe('stalled');

    // Nothing has run for a while and a job has waited 20 minutes: no process works through the queue.
    await t.db.query(`update jobs set finished_at = now() - interval '1 hour' where finished_at > now() - interval '20 minutes'`);
    await t.db.query(`delete from jobs where status = 'running'`);
    await t.db.query(`insert into jobs (type, status, run_at) values ('test.waiting', 'queued', now() - interval '20 minutes')`);
    expect((await queueStalled(t.db)).stalled).toBe(true);
    const healthy = makeWatch(t.ctx, fake({ lastPollAt: new Date() }), makeOpsAlerts(t.ctx));
    // Another process that stopped: its alert stays while it is fresh.
    await t.db.query(`insert into ops_alerts (key, title, notified_at) values ('jobs.poller:otherhost:1', 'A server process has stopped running background jobs', now())`);
    r = await healthy.checkPoller();
    expect(r.told).toEqual(['jobs.stalled']);
    // This process polls again, so its own alert clears; the other process's stays for now.
    expect(r.cleared).toEqual([expect.stringMatching(/^jobs\.poller:/)]);
    expect(r.cleared).not.toContain('jobs.poller:otherhost:1');
    expect(await healthy.jobsState()).toBe('behind');
    // Work again, and the other process's alert not seen for ten minutes: everything clears.
    await t.db.query(`delete from jobs where type = 'test.waiting'`);
    await t.db.query(`update ops_alerts set last_seen_at = now() - interval '11 minutes' where key = 'jobs.poller:otherhost:1'`);
    r = await healthy.checkPoller();
    expect(r.cleared).toEqual(expect.arrayContaining(['jobs.stalled', 'jobs.poller:otherhost:1']));
    expect(await openKeys()).toEqual([]);
  });
});

describe('/api/ready reports the job queue and email (E40-04)', () => {
  it('names each in one word and stays 200 when only the installation needs attention', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    // Under tests the poller does not run in this process: "off".
    expect(res.json()).toEqual({ ok: true, database: 'ok', jobs: 'off', mail: 'off' });
  });
});

describe('operational metrics endpoint (E40-04)', () => {
  const TOKEN = 'an-invented-metrics-token-for-tests-0123456789';
  afterAll(() => { delete process.env.GRC_METRICS_TOKEN; });

  it('is off until a token is set, then needs exactly that token', async () => {
    delete process.env.GRC_METRICS_TOKEN;
    expect((await t.app.inject({ method: 'GET', url: '/api/ops/metrics' })).statusCode).toBe(404);
    process.env.GRC_METRICS_TOKEN = 'too-short';
    expect((await t.app.inject({ method: 'GET', url: '/api/ops/metrics', headers: { authorization: 'Bearer too-short' } })).statusCode).toBe(404);
    process.env.GRC_METRICS_TOKEN = TOKEN;
    expect((await t.app.inject({ method: 'GET', url: '/api/ops/metrics' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/ops/metrics', headers: { authorization: `Bearer ${TOKEN}x` } })).statusCode).toBe(401);
    // A signed-in administrator's session is not enough either.
    expect((await t.api.get('/api/ops/metrics')).status).toBe(401);
    const ok = await t.app.inject({ method: 'GET', url: '/api/v1/ops/metrics', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    for (const name of ['grc_build_info', 'grc_http_requests_total', 'grc_http_request_duration_seconds_bucket', 'grc_jobs{status="queued"}', 'grc_jobs_oldest_due_seconds', 'grc_ops_alerts_open', 'grc_process_resident_memory_bytes']) {
      expect(ok.body).toContain(name);
    }
    expect(ok.body).toMatch(/grc_http_requests_total\{method="GET",status="4xx"\} \d+/);
  });

  it('holds no personal data', async () => {
    await t.db.query(`insert into mail_log (purpose, to_address, subject, status) values ('notification', 'private.person@example.invalid', 'A private subject', 'sent')`);
    const text = await metricsText(t.app, t.db, t.app.jobs, t.app.opsState.watch);
    const users = await t.db.query<{ username: string; email: string | null; display_name: string }>('select username, email, display_name from users');
    for (const u of users) {
      for (const v of [u.username, u.email, u.display_name].filter(Boolean)) expect(text).not.toContain(v);
    }
    expect(text).not.toContain('private.person');
    expect(text).not.toContain('A private subject');
    // Every line is a comment or `name{labels} number`.
    for (const line of text.trim().split('\n')) expect(line).toMatch(/^(# (HELP|TYPE) .+|[a-z_]+(\{[^}]*\})? -?[0-9.e+]+)$/);
  });
});

describe('cleaning up expired sessions and one-time links (E40-07)', () => {
  it('removes expired sessions and used or expired links daily, and keeps the rest', async () => {
    const me = (await t.db.one<{ id: string }>(`select id from users order by created_at limit 1`))!.id;
    await t.db.query(
      `insert into sessions (token_hash, user_id, expires_at) values ('invented-expired', $1, now() - interval '1 minute'), ('invented-live', $1, now() + interval '1 day')`, [me]);
    await t.db.query(
      `insert into one_time_tokens (token_hash, user_id, purpose, expires_at, used_at) values
         ('invented-used', $1, 'reset', now() + interval '1 day', now()),
         ('invented-old', $1, 'reset', now() - interval '1 minute', null),
         ('invented-open', $1, 'reset', now() + interval '1 day', null)`, [me]);
    const sched = await t.db.one<any>(`select every_seconds from job_schedules where name = 'core.session_cleanup'`);
    expect(sched.every_seconds).toBe(86_400);
    const r = await cleanupSessions(t.db);
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect(r.links).toBeGreaterThanOrEqual(2);
    const left = await t.db.query<{ token_hash: string }>(`select token_hash from sessions where token_hash like 'invented-%' union all select token_hash from one_time_tokens where token_hash like 'invented-%' order by 1`);
    expect(left.map((x) => x.token_hash)).toEqual(['invented-live', 'invented-open']);
    // The signed-in administrator's own session survives, and the API still answers.
    expect((await t.api.get('/api/auth/state')).body.user).toBeTruthy();
  });

  it('finds a person\'s sessions by index, so the users list does not read every session', async () => {
    const plan = await t.db.tx(async (tx) => {
      await tx.query('set local enable_seqscan = off');
      return tx.query<Record<string, string>>(
        `explain select count(*) from sessions s where s.user_id = '00000000-0000-0000-0000-000000000001' and s.expires_at > now()`);
    });
    const text = plan.map((p) => Object.values(p)[0]).join('\n');
    expect(text).toMatch(/sessions_user_ix/);
    expect(text).not.toMatch(/Seq Scan/);
  });
});
