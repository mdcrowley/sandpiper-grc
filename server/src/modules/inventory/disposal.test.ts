import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { displayDate } from '../../core/timezone.ts';
import { stepFor, when } from './reminders.ts';

// Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const history = async (id: string) =>
  (await t.api.get(`/api/history?record_type=asset&record_id=${id}`)).body.map((h: any) => h.action);
const day = async (offset: number) => (await t.db.one<{ d: string }>('select (current_date + $1::int)::text as d', [offset]))!.d;

const wfLoaded = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');
const request = (client: any, assetId: string, body: Record<string, unknown> = {}) =>
  client.post(`/api/assets/${assetId}/disposal-requests`, { reason: 'Beyond repair', ...body });
const decideOld = (client: any, assetId: string, rid: string, decision: string, comment?: string) =>
  client.post(`/api/assets/${assetId}/disposal-requests/${rid}/decision`, { decision, comment });
const onAsset = async (client: any, id: string) => (await client.get(`/api/workflows/records/asset/${id}`)).body;

// E04-24: disposal requests run on the shared approval workflows (the "Asset disposal" kind).
describe.runIf(wfLoaded)('routed disposal approval', () => {
  it('starts the Asset disposal workflow, and its approval writes the approver and the date and unlocks disposal', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const asset = (await agent.post('/api/assets', { name: 'Worn-out projector', status: 'retired' })).body;

    expect((await agent.post(`/api/assets/${asset.id}/disposal-requests`, {})).body.error.fields.reason).toBeTruthy();
    const asked = await request(agent, asset.id, { reason: 'Lamp failed; beyond repair', disposal_method: 'Recycled' });
    expect(asked.status).toBe(201);
    expect(asked.body.workflow).toBe('Asset disposal');
    expect(asked.body.approvers).toBeGreaterThan(0);
    expect((await agent.get(`/api/assets/${asset.id}`)).body).toMatchObject({ disposal_request_status: 'pending', disposal_method: 'Recycled', status: 'retired' });
    expect((await request(agent, asset.id, { reason: 'Again' })).status).toBe(409);

    // The workflow runs on the asset, with one step (no funder interest), and is on the approver's Approvals page.
    const panel = await onAsset(approver, asset.id);
    expect(panel.instances[0]).toMatchObject({ workflow: 'Asset disposal', kind: 'asset_disposal', status: 'running', kind_label: 'Asset disposal' });
    expect(panel.startable).toEqual([]);
    const waiting = (await approver.get('/api/workflows/approvals')).body.rows;
    expect(waiting.find((w: any) => w.record_id === asset.id)).toMatchObject({ workflow: 'Asset disposal', step: 'Inventory manager' });

    // The queue shows it with the workflow's progress; the requester cannot decide (either way); a refusal needs a reason.
    const queue = (await approver.get('/api/assets/disposal-requests')).body;
    expect(queue.find((r: any) => r.id === asked.body.id)).toMatchObject({ asset_name: 'Worn-out projector', own: false, status: 'pending', workflow: { name: 'Asset disposal', can_decide: true } });
    const own = await decideOld(agent, asset.id, asked.body.id, 'approve');
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('self_approval');
    const step = panel.instances[0].steps[0].id;
    expect((await agent.post(`/api/workflows/steps/${step}/decision`, { decision: 'approved' })).status).toBe(403);
    expect((await decideOld(approver, asset.id, asked.body.id, 'refuse')).body.error.fields.comment).toBeTruthy();
    expect((await decideOld(approver, asset.id, asked.body.id, 'maybe')).status).toBe(400);
    expect((await decideOld(await t.as('auditor'), asset.id, asked.body.id, 'approve')).status).toBe(403);

    const decided = await decideOld(approver, asset.id, asked.body.id, 'approve', 'Agreed');
    expect(decided.body).toMatchObject({ status: 'approved', decision_comment: 'Agreed', decided_by: approver.userId });
    const approved = (await agent.get(`/api/assets/${asset.id}`)).body;
    expect(approved.disposal_request_status).toBe('approved');
    expect(approved.disposal_approved_by).toMatch(/^Test approver/);
    expect(approved.disposal_approved_on).toBe(await day(0));
    expect((await onAsset(agent, asset.id)).instances[0].status).toBe('approved');
    expect((await decideOld(approver, asset.id, asked.body.id, 'refuse', 'Late')).status).toBe(409);

    // The disposal step now needs no typed approval, and a retyped approver name is ignored.
    const done = await agent.post(`/api/assets/${asset.id}/dispose`, { disposal_approved_by: 'Someone Else' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('disposed');
    expect(done.body.disposal_approved_by).toMatch(/^Test approver/);
    expect(await history(asset.id)).toEqual(expect.arrayContaining(['asset.disposal_requested', 'workflow.start', 'workflow.decide', 'asset.disposal_approved', 'asset.dispose']));
    expect((await request(agent, asset.id, { reason: 'Too late' })).status).toBe(409);

    if (t.app.hasDecorator('notify')) {
      const forApprover = (await approver.get('/api/notifications')).body.rows.map((n: any) => n.title);
      expect(forApprover).toContain(`Approval needed: asset Worn-out projector`);
      const forAgent = (await agent.get('/api/notifications')).body.rows.map((n: any) => n.title);
      expect(forAgent).toContain(`Approved: asset Worn-out projector`);
      expect(forAgent.some((x: string) => x.startsWith('Approval needed'))).toBe(false);
    }
  });

  it('records a refusal, lets the request be made again, and a withdrawal cancels the workflow', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const asset = (await agent.post('/api/assets', { name: 'Spare monitor' })).body;
    const first = (await request(agent, asset.id, { reason: 'Surplus' })).body;
    await decideOld(approver, asset.id, first.id, 'refuse', 'Still needed at the branch');
    expect((await agent.get(`/api/assets/${asset.id}`)).body).toMatchObject({ disposal_request_status: 'refused', disposal_approved_by: null });
    expect((await onAsset(agent, asset.id)).instances[0]).toMatchObject({ status: 'rejected', outcome_note: 'Still needed at the branch' });

    const second = (await request(agent, asset.id, { reason: 'Branch has closed' })).body;
    expect((await agent.post(`/api/assets/${asset.id}/disposal-requests/${second.id}/withdraw`)).body.status).toBe('withdrawn');
    expect((await agent.get(`/api/assets/${asset.id}`)).body.disposal_request_status).toBeNull();
    expect((await onAsset(agent, asset.id)).instances[0].status).toBe('canceled');
    const rows = (await agent.get(`/api/assets/${asset.id}/disposal-requests`)).body;
    expect(rows.map((r: any) => r.status)).toEqual(['withdrawn', 'refused']);
    expect(rows[1]).toMatchObject({ decision_comment: 'Still needed at the branch', own: true, workflow: null });
    expect(await history(asset.id)).toEqual(expect.arrayContaining(['asset.disposal_refused', 'asset.disposal_withdrawn']));
    // The status cannot be set by hand.
    await agent.patch(`/api/assets/${asset.id}`, { disposal_request_status: 'approved', location: 'Shelf' });
    expect((await agent.get(`/api/assets/${asset.id}`)).body.disposal_request_status).toBeNull();

    // Canceling the workflow from its panel closes the request too.
    const third = (await request(agent, asset.id, { reason: 'Closing the branch for good' })).body;
    const inst = (await onAsset(agent, asset.id)).instances[0];
    expect((await agent.post(`/api/workflows/instances/${inst.id}/cancel`, { reason: 'Asked by mistake' })).status).toBe(200);
    const after = (await agent.get(`/api/assets/${asset.id}/disposal-requests`)).body.find((r: any) => r.id === third.id);
    expect(after).toMatchObject({ status: 'withdrawn', decision_comment: 'Asked by mistake' });
    expect((await agent.get(`/api/assets/${asset.id}`)).body.disposal_request_status).toBeNull();
  });

  it('adds the funder step only when a funder keeps an interest, and routed-only accepts the approved workflow', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const funded = (await agent.post('/api/assets', { name: 'Funded scanner', funder_interest: true, funder_interest_pct: 60 })).body;
    const asked = (await request(agent, funded.id, { reason: 'Replaced' })).body;
    await decideOld(approver, funded.id, asked.id, 'approve');
    // Still waiting: the funder step comes next.
    expect((await agent.get(`/api/assets/${funded.id}`)).body.disposal_request_status).toBe('pending');
    const panel = await onAsset(agent, funded.id);
    expect(panel.instances[0].steps.map((s: any) => s.status)).toEqual(['approved', 'pending']);
    expect(panel.instances[0].steps[1].name).toBe('Funder\'s approval');
    await t.api.post(`/api/assets/${funded.id}/disposal-requests/${asked.id}/decision`, { decision: 'approve', comment: 'Funder letter received' });
    const done = (await agent.get(`/api/assets/${funded.id}`)).body;
    expect(done.disposal_request_status).toBe('approved');
    expect(done.disposal_approved_by).toBeTruthy();
    const blocked = await agent.post(`/api/assets/${funded.id}/dispose`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('funder_interest_block');
    expect((await agent.post(`/api/assets/${funded.id}/dispose`, { disposal_approval_ref: 'FUNDER-LETTER-9' })).body.status).toBe('disposed');

    // With the funder-interest option off, the funder step is skipped.
    await t.ctx.settings.set('feature_options', { funder_interest: { on: false } });
    try {
      const other = (await agent.post('/api/assets', { name: 'Funded printer' })).body;
      await t.db.query('update assets set funder_interest = true where id = $1', [other.id]);
      const r = (await request(agent, other.id, { reason: 'Broken' })).body;
      await decideOld(approver, other.id, r.id, 'approve');
      expect((await agent.get(`/api/assets/${other.id}`)).body.disposal_request_status).toBe('approved');
      expect((await onAsset(agent, other.id)).instances[0].steps.map((s: any) => s.status)).toEqual(['approved', 'skipped']);
    } finally {
      await t.ctx.settings.set('feature_options', {});
    }

    expect((await agent.patch('/api/inventory/settings', { disposalRoutedOnly: true })).status).toBe(403);
    expect((await t.api.patch('/api/inventory/settings', { disposalRoutedOnly: 'yes' })).status).toBe(400);
    expect((await t.api.patch('/api/inventory/settings', { disposalRoutedOnly: true })).body.disposalRoutedOnly).toBe(true);
    try {
      expect((await agent.get('/api/inventory/settings')).body.disposalRoutedOnly).toBe(true);
      const plain = (await agent.post('/api/assets', { name: 'Old keyboard' })).body;
      const typed = { disposal_approved_by: 'Pat Example', disposal_approved_on: '2026-11-01' };
      const refused = await agent.post(`/api/assets/${plain.id}/dispose`, typed);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('approval_required');
      expect((await agent.patch(`/api/assets/${plain.id}`, { status: 'disposed', ...typed })).status).toBe(409);
      expect(await history(plain.id)).toContain('asset.dispose_blocked');
      // An approval decided through the workflow (here from the Approvals page) is accepted.
      const r = (await request(agent, plain.id, { reason: 'Keys worn' })).body;
      const stepId = (await onAsset(approver, plain.id)).instances[0].steps[0].id;
      expect((await approver.post(`/api/workflows/steps/${stepId}/decision`, { decision: 'approved' })).status).toBe(200);
      expect((await agent.get(`/api/assets/${plain.id}/disposal-requests`)).body.find((x: any) => x.id === r.id).status).toBe('approved');
      expect((await agent.post(`/api/assets/${plain.id}/dispose`, {})).body.status).toBe('disposed');
    } finally {
      await t.api.patch('/api/inventory/settings', { disposalRoutedOnly: false });
    }
  });

  it('decides a request the old way while no disposal workflow is active', async () => {
    const defs = (await t.api.get('/api/workflows/definitions?record_type=asset')).body.rows.filter((d: any) => d.kind === 'asset_disposal' && d.active);
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) await t.api.patch(`/api/workflows/definitions/${d.id}`, { active: false });
    try {
      const agent = await t.as('agent');
      const approver = await t.as('approver');
      const asset = (await agent.post('/api/assets', { name: 'Cracked tablet' })).body;
      const asked = (await request(agent, asset.id)).body;
      expect(asked.workflow).toBeNull();
      expect((await onAsset(agent, asset.id)).instances).toEqual([]);
      expect((await decideOld(approver, asset.id, asked.id, 'approve')).body.status).toBe('approved');
      expect((await agent.get(`/api/assets/${asset.id}`)).body.disposal_request_status).toBe('approved');
    } finally {
      for (const d of defs) await t.api.patch(`/api/workflows/definitions/${d.id}`, { active: true });
    }
  });

  it('takes over a request that was waiting before the upgrade', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const asset = (await agent.post('/api/assets', { name: 'Old router' })).body;
    // A request made the old way: a row and the asset's status, no workflow.
    const old = (await t.db.one<{ id: string }>(
      `insert into asset_disposal_requests (asset_id, reason, requested_by, requested_at) values ($1, 'End of support', $2, now() - interval '3 days') returning id`,
      [asset.id, agent.userId]))!;
    await t.db.query(`update assets set disposal_request_status = 'pending' where id = $1`, [asset.id]);
    await t.db.query(`delete from workflow_kind_installs where kind = 'asset_disposal'`);
    const count = async () => (await t.db.one<{ n: number }>(`select count(*)::int as n from workflow_definitions where kind = 'asset_disposal'`))!.n;
    const before = await count();
    expect(await t.app.workflows!.installKinds('asset_disposal')).toEqual(['asset_disposal']);
    // No second ready-made workflow; the waiting request now runs on it, asked by the same person.
    expect(await count()).toBe(before);
    const inst = (await onAsset(approver, asset.id)).instances[0];
    expect(inst).toMatchObject({ status: 'running', kind: 'asset_disposal', requested_by: agent.userId });
    expect(inst.steps[0].approvers.map((a: any) => a.id)).toContain(approver.userId);
    expect(inst.steps[0].approvers.map((a: any) => a.id)).not.toContain(agent.userId);
    expect((await approver.get('/api/workflows/approvals')).body.rows.some((w: any) => w.record_id === asset.id)).toBe(true);
    // Running it again adopts nothing twice.
    await t.db.query(`delete from workflow_kind_installs where kind = 'asset_disposal'`);
    await t.app.workflows!.installKinds('asset_disposal');
    expect((await t.db.one<{ n: number }>(`select count(*)::int as n from workflow_instances where kind = 'asset_disposal' and record_id = $1`, [asset.id]))!.n).toBe(1);
    // Deciding it finishes the old request as before.
    expect((await decideOld(approver, asset.id, old.id, 'approve', 'Fine')).body.status).toBe('approved');
    expect((await agent.get(`/api/assets/${asset.id}`)).body).toMatchObject({ disposal_request_status: 'approved' });
  });

  it('lets a stand-in decide and records it on behalf of the approver', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const standin = await t.as('approver');
    // A workflow naming one approver, for one asset: the stand-in may decide only by standing in.
    const mine = (await t.api.post('/api/workflows/definitions', {
      record_type: 'asset', kind: 'asset_disposal', name: 'Disposal of loan laptops', conditions: [{ field: 'name', op: 'eq', value: 'Stand-in laptop' }],
      steps: [{ name: 'Named approver', approvers: { kind: 'users', users: [approver.userId] } }],
    })).body;
    expect(mine.trigger).toBe('module');
    try {
      expect((await approver.post('/api/workflows/standins', { standin_id: standin.userId, ends_on: await day(3) })).status).toBe(201);
      const asset = (await agent.post('/api/assets', { name: 'Stand-in laptop' })).body;
      const asked = (await request(agent, asset.id)).body;
      expect(asked.workflow).toBe('Disposal of loan laptops');
      expect((await decideOld(standin, asset.id, asked.id, 'approve', 'While away')).body.status).toBe('approved');
      expect((await agent.get(`/api/assets/${asset.id}`)).body.disposal_approved_by).toMatch(/on behalf of Test approver/);
      expect((await agent.get(`/api/assets/${asset.id}/disposal-requests`)).body[0].decided_on_behalf_of_name).toMatch(/^Test approver/);
    } finally {
      await t.api.del(`/api/workflows/definitions/${mine.id}`);
    }
  });
});

describe('department list on assets', () => {
  it('offers the organization departments, spells a match their way and refuses anything else', async () => {
    // No departments yet: free text is kept, as before.
    expect((await t.api.post('/api/assets', { name: 'Free text desk', department: 'Wherever' })).body.department).toBe('Wherever');
    await t.db.query(`insert into departments (name) values ('Planning'), ('Customer Service')`);
    expect((await t.api.get('/api/inventory/departments')).body.map((d: any) => d.name)).toEqual(['Customer Service', 'Planning']);

    const made = await t.api.post('/api/assets', { name: 'Plotter', department: 'planning' });
    expect(made.body.department).toBe('Planning');
    const bad = await t.api.patch(`/api/assets/${made.body.id}`, { department: 'Plannning' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.department).toMatch(/not in the department list/);
    expect((await t.api.post(`/api/assets/${made.body.id}/check-out`, { assignee_name: 'Sam Invented', department: 'customer service' })).status).toBe(201);
    expect((await t.api.get(`/api/assets/${made.body.id}`)).body.department).toBe('Customer Service');

    const report = (await t.api.get('/api/inventory/reports/assets-by-department')).body;
    expect(report.rows.find((r: any) => r.department === 'Customer Service')).toMatchObject({ assets: 1, in_use: 1 });
    expect(report.rows[report.rows.length - 1].department).toBe('No department recorded');
    await t.db.query('update departments set deleted_at = now()');
  });
});

describe('reports list', () => {
  it('counts each report and links to a filtered list where the filters can express it', async () => {
    await t.api.post('/api/assets', { name: 'Unsupported switch', status: 'in_use', support_end: await day(-10), assigned_to_name: 'Sam Invented' });
    await t.api.post('/api/assets', { name: 'Warranty nearly over', status: 'in_use', warranty_end: await day(20), assigned_to_name: 'Sam Invented' });
    const list = (await t.api.get('/api/inventory/reports')).body;
    expect(list.map((r: any) => r.key)).toContain('assets-by-department');
    for (const key of ['assets-past-support', 'warranty-expiring', 'unassigned-assets']) {
      const report = list.find((r: any) => r.key === key);
      expect(report).toMatchObject({ group: 'Assets', kind: 'issues' });
      expect(report.total).toBe((await t.api.get(`/api/inventory/reports/${key}`)).body.total);
      // The link is a page address; the same query against the API gives the same rows.
      const viaList = await t.api.get(`/api${report.list}`.replace('/api/assets?', '/api/assets?pageSize=500&'));
      expect(viaList.status).toBe(200);
      expect(viaList.body.total).toBe(report.total);
    }
    expect(list.find((r: any) => r.key === 'systems-without-owner')).toMatchObject({ group: 'Systems', list: null });
  });
});

describe('date reminders', () => {
  it('picks the tightest step that applies', () => {
    expect(stepFor(45, [30, 7, 0])).toBeNull();
    expect(stepFor(30, [30, 7, 0])).toBe(30);
    expect(stepFor(12, [30, 7, 0])).toBe(30);
    expect(stepFor(5, [30, 7, 0])).toBe(7);
    expect(stepFor(-2, [30, 7, 0])).toBe(0);
  });

  it('writes dates in reminders as people read them, not the ISO form (BW-08)', () => {
    expect(when(20, '2026-12-11')).toBe('in 20 days (Dec 11, 2026)');
    expect(when(1, '2026-01-02')).toBe('tomorrow (Jan 2, 2026)');
    expect(when(0, '2026-03-09')).toBe('today (Mar 9, 2026)');
    expect(when(-3, '2026-03-06')).toBe('3 days ago (Mar 6, 2026)');
    expect(displayDate('not a date')).toBe('not a date');
  });

  it('tells the owner once per step about warranty, support and loan dates', async () => {
    const owner = await t.as('agent');
    const asset = (await t.api.post('/api/assets', { name: 'Reminder laptop', owner_id: owner.userId, warranty_end: await day(5), support_end: await day(200) })).body;
    const retired = (await t.api.post('/api/assets', { name: 'Retired laptop', status: 'retired', owner_id: owner.userId, warranty_end: await day(5) })).body;
    await owner.post(`/api/assets/${asset.id}/check-out`, { assignee_name: 'Sam Invented', due_back_on: await day(2) });
    expect((await owner.post('/api/inventory/reminders/run')).status).toBe(403);

    const first = (await t.api.post('/api/inventory/reminders/run')).body;
    if (!t.app.hasDecorator('notify')) {
      // Without the notifications module nothing is sent and nothing is recorded as sent.
      expect(first).toEqual({ available: false, warranty: 0, support: 0, loans: 0 });
      return;
    }
    expect(first.available).toBe(true);
    expect(first.warranty).toBeGreaterThanOrEqual(1);
    expect(first.loans).toBe(1);
    const titles = (await owner.get('/api/notifications?pageSize=100')).body.rows.map((n: any) => n.title);
    expect(titles).toContain(`Warranty for ${asset.tag} Reminder laptop ends in 5 days (${displayDate(await day(5))})`);
    expect(titles).toContain(`${asset.tag} Reminder laptop is due back from Sam Invented in 2 days (${displayDate(await day(2))})`);
    expect(titles.some((x: string) => x.includes(retired.tag))).toBe(false);
    expect(titles.some((x: string) => x.startsWith(`Support for ${asset.tag}`))).toBe(false);

    // A second run the same day sends nothing new for these.
    const again = (await t.api.post('/api/inventory/reminders/run')).body;
    expect(again).toMatchObject({ warranty: 0, loans: 0 });
    // When the date moves inside the next step, the tighter reminder goes out.
    await t.api.patch(`/api/assets/${asset.id}`, { warranty_end: await day(0) });
    expect((await t.api.post('/api/inventory/reminders/run')).body.warranty).toBe(1);
  });
});

describe('records of other modules that point at a system or asset', () => {
  it('can be listed by the filters the Changes and issues tab uses', async () => {
    const meta = (await t.api.get('/api/meta')).body.resources;
    const system = (await t.api.post('/api/systems', { name: 'Panel system' })).body;
    const asset = (await t.api.post('/api/assets', { name: 'Panel asset' })).body;
    for (const type of ['change', 'ticket', 'vulnerability']) {
      if (!meta[type]) continue; // that module is not loaded in this run
      expect(meta[type].fields.system_id).toMatchObject({ type: 'ref', to: 'system' });
      expect(meta[type].fields.asset_id).toMatchObject({ type: 'ref', to: 'asset' });
      const bySystem = await t.api.get(`${meta[type].path}?f.system_id=${system.id}&pageSize=6`);
      expect(bySystem.status).toBe(200);
      expect(bySystem.body.total).toBe(0);
      expect((await t.api.get(`${meta[type].path}?f.asset_id=${asset.id}&pageSize=6`)).status).toBe(200);
    }
    if (meta.change) {
      const change = await t.api.post('/api/changes', { title: 'Patch the panel system', system_id: system.id });
      expect(change.status).toBe(201);
      expect((await t.api.get(`/api/changes?f.system_id=${system.id}`)).body.rows.map((r: any) => r.id)).toEqual([change.body.id]);
    }
  });
});
