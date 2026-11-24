import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addMonths } from '../../../../shared/dates.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { DESTRUCTION_KIND } from './index.ts';
import { eligibleOn, periodText } from './periods.ts';

// E41-15: the organization's records retention schedule (record series, paper and electronic, with
// periods and triggers) and the destruction log with approvals; legal holds stop a destruction.

let t: Awaited<ReturnType<typeof testApp>>;
const today = () => dayInZone();
const series = async (body: Record<string, unknown>) => {
  const r = await t.api.post('/api/record-series', { title: 'Invented series', medium: 'paper', retention_value: 3, retention_unit: 'years', trigger_event: 'closed', ...body });
  expect(r.status, r.text).toBe(201);
  return r.body;
};
const destruction = async (body: Record<string, unknown>) => {
  const r = await t.api.post('/api/records-destructions', { title: 'Invented boxes', ...body });
  expect(r.status, r.text).toBe(201);
  return r.body;
};
const get = async (id: string) => (await t.api.get(`/api/records-destructions/${id}`)).body;

let approverId = '';
beforeAll(async () => {
  t = await testApp();
  // Someone other than the requester, holding records.approve, decides.
  approverId = (await t.as('records_privacy_officer')).userId;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('periods', () => {
  it('works out when records may go, and says the period in words', () => {
    expect(eligibleOn('2020-06-30', { retention_value: 7, retention_unit: 'years' })).toBe('2027-06-30');
    expect(eligibleOn('2020-01-31', { retention_value: 1, retention_unit: 'months' })).toMatch(/^2020-02-2[89]$/);
    expect(eligibleOn('2020-01-01', { retention_value: 90, retention_unit: 'days' })).toBe('2020-03-31');
    expect(eligibleOn('2020-01-01', { retention_value: 0.5, retention_unit: 'years' })).toBe('2020-07-01');
    expect(eligibleOn('2020-01-01', { permanent: true, retention_value: 5, retention_unit: 'years' })).toBeNull();
    expect(eligibleOn(null, { retention_value: 5, retention_unit: 'years' })).toBeNull();
    expect(periodText({ retention_value: 7, retention_unit: 'years', trigger_event: 'fiscal_year_end' })).toBe('7 years after the end of the fiscal year');
    expect(periodText({ retention_value: 1, retention_unit: 'years', trigger_event: 'closed' })).toBe('1 year after the file or case is closed');
    expect(periodText({ permanent: true })).toBe('Kept permanently');
  });
});

describe('the retention schedule', () => {
  it('keeps paper and electronic series with a period and a trigger, or permanently', async () => {
    const s = await series({ title: 'Invented depot inspection sheets', medium: 'electronic', retention_value: 6, trigger_event: 'calendar_year_end', authority: 'Invented policy 4.2' });
    expect(s).toMatchObject({ ref: expect.stringMatching(/^RS-/), medium: 'electronic', status: 'active', permanent: false });
    const missing = await t.api.post('/api/record-series', { title: 'No period', medium: 'paper' });
    expect([missing.status, Object.keys(missing.body.error.fields)]).toEqual([400, ['retention_value']]);
    const forever = await series({ title: 'Invented board minutes', permanent: true, retention_value: 9 });
    expect(forever).toMatchObject({ permanent: true, retention_value: null });
    expect((await t.api.get('/api/record-series?q=depot inspection')).body.rows.map((r: any) => r.id)).toContain(s.id);
  });
});

describe('the destruction log', () => {
  it('works out the date from the series, refuses early destruction and a permanent series', async () => {
    const s = await series({ title: 'Invented fare media reports', retention_value: 2, retention_unit: 'years' });
    const early = await destruction({ series_id: s.id, trigger_date: addMonths(today(), -6) });
    expect(early).toMatchObject({ status: 'proposed', medium: 'paper', eligible_on: addMonths(addMonths(today(), -6), 24) });
    const r = await t.api.post(`/api/records-destructions/${early.id}/submit`);
    expect([r.status, r.body.error.code]).toEqual([409, 'not_eligible']);
    // No date at all: asked for.
    const undated = await destruction({ series_id: s.id });
    expect((await t.api.post(`/api/records-destructions/${undated.id}/submit`)).body.error.fields).toHaveProperty('trigger_date');
    const forever = await series({ title: 'Invented charter documents', permanent: true });
    const refused = await t.api.post('/api/records-destructions', { title: 'Never', series_id: forever.id, trigger_date: '2000-01-01' });
    expect(refused.body.error.fields).toHaveProperty('series_id');
  });

  it('goes through the Records destruction approval, then is carried out and kept in the log', async () => {
    const s = await series({ title: 'Invented payroll registers', retention_value: 1 });
    const d = await destruction({ series_id: s.id, trigger_date: addMonths(today(), -24), quantity: '3 boxes', method: 'shredding' });
    const sub = await t.api.post(`/api/records-destructions/${d.id}/submit`, { note: 'Past the period' });
    expect([sub.status, sub.body.status]).toEqual([202, 'pending_approval']);
    expect((await get(d.id)).status).toBe('pending_approval');
    // Submitted: the details are fixed, only notes change, and it cannot be deleted.
    expect((await t.api.patch(`/api/records-destructions/${d.id}`, { quantity: '4 boxes' })).body.error.code).toBe('locked');
    expect((await t.api.patch(`/api/records-destructions/${d.id}`, { notes: 'Boxes on shelf C' })).status).toBe(200);
    expect((await t.api.del(`/api/records-destructions/${d.id}`)).body.error.code).toBe('kept');

    await approvalEngine(t.app)!.decide(DESTRUCTION_KIND, d.id, null, 'approved', 'Fine', { userId: approverId });
    expect(await get(d.id)).toMatchObject({ status: 'approved', approved_on: today(), approved_by_name: expect.stringMatching(/^Test records_privacy_officer/) });

    const bad = await t.api.post(`/api/records-destructions/${d.id}/carried-out`, { carried_out_on: addMonths(today(), 1) });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['carried_out_by', 'carried_out_on']);
    const done = await t.api.post(`/api/records-destructions/${d.id}/carried-out`, { carried_out_on: today(), carried_out_by: 'Invented shredding service', certificate_ref: 'CERT-1' });
    expect(done.body).toEqual({ status: 'done' });
    expect(await get(d.id)).toMatchObject({ status: 'done', carried_out_on: today(), certificate_ref: 'CERT-1', method: 'shredding' });
    expect((await t.api.del(`/api/records-destructions/${d.id}`)).body.error.code).toBe('kept');
    // A series with destructions in the log is retired, not deleted.
    expect((await t.api.del(`/api/record-series/${s.id}`)).body.error.code).toBe('kept');
    const history = (await t.api.get(`/api/history?record_type=records_destruction&record_id=${d.id}`)).body;
    expect(JSON.stringify(history)).toContain('carried out');
  });

  it('a rejection sends it back with the reason, and it can be canceled', async () => {
    const s = await series({ title: 'Invented lost property logs', retention_value: 1 });
    const d = await destruction({ series_id: s.id, trigger_date: addMonths(today(), -18) });
    await t.api.post(`/api/records-destructions/${d.id}/submit`);
    await approvalEngine(t.app)!.decide(DESTRUCTION_KIND, d.id, null, 'rejected', 'Audit still open', { userId: approverId });
    expect(await get(d.id)).toMatchObject({ status: 'rejected', decision_note: 'Audit still open' });
    expect((await t.api.post(`/api/records-destructions/${d.id}/cancel`, { reason: 'Kept for the audit' })).body.status).toBe('canceled');
    expect((await t.api.del(`/api/records-destructions/${d.id}`)).status).toBe(200);
  });

  it('a legal hold on the series stops submission, approval and destruction', async () => {
    const s = await series({ title: 'Invented claims correspondence', retention_value: 1 });
    const d = await destruction({ series_id: s.id, trigger_date: addMonths(today(), -30) });
    const hold = (await t.api.post('/api/legal-holds', { matter: 'Invented claim about correspondence' })).body;
    expect((await t.api.post(`/api/legal-holds/${hold.id}/records`, { records: [{ type: 'record_series', id: s.id }] })).status).toBe(201);
    const r = await t.api.post(`/api/records-destructions/${d.id}/submit`);
    expect([r.status, r.body.error.code]).toEqual([409, 'on_hold']);
    expect(r.body.error.message).toContain(hold.ref);
    expect(r.body.error.message).not.toContain('correspondence');
    const state = (await t.api.get(`/api/records-destructions/${d.id}/state`)).body;
    expect(state).toMatchObject({ held: true, holds: [{ id: hold.id, ref: hold.ref }], eligible: true });
    // The series page shows the hold to legal.view holders.
    expect((await t.api.get(`/api/record-series/${s.id}`)).body._holds).toEqual([{ id: hold.id, ref: hold.ref }]);

    // Released: it goes ahead; a hold placed after approval stops the destruction itself.
    await t.db.query(`update legal_holds set status = 'released' where id = $1`, [hold.id]);
    expect((await t.api.post(`/api/records-destructions/${d.id}/submit`)).status).toBe(202);
    await approvalEngine(t.app)!.decide(DESTRUCTION_KIND, d.id, null, 'approved', null, { userId: approverId });
    const hold2 = (await t.api.post('/api/legal-holds', { matter: 'Second invented matter' })).body;
    await t.api.post(`/api/legal-holds/${hold2.id}/records`, { records: [{ type: 'record_series', id: s.id }] });
    const late = await t.api.post(`/api/records-destructions/${d.id}/carried-out`, { carried_out_on: today(), carried_out_by: 'Invented service' });
    expect([late.status, late.body.error.code]).toEqual([409, 'on_hold']);
  });

  it('without a workflow, only someone who may approve records work approves at once', async () => {
    await t.db.query(`update workflow_definitions set active = false where record_type = 'records_destruction'`);
    expect(await approvalEngine(t.app)!.definitions(DESTRUCTION_KIND)).toEqual([]);
    const s = await series({ title: 'Invented timetable drafts', retention_value: 1 });
    const d = await destruction({ series_id: s.id, trigger_date: addMonths(today(), -18) });
    expect((await t.api.post(`/api/records-destructions/${d.id}/submit`)).body.status).toBe('approved');
    // Someone holding only records.edit cannot.
    const d2 = await destruction({ series_id: s.id, trigger_date: addMonths(today(), -18) });
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('rec_editor', 'Records editor', true) returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'records.view'), ($1, 'records.edit')`, [role!.id]);
    const editor = await t.as('rec_editor');
    const r = await editor.post(`/api/records-destructions/${d2.id}/submit`);
    expect([r.status, r.body.error?.code]).toEqual([409, 'no_workflow']);
    expect((await get(d2.id)).status).toBe('proposed');
    await t.db.query(`update workflow_definitions set active = true where record_type = 'records_destruction'`);
  });

  it('is hidden everywhere while its area is off, and figures do not depend on who asks', async () => {
    const s = await series({ title: 'Invented zebra crossing surveys', retention_value: 1 });
    expect((await t.api.get('/api/search?q=zebra crossing')).body.map((h: any) => h.id)).toContain(s.id);
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    expect((await t.api.patch('/api/admin/features', { features: { recordsretention: false } })).status).toBe(200);
    try {
      expect((await t.api.get('/api/record-series')).status).toBe(404);
      expect((await t.api.get('/api/search?q=zebra crossing')).body).toEqual([]);
      const meta = (await t.api.get('/api/meta')).body;
      expect(meta.resources.record_series).toBeUndefined();
      expect(meta.lookups.destruction_status).toBeUndefined();
      expect((await t.api.get(`/api/records-destructions/${s.id}/state`)).status).toBe(404);
    } finally {
      expect((await t.api.patch('/api/admin/features', { features: { recordsretention: true } })).status).toBe(200);
    }
    // People without the records permissions see nothing of it.
    const agent = await t.as('agent');
    expect((await agent.get('/api/record-series')).status).toBe(403);
    const officer = await t.as('records_privacy_officer');
    expect((await officer.get('/api/record-series')).status).toBe(200);
  });
});
