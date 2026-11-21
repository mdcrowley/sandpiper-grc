import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import { testApp } from '../../test/helpers.ts';

// Invented record types: one open (flag-restricted rows possible) and one wholly restricted.
const fixtures: ModuleDef = {
  key: 'testnotifymail',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_ne_things (
        id uuid primary key default gen_random_uuid(), name text not null, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_ne_secrets (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'ne_thing', table: 'test_ne_things', module: 'tickets', label: 'Thing', plural: 'Things', path: '/api/ne-things', route: '/ne-things',
      titleField: 'name', restricted: 'flag',
      fields: { name: { label: 'Name', type: 'text', required: true }, restricted: { label: 'Restricted', type: 'boolean', default: false } },
    });
    ctx.defineResource({
      type: 'ne_secret', table: 'test_ne_secrets', module: 'tickets', label: 'Secret', plural: 'Secrets', path: '/api/ne-secrets', route: '/ne-secrets',
      titleField: 'title', restricted: true, fields: { title: { label: 'Title', type: 'text', required: true } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  sink = await startSmtpSink();
});
afterAll(async () => {
  await t.close();
  await sink.close();
});

type Client = Awaited<ReturnType<typeof t.as>>;
const prefs = (c: Client, body: unknown) => c.patch('/api/notifications/preferences', body);
const listTitles = async (c: Client) => (await c.get('/api/notifications?pageSize=100')).body.rows.map((r: any) => r.title);
const runMail = () => t.app.jobs.runDue({ types: ['mail.send'] });
const switchOn = () => t.api.put('/api/admin/mail/settings', {
  enabled: true, host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test',
});

describe('notifications by email', () => {
  it('offers a channel for each kind, and falls back to the bell while email is off', async () => {
    const agent = await t.as('agent');
    const p = (await agent.get('/api/notifications/preferences')).body;
    expect(p.emailAvailable).toBe(false);
    expect(p.kinds.every((k: any) => k.channel === 'app' && k.enabled)).toBe(true);
    expect(p.emailAddress).toMatch(/@example\.test$/);

    const bad = await prefs(agent, { channels: { assignment: 'pigeon', nonsense: 'app' } });
    expect(bad.status).toBe(400);
    expect((await prefs(agent, { channels: { assignment: 'pigeon' } })).body.error.fields.channels).toMatch(/app, email, both or none/);

    const saved = await prefs(agent, { channels: { assignment: 'email', reminder: 'none' } });
    expect(saved.body.kinds.find((k: any) => k.value === 'assignment')).toMatchObject({ channel: 'email', enabled: true });
    expect(saved.body.kinds.find((k: any) => k.value === 'reminder')).toMatchObject({ channel: 'none', enabled: false });
    // The older on/off switch still works, and "none" is an ordinary mute.
    expect((await t.app.notify({ userIds: [agent.userId], kind: 'reminder', title: 'Muted', route: '/' })).sent).toBe(0);

    // Email chosen but switched off: the bell gets it instead, so nothing is lost.
    await t.app.notify({ userIds: [agent.userId], kind: 'assignment', title: 'Fallback to the bell', route: '/' });
    expect(await listTitles(agent)).toContain('Fallback to the bell');
    expect((await t.db.one<any>(`select email_state, in_app from notifications where title = 'Fallback to the bell'`))).toEqual({ email_state: 'skipped', in_app: true });
    const audit = await t.db.query<any>(`select after from audit_events where action = 'notification.preferences' and record_id = $1`, [agent.userId]);
    expect(audit[0].after).toEqual({ muted: ['reminder'], dailyDigest: false, email: ['assignment:email'] });
  });

  it('emails each notification to people who chose email, with a link, and leaves the bell alone for "email only"', async () => {
    expect((await switchOn()).status).toBe(200);
    const both = await t.as('agent');
    const only = await t.as('agent');
    await prefs(both, { channels: { assignment: 'both' } });
    await prefs(only, { channels: { assignment: 'email' } });
    expect((await both.get('/api/notifications/preferences')).body.emailAvailable).toBe(true);
    const thing = (await t.api.post('/api/ne-things', { name: 'Depot gate controller' })).body.id;
    const before = sink.messages.length;
    const res = await t.app.notify({ userIds: [both.userId, only.userId], kind: 'assignment', title: 'Assigned to you: Depot gate controller', body: 'Priority high', recordType: 'ne_thing', recordId: thing });
    expect(res.sent).toBe(2);
    await runMail();
    const got = sink.messages.slice(before);
    expect(got.length).toBe(2);
    for (const m of got) {
      expect(m.subject).toBe('Assigned to you: Depot gate controller');
      expect(m.body).toContain('Priority high');
      expect(m.body).toContain(`https://grc.example.test/ne-things/${thing}`);
      expect(m.body).toContain('https://grc.example.test/notifications?tab=preferences');
      expect(m.body).toContain('Assigned to me');
    }
    expect(await listTitles(both)).toContain('Assigned to you: Depot gate controller');
    expect(await listTitles(only)).not.toContain('Assigned to you: Depot gate controller');
    expect((await only.get('/api/notifications/unread-count')).body.unread).toBe(0);
  });

  it('sends only a content-free message about a restricted record', async () => {
    const lead = await t.as('security_lead');
    await prefs(lead, { channels: { clock: 'both' } });
    const secret = (await t.api.post('/api/ne-secrets', { title: 'Zebra ransomware at the bus depot' })).body.id;
    const before = sink.messages.length;
    expect((await t.app.notify({ userIds: [lead.userId], kind: 'clock', title: 'Clock amber: Zebra ransomware at the bus depot', recordType: 'ne_secret', recordId: secret })).sent).toBe(1);
    await runMail();
    const m = sink.messages[before];
    expect(sink.messages.length).toBe(before + 1);
    expect(m.subject).toBe('New security notification in Sandpiper GRC');
    expect(m.body).toContain('You have a new security notification — open the application to view it');
    expect(m.raw).not.toMatch(/zebra|ransomware/i);
    expect(m.body).not.toMatch(/zebra|ransomware/i);
    expect(m.body).not.toContain(secret);

    // A record restricted after the notification was raised is treated the same way when the message is sent.
    await prefs(lead, { channels: { assignment: 'email' } });
    const thing = (await t.api.post('/api/ne-things', { name: 'Zebra later restricted' })).body.id;
    await t.app.notify({ userIds: [lead.userId], kind: 'assignment', title: 'Zebra later restricted', recordType: 'ne_thing', recordId: thing });
    await t.api.patch(`/api/ne-things/${thing}`, { restricted: true });
    await runMail();
    expect(sink.messages.at(-1)!.body).not.toMatch(/zebra/i);
  });

  it('collects notifications into one daily summary for people who chose it', async () => {
    const agent = await t.as('agent');
    await prefs(agent, { channels: { assignment: 'both', due: 'email' }, dailyDigest: true });
    await t.api.put('/api/admin/mail/settings', { enabled: true });
    await t.ctx.settings.set('notifications.digest_hour', 0);
    const a = (await t.api.post('/api/ne-things', { name: 'Ticket printer' })).body.id;
    const gone = (await t.api.post('/api/ne-things', { name: 'Zebra soon hidden' })).body.id;
    const before = sink.messages.length;
    await t.app.notify({ userIds: [agent.userId], kind: 'assignment', title: 'Assigned: Ticket printer', recordType: 'ne_thing', recordId: a });
    await t.app.notify({ userIds: [agent.userId], kind: 'due', title: 'Due soon: timetable review', route: '/actions' });
    await t.app.notify({ userIds: [agent.userId], kind: 'assignment', title: 'Assigned: Zebra soon hidden', recordType: 'ne_thing', recordId: gone });
    await runMail();
    expect(sink.messages.length).toBe(before); // nothing yet: they wait for the summary
    // The agent loses sight of one record before the summary goes.
    await t.api.patch(`/api/ne-things/${gone}`, { restricted: true });

    expect((await t.as('agent').then((c) => c.post('/api/notifications/email-digest/run'))).status).toBe(403);
    const first = await t.api.post('/api/notifications/email-digest/run');
    expect(first.body).toMatchObject({ messages: 1, items: 2 });
    await runMail();
    expect(sink.messages.length).toBe(before + 1);
    const m = sink.messages.at(-1)!;
    expect(m.subject).toBe('Your daily summary from Sandpiper GRC: 2 new');
    expect(m.body).toContain('Assigned: Ticket printer');
    expect(m.body).toContain('Due soon: timetable review');
    expect(m.body).toContain(`https://grc.example.test/ne-things/${a}`);
    expect(m.body).not.toMatch(/zebra/i);

    // Once a day, however often it runs.
    await t.app.notify({ userIds: [agent.userId], kind: 'assignment', title: 'Assigned later the same day', route: '/' });
    expect((await t.api.post('/api/notifications/email-digest/run')).body.messages).toBe(0);
    await t.db.query(`update notification_preferences set last_digest_on = current_date - 1 where user_id = $1`, [agent.userId]);
    expect((await t.api.post('/api/notifications/email-digest/run')).body).toMatchObject({ messages: 1, items: 1 });
  });

  it('leaves notifications about a switched-off part out of the summary, and sends them once it is on again', async () => {
    const agent = await t.as('agent');
    await prefs(agent, { channels: { assignment: 'email', general: 'email' }, dailyDigest: true });
    await t.db.query(`update notification_preferences set last_digest_on = null where user_id = $1`, [agent.userId]);
    const vehicle = await t.ctx.resources.create('vehicle', { fleet_number: 'QUAIL-31', mode: (await t.ctx.lookups.values('vehicle_mode'))[0].value });
    await t.app.notify({ userIds: [agent.userId], kind: 'assignment', title: 'Assigned: vehicle QUAIL-31', recordType: 'vehicle', recordId: vehicle.id });
    await t.app.notify({ userIds: [agent.userId], kind: 'general', title: 'Inspection due: QUAIL-31', route: `/vehicles/${vehicle.id}` } as any);
    await t.app.notify({ userIds: [agent.userId], kind: 'general', title: 'Timetable review this week', route: '/actions' } as any);
    expect((await t.api.patch('/api/admin/features', { features: { fleet: false } })).status).toBe(200);
    try {
      expect((await t.api.post('/api/notifications/email-digest/run')).body).toMatchObject({ messages: 1, items: 1 });
      await runMail();
      const m = sink.messages.at(-1)!;
      expect(m.body).toContain('Timetable review this week');
      expect(m.raw).not.toMatch(/QUAIL|vehicle/i);
      // Kept, not dropped: they still wait for a summary.
      const waiting = await t.db.query<{ title: string }>(`select title from notifications where user_id = $1 and email_state = 'digest' order by title`, [agent.userId]);
      expect(waiting.map((r) => r.title)).toEqual(['Assigned: vehicle QUAIL-31', 'Inspection due: QUAIL-31']);
      // Nothing else waits for that person while the part is off: no message the next day.
      await t.db.query(`update notification_preferences set last_digest_on = current_date - 1 where user_id = $1`, [agent.userId]);
      expect((await t.api.post('/api/notifications/email-digest/run')).body).toMatchObject({ messages: 0 });
    } finally {
      expect((await t.api.patch('/api/admin/features', { features: { fleet: true } })).status).toBe(200);
    }
    await t.db.query(`update notification_preferences set last_digest_on = current_date - 1 where user_id = $1`, [agent.userId]);
    expect((await t.api.post('/api/notifications/email-digest/run')).body).toMatchObject({ messages: 1, items: 2 });
    await runMail();
    expect(sink.messages.at(-1)!.body).toContain('Inspection due: QUAIL-31');
  });

  it('lists a restricted record in the summary without naming it', async () => {
    const lead = await t.as('security_lead');
    await prefs(lead, { channels: { clock: 'email' }, dailyDigest: true });
    const secret = (await t.api.post('/api/ne-secrets', { title: 'Zebra phishing wave' })).body.id;
    await t.app.notify({ userIds: [lead.userId], kind: 'clock', title: 'Clock red: Zebra phishing wave', recordType: 'ne_secret', recordId: secret });
    await t.api.post('/api/notifications/email-digest/run');
    await runMail();
    const m = sink.messages.at(-1)!;
    expect(m.to[0]).toMatch(/^security_lead\d+@example\.test$/);
    expect(m.body).toContain('A new security notification — open the application to view it');
    expect(m.raw).not.toMatch(/zebra|phishing/i);
  });
});

describe('scheduled work on the queue', () => {
  it('runs the reminders and the summary from the job queue, not timers', async () => {
    const names = (await t.db.query<any>('select name from job_schedules order by name')).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['jobs.cleanup', 'notifications.email_digest', 'notifications.reminders']));
    const ran = await t.api.post('/api/admin/jobs/schedules/notifications.reminders/run');
    expect(ran.body).toMatchObject({ status: 'done', type: 'notifications.reminders' });
    expect(ran.body.result).toHaveProperty('actions');
  });
});
