import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalEngine } from '../../core/approval-kinds.ts';
import type { ModuleDef } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { addDays, addMonths } from './dates.ts';
import { runInspectionWork } from './jobs.ts';

// Stand-ins for the corrective action plan type (contract C1, risks module) and the hazard log
// (safety module), so findings can be tested whatever state those modules are in.
const standIn: ModuleDef = {
  key: 'auditstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_caps (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, source text, source_type text, source_id uuid,
        problem_statement text, root_cause text, responsible_id uuid, due_on date, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists t_hazards (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, description text, source text, consequence text, site_id uuid,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'cap', table: 't_caps', module: 'actions', label: 'Corrective action plan', plural: 'Corrective action plans',
      path: '/api/caps', route: '/caps', titleField: 'title', ref: { field: 'ref', prefix: 'CAP-' },
      restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Title', type: 'text', required: true },
        source: { label: 'Source', type: 'text' }, source_type: { label: 'Source type', type: 'text' }, source_id: { label: 'Source', type: 'text' },
        problem_statement: { label: 'Problem', type: 'longtext' }, root_cause: { label: 'Root cause', type: 'longtext' },
        responsible_id: { label: 'Responsible', type: 'user' }, due_on: { label: 'Due', type: 'date' },
        restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      },
    });
    ctx.defineResource({
      type: 'hazard', table: 't_hazards', module: 'safety', label: 'Hazard', plural: 'Hazards', path: '/api/hazards', route: '/safety/hazards',
      titleField: 'title', ref: { field: 'ref', prefix: 'HAZ-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Hazard', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' }, source: { label: 'Source', type: 'text' },
        consequence: { label: 'Consequence', type: 'longtext' }, site_id: { label: 'Site', type: 'ref', to: 'site' },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;      // audit lead: audits.*, actions.*
let safety: Client;    // safety manager: audits.*, safety.*
let pm: Client;        // project manager: no audit permissions
let auditor: Client;   // auditor: audits.view, audits.export
let adminId: string;
const today = dayInZone();

beforeAll(async () => {
  process.env.GRC_MODULES = 'audits,inventory,workflows,notifications,attachments';
  t = await testApp({ extraModules: [standIn] });
  lead = await t.as('audit_lead');
  safety = await t.as('safety_manager');
  pm = await t.as('project_manager');
  auditor = await t.as('auditor');
  adminId = (await t.db.one<{ id: string }>(`select id from users where username not like '%1' order by created_at limit 1`))!.id;
});
afterAll(async () => { delete process.env.GRC_MODULES; await t.close(); });

async function makeTemplate(client: Client, kind: 'inspection' | 'audit', items: { prompt: string; critical?: boolean; photo_required?: boolean; section?: string }[]) {
  const tpl = await client.post('/api/checklist-templates', { name: `Invented ${kind} checklist ${Math.random().toString(36).slice(2, 7)}`, kind, target_type: kind === 'inspection' ? 'site' : null });
  expect(tpl.status).toBe(201);
  const put = await client.put(`/api/checklist-templates/${tpl.body.id}/items`, { items });
  expect(put.status).toBe(200);
  return { id: tpl.body.id as string, items: put.body.items as { id: string; prompt: string }[] };
}

describe('audit universe and coverage', () => {
  it('keeps areas with a cycle, and works out the next due date from the last audit', async () => {
    expect((await lead.post('/api/audit-areas', { name: 'Invented area', cycle_months: 0 })).status).toBe(400);
    const area = await lead.post('/api/audit-areas', { name: 'Invented hazard process', category: 'safety_plan_element', cycle_months: 24, risk_level: 'high' });
    expect(area.status).toBe(201);
    expect(area.body.last_audited_on).toBeNull();
    // last_audited_on is read-only for people.
    const p = await lead.patch(`/api/audit-areas/${area.body.id}`, { last_audited_on: '2020-01-01' });
    expect(p.body.last_audited_on).toBeNull();
    const cov = await lead.get('/api/audits/coverage?years=3');
    expect(cov.status).toBe(200);
    expect(cov.body.years).toHaveLength(4);
    expect(cov.body.areas.find((a: any) => a.id === area.body.id).state).toBe('never');
    expect((await pm.get('/api/audits/coverage')).status).toBe(403);
  });
});

describe('checklist templates', () => {
  it('keeps ordered items, and versions a template once it has been used', async () => {
    const tpl = await makeTemplate(lead, 'inspection', [{ prompt: 'Exits clear', critical: true }, { prompt: 'Lights working' }]);
    expect(tpl.items.map((i) => i.prompt)).toEqual(['Exits clear', 'Lights working']);
    expect((await lead.put(`/api/checklist-templates/${tpl.id}/items`, { items: [{ prompt: '' }] })).status).toBe(400);
    expect((await auditor.put(`/api/checklist-templates/${tpl.id}/items`, { items: [] })).status).toBe(403);
    const ins = await lead.post('/api/inspections', { template_id: tpl.id, target_type: 'none', due_on: today });
    expect(ins.status).toBe(201);
    expect((await lead.put(`/api/inspections/${ins.body.id}/responses`, { item_id: tpl.items[0].id, answer: 'yes' })).status).toBe(200);
    const changed = await lead.put(`/api/checklist-templates/${tpl.id}/items`, { items: [{ id: tpl.items[1].id, prompt: 'Lights working' }, { prompt: 'Floors dry' }] });
    expect(changed.body.template.version).toBe(2);
    // The removed item is kept for the inspection that answered it.
    const r = await lead.get(`/api/inspections/${ins.body.id}/responses`);
    expect(r.body.items.map((i: any) => i.prompt)).toEqual(['Exits clear', 'Lights working', 'Floors dry']);
    expect(r.body.items[0].removed).toBe(true);
  });
});

describe('inspections', () => {
  let siteId: string;
  let tpl: Awaited<ReturnType<typeof makeTemplate>>;
  let inspectionId: string;

  beforeAll(async () => {
    siteId = (await t.api.post('/api/sites', { name: 'Invented Depot East' })).body.id;
    tpl = await makeTemplate(lead, 'inspection', [
      { prompt: 'Spill kit present', critical: true, section: 'Yard' },
      { prompt: 'Walkways clear', section: 'Yard' },
      { prompt: 'Ramp deploys', photo_required: true, section: 'Vehicles' },
    ]);
  });

  it('creates due inspections from schedules, once, and moves the schedule on', async () => {
    const s = await lead.post('/api/inspection-schedules', { template_id: tpl.id, target_type: 'site', target_id: siteId, frequency: 'monthly', next_due_on: today, assignee_id: lead.userId });
    expect(s.status).toBe(201);
    expect(s.body.target_label).toBe('Invented Depot East');
    expect(s.body.name).toContain('Invented Depot East');
    expect((await lead.post('/api/inspection-schedules', { template_id: tpl.id, target_type: 'site', target_id: '00000000-0000-4000-8000-000000000000', next_due_on: today })).status).toBe(400);
    const first = await runInspectionWork(t.ctx);
    expect(first.created).toBeGreaterThanOrEqual(1);
    const made = await t.db.query<any>('select * from inspections where schedule_id = $1', [s.body.id]);
    expect(made).toHaveLength(1);
    expect(made[0].due_on).toBe(today);
    expect(made[0].inspector_id).toBe(lead.userId);
    expect(made[0].target_label).toBe('Invented Depot East');
    expect(made[0].ref).toMatch(/^INS-/);
    expect((await t.db.one<any>('select next_due_on from inspection_schedules where id = $1', [s.body.id])).next_due_on).toBe(addMonths(today, 1));
    await runInspectionWork(t.ctx);
    expect(await t.db.query('select 1 from inspections where schedule_id = $1', [s.body.id])).toHaveLength(1);
    inspectionId = made[0].id;
  });

  it('marks inspections not done a week after their due date as missed', async () => {
    const late = await lead.post('/api/inspections', { template_id: tpl.id, target_type: 'site', target_id: siteId, due_on: addDays(today, -8) });
    await runInspectionWork(t.ctx);
    expect((await lead.get(`/api/inspections/${late.body.id}`)).body.status).toBe('missed');
  });

  it('saves answers as given, and completes with a result, a score and findings', async () => {
    expect((await lead.patch(`/api/inspections/${inspectionId}`, { status: 'complete' })).status).toBe(400);
    const [kit, walk, ramp] = tpl.items;
    expect((await lead.put(`/api/inspections/${inspectionId}/responses`, { item_id: kit.id, answer: 'maybe' })).status).toBe(400);
    expect((await auditor.put(`/api/inspections/${inspectionId}/responses`, { item_id: kit.id, answer: 'yes' })).status).toBe(403);
    const saved = await lead.put(`/api/inspections/${inspectionId}/responses`, { item_id: kit.id, answer: 'no', note: 'Spill kit missing.' });
    expect(saved.status).toBe(200);
    expect((await lead.get(`/api/inspections/${inspectionId}`)).body.status).toBe('in_progress');
    expect((await lead.post(`/api/inspections/${inspectionId}/complete`, {})).body.error.code).toBe('incomplete');
    await lead.put(`/api/inspections/${inspectionId}/responses`, { responses: [{ item_id: walk.id, answer: 'yes' }, { item_id: ramp.id, answer: 'yes' }] });
    expect((await lead.post(`/api/inspections/${inspectionId}/complete`, {})).body.error.code).toBe('photo_required');
    // A photo must be a file attached to this inspection.
    expect((await lead.put(`/api/inspections/${inspectionId}/responses`, { item_id: ramp.id, answer: 'yes', attachment_ids: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(400);
    await lead.put(`/api/inspections/${inspectionId}/responses`, { item_id: ramp.id, answer: 'na' });
    const done = await lead.post(`/api/inspections/${inspectionId}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.body.inspection.status).toBe('complete');
    expect(done.body.inspection.result).toBe('fail');
    expect(Number(done.body.inspection.score_pct)).toBe(50);
    expect(done.body.inspection.performed_on).toBe(today);
    expect(done.body.findings).toHaveLength(1);
    expect(done.body.findings[0].rating).toBe('major_nonconformity');
    expect((await lead.put(`/api/inspections/${inspectionId}/responses`, { item_id: kit.id, answer: 'yes' })).status).toBe(409);
    const f = await lead.get(`/api/audit-findings/${done.body.findings[0].id}`);
    expect(f.body.condition).toBe('Spill kit missing.');
    expect(f.body.item_id).toBe(kit.id);
    expect(f.body.response_due).toBe(addDays(today, 30));
  });

  it('raises a corrective action plan and a hazard from a finding', async () => {
    const fid = (await t.db.one<any>(`select id from audit_findings where source_id = $1`, [inspectionId])).id;
    expect((await pm.post(`/api/audit-findings/${fid}/cap`, {})).status).toBe(403);
    expect((await auditor.post(`/api/audit-findings/${fid}/cap`, {})).status).toBe(403);
    const cap = await lead.post(`/api/audit-findings/${fid}/cap`, { due_on: addDays(today, 20) });
    expect(cap.status).toBe(201);
    const plan = await t.db.one<any>('select * from t_caps where id = $1', [cap.body.cap.id]);
    expect(plan).toMatchObject({ source: 'inspection', source_type: 'audit_finding', source_id: fid, due_on: addDays(today, 20) });
    expect(plan.problem_statement).toContain('Spill kit missing.');
    const f = await lead.get(`/api/audit-findings/${fid}`);
    expect(f.body).toMatchObject({ cap_id: cap.body.cap.id, status: 'cap_raised', responded_on: today });
    expect((await lead.post(`/api/audit-findings/${fid}/cap`, {})).status).toBe(409);
    // The audit lead cannot create safety records; the safety manager can.
    expect((await lead.post(`/api/audit-findings/${fid}/hazard`, {})).status).toBe(403);
    const hz = await safety.post(`/api/audit-findings/${fid}/hazard`, {});
    expect(hz.status).toBe(201);
    expect(await t.db.one('select source, site_id from t_hazards where id = $1', [hz.body.hazard.id])).toEqual({ source: 'inspection', site_id: siteId });
    const links = await t.db.query<any>(`select to_type from record_links where from_type = 'audit_finding' and from_id = $1 order by to_type`, [fid]);
    expect(links.map((l) => l.to_type)).toEqual(['cap', 'hazard']);
  });
});

describe('audits, evidence requests and report approval', () => {
  let auditId: string;
  let findingId: string;
  let areaId: string;

  it('runs an audit from planned through fieldwork to reporting', async () => {
    areaId = (await lead.post('/api/audit-areas', { name: 'Invented procurement', category: 'process', cycle_months: 12 })).body.id;
    const tpl = await makeTemplate(lead, 'audit', [{ prompt: 'Approvals by authorized people' }]);
    const bad = await lead.post('/api/audits', { title: 'Invented audit', audit_type: 'internal_audit', planned_start: '2026-05-10', planned_end: '2026-05-01' });
    expect(bad.status).toBe(400);
    const a = await lead.post('/api/audits', {
      title: 'Invented procurement audit', audit_type: 'internal_audit', area_id: areaId, template_id: tpl.id, plan_year: 2026,
      lead_auditor_id: lead.userId, team_ids: [lead.userId, lead.userId], scope: 'Invented scope.',
    });
    expect(a.status).toBe(201);
    expect(a.body.ref).toMatch(/^AUD-/);
    expect(a.body.status).toBe('planned');
    expect(a.body.team_ids).toEqual([lead.userId]);
    auditId = a.body.id;
    const fw = await lead.patch(`/api/audits/${auditId}`, { status: 'fieldwork' });
    expect(fw.body.fieldwork_start).toBe(today);
    const cl = await lead.put(`/api/audits/${auditId}/checklist`, { item_id: tpl.items[0].id, answer: 'no', note: 'Two purchases approved above the limit.' });
    expect(cl.status).toBe(200);
    expect(cl.body.answered).toBe(1);
    const f = await lead.post('/api/audit-findings', { title: 'Approvals above the limit', source_type: 'audit_engagement', source_id: auditId, rating: 'minor_nonconformity', response_due: addDays(today, -1) });
    expect(f.status).toBe(201);
    expect(f.body.ref).toMatch(/^FND-/);
    findingId = f.body.id;
    expect((await lead.post('/api/audit-findings', { title: 'x', source_type: 'risk', source_id: auditId })).status).toBe(400);
    expect((await lead.patch(`/api/audits/${auditId}`, { status: 'reporting' })).body.fieldwork_end).toBe(today);
  });

  it('lets the person asked answer an evidence request without seeing the audit', async () => {
    const r = await lead.post('/api/audit-requests', { audit_id: auditId, request: 'Invented: the approval records.', owner_id: pm.userId, due_on: addDays(today, 2) });
    expect(r.status).toBe(201);
    expect(r.body.ref).toMatch(/^REQ-/);
    const note = await t.db.one<any>(`select title, route from notifications where user_id = $1 order by created_at desc limit 1`, [pm.userId]);
    expect(note).toMatchObject({ route: '/audits/my-requests' });
    const mine = await pm.get('/api/audit-requests/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.open).toHaveLength(1);
    expect(Object.keys(mine.body.open[0]).sort()).toEqual(['answerable', 'due_on', 'files', 'id', 'overdue', 'provided_at', 'ref', 'request', 'response_note', 'status', 'status_label']);
    expect((await pm.get(`/api/audit-requests/${r.body.id}`)).status).toBe(403);
    expect((await pm.get(`/api/audits/${auditId}`)).status).toBe(403);
    expect((await auditor.post(`/api/audit-requests/${r.body.id}/respond`, { response_note: 'Not mine.' })).status).toBe(404);
    expect((await pm.post(`/api/audit-requests/${r.body.id}/respond`, {})).status).toBe(400);
    const done = await pm.post(`/api/audit-requests/${r.body.id}/respond`, { response_note: 'In the shared folder.' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('provided');
    expect((await lead.get(`/api/audit-requests/${r.body.id}`)).body.provided_at).toBeTruthy();
    // A request on a restricted audit is not shown to someone who may not see restricted records.
    const secret = await t.api.post('/api/audits', { title: 'Invented restricted audit', audit_type: 'cyber_control_audit', restricted: true });
    const hidden = await t.api.post('/api/audit-requests', { audit_id: secret.body.id, request: 'Invented secret request.', owner_id: pm.userId });
    expect(hidden.body.restricted).toBe(true);
    expect((await pm.get('/api/audit-requests/mine')).body.open).toHaveLength(0);
    expect((await pm.post(`/api/audit-requests/${hidden.body.id}/respond`, { response_note: 'x' })).status).toBe(404);
    // Its findings inherit the restriction; the audit lead cannot see them, but the figures count them.
    const sf = await t.api.post('/api/audit-findings', { title: 'Invented restricted finding', source_type: 'audit_engagement', source_id: secret.body.id });
    expect(sf.body.restricted).toBe(true);
    expect((await lead.get(`/api/audit-findings/${sf.body.id}`)).status).toBe(404);
    const sum = await lead.get('/api/audits/summary');
    expect(sum.status).toBe(200);
    expect(sum.body.findings.open).toBe((await t.api.get('/api/audits/summary')).body.findings.open);
    const cov = await lead.get('/api/audits/coverage');
    expect(JSON.stringify(cov.body)).not.toContain('Invented restricted audit');
  });

  it('closes only with a summary, a response on every finding and an approved report', async () => {
    const refuse = await lead.patch(`/api/audits/${auditId}`, { status: 'closed' });
    expect(refuse.status).toBe(400);
    expect(refuse.body.error.message).toContain('report summary');
    expect(refuse.body.error.message).toContain('management response');
    const state = await lead.get(`/api/audits/${auditId}/report-approval`);
    expect(state.body).toMatchObject({ available: true, required: true, approved: false });
    expect(state.body.problems).toHaveLength(2);
    expect((await lead.post(`/api/audits/${auditId}/report-approval`, {})).status).toBe(400);
    await lead.patch(`/api/audit-findings/${findingId}`, { management_response: 'Agreed; limits are now checked by the system.' });
    expect((await lead.get(`/api/audit-findings/${findingId}`)).body).toMatchObject({ status: 'responded', responded_on: today });
    await lead.patch(`/api/audits/${auditId}`, { report_summary: 'Invented summary.', opinion: 'needs_improvement' });
    const gated = await lead.patch(`/api/audits/${auditId}`, { status: 'closed' });
    expect(gated.status).toBe(409);
    expect(gated.body.error.code).toBe('approval_required');
    const asked = await lead.post(`/api/audits/${auditId}/report-approval`, { note: 'Ready.' });
    expect(asked.status).toBe(201);
    expect((await lead.post(`/api/audits/${auditId}/report-approval`, {})).status).toBe(409);
    await approvalEngine(t.app)!.decide('audit_report', auditId, null, 'approved', 'Fine.', { userId: adminId });
    const after = await lead.get(`/api/audits/${auditId}`);
    expect(after.body).toMatchObject({ status: 'closed', closed_on: today, report_approved_on: today });
    const area = await lead.get(`/api/audit-areas/${areaId}`);
    expect(area.body).toMatchObject({ last_audited_on: today, next_due_on: addMonths(today, 12) });
    const cov = await lead.get('/api/audits/coverage');
    expect(cov.body.areas.find((a: any) => a.id === areaId)).toMatchObject({ state: 'ok', audited_in_period: true });
  });

  it('exports the report as a PDF for people who may export', async () => {
    expect((await lead.get(`/api/audits/${auditId}/report.pdf`)).status).toBe(200);
    const res = await auditor.get(`/api/audits/${auditId}/report.pdf`);
    expect(res.status).toBe(200);
    expect(res.text.startsWith('%PDF')).toBe(true);
    expect((await pm.get(`/api/audits/${auditId}/report.pdf`)).status).toBe(403);
    expect(await t.db.one(`select 1 as x from audit_events where action = 'audit_engagement.report_pdf' and record_id = $1`, [auditId])).toEqual({ x: 1 });
  });

  it('names a finding\'s corrective action plan only to a reader who may see it (W17-4)', async () => {
    const { pdfText } = await import('../../core/export/testing.ts');
    const plan = (await t.db.one<{ id: string }>(`insert into t_caps (ref, title) values ('CAP-09001', 'Invented plan title for the label check') returning id`))!.id;
    await t.db.query('update audit_findings set cap_id = $1 where id = $2', [plan, findingId]);
    const { createSession, SESSION_COOKIE } = await import('../../core/auth.ts');
    const pdf = async (c: Client) => {
      const token = await createSession(t.db, c.userId);
      const res = await t.app.inject({ method: 'GET', url: `/api/audits/${auditId}/report.pdf`, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
      expect(res.statusCode).toBe(200);
      return pdfText(res.rawPayload);
    };
    expect(await pdf(lead)).toContain('Invented plan title for the label check');
    // E41-13: the audit report is tagged for PDF/UA like every server PDF.
    const { checkPdfUa } = await import('../../core/export/pdfua.ts');
    const token = await createSession(t.db, lead.userId);
    const file = await t.app.inject({ method: 'GET', url: `/api/audits/${auditId}/report.pdf`, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect((await checkPdfUa(file.rawPayload)).failures).toEqual([]);
    const asAuditor = await pdf(auditor); // audits.export, but no actions.view
    expect(asAuditor).not.toContain('Invented plan title');
    expect(asAuditor).toContain('Restricted');
  });
});

describe('dashboard and metrics', () => {
  it('offers the summary and the two metrics', async () => {
    const s = await lead.get('/api/audits/summary');
    expect(s.body.inspections.by_month).toHaveLength(6);
    expect(s.body.inspections.last_90.missed).toBeGreaterThanOrEqual(1);
    const m = await lead.get(`/api/metrics?month=${today.slice(0, 7)}`);
    const keys = m.body.metrics.map((x: any) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['audits.inspections_on_time_pct', 'audits.findings_overdue']));
    const pct = m.body.metrics.find((x: any) => x.key === 'audits.inspections_on_time_pct');
    expect(pct.value === null || (pct.value >= 0 && pct.value <= 100)).toBe(true);
    expect((await pm.get(`/api/metrics?month=${today.slice(0, 7)}`)).body.metrics.map((x: any) => x.key)).not.toContain('audits.findings_overdue');
  });
});

describe('canceled inspections and the signature of completion (E38-11)', () => {
  it('refuses answers and completion on a canceled inspection', async () => {
    const tpl = await makeTemplate(lead, 'inspection', [{ prompt: 'Invented gate latched' }]);
    const ins = await lead.post('/api/inspections', { template_id: tpl.id, target_type: 'none', due_on: today });
    expect(ins.status).toBe(201);
    expect((await lead.patch(`/api/inspections/${ins.body.id}`, { status: 'canceled' })).status).toBe(200);
    const put = await lead.put(`/api/inspections/${ins.body.id}/responses`, { item_id: tpl.items[0].id, answer: 'yes' });
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe('inspection_canceled');
    expect((await lead.post(`/api/inspections/${ins.body.id}/complete`, {})).body.error.code).toBe('inspection_canceled');
  });

  it('records who signed, with a signature that must be a file on the inspection', async () => {
    const tpl = await makeTemplate(lead, 'inspection', [{ prompt: 'Invented hatch closed' }, { prompt: 'Invented signage present' }]);
    const ins = await lead.post('/api/inspections', { template_id: tpl.id, target_type: 'none', due_on: today });
    await lead.put(`/api/inspections/${ins.body.id}/responses`, { responses: tpl.items.map((i) => ({ item_id: i.id, answer: 'yes' })) });
    const file = await t.db.one<{ id: string }>(
      `insert into attachments (record_type, record_id, file_name, extension, content_type, size_bytes, sha256, storage_key)
       values ('inspection', $1, 'signature.png', 'png', 'image/png', 10, 'x', $2) returning id`, [ins.body.id, `sig/${ins.body.id}`]);
    const other = await t.db.one<{ id: string }>(
      `insert into attachments (record_type, record_id, file_name, extension, content_type, size_bytes, sha256, storage_key)
       values ('inspection', gen_random_uuid(), 'other.png', 'png', 'image/png', 10, 'x', $1) returning id`, [`sig/other/${ins.body.id}`]);
    const wrong = await lead.post(`/api/inspections/${ins.body.id}/complete`, { signed_by_name: 'Test signer', signature_attachment_id: other!.id });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.signature_attachment_id).toBeTruthy();
    expect((await lead.post(`/api/inspections/${ins.body.id}/complete`, { signature_attachment_id: file!.id })).body.error.fields.signed_by_name).toBeTruthy();
    const done = await lead.post(`/api/inspections/${ins.body.id}/complete`, { signed_by_name: 'Test signer', signature_attachment_id: file!.id });
    expect(done.status).toBe(200);
    expect(done.body.inspection).toMatchObject({ status: 'complete', result: 'pass', signed_by_name: 'Test signer' });
    expect(done.body.inspection.signed_at).toBeTruthy();
    const ev = await t.db.one<any>(`select summary, after from audit_events where action = 'inspection.complete' and record_id = $1`, [ins.body.id]);
    expect(ev.summary).toContain('signed by Test signer');
    expect(ev.after.signature_attachment_id).toBe(file!.id);
  });
});
