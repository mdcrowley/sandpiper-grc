import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: status reports, gate checklist ticks and gate decisions loaded in data load mode carry
// the person the load names; outside a load, the signed-in person. Invented projects only.

let t: Awaited<ReturnType<typeof testApp>>;
let former = '';
let adminId = '';
const REPORT = { period_end: '2024-03-31', overall: 'green', schedule: 'green', budget: 'amber', risk: 'green' };

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled') returning id`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('project actor columns', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const p = (await t.api.post('/api/projects', { name: 'Invented platform canopy' })).body;
    expect((await t.api.post(`/api/projects/${p.id}/status-reports`, REPORT)).status).toBe(201);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const loaded = await t.api.post(`/api/projects/${p.id}/status-reports`, { ...REPORT, period_end: '2024-04-30', on_behalf_of: 'rclerk' });
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(201);
    const reports = await t.db.query<Row>('select author_id, author_name from status_reports where project_id = $1 order by period_end', [p.id]);
    expect(reports.map((r) => [r.author_id, r.author_name])).toEqual([[adminId, 'Test Admin'], [former, 'Robin Clerk']]);

    const gates = (await t.api.get(`/api/projects/${p.id}/gates`)).body;
    const gate = gates.gates.find((g: Row) => g.id === gates.current_gate_id);
    for (const item of gate.items) await t.api.patch(`/api/projects/${p.id}/gates/${gate.id}/items/${item.id}`, { checked: true, on_behalf_of: 'rclerk' });
    for (const i of gate.documents.keys()) await t.api.patch(`/api/projects/${p.id}/gates/${gate.id}/documents/${i}`, { received: true });
    if (gate.items.length) {
      expect((await t.db.query<Row>('select distinct checked_by from gate_checklist_items where project_gate_id = $1', [gate.id])).map((r) => r.checked_by)).toEqual([former]);
    }
    const decided = await t.api.post(`/api/projects/${p.id}/gates/${gate.id}/decide`, { decision: 'approved', decided_on: '2024-05-02', on_behalf_of: 'rclerk' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const d = (await t.db.one<Row>('select approver_name, recorded_by, recorded_by_name from project_gate_decisions where project_gate_id = $1', [gate.id]))!;
    expect(d).toEqual({ approver_name: 'Robin Clerk', recorded_by: former, recorded_by_name: 'Robin Clerk' });
  });
});
