import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarSources } from '../../core/calendar.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runLifecycle } from './index.ts';
import { addMonths, runLifecycleReminders } from './lifecycle.ts';
import { startEndedContracts } from './offboarding.ts';

// The vendor risk lifecycle (E35): reassessment cadence, exclusion-list checks, vendor issues,
// offboarding when a contract ends, the lifecycle figures and the switched-off area.
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let editor: Client;   // vendors and contracts view and edit, no approval
let lead: Client;     // security lead: vendors.* and contracts.*, actions.*
let agent: Client;    // vendors.view only
const before = process.env.GRC_MODULES;

const notes = (userId: string, recordId: string) =>
  t.db.query<Row>('select title, kind from notifications where user_id = $1 and record_id = $2 order by created_at', [userId, recordId]);
const audit = (action: string, recordId: string) =>
  t.db.query<Row>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, recordId]);

beforeAll(async () => {
  process.env.GRC_MODULES = 'vendors,inventory,risks,workflows,notifications,attachments,admin';
  t = await testApp();
  const role = (await t.db.one<Row>(`insert into roles (key, name) values ('vendor_editor', 'Vendor editor (test)') returning id`))!;
  for (const p of ['vendors.view', 'vendors.edit', 'vendors.create', 'contracts.view', 'contracts.edit', 'contracts.create', 'actions.view', 'actions.create']) {
    await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, p]);
  }
  editor = await t.as('vendor_editor');
  lead = await t.as('security_lead');
  agent = await t.as('agent');
}, 90_000);
afterAll(async () => {
  await t?.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

async function newVendor(name: string, extra: Row = {}): Promise<Row> {
  const res = await t.api.post('/api/vendors', { name, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

async function completeAssessment(vendorId: string, assessedOn: string) {
  const a = (await t.api.post(`/api/vendors/${vendorId}/assessments`, {})).body;
  const answers = Object.fromEntries((a.questions as Row[]).map((q) => [q.key, { answer: 'yes' }]));
  expect((await t.api.patch(`/api/vendor-assessments/${a.id}`, { answers })).status).toBe(200);
  expect((await t.api.post(`/api/vendor-assessments/${a.id}/complete`, { assessed_on: assessedOn })).status).toBe(200);
}

describe('reassessment cadence by criticality', () => {
  it('works the next assessment date out from the criticality and the last completed assessment', async () => {
    const v = await newVendor('Cadence Works', { criticality: 'critical' });
    expect(v.next_assessment_due).toBe(dayInZone()); // never assessed: due from the day it was added
    const assessed = dayInZone(-30);
    await completeAssessment(v.id, assessed);
    let row = (await t.api.get(`/api/vendors/${v.id}`)).body;
    expect(row.last_assessed_on).toBe(assessed);
    expect(row.next_assessment_due).toBe(addMonths(assessed, 12));
    // A lower criticality brings a longer cadence.
    expect((await t.api.patch(`/api/vendors/${v.id}`, { criticality: 'low' })).status).toBe(200);
    row = (await t.api.get(`/api/vendors/${v.id}`)).body;
    expect(row.next_assessment_due).toBe(addMonths(assessed, 36));
    // People cannot set the worked-out dates.
    await t.api.patch(`/api/vendors/${v.id}`, { next_assessment_due: '2099-01-01' });
    expect((await t.api.get(`/api/vendors/${v.id}`)).body.next_assessment_due).toBe(addMonths(assessed, 36));
  });

  it('lets an administrator change the months, which recomputes every vendor; empty means never due', async () => {
    const v = await newVendor('Cadence Medium', { criticality: 'medium' });
    expect((await agent.put('/api/vendors/lifecycle-settings', { cadence: [{ value: 'medium', months: 6 }] })).status).toBe(403);
    expect((await t.api.put('/api/vendors/lifecycle-settings', { cadence: [{ value: 'medium', months: 0 }] })).status).toBe(400);
    const res = await t.api.put('/api/vendors/lifecycle-settings', { cadence: [{ value: 'medium', months: null }], reminder_days: 45, exclusion_months: 6 });
    expect(res.status).toBe(200);
    expect(res.body.cadence.find((c: Row) => c.value === 'medium').months).toBeNull();
    expect(res.body).toMatchObject({ reminder_days: 45, exclusion_months: 6, exclusion_before_contract: false });
    expect((await t.api.get(`/api/vendors/${v.id}`)).body.next_assessment_due).toBeNull();
    await t.api.put('/api/vendors/lifecycle-settings', { cadence: [{ value: 'medium', months: 24 }], reminder_days: 30, exclusion_months: 12 });
    expect((await t.api.get(`/api/vendors/${v.id}`)).body.next_assessment_due).toBe(dayInZone());
  });

  it('lists vendors due within a window, overdue ones first', async () => {
    const v = await newVendor('Overdue Partners', { criticality: 'high' });
    await completeAssessment(v.id, addMonths(dayInZone(), -13));
    const due = (await agent.get('/api/vendors/reassessments?due_within=30')).body;
    const row = due.rows.find((r: Row) => r.id === v.id);
    expect(row).toMatchObject({ assessment_overdue: true, cadence_months: 12, criticality_label: 'High' });
    expect((await agent.get('/api/vendors/lifecycle-summary')).body.reassessments_overdue).toBeGreaterThanOrEqual(1);
  });

  it('reminds the owner once, however many runs overlap', async () => {
    const v = await newVendor('Reminder Twice', { criticality: 'critical', owner_id: editor.userId });
    await Promise.all([runLifecycleReminders(t.ctx), runLifecycleReminders(t.ctx), runLifecycleReminders(t.ctx)]);
    const sent = (await notes(editor.userId, v.id)).filter((n) => n.title.includes('reassessment'));
    expect(sent).toHaveLength(1);
    await runLifecycleReminders(t.ctx);
    expect((await notes(editor.userId, v.id)).filter((n) => n.title.includes('reassessment'))).toHaveLength(1);
  });
});

describe('exclusion-list checks', () => {
  it('records checks against a list the organization names, and tells the owner about a match', async () => {
    const v = await newVendor('Exclusion Checked', { owner_id: editor.userId });
    const url = `/api/vendors/${v.id}/exclusion-checks`;
    expect((await agent.post(url, { list_key: 'government_exclusion_list', result: 'clear' })).status).toBe(403);
    expect((await editor.post(url, { list_key: 'made_up', result: 'clear' })).status).toBe(400);
    expect((await editor.post(url, { list_key: 'government_exclusion_list', result: 'match' })).body.error.fields.note).toBeTruthy();
    expect((await editor.post(url, { list_key: 'government_exclusion_list', result: 'clear', checked_on: dayInZone(5) })).status).toBe(400);
    const clear = await editor.post(url, { list_key: 'government_exclusion_list', result: 'clear', checked_on: dayInZone(-400), reference: 'REF-1' });
    expect(clear.status).toBe(201);
    let list = (await agent.get(url)).body;
    expect(list.overdue).toBe(true);
    expect(list.rows[0]).toMatchObject({ result: 'clear', list_label: 'Government exclusion list (rename to yours)', reference: 'REF-1' });
    expect((await t.api.get(`/api/vendors/${v.id}`)).body.last_exclusion_check_on).toBe(dayInZone(-400));
    const match = await editor.post(url, { list_key: 'government_exclusion_list', result: 'match', note: 'Same registration number (test).' });
    expect(match.status).toBe(201);
    list = (await agent.get(url)).body;
    expect(list).toMatchObject({ overdue: false, latest_result: 'match' });
    expect((await notes(editor.userId, v.id)).some((n) => n.title.includes('found a match'))).toBe(true);
    expect((await audit('vendor.exclusion_check', v.id))).toHaveLength(2);
  });

  it('blocks contract activation while the setting is on and the vendor has no recent clear check', async () => {
    const v = await newVendor('Activation Gate');
    const draft = await editor.post('/api/contracts', { title: 'Gate contract', vendor_id: v.id, status: 'draft' });
    expect(draft.status).toBe(201);
    expect((await t.api.put('/api/vendors/lifecycle-settings', { exclusion_before_contract: true })).status).toBe(200);
    try {
      const refused = await editor.patch(`/api/contracts/${draft.body.id}`, { status: 'active' });
      expect(refused.status).toBe(400);
      expect(refused.body.error.fields.status).toContain('exclusion-list check');
      expect((await editor.post('/api/contracts', { title: 'Gate contract 2', vendor_id: v.id })).status).toBe(400);
      await editor.post(`/api/vendors/${v.id}/exclusion-checks`, { list_key: 'government_exclusion_list', result: 'match', note: 'Match (test).' });
      expect((await editor.patch(`/api/contracts/${draft.body.id}`, { status: 'active' })).body.error.fields.status).toContain('found a match');
      await editor.post(`/api/vendors/${v.id}/exclusion-checks`, { list_key: 'government_exclusion_list', result: 'clear' });
      expect((await editor.patch(`/api/contracts/${draft.body.id}`, { status: 'active' })).status).toBe(200);
      // Moving the active contract to a vendor with no check is refused too (W23 F3).
      const other = await newVendor('Activation Gate Other');
      const moved = await editor.patch(`/api/contracts/${draft.body.id}`, { vendor_id: other.id });
      expect(moved.status).toBe(400);
      expect(moved.body.error.fields.vendor_id).toContain('exclusion-list check');
      expect((await t.api.get(`/api/contracts/${draft.body.id}`)).body.vendor_id).toBe(v.id);
    } finally {
      await t.api.put('/api/vendors/lifecycle-settings', { exclusion_before_contract: false });
    }
  });

  it('clears the checks\' people and notes, and the vendor\'s contacts, when the vendor is anonymized', async () => {
    const v = await newVendor('Anonymized Supplier');
    await t.api.post(`/api/vendors/${v.id}/contacts`, { name: 'Robin Contact', email: 'robin@example.test', phone: '555-0100' });
    await editor.post(`/api/vendors/${v.id}/exclusion-checks`, { list_key: 'government_exclusion_list', result: 'possible_match', note: 'Robin checked by phone (test).' });
    await t.db.query(`update vendors set created_at = now() - interval '12 years', updated_at = now() - interval '12 years' where id = $1`, [v.id]);
    expect((await t.api.put('/api/admin/retention/vendor', { periodMonths: 24, disposal: 'anonymize' })).status).toBe(200);
    await t.core.retention.sweep();
    const review = (await t.api.get('/api/admin/retention/reviews?record_type=vendor')).body.rows.find((r: Row) => r.record_id === v.id);
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
    expect((await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'End of the schedule (test).', confirm: true })).status).toBe(200);
    const check = await t.db.one<Row>('select checked_by, note, result from vendor_exclusion_checks where vendor_id = $1', [v.id]);
    expect(check).toMatchObject({ checked_by: null, result: 'possible_match' });
    expect(check!.note).not.toContain('Robin');
    const contact = await t.db.one<Row>('select name, email, phone from vendor_contacts where vendor_id = $1', [v.id]);
    expect(contact).toMatchObject({ email: null, phone: null });
    expect(contact!.name).not.toContain('Robin');
  });
});

describe('vendor issues', () => {
  it('tracks an issue to resolution and raises a corrective action plan from it', async () => {
    const v = await newVendor('Issue Prone');
    const res = await editor.post('/api/vendor-issues', { vendor_id: v.id, title: 'Outage (test)', category: 'service_failure', severity: 'high' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'open', raised_on: dayInZone() });
    expect(res.body.ref).toMatch(/^VIS-/);
    expect((await agent.post(`/api/vendor-issues/${res.body.id}/cap`, {})).status).toBe(403);
    const cap = await editor.post(`/api/vendor-issues/${res.body.id}/cap`, {});
    expect(cap.status).toBe(201);
    const plan = (await t.api.get(`/api/caps/${cap.body.cap.id}`)).body;
    expect(plan).toMatchObject({ source: 'vendor', source_type: 'vendor_issue', source_id: res.body.id });
    expect((await t.api.get(`/api/vendor-issues/${res.body.id}`)).body).toMatchObject({ cap_id: cap.body.cap.id, status: 'in_progress' });
    expect((await editor.post(`/api/vendor-issues/${res.body.id}/cap`, {})).status).toBe(409);
    expect((await editor.patch(`/api/vendor-issues/${res.body.id}`, { status: 'resolved' })).status).toBe(400);
    const done = await editor.patch(`/api/vendor-issues/${res.body.id}`, { status: 'resolved', resolution: 'Fixed (test).' });
    expect(done.status).toBe(200);
    expect(done.body.resolved_on).toBe(dayInZone());
  });
});

describe('offboarding', () => {
  let vendor: Row;
  let contract: Row;
  let system: Row;
  let asset: Row;

  beforeAll(async () => {
    vendor = await newVendor('Offboard Me', { remote_access_method: 'Vendor support tool (test)' });
    contract = (await editor.post('/api/contracts', { title: 'Ending contract', vendor_id: vendor.id, owner_id: editor.userId })).body;
    system = (await t.api.post('/api/systems', { name: 'Offboarded system', vendor_id: vendor.id })).body;
    asset = (await t.api.post('/api/assets', { name: 'Vendor laptop', vendor_id: vendor.id, contract_id: contract.id })).body;
    await t.api.post('/api/assets', { name: 'Old laptop', vendor_id: vendor.id, status: 'disposed', disposed_on: dayInZone(-10), disposal_approved_by: 'Test', disposal_approved_on: dayInZone(-11), disposal_method: 'Recycled' });
    const cat = (await t.api.post('/api/data-categories', { name: 'Vendor-held records' })).body;
    await t.db.query('insert into system_data_categories (system_id, data_category_id) values ($1, $2)', [system.id, cat.id]);
  });

  it('starts once when the contract ends, with items from the inventory and the template', async () => {
    expect((await editor.patch(`/api/contracts/${contract.id}`, { status: 'terminated' })).status).toBe(200);
    const list = (await agent.get(`/api/vendor-offboardings?f.contract_id=${contract.id}`)).body;
    expect(list.total).toBe(1);
    const ob = list.rows[0];
    expect(ob).toMatchObject({ trigger: 'terminated', status: 'open', owner_id: editor.userId });
    const items = (await agent.get(`/api/vendor-offboardings/${ob.id}/items`)).body;
    const kinds = items.items.map((i: Row) => `${i.kind}:${i.record?.type ?? ''}`);
    expect(kinds).toEqual(expect.arrayContaining(['account_access:system', 'remote_access:system', 'asset_return:asset', 'data_return:data_category', 'other:']));
    expect(items.items.filter((i: Row) => i.kind === 'asset_return')).toHaveLength(1); // the disposed one is left out
    expect(items.items.find((i: Row) => i.kind === 'asset_return').record.id).toBe(asset.id);
    // Moving the status again starts nothing new, and refreshing adds no duplicates.
    await editor.patch(`/api/contracts/${contract.id}`, { status: 'expired' });
    expect((await agent.get(`/api/vendor-offboardings?f.contract_id=${contract.id}`)).body.total).toBe(1);
    const refreshed = (await editor.post(`/api/vendor-offboardings/${ob.id}/refresh-items`, {})).body;
    expect(refreshed.added).toBe(0);
    expect((await notes(editor.userId, ob.id)).length).toBe(0); // the person who started it is not told about it
  });

  it('works through the items and signs off directly without a workflow (vendors.approve)', async () => {
    const ob = (await agent.get(`/api/vendor-offboardings?f.contract_id=${contract.id}`)).body.rows[0];
    let items = (await editor.get(`/api/vendor-offboardings/${ob.id}/items`)).body.items as Row[];
    expect((await editor.post(`/api/vendor-offboardings/${ob.id}/sign-off`, {})).status).toBe(409);
    expect((await editor.post(`/api/vendor-offboardings/${ob.id}/items/${items[0].id}`, { status: 'not_applicable' })).status).toBe(400);
    for (const [i, item] of items.entries()) {
      const r = await editor.post(`/api/vendor-offboardings/${ob.id}/items/${item.id}`, i % 2 ? { status: 'not_applicable', evidence_note: 'Never issued (test).' } : { status: 'done', evidence_note: 'Done (test).' });
      expect(r.status).toBe(200);
    }
    expect((await t.api.get(`/api/vendor-offboardings/${ob.id}`)).body.status).toBe('in_progress');
    items = (await editor.get(`/api/vendor-offboardings/${ob.id}/items`)).body.items;
    expect(items.every((i) => i.status !== 'to_do' && (i.status === 'not_applicable' || i.done_by_name))).toBe(true);
    // No workflow and no approval permission: refused.
    expect((await editor.post(`/api/vendor-offboardings/${ob.id}/sign-off`, {})).status).toBe(403);
    const signed = await lead.post(`/api/vendor-offboardings/${ob.id}/sign-off`, {});
    expect(signed.status).toBe(200);
    expect(signed.body.workflow).toBeNull();
    expect((await t.api.get(`/api/vendor-offboardings/${ob.id}`)).body).toMatchObject({ status: 'signed_off', signed_off_on: dayInZone() });
    expect((await editor.post(`/api/vendor-offboardings/${ob.id}/items/${items[0].id}`, { status: 'to_do' })).status).toBe(409);
    expect((await editor.patch(`/api/vendor-offboardings/${ob.id}`, { status: 'open' })).status).toBe(400);
  });

  it('goes through the approval workflow when one of the kind is active', async () => {
    const v = await newVendor('Offboard Through Approval');
    const ob = (await editor.post('/api/vendor-offboardings', { vendor_id: v.id, trigger: 'vendor_exit' })).body;
    expect(ob.ref).toMatch(/^OFB-/);
    const wf = await t.api.post('/api/workflows/definitions', {
      record_type: 'vendor_offboarding', kind: 'vendor_offboarding', name: 'Offboarding sign-off (test)',
      steps: [{ name: 'Vendor manager', approvers: { kind: 'users', users: [lead.userId] } }],
    });
    expect(wf.status).toBe(201);
    try {
      for (const item of (await editor.get(`/api/vendor-offboardings/${ob.id}/items`)).body.items) {
        await editor.post(`/api/vendor-offboardings/${ob.id}/items/${item.id}`, { status: 'done' });
      }
      const asked = await editor.post(`/api/vendor-offboardings/${ob.id}/sign-off`, {});
      expect(asked.status).toBe(202);
      expect(asked.body.approval.running).toBeTruthy();
      expect((await editor.post(`/api/vendor-offboardings/${ob.id}/sign-off`, {})).status).toBe(409);
      const waiting = (await lead.get('/api/workflows/approvals')).body.rows.find((r: Row) => r.record_id === ob.id);
      expect((await lead.post(`/api/workflows/steps/${waiting.step_id}/decision`, { decision: 'approved' })).status).toBe(200);
      const row = (await t.api.get(`/api/vendor-offboardings/${ob.id}`)).body;
      expect(row.status).toBe('signed_off');
      expect(row.signed_off_by_name).toContain('security_lead');
    } finally {
      await t.api.del(`/api/workflows/definitions/${wf.body.id}`);
    }
  });

  it('starts nightly for a contract whose end date passed with no renewal, once across overlapping runs', async () => {
    const v = await newVendor('Quietly Ended');
    const c = (await t.api.post('/api/contracts', { title: 'Lapsed', vendor_id: v.id, renewal_mechanism: 'fixed', start_date: dayInZone(-400), end_date: dayInZone(-3) })).body;
    const renews = (await t.api.post('/api/contracts', { title: 'Renews', vendor_id: v.id, renewal_mechanism: 'auto_renew', start_date: dayInZone(-400), end_date: dayInZone(-3) })).body;
    await Promise.all([startEndedContracts(t.ctx), startEndedContracts(t.ctx)]);
    expect((await t.api.get(`/api/vendor-offboardings?f.contract_id=${c.id}`)).body.total).toBe(1);
    expect((await t.api.get(`/api/vendor-offboardings?f.contract_id=${renews.id}`)).body.total).toBe(0);
    expect((await t.api.get(`/api/vendor-offboardings?f.contract_id=${c.id}`)).body.rows[0].trigger).toBe('contract_ended');
    const ran = await runLifecycle(t.ctx);
    expect(ran.offboardings).toBe(0);
  });

  it('clears the people and notes of its items when anonymized at the end of retention', async () => {
    const ob = (await agent.get(`/api/vendor-offboardings?f.contract_id=${contract.id}`)).body.rows[0];
    await t.db.query(`update vendor_offboardings set created_at = now() - interval '9 years', updated_at = now() - interval '9 years' where id = $1`, [ob.id]);
    expect((await t.api.put('/api/admin/retention/vendor_offboarding', { periodMonths: 24, disposal: 'anonymize' })).status).toBe(200);
    await t.core.retention.sweep();
    const review = (await t.api.get('/api/admin/retention/reviews?record_type=vendor_offboarding')).body.rows.find((r: Row) => r.record_id === ob.id);
    expect(review).toBeTruthy();
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
    expect((await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'End of the schedule (test).', confirm: true })).status).toBe(200);
    const items = await t.db.query<Row>('select done_by, evidence_note from vendor_offboarding_items where offboarding_id = $1', [ob.id]);
    expect(items.every((i) => i.done_by === null && (i.evidence_note === null || !i.evidence_note.includes('test')))).toBe(true);
  });
});

describe('figures, calendar and the switched-off area', () => {
  it('offers its metrics and the reassessment calendar source to people who may see vendors', async () => {
    const keys = metricsAvailable(t.app, t.ctx.resources).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['vendors.reassessments_overdue', 'vendors.open_issues']));
    const month = dayInZone().slice(0, 7);
    const values = (await t.api.get(`/api/metrics?month=${month}`)).body;
    const overdue = (values.metrics ?? values).find((m: Row) => m.key === 'vendors.reassessments_overdue');
    expect(overdue.value).toBeGreaterThanOrEqual(1);
    const v = await newVendor('Calendar Owner', { criticality: 'critical', owner_id: editor.userId });
    const user = { id: editor.userId, permissions: ['vendors.view'] } as never;
    const src = calendarSources(t.app, t.ctx.resources, user).find((s) => s.key === 'vendors.reassessments')!;
    expect(src).toBeTruthy();
    const events = await src.events(t.ctx, user, dayInZone(-1), dayInZone(1));
    expect(events.map((e) => e.recordId)).toContain(v.id);
    const summary = (await agent.get('/api/vendors/lifecycle-summary')).body;
    expect(Object.keys(summary).sort()).toEqual(['checks_outstanding', 'exclusion_checks_overdue', 'offboardings_open', 'open_issues', 'reassessments_overdue']);
  });

  it('disappears with the vendors area', async () => {
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
    expect((await t.api.patch('/api/admin/features', { features: { vendors: false } })).status).toBe(200);
    try {
      for (const url of ['/api/vendor-issues', '/api/vendor-offboardings', '/api/vendors/reassessments', '/api/vendors/lifecycle-summary']) {
        const res = await t.api.get(url);
        expect(res.status, url).toBe(404);
        expect(res.body.error.code, url).toBe('switched_off');
      }
      const meta = (await t.api.get('/api/meta')).body;
      expect(meta.resources.vendor_issue).toBeUndefined();
      expect(meta.lookups.exclusion_list).toBeUndefined();
      expect(meta.lookups.offboarding_item_template).toBeUndefined();
      const keys = metricsAvailable(t.app, t.ctx.resources).map((m) => m.key);
      expect(keys.some((k) => k.startsWith('vendors.'))).toBe(false);
      expect(calendarSources(t.app, t.ctx.resources, { id: editor.userId, permissions: ['vendors.view'] } as never).some((s) => s.key.startsWith('vendors.'))).toBe(false);
    } finally {
      await t.api.patch('/api/admin/features', { features: { vendors: true } });
    }
  });
});
