import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: a change approval recorded in data load mode is the named person's (recorded_by and the
// approver), with or without a waiting workflow; outside a load it is the signed-in approver's.
// Invented people and changes only.

let t: Awaited<ReturnType<typeof testApp>>;
let former = '';

const LOW = { people_affected: 'few', downtime: 'none', back_out: 'quick', experience: 'routine', testing: 'full' };
const complete = (day: string, extra: Record<string, unknown> = {}) => ({
  title: 'Replace the depot archive disk', description: 'Swap the failing disk.', reason: 'The disk reports errors.',
  implementation_plan: 'Swap the disk and rebuild.', test_plan: 'Read a file back.', backout_plan: 'Refit the old disk.',
  risk_answers: LOW, planned_start: `${day}T18:00:00.000Z`, planned_end: `${day}T20:00:00.000Z`, ...extra,
});

beforeAll(async () => {
  t = await testApp();
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled') returning id`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('change approvals', () => {
  it('outside a load, records the signed-in approver', async () => {
    const agent = await t.as('agent');
    const approver = await t.as('approver');
    const made = (await agent.post('/api/changes', complete('2031-02-03'))).body;
    expect((await agent.post(`/api/changes/${made.id}/transition`, { to: 'submitted' })).body.status).toBe('submitted');
    const res = await approver.post(`/api/changes/${made.id}/approvals`, { decision: 'approved' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = (await t.db.one<Row>('select recorded_by, approver_user_id from change_approvals where change_id = $1', [made.id]))!;
    expect(row).toEqual({ recorded_by: approver.userId, approver_user_id: approver.userId });
  });

  it('in a load, records the decision of the person named, by name and account', async () => {
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const made = await t.api.post('/api/changes', complete('2024-02-05', { status: 'submitted', submitted_at: '2024-02-01T09:00:00Z' }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const res = await t.api.post(`/api/changes/${made.body.id}/approvals`, { decision: 'approved', decided_on: '2024-02-02', on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = (await t.db.one<Row>('select recorded_by, recorded_by_name, approver_name, approver_user_id, decided_on::text as decided_on from change_approvals where change_id = $1', [made.body.id]))!;
    expect(row).toEqual({ recorded_by: former, recorded_by_name: 'Robin Clerk', approver_name: 'Robin Clerk', approver_user_id: former, decided_on: '2024-02-02' });
    // A decision given by hand keeps its approver; the person named recorded it.
    const other = (await t.api.post('/api/changes', complete('2024-02-06', { status: 'submitted', submitted_at: '2024-02-01T09:00:00Z' }))).body;
    await t.api.post(`/api/changes/${other.id}/approvals`, { decision: 'approved', approver_name: 'Board chair', on_behalf_of: 'rclerk' });
    expect((await t.db.one<Row>('select recorded_by, approver_name, approver_user_id from change_approvals where change_id = $1', [other.id]))).toEqual(
      { recorded_by: former, approver_name: 'Board chair', approver_user_id: null });
  });
});
