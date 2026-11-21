import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { ensureMail } from './index.ts';
import { createServer, type AddressInfo } from 'node:net';
import { MAIL_BREAKER_DEFAULTS, makeMailBreaker } from './breaker.ts';
import { SMTP_TIMEOUTS, smtpRetryAfter } from './provider.ts';
import { startSmtpSink, type SmtpSink } from './smtp-sink.ts';

// Starts mail without relying on any module, and adds two invented record types:
// an open one and a restricted one.
const fixtures: ModuleDef = {
  key: 'testmail',
  async seedDefaults(ctx) {
    await ensureMail(ctx);
    await ctx.db.exec(`
      create table if not exists test_m_open (id uuid primary key default gen_random_uuid(), name text not null,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_m_secret (id uuid primary key default gen_random_uuid(), name text not null,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'm_open', table: 'test_m_open', module: 'tickets', label: 'Open thing', plural: 'Open things',
      path: '/api/m-open', route: '/m-open', titleField: 'name', fields: { name: { label: 'Name', type: 'text', required: true } },
    });
    ctx.defineResource({
      type: 'm_secret', table: 'test_m_secret', module: 'tickets', label: 'Secret thing', plural: 'Secret things',
      path: '/api/m-secret', route: '/m-secret', titleField: 'name', restricted: true, fields: { name: { label: 'Name', type: 'text', required: true } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;
const AUTH = { user: 'mailer', pass: 'sink password 1' };

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  sink = await startSmtpSink({ auth: AUTH });
});
afterAll(async () => {
  await t.close();
  await sink.close();
});

const settings = (patch: Record<string, unknown>) => t.api.put('/api/admin/mail/settings', patch);
const goodSettings = () => ({
  host: '127.0.0.1', port: sink.port, tlsMode: 'none', username: AUTH.user, password: AUTH.pass,
  fromAddress: 'grc@example.test', fromName: 'Sandpiper', replyTo: 'service-desk@example.test', baseUrl: 'https://grc.example.test',
});
const log = (id: string) => t.db.one<any>('select * from mail_log where id = $1', [id]);
const jobOf = async (logId: string) => (await log(logId)).job_id as string;
const due = (jobId: string) => t.db.query(`update jobs set run_at = now() - interval '1 second' where id = $1`, [jobId]);
const run = () => t.app.jobs.runDue({ types: ['mail.send'] });

describe('email is off by default', () => {
  it('queues nothing and says so', async () => {
    const s = await t.api.get('/api/admin/mail/settings');
    expect(s.body).toMatchObject({ enabled: false, passwordSet: false, provider: 'smtp', providers: ['gmail', 'graph', 'smtp'] });
    const agent = await t.as('agent');
    expect(await t.app.sendMail({ userIds: [agent.userId], data: { subject: 'Hello', message: 'Hi' } })).toEqual({ queued: 0, skipped: 0, enabled: false, logIds: [] });
    expect(await t.app.mailEnabled()).toBe(false);
    expect((await t.anon.get('/api/auth/forgot-password')).body).toEqual({ available: false });
    expect((await t.db.query('select 1 from mail_log')).length).toBe(0);
    expect((await agent.get('/api/admin/mail/settings')).status).toBe(403);
  });
});

describe('settings', () => {
  it('needs a server, a from address and the application address to switch on, and keeps the password encrypted', async () => {
    const refused = await settings({ enabled: true });
    expect(refused.status).toBe(400);
    expect(Object.keys(refused.body.error.fields).sort()).toEqual(['baseUrl', 'fromAddress', 'host']);
    expect((await settings({ port: 70000, tlsMode: 'sometimes', fromAddress: 'nope', baseUrl: 'ftp://x' })).body.error.fields)
      .toMatchObject({ port: expect.any(String), tlsMode: expect.any(String), fromAddress: expect.any(String), baseUrl: expect.any(String) });

    const saved = await settings(goodSettings());
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ enabled: false, passwordSet: true, host: '127.0.0.1', tlsMode: 'none' });
    expect(JSON.stringify(saved.body)).not.toContain(AUTH.pass);
    const stored = await t.db.one<any>('select password_sealed from mail_config');
    expect(stored.password_sealed).toMatch(/^enc:v1:/);
    const audits = await t.db.query<any>(`select before, after from audit_events where action = 'mail.settings'`);
    expect(audits.length).toBe(1);
    expect(JSON.stringify(audits)).not.toContain(AUTH.pass);
  });
});

describe('test email', () => {
  it('sends over a plain connection with a sign-in, even before email is switched on', async () => {
    const before = sink.messages.length;
    const res = await t.api.post('/api/admin/mail/test', { to: 'checker@example.test' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'sent', to_address: 'checker@example.test', purpose: 'test', attempts: 1 });
    const m = sink.messages[before];
    expect(m.user).toBe(AUTH.user);
    expect(m.to).toEqual(['checker@example.test']);
    expect(m.from).toBe('grc@example.test');
    expect(m.subject).toBe('Test message from Sandpiper GRC');
    expect(m.body).toContain(`sent by ${ADMIN.displayName}`);
    expect(m.body).toContain('https://grc.example.test/');
    expect(m.raw).toMatch(/Reply-To: service-desk@example.test/i);
    expect(m.raw).toContain('text/html');
  });

  it('records a refused password as a failure that is not retried', async () => {
    await settings({ password: 'wrong password here' });
    const res = await t.api.post('/api/admin/mail/test', { to: 'checker@example.test' });
    expect(res.body.status).toBe('dead');
    expect(res.body.error).toMatch(/refused the user name or password/);
    expect((await t.db.one<any>('select status from jobs where id = $1', [res.body.job_id])).status).toBe('dead');
    await settings({ password: AUTH.pass });
  });
});

describe('sending through the queue', () => {
  it('waits as long as a busy SMTP server says before trying again (E14-30)', async () => {
    await settings({ ...goodSettings(), enabled: true });
    sink.refuseNext(1, 421, '4.7.0 Too many messages, try again in 3 minutes');
    const res = await t.app.sendMail({ to: 'outside@example.test', data: { subject: 'Busy', message: 'x' } });
    await run();
    const row = await log(res.logIds[0]);
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    const job = await t.db.one<any>('select run_at from jobs where id = $1', [row.job_id]);
    const wait = (new Date(job.run_at).getTime() - Date.now()) / 1000;
    expect(wait).toBeGreaterThan(170);
    expect(wait).toBeLessThan(181);
    await due(row.job_id);
    await run();
    expect(await log(res.logIds[0])).toMatchObject({ status: 'sent', attempts: 2 });
    expect(smtpRetryAfter('451 4.3.0 Try again later')).toBeNull();
    expect(smtpRetryAfter('450 4.2.1 Rate limited: retry after 90 seconds')).toBe(90);
    expect(smtpRetryAfter('421 4.7.28 Please wait 2 hours')).toBe(7200);
  });

  it('retries a busy server and logs every attempt', async () => {
    await settings({ enabled: true });
    const agent = await t.as('agent');
    sink.refuseNext(1, 451);
    const before = sink.messages.length;
    const res = await t.app.sendMail({ userIds: [agent.userId], purpose: 'reports', data: { subject: 'Monthly report', message: 'It is ready.', link: '/reports' } });
    expect(res).toMatchObject({ queued: 1, enabled: true });
    await run();
    expect(await log(res.logIds[0])).toMatchObject({ status: 'failed', attempts: 1, to_address: expect.stringMatching(/^agent\d+@example\.test$/) });
    expect((await log(res.logIds[0])).error).toMatch(/451/);
    expect((await t.db.one<any>('select status from jobs where id = $1', [await jobOf(res.logIds[0])])).status).toBe('failed');
    await due(await jobOf(res.logIds[0]));
    await run();
    expect(await log(res.logIds[0])).toMatchObject({ status: 'sent', attempts: 2, subject: 'Monthly report' });
    expect(sink.messages.length).toBe(before + 1);
    expect(sink.messages[before].body).toContain('https://grc.example.test/reports');

    // A permanent refusal (5xx) is not retried.
    sink.refuseNext(1, 550);
    const again = await t.app.sendMail({ userIds: [agent.userId], data: { subject: 'Second', message: 'x' } });
    await run();
    expect(await log(again.logIds[0])).toMatchObject({ status: 'dead', attempts: 1 });

    const listed = await t.api.get('/api/admin/mail/log?status=dead');
    expect(listed.body.rows.map((r: any) => r.id)).toContain(again.logIds[0]);
  });

  it('skips people with no address or who are no longer active, and checks them again when sending', async () => {
    const agent = await t.as('agent');
    const res = await t.app.sendMail({ userIds: [agent.userId, '00000000-0000-0000-0000-000000000000'], data: { subject: 'x', message: 'y' } });
    expect(res).toMatchObject({ queued: 1, skipped: 1 });
    await t.db.query(`update users set status = 'disabled' where id = $1`, [agent.userId]);
    await run();
    expect(await log(res.logIds[0])).toMatchObject({ status: 'skipped' });
  });

  it('never describes a restricted record: content-free for those who may see it, nothing for others', async () => {
    const lead = await t.as('security_lead');
    const agent = await t.as('agent');
    const secret = (await t.api.post('/api/m-secret', { name: 'Zebra breach at the depot' })).body.id;
    const open = (await t.api.post('/api/m-open', { name: 'Open thing' })).body.id;
    const before = sink.messages.length;
    const res = await t.app.sendMail({
      userIds: [lead.userId, agent.userId], to: ['outside@example.test'], template: 'notification',
      data: { title: 'Zebra breach at the depot', body: 'Zebra details', link: `/m-secret/${secret}` },
      record: { type: 'm_secret', id: secret }, attachments: [{ filename: 'zebra.txt', contentBase64: Buffer.from('zebra').toString('base64') }],
    });
    // The outside address is never queued for a restricted record.
    expect(res.queued).toBe(2);
    await run();
    const logs = await Promise.all(res.logIds.map(log));
    const forLead = logs.find((l) => l.user_id === lead.userId);
    const forAgent = logs.find((l) => l.user_id === agent.userId);
    expect(forLead).toMatchObject({ status: 'sent', error: null });
    expect(forAgent.status).toBe('skipped');
    const m = sink.messages[before];
    expect(sink.messages.length).toBe(before + 1);
    expect(m.subject).toBe('New security notification in Sandpiper GRC');
    expect(m.body).toContain('You have a new security notification — open the application to view it');
    expect(m.raw).not.toMatch(/zebra/i);
    expect(m.body).not.toMatch(/zebra/i);
    expect(m.body).toContain('https://grc.example.test/notifications');

    // An open record is described, with its link.
    const ok = await t.app.sendMail({ userIds: [agent.userId], template: 'notification', data: { title: 'Open <b>thing</b> & co', link: `/m-open/${open}` }, record: { type: 'm_open', id: open } });
    await run();
    expect((await log(ok.logIds[0])).status).toBe('sent');
    const m2 = sink.messages.at(-1)!;
    expect(m2.subject).toBe('Open <b>thing</b> & co');
    expect(m2.body).toContain('Open &lt;b&gt;thing&lt;/b&gt; &amp; co'); // escaped in the HTML part
    expect(m2.body).toContain(`https://grc.example.test/m-open/${open}`);
  });

  it('accepts the plain shape { to, subject, text, attachments } and treats a user\'s address as that user', async () => {
    const agent = await t.as('agent');
    const email = (await t.db.one<any>('select email from users where id = $1', [agent.userId]))!.email;
    const res = await t.app.sendMail({
      to: email.toUpperCase(), subject: 'Monthly fares report', text: 'Your report is ready.', link: '/reports',
      attachments: [{ filename: 'fares.csv', content: Buffer.from('route,riders\n12,340'), contentType: 'text/csv' }], purpose: 'reports',
    });
    expect(res).toMatchObject({ queued: 1, enabled: true });
    expect((await log(res.logIds[0])).user_id).toBe(agent.userId);
    await run();
    const m = sink.messages.at(-1)!;
    expect(m.subject).toBe('Monthly fares report');
    expect(m.body).toContain('Your report is ready.');
    expect(m.raw).toContain('filename=fares.csv');
    expect(m.body).toContain('route,riders');
  });

  it('stops sending when email is switched off', async () => {
    const agent = await t.as('agent');
    const res = await t.app.sendMail({ userIds: [agent.userId], data: { subject: 'x', message: 'y' } });
    await settings({ enabled: false });
    await run();
    expect(await log(res.logIds[0])).toMatchObject({ status: 'dead', error: expect.stringMatching(/switched off/) });
    await settings({ enabled: true });
  });
});

describe('templates', () => {
  it('can be edited, are checked, previewed and put back', async () => {
    const list = (await t.api.get('/api/admin/mail/templates')).body;
    expect(list.map((x: any) => x.key)).toEqual(['test', 'notification', 'notification_restricted', 'digest', 'setup_link', 'reset_link', 'message', 'text_message', 'vendor_response_link', 'vendor_response_reminder']);
    const n = list.find((x: any) => x.key === 'notification');
    expect(n.placeholders).toContain('title');
    expect(n.html).toContain('<a href="{{link}}">');

    const bad = await t.api.put('/api/admin/mail/templates/notification', { subject: '{{nonsense}}', text: 'x', html: '<script>alert(1)</script>' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.subject).toMatch(/Unknown placeholder/);
    expect(bad.body.error.fields.html).toMatch(/<script> is not allowed/);
    expect((await t.api.put('/api/admin/mail/templates/notification', { subject: 'x', text: 'y', html: '<a href="javascript:alert(1)">x</a>' })).body.error.fields.html).toMatch(/link may point only/);
    expect((await t.api.put('/api/admin/mail/templates/notification', { subject: 'x', text: 'y', html: '<p onclick="x()">x</p>' })).body.error.fields.html).toMatch(/attribute/);
    expect((await t.api.put('/api/admin/mail/templates/notification_restricted', { subject: 'x', text: '{{title}}', html: '' })).status).toBe(400);

    const saved = await t.api.put('/api/admin/mail/templates/test', { subject: 'Hello from {{appName}}', text: 'Plain {{senderName}}', html: '<p><strong>{{senderName}}</strong></p>' });
    expect(saved.body).toMatchObject({ customised: true, subject: 'Hello from {{appName}}' });
    const preview = await t.api.post('/api/admin/mail/templates/test/preview', { subject: 'Hi {{recipientName}}', text: 'T', html: '<p>{{senderName}}</p>' });
    expect(preview.body.subject).toBe('Hi Alex Example');
    expect(preview.body.html).toContain('<p>Sam Administrator</p>');
    await t.api.post('/api/admin/mail/test', { to: 'checker@example.test' });
    expect(sink.messages.at(-1)!.subject).toBe('Hello from Sandpiper GRC');

    const reset = await t.api.post('/api/admin/mail/templates/test/reset');
    expect(reset.body).toMatchObject({ customised: false, subject: 'Test message from {{appName}}' });
    expect((await t.db.query(`select 1 from audit_events where action = 'mail.template'`)).length).toBe(2);
  });
});

describe('forgotten password', () => {
  it('answers the same whether or not the account exists, and emails a working link', async () => {
    const agent = await t.as('agent');
    const user = (await t.db.one<any>('select username, email from users where id = $1', [agent.userId]))!;
    const before = sink.messages.length;
    const unknown = await t.anon.post('/api/auth/forgot-password', { identifier: 'nobody-at-all' });
    const known = await t.anon.post('/api/auth/forgot-password', { identifier: user.email.toUpperCase() });
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    await run();
    expect(sink.messages.length).toBe(before + 1);
    const m = sink.messages.at(-1)!;
    expect(m.to).toEqual([user.email]);
    expect(m.subject).toBe('Reset your password for Sandpiper GRC');
    const token = /https:\/\/grc\.example\.test\/redeem\?token=([A-Za-z0-9_-]+)/.exec(m.body)?.[1];
    expect(token).toBeTruthy();
    // The link is never kept readable: not in the job, not in the delivery log, not on the jobs page.
    const stored = await t.db.query<{ p: string }>(`select payload::text as p from jobs where type = 'mail.send'`);
    expect(stored.some((r) => r.p.includes(token!))).toBe(false);
    expect(JSON.stringify((await t.db.query('select * from mail_log')))).not.toContain(token);
    const jobId = (await t.db.one<any>(`select job_id from mail_log where purpose = 'reset_link' order by created_at desc limit 1`)).job_id;
    const shown = await t.api.get(`/api/admin/jobs/${jobId}`);
    expect(shown.body.payload.sealedLink).toBe('(encrypted)');
    expect(JSON.stringify(shown.body)).not.toContain(token);
    const { sha256 } = await import('../auth.ts');
    expect(await t.db.one('select purpose, user_id from one_time_tokens where token_hash = $1 and used_at is null', [sha256(token!)]))
      .toEqual({ purpose: 'reset', user_id: agent.userId });
    if (t.modules.some((x) => x.key === 'admin')) { // the admin module redeems links
      expect((await t.anon.get(`/api/auth/redeem?token=${token}`)).body).toMatchObject({ valid: true, purpose: 'reset', username: user.username });
      expect((await t.anon.post('/api/auth/redeem', { token, password: 'a brand new passphrase 7' })).status).toBe(200);
      expect((await t.anon.post('/api/auth/login', { username: user.username, password: 'a brand new passphrase 7' })).status).toBe(200);
    }
    expect((await t.db.query(`select 1 from audit_events where action = 'password.reset_request'`)).length).toBe(2);
  });

  it('is rate-limited by source address and by account', async () => {
    await t.db.query('delete from rate_limit_hits');
    const agent = await t.as('agent');
    const email = (await t.db.one<any>('select email from users where id = $1', [agent.userId]))!.email;
    const before = (await t.db.query(`select 1 from mail_log where purpose = 'reset_link' and user_id = $1`, [agent.userId])).length;
    for (let i = 0; i < 5; i += 1) expect((await t.anon.post('/api/auth/forgot-password', { identifier: email })).status).toBe(200);
    expect((await t.anon.post('/api/auth/forgot-password', { identifier: email })).status).toBe(429);
    // Only three links an hour for one account, however the requests arrive.
    const sent = (await t.db.query(`select 1 from mail_log where purpose = 'reset_link' and user_id = $1`, [agent.userId])).length - before;
    expect(sent).toBe(3);
    await t.db.query('delete from rate_limit_hits');
  });

  it('emails the link an administrator issues, and still shows it to the administrator', async () => {
    if (!t.modules.some((m) => m.key === 'admin')) return; // the admin module issues these links
    await t.db.query('delete from rate_limit_hits');
    const made = await t.api.post('/api/admin/users', { username: 'new.starter', email: 'new.starter@example.test', displayName: 'New Starter', roles: [] });
    expect(made.status).toBe(201);
    expect(made.body.setupLink).toMatch(/^\/redeem\?token=/);
    expect(made.body.emailedTo).toBe('new.starter@example.test');
    await run();
    expect(await t.db.one(`select status, error from mail_log where purpose = 'setup_link' order by created_at desc limit 1`)).toEqual({ status: 'sent', error: null });
    const m = sink.messages.at(-1)!;
    expect(m.subject).toBe('Set your password for Sandpiper GRC');
    expect(m.body).toContain(`https://grc.example.test${made.body.setupLink}`);
    expect(m.body).toContain('new.starter');

    await settings({ enabled: false });
    const again = await t.api.post(`/api/admin/users/${made.body.user.id}/setup-link`);
    expect(again.body.link).toMatch(/^\/redeem\?token=/);
    expect(again.body).not.toHaveProperty('emailedTo');
    await settings({ enabled: true });
  });
});

// OP-09: an unreachable mail server cost every message a full time-out, one after another, on
// the only job queue. Now: a shorter connect time-out, a pause after a few failures in a row
// (the waiting messages keep their attempts), and mail in its own lane of the queue.
describe('an unreachable mail server', () => {
  it('pauses sending after a few connection failures, without using up the waiting messages\' attempts', async () => {
    expect(SMTP_TIMEOUTS.connection).toBeLessThanOrEqual(5000);
    // A port nobody listens on: every connection is refused at once.
    const closed = await new Promise<number>((resolve) => {
      const srv = createServer();
      srv.listen(0, '127.0.0.1', () => { const port = (srv.address() as AddressInfo).port; srv.close(() => resolve(port)); });
    });
    await settings({ ...goodSettings(), port: closed, enabled: true });
    const sent = await Promise.all([1, 2, 3, 4, 5].map((n) => t.app.sendMail({ to: `down${n}@example.test`, data: { subject: `Down ${n}`, message: 'x' } })));
    const ids = sent.map((s) => s.logIds[0]);
    const started = Date.now();
    await run();
    expect(Date.now() - started).toBeLessThan(30_000);
    const rows = await Promise.all(ids.map(log));
    const tried = rows.filter((r) => /Could not reach/.test(r.error ?? ''));
    const waiting = rows.filter((r) => /^Waiting: the mail server could not be reached/.test(r.error ?? ''));
    expect(tried).toHaveLength(MAIL_BREAKER_DEFAULTS.threshold);
    expect(waiting).toHaveLength(5 - MAIL_BREAKER_DEFAULTS.threshold);
    for (const r of waiting) {
      const job = await t.db.one<any>('select status, attempts, run_at from jobs where id = $1', [r.job_id]);
      expect(job).toMatchObject({ status: 'queued', attempts: 0 });
      expect(new Date(job.run_at).getTime() - Date.now()).toBeGreaterThan(60_000);
    }
    // Another server (the settings fixed) is not paused.
    await settings({ ...goodSettings(), enabled: true });
    const ok = await t.app.sendMail({ to: 'up@example.test', data: { subject: 'Up again', message: 'x' } });
    await run();
    expect(await log(ok.logIds[0])).toMatchObject({ status: 'sent' });
    await t.db.query(`delete from jobs where id = any($1::uuid[])`, [rows.map((r) => r.job_id)]);
  });

  it('pauses after the threshold and starts over after a success', () => {
    const b = makeMailBreaker({ threshold: 2, pauseMs: 60_000 });
    expect(b.failure('k', 0)).toBeNull();
    expect(b.pausedUntil('k', 0)).toBeNull();
    expect(b.failure('k', 0)?.getTime()).toBe(60_000);
    expect(b.pausedUntil('k', 59_999)?.getTime()).toBe(60_000);
    expect(b.pausedUntil('k', 60_000)).toBeNull(); // one message may try again
    expect(b.failure('k', 60_000)?.getTime()).toBe(120_000); // still down: paused again
    b.success('k');
    expect(b.pausedUntil('k', 60_001)).toBeNull();
    expect(b.failure('k', 70_000)).toBeNull();
  });
});
