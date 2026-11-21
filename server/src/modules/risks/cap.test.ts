import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricsAvailable } from '../../core/metrics.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runVerificationReminders } from './caps.ts';

// Corrective action plans and verification (E23, contracts C1 and C2). Invented records only.

const workflows = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');
type T = Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<T['as']>>;
let t: T;
let lead: Client; // security lead: actions.*, security.view
let doer: Client; // actions view/create/edit only, no security.view, no approve

const plus = (n: number) => dayInZone(n);

beforeAll(async () => {
  t = await testApp();
  lead = await t.as('security_lead');
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('action_doer', 'Action doer') returning id`);
  await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'actions.view'), ($1, 'actions.create'), ($1, 'actions.edit')`, [role!.id]);
  doer = await t.as('action_doer');
}, 60_000);
afterAll(async () => { await t?.close(); });

const newCap = async (client: Client | T['api'], body: Record<string, unknown> = {}) => {
  const res = await client.post('/api/caps', { title: 'Platform edge markings faded', problem_statement: 'Invented: markings at two stops have worn away', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};
const addAction = async (client: Client | T['api'], capId: string, body: Record<string, unknown> = {}) => {
  const res = await client.post('/api/actions', { title: 'Repaint the markings', cap_id: capId, due_on: plus(10), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};
const capOf = async (id: string) => (await t.api.get(`/api/caps/${id}`)).body;
const approveDirect = (id: string) => t.db.query(`update caps set status = 'approved' where id = $1`, [id]);

describe('corrective action plans (C1)', () => {
  it('lists, numbers and audits plans, and actions take the plan source and need verification', async () => {
    const cap = await newCap(lead);
    expect(cap).toMatchObject({ status: 'draft', source: 'other', restricted: false });
    expect(cap.ref).toMatch(/^CAP-\d+/);
    const action = await addAction(lead, cap.id);
    expect(action).toMatchObject({ cap_id: cap.id, verification_required: true });
    expect(await t.db.one(`select 1 as ok from audit_events where record_type = 'cap' and record_id = $1 and action = 'cap.create'`, [cap.id])).toEqual({ ok: 1 });
    expect((await lead.post('/api/actions', { title: 'x', cap_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });

  it('a plan raised on a restricted record is restricted, and so are its actions', async () => {
    const risk = (await lead.post('/api/risks', { title: 'Invented depot gate controller exposure' })).body;
    const cap = await newCap(t.api, { source_type: 'risk', source_id: risk.id });
    expect(cap).toMatchObject({ restricted: true, source: 'risk' });
    const action = await addAction(lead, cap.id);
    expect(action).toMatchObject({ restricted: true, source_type: 'risk', source_id: risk.id, source: 'risk' });
    expect((await doer.get(`/api/caps/${cap.id}`)).status).toBe(404);
    expect((await doer.get('/api/caps/register')).body.rows.some((r: any) => r.id === cap.id)).toBe(false);
    // Figures count every plan for everyone.
    const mine = (await doer.get('/api/caps/summary')).body;
    const all = (await lead.get('/api/caps/summary')).body;
    expect(mine.open).toBe(all.open);
    expect(mine.restricted).toBeGreaterThan(0);
  });

  it('people cannot set workflow statuses or close a plan with open actions', async () => {
    const cap = await newCap(lead);
    expect((await lead.patch(`/api/caps/${cap.id}`, { status: 'approved' })).status).toBe(400);
    expect((await lead.post('/api/caps', { title: 'x', problem_statement: 'y', status: 'closed' })).status).toBe(400);
    await addAction(lead, cap.id);
    await approveDirect(cap.id);
    expect((await lead.patch(`/api/caps/${cap.id}`, { status: 'closed' })).status).toBe(409);
  });
});

describe('verification (C2)', () => {
  it('done becomes awaiting verification; effective finishes it and closes the plan', async () => {
    const cap = await newCap(lead);
    await approveDirect(cap.id);
    const a = await addAction(lead, cap.id, { verifier_id: lead.userId });
    const set = await doer.patch(`/api/actions/${a.id}`, { status: 'done' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ status: 'pending_verification', completed_on: plus(0) });
    expect(set.body.verification_due).toBe(plus(30));
    expect((await capOf(cap.id)).status).toBe('verifying');
    // Setting done again by hand is refused; it waits for the verification.
    expect((await doer.patch(`/api/actions/${a.id}`, { status: 'done' })).status).toBe(409);
    // Only the named verifier or someone who may approve actions records it.
    expect((await doer.post(`/api/actions/${a.id}/verify`, { method: 'observation', result: 'effective' })).status).toBe(403);
    expect((await lead.post(`/api/actions/${a.id}/verify`, { method: 'nope', result: 'effective' })).status).toBe(400);
    const v = await lead.post(`/api/actions/${a.id}/verify`, { method: 'observation', result: 'effective', note: 'Invented: markings visible at night' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body).toMatchObject({ status: 'done', verification_result: 'effective', verified_by: lead.userId });
    const closed = await capOf(cap.id);
    expect(closed.status).toBe('closed');
    expect(closed.closed_on).toBe(plus(0));
  });

  it('not effective reopens the action with the reason and moves the plan back to in progress', async () => {
    const cap = await newCap(lead);
    await approveDirect(cap.id);
    const a = await addAction(lead, cap.id);
    await lead.patch(`/api/actions/${a.id}`, { status: 'done' });
    expect((await lead.post(`/api/actions/${a.id}/verify`, { method: 're_inspection', result: 'not_effective' })).body.error.fields.note).toBeDefined();
    const v = await lead.post(`/api/actions/${a.id}/verify`, { method: 're_inspection', result: 'not_effective', note: 'Invented: paint wore off within a week' });
    expect(v.body).toMatchObject({ status: 'in_progress', completed_on: null, verification_result: 'not_effective' });
    expect((await capOf(cap.id)).status).toBe('in_progress');
    const audit = await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'action.verification_failed' and record_id = $1`, [a.id]);
    expect(audit!.summary).toMatch(/paint wore off/);
  });

  it('an action without verification finishes as before, and the open-action status list keeps it open', async () => {
    const plain = (await lead.post('/api/actions', { title: 'Invented: replace a bulb' })).body;
    expect((await lead.patch(`/api/actions/${plain.id}`, { status: 'done' })).body.status).toBe('done');
    const statuses = (await t.db.query<any>(`select value, meta from lookups where list_key = 'action_status' and value = 'pending_verification'`));
    expect(statuses[0].meta.closed).toBeUndefined();
    expect((await lead.get('/api/actions/summary')).body.open_statuses).toContain('pending_verification');
  });
});

describe('closure evidence (E23-04)', () => {
  it('actions from a listed source need evidence before they finish', async () => {
    await t.db.query(`insert into settings (key, value) values ('actions.closure_evidence_sources', '["audit"]'::jsonb) on conflict (key) do update set value = excluded.value`);
    const a = (await lead.post('/api/actions', { title: 'Invented audit item', source: 'audit' })).body;
    const refused = await lead.patch(`/api/actions/${a.id}`, { status: 'done' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.closure_evidence).toBeDefined();
    expect((await lead.patch(`/api/actions/${a.id}`, { status: 'done', closure_evidence: 'Invented: photo of the repaired door' })).body.status).toBe('done');
    await t.db.query(`delete from settings where key = 'actions.closure_evidence_sources'`);
  });
});

describe.runIf(workflows)('approval workflows (E23-02, E23-05)', () => {
  it('installs both default workflows once', async () => {
    const defs = (await t.api.get('/api/workflows/definitions')).body.rows.map((d: any) => d.kind);
    expect(defs.filter((k: string) => k === 'cap_approval')).toHaveLength(1);
    expect(defs.filter((k: string) => k === 'action_extension')).toHaveLength(1);
  });

  it('submits a plan, and the approval records who approved it', async () => {
    const cap = await newCap(doer);
    expect((await doer.post(`/api/caps/${cap.id}/submit`)).status).toBe(400); // no root cause
    await doer.patch(`/api/caps/${cap.id}`, { root_cause: 'Invented: wrong paint for the surface' });
    expect((await doer.post(`/api/caps/${cap.id}/submit`)).status).toBe(409); // no actions
    await addAction(doer, cap.id);
    const sub = await doer.post(`/api/caps/${cap.id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.status).toBe('submitted');
    const item = (await lead.get('/api/workflows/approvals')).body.rows.find((r: any) => r.record_id === cap.id);
    expect(item).toMatchObject({ kind: 'cap_approval' });
    expect((await lead.post(`/api/workflows/steps/${item.step_id}/decision`, { decision: 'approved' })).status).toBe(200);
    const after = await capOf(cap.id);
    expect(after).toMatchObject({ status: 'approved', approved_on: plus(0) });
    expect(after.approved_by_name).toMatch(/security_lead/);
    expect((await doer.get(`/api/caps/${cap.id}/approval`)).body.request).toMatchObject({ status: 'approved' });
  });

  it('locks the due date of an approved plan\'s actions and extends it through approval', async () => {
    const cap = await newCap(lead);
    const a = await addAction(lead, cap.id, { due_on: plus(5) });
    await approveDirect(cap.id);
    expect((await doer.patch(`/api/actions/${a.id}`, { due_on: plus(20) })).status).toBe(400);
    expect((await doer.post(`/api/actions/${a.id}/extension-request`, { new_due_on: plus(2), reason: 'x' })).status).toBe(400);
    const asked = await doer.post(`/api/actions/${a.id}/extension-request`, { new_due_on: plus(20), reason: 'Invented: paint supplier delay' });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    expect((await doer.post(`/api/actions/${a.id}/extension-request`, { new_due_on: plus(21), reason: 'again' })).status).toBe(409);
    const item = (await lead.get('/api/workflows/approvals')).body.rows.find((r: any) => r.record_id === a.id && r.kind === 'action_extension');
    await lead.post(`/api/workflows/steps/${item.step_id}/decision`, { decision: 'approved' });
    const after = (await lead.get(`/api/actions/${a.id}`)).body;
    expect(after).toMatchObject({ due_on: plus(20), original_due_on: plus(5), extension_count: 1 });
    const hist = (await doer.get(`/api/actions/${a.id}/extension-requests`)).body;
    expect(hist.requests[0]).toMatchObject({ status: 'approved', new_due_on: plus(20), reason: 'Invented: paint supplier delay' });
  });
});

describe('register, reminders and metrics (E23-06, E23-08, E23-09)', () => {
  it('filters the register and counts actions', async () => {
    const cap = await newCap(lead, { due_on: plus(-3), title: 'Invented overdue plan' });
    await approveDirect(cap.id);
    const a = await addAction(lead, cap.id);
    await lead.patch(`/api/actions/${a.id}`, { status: 'done' });
    const reg = (await lead.get('/api/caps/register?overdue=1&awaiting=1')).body.rows;
    const row = reg.find((r: any) => r.id === cap.id);
    expect(row).toMatchObject({ overdue: true, actions_total: 1, actions_awaiting_verification: 1 });
    // The plan keeps its counts for list filters: the register's "Actions to verify" view.
    const listed = (await lead.get('/api/caps?f.actions_awaiting.gt=0&pageSize=200')).body.rows;
    expect(listed.find((r: any) => r.id === cap.id)).toMatchObject({ actions_total: 1, actions_done: 0, actions_awaiting: 1 });
    expect(reg.every((r: any) => r.overdue)).toBe(true);
  });

  it('is scheduled and reminds the verifier once', async () => {
    expect(await t.db.one(`select every_seconds from job_schedules where name = 'actions.verification_due'`)).toEqual({ every_seconds: 6 * 3600 });
    if (!t.app.hasDecorator('notify')) return;
    const cap = await newCap(lead);
    await approveDirect(cap.id);
    const a = await addAction(lead, cap.id, { verifier_id: doer.userId, title: 'Invented reminder probe' });
    await lead.patch(`/api/actions/${a.id}`, { status: 'done', verification_due: plus(3) });
    await runVerificationReminders(t.ctx);
    await runVerificationReminders(t.ctx);
    const n = await t.db.query(`select 1 from notifications where user_id = $1 and title like '%Invented reminder probe%'`, [doer.userId]);
    expect(n).toHaveLength(1);
  });

  it('offers the three metrics', async () => {
    const keys = metricsAvailable(t.app, t.ctx.resources).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['actions.overdue', 'actions.caps_overdue', 'actions.awaiting_verification']));
    const res = (await doer.get(`/api/metrics?month=${plus(0).slice(0, 7)}`)).body.metrics;
    const awaiting = res.find((m: any) => m.key === 'actions.awaiting_verification');
    expect(awaiting.value).toBeGreaterThan(0);
    expect(res.find((m: any) => m.key === 'actions.caps_overdue').value).toBeGreaterThan(0);
  });
});

describe('sample data (E23-10)', () => {
  it('adds four plans in different states on the sample risks, once, and only for the dev profile', async () => {
    const { seedCaps } = await import('./seed-caps.ts');
    expect(await seedCaps(t.ctx, { profile: 'pilot', seedDir: '' })).toBeNull();
    for (const title of ['[Sample] CAD/AVL outage during peak service', '[Sample] Ransomware on the fare collection system']) {
      await t.api.post('/api/risks', { title });
    }
    expect(await seedCaps(t.ctx, { profile: 'dev', seedDir: '' })).toMatch(/4 sample corrective action plans/);
    expect(await seedCaps(t.ctx, { profile: 'dev', seedDir: '' })).toBeNull();
    const rows = (await t.api.get('/api/caps/register?q=[Sample]')).body.rows;
    const states = rows.map((r: any) => r.status).sort();
    expect(states).toEqual(workflows ? ['closed', 'in_progress', 'submitted', 'verifying'] : ['approved', 'closed', 'in_progress', 'verifying']);
    expect(rows.every((r: any) => r.restricted)).toBe(true);
    const closed = rows.find((r: any) => r.status === 'closed');
    expect(closed.closed_on < plus(0)).toBe(true);
  });
});
