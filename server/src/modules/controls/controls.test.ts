import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runTestReminders } from './reminders.ts';
import { addMonths } from './shared.ts';

// Stand-ins for the risks module's `risk` (a restricted type) and `cap` (contract C1), so the
// control library can be tested alone. Hazards come from the real safety module.
const standIn: ModuleDef = {
  key: 'controlstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_risks (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, owner_id uuid, review_on date, status text,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists t_caps (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, source text, source_type text, source_id uuid,
        problem_statement text, responsible_id uuid, due_on date, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'risk', table: 't_risks', module: 'risks', label: 'Risk', plural: 'Risks', restricted: true,
      path: '/api/risks', route: '/risks', titleField: 'title', ref: { field: 'ref', prefix: 'RSK-' },
      fields: { ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Risk', type: 'text', required: true }, owner_id: { label: 'Owner', type: 'user' }, review_on: { label: 'Next review', type: 'date' } },
    });
    ctx.defineResource({
      type: 'cap', table: 't_caps', module: 'actions', label: 'Corrective action plan', plural: 'Corrective action plans',
      path: '/api/caps', route: '/caps', titleField: 'title', ref: { field: 'ref', prefix: 'CAP-' },
      restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Title', type: 'text', required: true },
        source: { label: 'Source', type: 'text' }, source_type: { label: 'Source type', type: 'text' }, source_id: { label: 'Source id', type: 'text' },
        problem_statement: { label: 'Problem', type: 'longtext' }, responsible_id: { label: 'Responsible', type: 'user' }, due_on: { label: 'Due', type: 'date' },
        restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;      // security lead: controls.*, risks, security.view, safety.view
let lead2: Client;     // a second security lead, who reviews what the first one tests
let auditLead: Client; // controls.* but no risks, no security.view, no safety
let auditor: Client;   // controls.view only
let controlId: string;
let riskId: string;
let hazardId: string;
let testId: string;

let today = dayInZone();
// Worked out again before each test, so a run that crosses midnight compares with the day the server uses.
beforeEach(() => { today = dayInZone(); });

beforeAll(async () => {
  process.env.GRC_MODULES = 'controls,safety,notifications';
  t = await testApp({ extraModules: [standIn] });
  lead = await t.as('security_lead');
  lead2 = await t.as('security_lead');
  auditLead = await t.as('audit_lead');
  auditor = await t.as('auditor');
  const risk = await t.ctx.resources.create('risk', { title: 'Invented secret risk about the fare gates', owner_id: lead.userId, review_on: dayInZone(200) });
  riskId = risk.id;
  hazardId = (await t.ctx.resources.create('hazard', { title: 'Invented hazard at the yard gate', owner_id: lead.userId, review_date: dayInZone(90) })).id;
});
afterAll(async () => { await t.close(); delete process.env.GRC_MODULES; });

describe('control records', () => {
  it('creates a control with a reference and validates the test interval', async () => {
    const res = await lead.post('/api/controls', { title: 'Invented badge check at the depot gate', control_type: 'preventive', domain: 'safety', status: 'active', test_every_months: 6 });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('CTL-00001');
    expect(res.body.key_control).toBe(false);
    controlId = res.body.id;
    expect((await lead.patch(`/api/controls/${controlId}`, { test_every_months: 0 })).body.error.fields.test_every_months).toBeTruthy();
    expect((await lead.patch(`/api/controls/${controlId}`, { test_every_months: 2.5 })).status).toBe(400);
    expect((await lead.patch(`/api/controls/${controlId}`, { operating_rating: 'effective' })).body.operating_rating).toBeNull(); // read-only
    expect((await auditor.post('/api/controls', { title: 'Not allowed' })).status).toBe(403);
  });
});

describe('coverage', () => {
  it('links a control to the records it covers', async () => {
    expect((await lead.post(`/api/controls/${controlId}/coverage`, { type: 'risk', id: riskId })).status).toBe(201);
    expect((await lead.post(`/api/controls/${controlId}/coverage`, { type: 'risk', id: riskId })).body.added).toBe(false);
    expect((await lead.post(`/api/controls/${controlId}/coverage`, { type: 'hazard', id: hazardId })).status).toBe(201);
    expect((await lead.post(`/api/controls/${controlId}/coverage`, { type: 'ticket', id: hazardId })).status).toBe(400);
    const cov = await lead.get(`/api/controls/${controlId}/coverage`);
    expect(cov.body.rows.map((r: any) => r.type).sort()).toEqual(['hazard', 'risk']);
    // The link is generic, so it also shows on the risk's Related tab.
    const links = await lead.get(`/api/links?record_type=risk&record_id=${riskId}`);
    expect(links.body.some((l: any) => l.relation === 'covers' && l.recordId === controlId)).toBe(true);
    const covering = await lead.get(`/api/controls/covering?type=risk&id=${riskId}`);
    expect(covering.body.rows.map((r: any) => r.id)).toEqual([controlId]);
    expect(covering.body.state).toBe('untested');
  });

  it('never shows restricted records to people who cannot see them', async () => {
    const cov = await auditLead.get(`/api/controls/${controlId}/coverage`);
    expect(cov.status).toBe(200);
    expect(cov.body.rows).toEqual([]);
    expect(cov.body.types.map((x: any) => x.type)).not.toContain('risk');
    expect(JSON.stringify(cov.body)).not.toContain('fare gates');
    expect((await auditLead.get(`/api/controls/covering?type=risk&id=${riskId}`)).status).toBe(404);
    expect((await auditLead.post(`/api/controls/${controlId}/coverage`, { type: 'risk', id: riskId })).status).toBe(400);
    const linkId = (await lead.get(`/api/controls/${controlId}/coverage`)).body.rows.find((r: any) => r.type === 'risk').link_id;
    expect((await auditLead.del(`/api/controls/${controlId}/coverage/${linkId}`)).status).toBe(404);
    const matrix = await auditLead.get('/api/controls/coverage-matrix');
    expect(matrix.status).toBe(200);
    expect(JSON.stringify(matrix.body)).not.toContain(riskId);
    expect((await lead.get('/api/controls/coverage-matrix')).body.rows.some((r: any) => r.id === riskId)).toBe(true);
    // The control's history never names the restricted risk; the risk's own history records the link.
    const history = await auditLead.get(`/api/history?record_type=control&record_id=${controlId}`);
    expect(JSON.stringify(history.body)).not.toContain('fare gates');
    expect(JSON.stringify(history.body)).not.toContain(riskId);
    const riskHistory = await lead.get(`/api/history?record_type=risk&record_id=${riskId}`);
    expect(riskHistory.body.some((h: any) => h.action === 'control.coverage_add')).toBe(true);
    const summary = await auditLead.get('/api/controls/summary');
    expect(summary.body.coverage.map((c: any) => c.type)).not.toContain('risk');
  });
});

describe('tests and review', () => {
  it('records a test with checks on its numbers, dates and status', async () => {
    const res = await lead.post('/api/control-tests', { control_id: controlId, test_type: 'operating', method: 'inspection', sample_size: 10 });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('CTT-00001');
    expect(res.body.title).toContain('Invented badge check');
    testId = res.body.id;
    expect((await lead.patch(`/api/control-tests/${testId}`, { sample_size: -1 })).body.error.fields.sample_size).toBeTruthy();
    expect((await lead.patch(`/api/control-tests/${testId}`, { exceptions_found: 11 })).body.error.fields.exceptions_found).toBeTruthy();
    expect((await lead.patch(`/api/control-tests/${testId}`, { period_start: '2026-06-01', period_end: '2026-05-01' })).body.error.fields.period_end).toBeTruthy();
    expect((await lead.patch(`/api/control-tests/${testId}`, { status: 'complete' })).body.error.fields.result).toBeTruthy();
    expect((await lead.patch(`/api/control-tests/${testId}`, { status: 'reviewed' })).body.error.fields.status).toBeTruthy();
    expect((await lead.patch(`/api/control-tests/${testId}`, { performed_on: dayInZone(3) })).body.error.fields.performed_on).toBeTruthy();
    expect((await lead.post('/api/control-tests', { control_id: '00000000-0000-4000-8000-000000000000' })).body.error.fields.control_id).toBeTruthy();
  });

  it('keeps sampled items and counts their exceptions', async () => {
    const a = await lead.post(`/api/control-tests/${testId}/samples`, { item: 'Gate log, Monday', result: 'pass' });
    expect(a.status).toBe(201);
    const b = await lead.post(`/api/control-tests/${testId}/samples`, { item: 'Gate log, Tuesday', result: 'exception', note: 'Badge not checked.' });
    expect(b.body.sample_size).toBe(2);
    expect(b.body.exceptions_found).toBe(1);
    expect((await lead.post(`/api/control-tests/${testId}/samples`, { item: '' })).status).toBe(400);
    expect((await lead.post(`/api/control-tests/${testId}/samples`, { item: 'x', result: 'maybe' })).status).toBe(400);
    expect((await auditor.post(`/api/control-tests/${testId}/samples`, { item: 'x' })).status).toBe(403);
    expect((await auditor.get(`/api/control-tests/${testId}/samples`)).body.rows.length).toBe(2);
    const patched = await lead.patch(`/api/control-tests/${testId}/samples/${a.body.id}`, { result: 'exception' });
    expect(patched.body.exceptions_found).toBe(2);
    expect((await lead.del(`/api/control-tests/${testId}/samples/${a.body.id}`)).body.exceptions_found).toBe(1);
  });

  it('is reviewed only by someone other than the tester, holding controls.approve', async () => {
    const performed = dayInZone(-2);
    const done = await lead.patch(`/api/control-tests/${testId}`, { result: 'ineffective', performed_on: performed, status: 'complete' });
    expect(done.status).toBe(200);
    expect((await lead2.post(`/api/control-tests/${testId}/review`)).body.error.fields.conclusion).toBeTruthy();
    await lead.patch(`/api/control-tests/${testId}`, { conclusion: 'Badges were not checked on one day in two.' });
    expect((await lead.post(`/api/control-tests/${testId}/review`)).status).toBe(403); // the tester
    expect((await auditor.post(`/api/control-tests/${testId}/review`)).status).toBe(403); // no controls.approve
    const res = await lead2.post(`/api/control-tests/${testId}/review`, { note: 'Checked the gate logs.' });
    expect(res.status).toBe(200);
    expect(res.body.test.status).toBe('reviewed');
    expect(res.body.test.reviewer_id).toBe(lead2.userId);
    expect(res.body.test.flagged_on).toBe(today);
    expect(res.body.flagged).toBe(2);
    expect(res.body.control.operating_rating).toBe('ineffective');
    expect(res.body.control.last_tested_on).toBe(performed);
    expect(res.body.control.next_test_due).toBe(addMonths(performed, 6));
    expect((await lead2.post(`/api/control-tests/${testId}/review`)).status).toBe(409);
    expect((await lead.patch(`/api/control-tests/${testId}`, { conclusion: 'Changed' })).status).toBe(409);
    expect((await lead.post(`/api/control-tests/${testId}/samples`, { item: 'Late' })).status).toBe(409);
  });

  it('flags the covered risks and hazards for review and tells their owners', async () => {
    expect((await t.ctx.resources.find('risk', riskId))!.review_on).toBe(today);
    expect((await t.ctx.resources.find('hazard', hazardId))!.review_date).toBe(today);
    const notes = await t.db.query<any>(`select record_type, kind from notifications where user_id = $1 and kind = 'controls' order by record_type`, [lead.userId]);
    expect(notes.map((n) => n.record_type)).toEqual(['hazard', 'risk']);
  });

  it('raises one corrective action plan for a failed test', async () => {
    expect((await auditor.post(`/api/control-tests/${testId}/cap`)).status).toBe(403);
    const res = await lead.post(`/api/control-tests/${testId}/cap`, { due_on: dayInZone(30) });
    expect(res.status).toBe(201);
    const cap = (await t.ctx.resources.find('cap', res.body.cap.id))!;
    expect(cap.source_type).toBe('control_test');
    expect(cap.source_id).toBe(testId);
    expect(cap.problem_statement).toContain('ineffective');
    expect(cap.restricted).toBe(false);
    expect((await lead.get(`/api/control-tests/${testId}`)).body.cap_id).toBe(cap.id);
    expect((await lead.post(`/api/control-tests/${testId}/cap`)).status).toBe(409);
    const other = await lead.post('/api/control-tests', { control_id: controlId, test_type: 'design', result: 'effective', performed_on: today, status: 'complete' });
    expect((await lead.post(`/api/control-tests/${other.body.id}/cap`)).body.error.code).toBe('not_failed');
  });

  it('rolls ratings back when a reviewed test is deleted', async () => {
    const extra = await lead.post('/api/control-tests', { control_id: controlId, test_type: 'operating', result: 'effective', performed_on: today, status: 'complete' });
    await lead2.post(`/api/control-tests/${extra.body.id}/review`);
    expect((await lead.get(`/api/controls/${controlId}`)).body.operating_rating).toBe('effective');
    expect((await lead.del(`/api/control-tests/${extra.body.id}`)).status).toBe(200);
    expect((await lead.get(`/api/controls/${controlId}`)).body.operating_rating).toBe('ineffective');
  });
});

describe('figures, metrics and reminders', () => {
  it('summarizes the library with the same figures for everyone', async () => {
    const a = (await lead.get('/api/controls/summary')).body;
    const b = (await auditor.get('/api/controls/summary')).body;
    expect(a.totals).toEqual(b.totals);
    expect(a.totals.ineffective).toBe(1);
    expect(a.coverage.find((c: any) => c.type === 'risk')).toMatchObject({ covered: 1, relying_on_failed: 1 });
  });

  it('offers the metrics for computed indicators', async () => {
    const res = await lead.get(`/api/metrics?month=${today.slice(0, 7)}`);
    const byKey = Object.fromEntries(res.body.metrics.map((m: any) => [m.key, m.value]));
    expect(byKey['controls.ineffective']).toBe(1);
    expect(byKey['controls.tests_overdue']).toBe(0);
    await t.db.query('update controls set test_every_months = 1, last_tested_on = null where id = $1', [controlId]);
    await t.db.query(`update control_tests set performed_on = $1::date where id = $2`, [dayInZone(-80), testId]);
    expect((await lead.get(`/api/metrics?month=${today.slice(0, 7)}`)).body.metrics.find((m: any) => m.key === 'controls.tests_overdue').value).toBe(1);
  });

  it('reminds the owner when a test comes due', async () => {
    const c = await lead.post('/api/controls', { title: 'Invented key cabinet check', status: 'active', owner_id: auditLead.userId, next_test_due: dayInZone(5) });
    const run = await runTestReminders(t.ctx);
    expect(run.soon).toBeGreaterThanOrEqual(1);
    const again = await runTestReminders(t.ctx);
    expect(again.notified).toBe(0);
    const notes = await t.db.query<any>(`select title from notifications where user_id = $1 and record_id = $2`, [auditLead.userId, c.body.id]);
    expect(notes.length).toBe(1);
    expect(notes[0].title).toContain('Control test due on');
  });
});
