import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { stepFor } from './reminders.ts';

// Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const history = async (id: string) =>
  (await t.api.get(`/api/history?record_type=asset&record_id=${id}`)).body.map((h: any) => h.action);
const day = async (offset: number) => (await t.db.one<{ d: string }>('select (current_date + $1::int)::text as d', [offset]))!.d;

describe('routed disposal approval', () => {
  it('routes a request to an approver who is not the requester, and the decision unlocks disposal', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const asset = (await agent.post('/api/assets', { name: 'Worn-out projector', status: 'retired' })).body;

    expect((await agent.post(`/api/assets/${asset.id}/disposal-requests`, {})).body.error.fields.reason).toBeTruthy();
    const asked = await agent.post(`/api/assets/${asset.id}/disposal-requests`, { reason: 'Lamp failed; beyond repair', disposal_method: 'Recycled' });
    expect(asked.status).toBe(201);
    expect(asked.body.approvers).toBeGreaterThan(0);
    expect((await agent.get(`/api/assets/${asset.id}`)).body).toMatchObject({ disposal_request_status: 'pending', disposal_method: 'Recycled', status: 'retired' });
    expect((await agent.post(`/api/assets/${asset.id}/disposal-requests`, { reason: 'Again' })).status).toBe(409);

    // The queue shows it; the requester cannot decide their own request; a refusal needs a reason.
    const queue = (await approver.get('/api/assets/disposal-requests')).body;
    expect(queue.find((r: any) => r.id === asked.body.id)).toMatchObject({ asset_name: 'Worn-out projector', own: false, status: 'pending' });
    const own = await agent.post(`/api/assets/${asset.id}/disposal-requests/${asked.body.id}/decision`, { decision: 'approve' });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('self_approval');
    expect((await approver.post(`/api/assets/${asset.id}/disposal-requests/${asked.body.id}/decision`, { decision: 'refuse' })).body.error.fields.comment).toBeTruthy();
    expect((await approver.post(`/api/assets/${asset.id}/disposal-requests/${asked.body.id}/decision`, { decision: 'maybe' })).status).toBe(400);
    // Someone without assets.approve cannot decide.
    expect((await (await t.as('auditor')).post(`/api/assets/${asset.id}/disposal-requests/${asked.body.id}/decision`, { decision: 'approve' })).status).toBe(403);

    const decided = await approver.post(`/api/assets/${asset.id}/disposal-requests/${asked.body.id}/decision`, { decision: 'approve', comment: 'Agreed' });
    expect(decided.body).toMatchObject({ status: 'approved', decision_comment: 'Agreed', decided_by: approver.userId });
    const approved = (await agent.get(`/api/assets/${asset.id}`)).body;
    expect(approved.disposal_request_status).toBe('approved');
    expect(approved.disposal_approved_by).toMatch(/^Test approver/);
    expect(approved.disposal_approved_on).toBe(await day(0));
    expect((await approver.post(`/api/assets/${asset.id}/disposal-requests/${asked.body.id}/decision`, { decision: 'refuse', comment: 'Late' })).status).toBe(409);

    // The disposal step now needs no typed approval, and a retyped approver name is ignored.
    const done = await agent.post(`/api/assets/${asset.id}/dispose`, { disposal_approved_by: 'Someone Else' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('disposed');
    expect(done.body.disposal_approved_by).toMatch(/^Test approver/);
    const actions = await history(asset.id);
    expect(actions).toEqual(expect.arrayContaining(['asset.disposal_requested', 'asset.disposal_approved', 'asset.dispose']));
    expect((await agent.post(`/api/assets/${asset.id}/disposal-requests`, { reason: 'Too late' })).status).toBe(409);

    if (t.app.hasDecorator('notify')) {
      const forApprover = (await approver.get('/api/notifications')).body.rows.map((n: any) => n.title);
      expect(forApprover).toContain(`Disposal of ${asset.tag} Worn-out projector is waiting for your decision`);
      const forAgent = (await agent.get('/api/notifications')).body.rows.map((n: any) => n.title);
      expect(forAgent).toContain(`Disposal of ${asset.tag} Worn-out projector was approved`);
      expect(forAgent.some((x: string) => x.includes('waiting for your decision'))).toBe(false);
    }
  });

  it('records a refusal, lets the request be made again, and can be withdrawn', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const asset = (await agent.post('/api/assets', { name: 'Spare monitor' })).body;
    const first = (await agent.post(`/api/assets/${asset.id}/disposal-requests`, { reason: 'Surplus' })).body;
    await approver.post(`/api/assets/${asset.id}/disposal-requests/${first.id}/decision`, { decision: 'refuse', comment: 'Still needed at the branch' });
    expect((await agent.get(`/api/assets/${asset.id}`)).body).toMatchObject({ disposal_request_status: 'refused', disposal_approved_by: null });

    const second = (await agent.post(`/api/assets/${asset.id}/disposal-requests`, { reason: 'Branch has closed' })).body;
    expect((await agent.post(`/api/assets/${asset.id}/disposal-requests/${second.id}/withdraw`)).body.status).toBe('withdrawn');
    expect((await agent.get(`/api/assets/${asset.id}`)).body.disposal_request_status).toBeNull();
    const rows = (await agent.get(`/api/assets/${asset.id}/disposal-requests`)).body;
    expect(rows.map((r: any) => r.status)).toEqual(['withdrawn', 'refused']);
    expect(rows[1]).toMatchObject({ decision_comment: 'Still needed at the branch', own: true });
    expect(await history(asset.id)).toEqual(expect.arrayContaining(['asset.disposal_refused', 'asset.disposal_withdrawn']));
    // The status cannot be set by hand.
    await agent.patch(`/api/assets/${asset.id}`, { disposal_request_status: 'approved', location: 'Shelf' });
    expect((await agent.get(`/api/assets/${asset.id}`)).body.disposal_request_status).toBeNull();
  });

  it('keeps the funder-interest rule after an approval, and can make routed approval the only way', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const funded = (await agent.post('/api/assets', { name: 'Funded scanner', funder_interest: true, funder_interest_pct: 60 })).body;
    const asked = (await agent.post(`/api/assets/${funded.id}/disposal-requests`, { reason: 'Replaced' })).body;
    await approver.post(`/api/assets/${funded.id}/disposal-requests/${asked.id}/decision`, { decision: 'approve' });
    const blocked = await agent.post(`/api/assets/${funded.id}/dispose`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('funder_interest_block');
    expect((await agent.post(`/api/assets/${funded.id}/dispose`, { disposal_approval_ref: 'FUNDER-LETTER-9' })).body.status).toBe('disposed');

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
    } finally {
      await t.api.patch('/api/inventory/settings', { disposalRoutedOnly: false });
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
    expect(titles).toContain(`Warranty for ${asset.tag} Reminder laptop ends in 5 days (${await day(5)})`);
    expect(titles).toContain(`${asset.tag} Reminder laptop is due back from Sam Invented in 2 days (${await day(2)})`);
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
