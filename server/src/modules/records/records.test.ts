import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { calendarSources } from '../../core/calendar.ts';
import { holdsOn } from '../../core/holds.ts';
import { ANONYMIZED_TEXT } from '../../core/retention.ts';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { dayInZone } from '../../core/timezone.ts';
import type { SessionUser } from '../../core/module.ts';
import { ADMIN, testApp, type TestApi } from '../../test/helpers.ts';
import { PIA_KIND } from './privacy.ts';
import { addDays, dueDateFor, readSettings } from './settings.ts';

// Records requests and privacy (E34-03 to E34-07): due dates from settings (no built-in deadline),
// personal-data requests seen only with privacy.view while figures count them all, responsive
// records with exemptions, extension, preservation, closing, clocks claimed before alerting,
// privacy impact assessments with approval and "needs update", and the area switched off.

let t: Awaited<ReturnType<typeof testApp>>;
let adminId = '';
let recordsOnly: TestApi & { userId: string };
const req = async (data: Record<string, unknown>) => {
  const res = await t.api.post('/api/records-requests', { subject: 'Invented request', kind: 'records', ...data });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};

/** A user holding exactly these permissions (no default role is records-only). */
async function withGrants(key: string, grants: string[]) {
  const role = (await t.db.one<{ id: string }>(`insert into roles (key, name) values ($1, $1) returning id`, [key]))!;
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, g]);
  const user = (await t.db.one<{ id: string }>(`insert into users (username, email, display_name, status) values ($1, $2, $1, 'active') returning id`, [key, `${key}@example.test`]))!;
  await t.db.query('insert into user_roles (user_id, role_id) values ($1, $2)', [user.id, role.id]);
  const token = await createSession(t.db, user.id);
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown) => {
    const res = await t.app.inject({ method, url, headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1' }, ...(body !== undefined ? { payload: body as object } : {}) });
    let parsed: any = null;
    try { parsed = res.json(); } catch { /* not JSON */ }
    return { status: res.statusCode, body: parsed, text: res.body };
  };
  return {
    userId: user.id,
    get: (u: string) => call('GET', u), post: (u: string, b?: unknown) => call('POST', u, b ?? {}), patch: (u: string, b?: unknown) => call('PATCH', u, b ?? {}),
    put: (u: string, b?: unknown) => call('PUT', u, b ?? {}), del: (u: string) => call('DELETE', u),
  } as TestApi & { userId: string };
}

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  recordsOnly = await withGrants('records_clerk', ['records.view', 'records.edit', 'systems.view']);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('due dates (no jurisdiction built in)', () => {
  it('defaults to 20 calendar days for every kind, and follows the settings by kind and working days', async () => {
    const s = await readSettings(t.ctx);
    expect(s).toMatchObject({ dueDays: { '*': 20 }, businessDays: false, amberFraction: 0.25, reviewReminderDays: 30 });
    expect(dueDateFor(s, 'records', '2026-11-02')).toBe('2026-11-22');
    expect(addDays('2026-11-20', 1, true)).toBe('2026-11-23'); // Friday + 1 working day = Monday
    const r = await req({ received_on: '2026-11-02' });
    expect(r.due_on).toBe('2026-11-22');

    expect((await t.api.put('/api/records/settings', { dueDays: { '*': 'soon' } })).status).toBe(400);
    expect((await recordsOnly.put('/api/records/settings', { businessDays: true })).status).toBe(403);
    const saved = await t.api.put('/api/records/settings', { dueDays: { '*': 15, personal_access: 30 }, businessDays: true });
    expect(saved.body).toMatchObject({ dueDays: { '*': 15, personal_access: 30 }, businessDays: true });
    expect((await req({ received_on: '2026-11-02' })).due_on).toBe('2026-11-23'); // 15 working days
    expect((await req({ received_on: '2026-11-02', kind: 'personal_access' })).due_on).toBe('2026-12-14');
    await t.api.put('/api/records/settings', { dueDays: { '*': 20 }, businessDays: false });
  });
});

describe('personal-data requests and figures', () => {
  it('hides personal-data kinds from people without privacy.view everywhere, and still counts them', async () => {
    const personal = await req({ subject: 'Invented access request', kind: 'personal_access', requester_name: 'Pat Example' });
    const plain = await req({ subject: 'Invented records request' });
    expect((await recordsOnly.get(`/api/records-requests/${personal.id}`)).status).toBe(404);
    expect((await recordsOnly.get(`/api/records-requests/${plain.id}`)).status).toBe(200);
    const list = (await recordsOnly.get('/api/records-requests?pageSize=500')).body.rows.map((r: any) => r.id);
    expect(list).toContain(plain.id);
    expect(list).not.toContain(personal.id);
    expect((await recordsOnly.get('/api/search?q=Invented%20access')).body.some((h: any) => h.id === personal.id)).toBe(false);
    expect((await recordsOnly.get('/api/records/clocks')).body.some((c: any) => c.request_id === personal.id)).toBe(false);

    const mine = (await recordsOnly.get('/api/records/summary')).body;
    const admins = (await t.api.get('/api/records/summary')).body;
    expect(mine.requests).toEqual(admins.requests); // the same figures for everyone
    expect(mine.requests.by_kind.personal_access).toBeGreaterThanOrEqual(1);
    expect(mine.holds_active).toBeUndefined(); // legal.view only
    expect(typeof admins.holds_active).toBe('number');
    expect(JSON.stringify(admins)).not.toContain('Pat Example');
  });
});

describe('responsive records, extension, preservation and closing', () => {
  it('links records the person can see, with exemptions, mirrored on the record', async () => {
    const r = await req({ subject: 'Invented documentation request' });
    const sys = (await t.api.post('/api/systems', { name: 'Responsive invented system' })).body;
    const risk = (await t.api.post('/api/risks', { title: 'Invented restricted risk' })).body;
    expect((await recordsOnly.post(`/api/records-requests/${r.id}/items`, { record_type: 'risk', record_id: risk.id })).status).toBe(400);
    expect((await t.api.post(`/api/records-requests/${r.id}/items`, { record_type: 'system', record_id: sys.id, exemption: 'made_up' })).status).toBe(400);
    const item = await t.api.post(`/api/records-requests/${r.id}/items`, { record_type: 'system', record_id: sys.id, exemption: 'security_sensitive', disclosed: 'partial', note: 'Addresses withheld' });
    expect(item.status).toBe(201);
    expect(item.body).toMatchObject({ label: 'Responsive invented system', exemption: 'security_sensitive', disclosed: 'partial' });
    expect((await t.api.post(`/api/records-requests/${r.id}/items`, { record_type: 'system', record_id: sys.id })).status).toBe(409);
    await t.api.post(`/api/records-requests/${r.id}/items`, { record_type: 'risk', record_id: risk.id, disclosed: 'withheld' });
    const links = (await t.api.get(`/api/links?record_type=system&record_id=${sys.id}`)).body;
    expect(links).toEqual(expect.arrayContaining([expect.objectContaining({ relation: 'responsive_to', type: 'records_request', recordId: r.id })]));
    // The clerk sees the visible item and the count of all.
    expect((await recordsOnly.get(`/api/records-requests/${r.id}/items`)).body).toMatchObject({ total: 2, hidden: 1 });
    expect((await t.api.patch(`/api/records-requests/${r.id}/items/${item.body.id}`, { disclosed: 'full' })).body.disclosed).toBe('full');
  });

  it('extends with a reason (audited, alerts start again), preserves under a legal hold, and closes with a summary', async () => {
    const r = await req({ subject: 'Invented extension request', received_on: dayInZone(-25) });
    expect(r.due_on).toBe(dayInZone(-5));
    // The extended date is read-only to forms: only "Extend", with a reason, sets it.
    expect((await t.api.patch(`/api/records-requests/${r.id}`, { extended_due_on: dayInZone(10) })).body.extended_due_on).toBeNull();
    expect((await t.api.post(`/api/records-requests/${r.id}/extend`, { until: dayInZone(10) })).status).toBe(400);
    await t.db.query('update records_requests set alerted_red_at = now(), alerted_amber_at = now() where id = $1', [r.id]);
    const ext = await t.api.post(`/api/records-requests/${r.id}/extend`, { until: dayInZone(10), reason: 'Third party consulted (invented)' });
    expect(ext.status).toBe(200);
    expect(ext.body).toMatchObject({ extended_due_on: dayInZone(10), due_on: dayInZone(-5) });
    expect(await t.db.one<any>('select alerted_red_at from records_requests where id = $1', [r.id])).toEqual({ alerted_red_at: null });
    expect((await t.db.one<any>(`select summary from audit_events where action = 'records_request.extend' and record_id = $1`, [r.id])).summary).toContain('Third party consulted');
    expect((await t.api.get(`/api/records-requests/${r.id}/clock`)).body).toMatchObject({ due_on: dayInZone(10), extended: true, original_due_on: dayInZone(-5) });

    const sys = (await t.api.post('/api/systems', { name: 'Invented preserved system' })).body;
    await t.api.post(`/api/records-requests/${r.id}/items`, { record_type: 'system', record_id: sys.id });
    expect((await recordsOnly.post(`/api/records-requests/${r.id}/preserve`, {})).status).toBe(403);
    const kept = await t.api.post(`/api/records-requests/${r.id}/preserve`, { matter: 'Invented preservation for a request' });
    expect(kept.body).toMatchObject({ added: 1, ref: expect.stringMatching(/^LGH-/) });
    expect((await holdsOn(t.db, 'system', sys.id)).length).toBe(1);

    expect((await t.api.patch(`/api/records-requests/${r.id}`, { status: 'closed' })).status).toBe(400);
    expect((await t.api.post(`/api/records-requests/${r.id}/close`, {})).status).toBe(400);
    const closed = await t.api.post(`/api/records-requests/${r.id}/close`, { response_summary: 'Released in part (invented)' });
    expect(closed.body).toMatchObject({ status: 'closed', closed_on: dayInZone() });
  });
});

describe('clocks', () => {
  it('turns amber then red, and alerts the owner once even when two runs overlap', async () => {
    const amber = await req({ subject: 'Invented nearly due', received_on: dayInZone(-17), owner_id: adminId });
    const red = await req({ subject: 'Invented overdue', received_on: dayInZone(-30), owner_id: adminId });
    const green = await req({ subject: 'Invented fresh', received_on: dayInZone(), owner_id: adminId });
    const clocks = (await t.api.get('/api/records/clocks')).body;
    const state = (id: string) => clocks.find((c: any) => c.request_id === id)?.state;
    expect([state(red.id), state(amber.id), state(green.id)]).toEqual(['red', 'amber', 'green']);
    expect(clocks.findIndex((c: any) => c.request_id === red.id)).toBeLessThan(clocks.findIndex((c: any) => c.request_id === green.id));

    const count = async (id: string) => (await t.db.one<{ n: number }>(`select count(*)::int n from notifications where record_id = $1 and kind = 'records'`, [id]))!.n;
    await Promise.all([t.api.post('/api/records/reminders/run'), t.api.post('/api/records/reminders/run')]);
    await t.api.post('/api/records/reminders/run');
    expect(await count(red.id)).toBe(1);
    expect(await count(amber.id)).toBe(1);
    expect(await count(green.id)).toBe(0);
  });

  it('offers a calendar source of the requests one owns, and the overdue metric', async () => {
    const mine = await req({ subject: 'Invented calendar request', received_on: dayInZone(-3), owner_id: adminId });
    const user: SessionUser = { id: adminId, username: 'admin', displayName: 'Admin', email: ADMIN.email, roles: [], permissions: ['*'] };
    const source = calendarSources(t.app, t.ctx.resources, user).find((s) => s.key === 'records.requests_due')!;
    expect(source).toBeTruthy();
    const events = await source.events(t.ctx, user, dayInZone(), dayInZone(60));
    expect(events.find((e) => e.recordId === mine.id)).toMatchObject({ allDay: true, start: mine.due_on, url: `/records-requests/${mine.id}` });
    const metrics = (await t.api.get(`/api/metrics?month=${dayInZone().slice(0, 7)}`)).body.metrics;
    expect(metrics.find((m: any) => m.key === 'records.requests_overdue').value).toBeGreaterThanOrEqual(1);
  });
});

describe('privacy impact assessments', () => {
  it('lists systems with personal data and no current assessment, approves through the workflow, and flags a change of categories', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Invented rider app' })).body;
    const cat = (await t.api.post('/api/data-categories', { name: 'Invented rider contacts', personal_data: true, personal_data_kinds: ['contact'] })).body;
    expect(cat.personal_data_kinds).toEqual(['contact']);
    expect((await t.api.post('/api/data-categories', { name: 'Bad kinds', personal_data_kinds: ['nope'] })).status).toBe(400);
    await t.api.post(`/api/systems/${sys.id}/data-categories`, { data_category_id: cat.id });
    let cov = (await t.api.get('/api/privacy/coverage')).body;
    expect(cov.rows.find((r: any) => r.id === sys.id)).toMatchObject({ current: false, assessment: null });

    const pia = (await t.api.post('/api/privacy-assessments', { title: 'Invented rider app assessment', system_id: sys.id })).body;
    expect(pia.status).toBe('draft');
    expect((await t.api.get(`/api/links?record_type=system&record_id=${sys.id}`)).body.some((l: any) => l.relation === 'assessed_by' && l.recordId === pia.id)).toBe(true);
    expect((await t.api.post(`/api/privacy-assessments/${pia.id}/submit`)).status).toBe(400);
    await t.api.patch(`/api/privacy-assessments/${pia.id}`, { purpose: 'Trip planning (invented)', risks: 'Location tracking (invented)', residual_risk: 'low', review_months: 12 });
    const approver = await t.as('records_privacy_officer');
    const sent = await t.api.post(`/api/privacy-assessments/${pia.id}/submit`);
    expect(sent.body).toMatchObject({ status: 'in_review', workflow: 'Privacy impact assessment' });
    await approvalEngine(t.app)!.decide(PIA_KIND, pia.id, null, 'approved', null, { userId: approver.userId });
    const done = (await t.api.get(`/api/privacy-assessments/${pia.id}`)).body;
    expect(done).toMatchObject({ status: 'approved', approved_on: dayInZone() });
    expect(done.next_review_on > dayInZone(360)).toBe(true);
    cov = (await t.api.get('/api/privacy/coverage')).body;
    expect(cov.rows.find((r: any) => r.id === sys.id)).toMatchObject({ current: true });

    const other = (await t.api.post('/api/data-categories', { name: 'Invented trip history', personal_data: true })).body;
    await t.api.post(`/api/systems/${sys.id}/data-categories`, { data_category_id: other.id });
    cov = (await t.api.get('/api/privacy/coverage')).body;
    expect((await t.api.get(`/api/privacy-assessments/${pia.id}`)).body.status).toBe('needs_update');
    expect(cov.rows.find((r: any) => r.id === sys.id)).toMatchObject({ current: false });
  });

  it('reminds the owner of a review once, even when two runs overlap', async () => {
    const pia = (await t.api.post('/api/privacy-assessments', { title: 'Invented review due', owner_id: adminId })).body;
    await t.db.query(`update privacy_assessments set status = 'approved', next_review_on = $2 where id = $1`, [pia.id, dayInZone(5)]);
    await Promise.all([t.api.post('/api/records/reminders/run'), t.api.post('/api/records/reminders/run')]);
    const n = (await t.db.one<{ n: number }>(`select count(*)::int n from notifications where record_id = $1`, [pia.id]))!.n;
    expect(n).toBe(1);
  });
});

describe('retention', () => {
  it('anonymizing a request clears the requester and the notes on its responsive records', async () => {
    const r = await req({ subject: 'Invented anonymize request', requester_name: 'Sam Sample', requester_contact: 'sam@example.test', requester_address: '1 Invented Way' });
    const sys = (await t.api.post('/api/systems', { name: 'Invented anonymize system' })).body;
    await t.api.post(`/api/records-requests/${r.id}/items`, { record_type: 'system', record_id: sys.id, note: 'Sam asked for the logs' });
    await t.core.retention.anonymize(t.core.resources.registry.get('records_request')!, r.id);
    const row = await t.db.one<any>('select requester_name, requester_contact, requester_address, subject from records_requests where id = $1', [r.id]);
    expect(row).toEqual({ requester_name: ANONYMIZED_TEXT, requester_contact: ANONYMIZED_TEXT, requester_address: ANONYMIZED_TEXT, subject: 'Invented anonymize request' });
    expect((await t.db.one<any>('select note from records_request_items where request_id = $1', [r.id])).note).toBe(ANONYMIZED_TEXT);
  });
});

describe('the records area switched off', () => {
  it('hides requests, assessments, their lists, fields and sources, and keeps legal holds working', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Invented held while records off' })).body;
    const h = (await t.api.post('/api/legal-holds', { matter: 'Invented matter while off' })).body;
    await t.api.post(`/api/legal-holds/${h.id}/records`, { record_type: 'system', record_id: sys.id });
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    expect((await t.api.patch('/api/admin/features', { features: { records: false } })).status).toBe(200);
    try {
      for (const url of ['/api/records-requests', '/api/privacy-assessments', '/api/records/summary', '/api/records/clocks', '/api/privacy/coverage']) {
        const res = await t.api.get(url);
        expect([url, res.status, res.body?.error?.code]).toEqual([url, 404, 'switched_off']);
      }
      const meta = (await t.api.get('/api/meta')).body;
      expect(meta.resources.records_request).toBeUndefined();
      expect(meta.resources.data_category.fields.personal_data).toBeUndefined();
      expect(meta.lookups.records_request_kind).toBeUndefined();
      expect(meta.lookups.personal_data_kind).toBeUndefined();
      expect((meta.lookups.action_source ?? []).map((v: any) => v.value)).not.toContain('records');
      expect((meta.lookups.notification_kind ?? []).map((v: any) => v.value)).not.toContain('records');
      const user: SessionUser = { id: adminId, username: 'admin', displayName: 'Admin', email: ADMIN.email, roles: [], permissions: ['*'] };
      expect(calendarSources(t.app, t.ctx.resources, user).some((s) => s.key === 'records.requests_due')).toBe(false);
      // Legal holds are not part of the area.
      expect((await t.api.get(`/api/legal-holds/${h.id}/records`)).body.total).toBe(1);
      expect((await t.api.del(`/api/systems/${sys.id}`)).body.error.code).toBe('on_hold');
    } finally {
      expect((await t.api.patch('/api/admin/features', { features: { records: true } })).status).toBe(200);
    }
  });
});
