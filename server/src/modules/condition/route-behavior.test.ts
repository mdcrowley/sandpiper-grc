import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { testApp } from '../../test/helpers.ts';
import { KIND } from './targets.ts';

// Behavior tests for POST /api/asset-classes/:id/targets/:year/approve [assets.approve] and
// /approval [assets.edit] (E40-05): the effect, the audit event, the refusals and the rules
// (no target, already approved, a waiting request, a direct decision ending a waiting request).

let t: Awaited<ReturnType<typeof testApp>>;
const MISSING = '00000000-0000-4000-8000-0000000000cc';
const audits = (action: string, id: string) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, id]);

async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}
const newClass = async (name: string) => (await t.api.post('/api/asset-classes', { name, applies_to: 'asset', useful_life_years: 8 })).body.id as string;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('POST /api/asset-classes/:id/targets/:year/approve', () => {
  it('approves a draft target, records who and the decision, and audits it', async () => {
    const cls = await newClass('Invented fare vending machines');
    const url = `/api/asset-classes/${cls}/targets/2031`;
    expect((await t.api.put(url, { target_pct: 15 })).body.status).toBe('draft');

    const editor = await withGrants('rb_assets_editor', ['assets.view', 'assets.edit']);
    expect((await editor.post(`${url}/approve`, {})).status).toBe(403);
    expect((await (await t.as('continuity_manager')).post(`${url}/approve`, {})).status).toBe(403); // assets.view only

    const approver = await t.as('approver'); // assets.view and assets.approve
    const res = await approver.post(`${url}/approve`, { decision_ref: 'Invented capital committee decision 4' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ class_id: cls, year: 2031, target_pct: 15, status: 'approved', decision_ref: 'Invented capital committee decision 4', approved_by_name: expect.stringMatching(/^Test approver [0-9]+$/) });
    expect(res.body.approved_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await t.api.get(url)).body).toMatchObject({ status: 'approved' });
    const ev = await audits('asset_class.target_approve', cls);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toBe('Target for 2031 (15%) approved (Invented capital committee decision 4)');

    // Approving twice is refused; a year without a target and a bad year are refused.
    expect((await approver.post(`${url}/approve`, {})).status).toBe(409);
    expect((await approver.post(`/api/asset-classes/${cls}/targets/2032/approve`, {})).status).toBe(404);
    expect((await approver.post(`/api/asset-classes/${cls}/targets/1999/approve`, {})).status).toBe(400);
    expect((await approver.post(`/api/asset-classes/${MISSING}/targets/2031/approve`, {})).status).toBe(404);
    expect(await audits('asset_class.target_approve', cls)).toHaveLength(1);
  });

  it('a direct approval ends a request still waiting in the approval workflow', async () => {
    const cls = await newClass('Invented platform elevators');
    const url = `/api/asset-classes/${cls}/targets/2030`;
    await t.api.put(url, { target_pct: 30 });
    const asked = await t.api.post(`${url}/approval`, {});
    expect(asked.status).toBe(201);
    expect(asked.body.target.status).toBe('pending_approval');

    const res = await t.api.post(`${url}/approve`, { decision_ref: 'Invented board minute 9' });
    expect(res.body.status).toBe('approved');
    const latest = await approvalEngine(t.app)!.latest(KIND, cls);
    expect(latest?.status).toBe('canceled');
    expect((await t.api.get(url)).body).toMatchObject({ status: 'approved', decision_ref: 'Invented board minute 9' });
  });
});

describe('POST /api/asset-classes/:id/targets/:year/approval', () => {
  it('starts the approval workflow, marks the target waiting, refuses a second request, and audits', async () => {
    const cls = await newClass('Invented depot lifts');
    const url = `/api/asset-classes/${cls}/targets/2029`;
    await t.api.put(url, { target_pct: 22 });

    const approverOnly = await t.as('approver'); // assets.approve without assets.edit
    expect((await approverOnly.post(`${url}/approval`, {})).status).toBe(403);

    const manager = await t.as('asset_manager');
    const res = await manager.post(`${url}/approval`, { note: 'Invented: please approve for the capital plan' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ instance_id: expect.any(String), workflow: 'Asset condition targets', status: 'running', target: { status: 'pending_approval', target_pct: 22 } });
    expect((await t.api.get(url)).body.status).toBe('pending_approval');
    expect(await audits('asset_class.target_approval_requested', cls)).toHaveLength(1);

    expect((await manager.post(`${url}/approval`, {})).body.error.code).toBe('already_requested');

    // Changing the percentage ends the waiting request and makes it a draft again.
    expect((await manager.put(url, { target_pct: 25 })).body.status).toBe('draft');
    expect((await approvalEngine(t.app)!.latest(KIND, cls))?.status).toBe('canceled');
  });

  it('refuses a year with no target, an approved target, and a class that does not exist', async () => {
    const cls = await newClass('Invented ticket gates');
    expect((await t.api.post(`/api/asset-classes/${cls}/targets/2028/approval`, {})).status).toBe(404);
    await t.api.put(`/api/asset-classes/${cls}/targets/2028`, { target_pct: 5 });
    await t.api.post(`/api/asset-classes/${cls}/targets/2028/approve`, {});
    const res = await t.api.post(`/api/asset-classes/${cls}/targets/2028/approval`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_approved');
    expect((await t.api.post(`/api/asset-classes/${MISSING}/targets/2028/approval`, {})).status).toBe(404);
    expect((await t.api.post(`/api/asset-classes/${cls}/targets/abc/approval`, {})).status).toBe(400);
  });
});
