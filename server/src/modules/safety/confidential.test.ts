import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { forgetConfidentialReporter } from './confidential.ts';

// E41-05: confidential safety reporting, and telling the reporter what was done. Invented people and
// events only. Needs safety, portal, notifications and the core (GRC_MODULES=safety,portal,notifications,risks or all).

let t: Awaited<ReturnType<typeof testApp>>;
let reporter: Awaited<ReturnType<typeof t.as>>;
let reporterName = '';
let safety: Awaited<ReturnType<typeof t.as>>;
let named: Awaited<ReturnType<typeof t.as>>;
let eventId = '';
let sink: SmtpSink | undefined;

const report = {
  title: 'Supervisor told me to skip the brake check', description: 'At the start of the early shift the brake check was skipped to leave on time.',
  event_type: 'unsafe_condition', harm: 'none', occurred_at: '2026-11-18T05:30:00Z', where: 'North depot, bay 4',
};

const history = async (id: string) => (await t.api.get(`/api/history?record_type=safety_event&record_id=${id}`)).body as Record<string, unknown>[];

beforeAll(async () => {
  t = await testApp();
  await t.api.patch('/api/admin/features', { features: { portal: true } });
  reporter = await t.as('requester');
  reporterName = (await t.db.one<{ display_name: string }>('select display_name from users where id = $1', [reporter.userId]))!.display_name;
  safety = await t.as('safety_manager');
  named = await t.as('safety_manager');
});
afterAll(async () => { await t.close(); await sink?.close(); });

describe('a confidential report from the portal', () => {
  it('keeps the reporter apart from the event', async () => {
    const made = await reporter.post('/api/portal/safety-reports', { ...report, confidential: true });
    expect(made.status).toBe(201);
    eventId = made.body.id;
    const event = (await safety.get(`/api/safety-events/${eventId}`)).body;
    expect(event).toMatchObject({ confidential_reporter: true, reported_by_id: null, created_by: null, status: 'reported' });
    expect(JSON.stringify(event)).not.toContain(reporter.userId);
    expect(JSON.stringify(event)).not.toContain(reporterName);
    expect(event.notes).toContain('confidential');
    // The history names the application, not the reporter.
    const h = await history(eventId);
    expect(h.find((e) => e.action === 'safety_event.create')?.actor_name).toBe('System');
    expect(JSON.stringify(h)).not.toContain(reporter.userId);
    expect(JSON.stringify(h)).not.toContain(reporterName);
    // The safety team's notification does not name them.
    const told = (await t.db.query<{ title: string; body: string | null }>(`select title, body from notifications where record_id = $1`, [eventId]));
    expect(told.length).toBeGreaterThan(0);
    for (const n of told) expect(`${n.title} ${n.body}`).not.toContain(reporterName);
  });

  it('is not found through exports, search or lists by the reporter', async () => {
    const csv = await t.api.get('/api/safety-events?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(report.title);
    expect(csv.text).not.toContain(reporterName);
    const byReporter = (await t.api.get(`/api/safety-events?f.reported_by_id=${reporter.userId}`)).body;
    expect(byReporter.total).toBe(0);
    const found = (await t.api.get(`/api/search?q=${encodeURIComponent(reporterName)}`)).body as { id: string }[];
    expect(found.some((r) => r.id === eventId)).toBe(false);
  });

  it('shows the reporter their own report', async () => {
    const mine = (await reporter.get('/api/portal/safety-reports')).body.rows;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: eventId, confidential: true, outcome: null, status: { key: 'received' } });
  });
});

describe('who may see a confidential reporter', () => {
  it('is nobody until people are named', async () => {
    const res = await safety.get(`/api/safety-events/${eventId}/reporter`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_named');
    expect((await t.api.get(`/api/safety-events/${eventId}/reporter`)).status).toBe(403);
    expect((await safety.get('/api/safety/confidential-viewers')).body).toMatchObject({ viewers: [], named: false, can_administer: true });
  });

  it('names only people who can see safety events, and is administered', async () => {
    // Naming someone needs a recent password confirmation.
    await t.db.query("update sessions set confirmed_at = now() - interval '1 day' where user_id = $1", [safety.userId]);
    expect((await safety.put('/api/safety/confidential-viewers', { viewers: [named.userId] })).body.error.code).toBe('reauth_required');
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    expect((await t.api.put('/api/safety/confidential-viewers', { viewers: [reporter.userId] })).body.error.fields.viewers).toMatch(/can see safety events/);
    expect((await t.api.put('/api/safety/confidential-viewers', { viewers: ['nope'] })).status).toBe(400);
    const saved = await t.api.put('/api/safety/confidential-viewers', { viewers: [named.userId] });
    expect(saved.status).toBe(200);
    expect(saved.body.viewers).toEqual([expect.objectContaining({ id: named.userId, eligible: true })]);
    expect((await named.get('/api/safety/confidential-viewers')).body).toMatchObject({ named: true, can_administer: true });
    const viewer = await t.as('executive_viewer');
    expect((await viewer.put('/api/safety/confidential-viewers', { viewers: [] })).status).toBe(403);
  });

  it('shows a named person who reported, and records every look', async () => {
    expect((await safety.get(`/api/safety-events/${eventId}/reporter`)).status).toBe(403);
    const seen = await named.get(`/api/safety-events/${eventId}/reporter`);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ confidential: true, reporter: { id: reporter.userId, name: reporterName } });
    await named.get(`/api/safety-events/${eventId}/reporter`);
    const looks = (await history(eventId)).filter((e) => e.action === 'safety_event.reporter_view');
    expect(looks).toHaveLength(2);
    // The history says who looked, never who reported.
    expect(JSON.stringify(looks)).not.toContain(reporterName);
    // An event whose reporter is not confidential has nothing to reveal.
    const open = await safety.post('/api/safety-events', { title: 'Open report', occurred_at: '2026-11-18T06:00:00Z', event_type: 'near_miss', severity: 'minor', reported_by_id: reporter.userId });
    expect((await safety.get(`/api/safety-events/${open.body.id}/reporter`)).body).toEqual({ confidential: false });
  });

  it('cannot be changed or worked around after the report is made', async () => {
    expect((await safety.patch(`/api/safety-events/${eventId}`, { confidential_reporter: false })).body.error.fields.confidential_reporter).toBeDefined();
    expect((await safety.patch(`/api/safety-events/${eventId}`, { reported_by_id: reporter.userId })).body.error.fields.reported_by_id).toBeDefined();
    const plain = await safety.post('/api/safety-events', { title: 'Plain', occurred_at: '2026-11-18T06:00:00Z', event_type: 'near_miss', severity: 'minor' });
    expect((await safety.patch(`/api/safety-events/${plain.body.id}`, { confidential_reporter: true })).status).toBe(400);
  });
});

describe('a confidential report entered by the safety team', () => {
  it('keeps someone else\'s identity apart, and refuses one\'s own', async () => {
    const own = await safety.post('/api/safety-events', { title: 'Mine', occurred_at: '2026-11-18T06:00:00Z', event_type: 'near_miss', severity: 'minor', reported_by_id: safety.userId, confidential_reporter: true });
    expect(own.body.error.fields.confidential_reporter).toMatch(/portal/);
    const phoned = await safety.post('/api/safety-events', { title: 'Phoned in', occurred_at: '2026-11-18T06:00:00Z', event_type: 'near_miss', severity: 'minor', reported_by_id: reporter.userId, confidential_reporter: true });
    expect(phoned.status).toBe(201);
    expect(phoned.body).toMatchObject({ reported_by_id: null, confidential_reporter: true });
    expect(JSON.stringify(await history(phoned.body.id))).not.toContain(reporter.userId);
    expect((await named.get(`/api/safety-events/${phoned.body.id}/reporter`)).body.reporter.id).toBe(reporter.userId);
    // An anonymous report: confidential, with nobody kept.
    const anon = await safety.post('/api/safety-events', { title: 'Note under the door', occurred_at: '2026-11-18T06:00:00Z', event_type: 'near_miss', severity: 'minor', confidential_reporter: true });
    expect((await named.get(`/api/safety-events/${anon.body.id}/reporter`)).body).toEqual({ confidential: true, reporter: null });
  });
});

describe('telling the reporter what was done', () => {
  it('needs the words before an event with a reporter closes, then tells them', async () => {
    const closing = { status: 'closed', root_cause: 'Timetable pressure on the early shift.' };
    const refused = await safety.patch(`/api/safety-events/${eventId}`, closing);
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.reporter_outcome).toBeDefined();
    const outcome = 'We added ten minutes to the early shift start so the brake check is never skipped, and briefed every supervisor.';
    // The reporter chose the bell and email for general notifications, and email is on (wave 23 A6).
    sink = await startSmtpSink();
    const mail = await t.api.put('/api/admin/mail/settings', {
      host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test', enabled: true,
    });
    expect(mail.status, JSON.stringify(mail.body)).toBe(200);
    await t.db.query(
      `insert into notification_preferences (user_id, muted_kinds, daily_digest, channels) values ($1, '[]'::jsonb, false, '{"general":"both"}'::jsonb)
       on conflict (user_id) do update set channels = excluded.channels, daily_digest = false`, [reporter.userId]);
    const closed = await safety.patch(`/api/safety-events/${eventId}`, { ...closing, reporter_outcome: outcome });
    expect(closed.status).toBe(200);
    expect(closed.body.reporter_told_at).toBeTruthy();
    // A confidential reporter's notification names neither the event nor what it was about.
    const mine = (await reporter.get('/api/notifications')).body.rows as { title: string; body: string; route: string }[];
    const told = mine.find((n) => n.title.includes('safety report'));
    expect(told).toMatchObject({ title: 'A safety report you made has been closed', route: '/portal/safety' });
    expect(`${told!.title} ${told!.body}`).not.toContain(report.title);
    // In the application only: no email, so the outgoing message log never names them (wave 23 A6).
    expect((await t.db.query('select 1 from mail_log where user_id = $1', [reporter.userId])).length).toBe(0);
    const reporterEmail = (await t.db.one<{ email: string }>('select email from users where id = $1', [reporter.userId]))!.email;
    expect((await t.db.query('select 1 from mail_log where lower(to_address) = lower($1)', [reporterEmail])).length).toBe(0);
    // The portal shows the words.
    const row = (await reporter.get('/api/portal/safety-reports')).body.rows.find((r: { id: string }) => r.id === eventId);
    expect(row).toMatchObject({ status: { key: 'closed' }, outcome });
    expect((await history(eventId)).some((e) => e.action === 'safety_event.reporter_told')).toBe(true);
  });

  it('tells a named reporter with the reference and the words', async () => {
    const made = await reporter.post('/api/portal/safety-reports', { ...report, title: 'Loose handrail at the north stairs' });
    const event = (await safety.get(`/api/safety-events/${made.body.id}`)).body;
    expect(event.reported_by_id).toBe(reporter.userId);
    await safety.patch(`/api/safety-events/${event.id}`, { status: 'closed', root_cause: 'Bolts worked loose.', reporter_outcome: 'The handrail was refixed the same day.' });
    const mine = (await reporter.get('/api/notifications')).body.rows as { title: string; body: string }[];
    expect(mine.find((n) => n.title === `Your safety report ${event.ref} is closed`)?.body).toBe('The handrail was refixed the same day.');
    // A named reporter gets the email they chose.
    expect((await t.db.query('select 1 from mail_log where user_id = $1', [reporter.userId])).length).toBe(1);
    // An event with no reporter closes without the words.
    const plain = await safety.post('/api/safety-events', { title: 'No reporter', occurred_at: '2026-11-18T06:00:00Z', event_type: 'near_miss', severity: 'minor' });
    const closed = await safety.patch(`/api/safety-events/${plain.body.id}`, { status: 'closed', root_cause: 'Nothing more to do.' });
    expect(closed.status).toBe(200);
    expect(closed.body.reporter_told_at).toBeNull();
  });

  it('forgets the confidential reporter at the end of retention', async () => {
    expect(await forgetConfidentialReporter(t.db, eventId)).toBe(1);
    expect(await t.db.one('select 1 from safety_confidential_reporters where event_id = $1', [eventId])).toBeUndefined();
  });
});
