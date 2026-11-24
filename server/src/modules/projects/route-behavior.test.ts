import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior test for POST /api/projects/:id/gates/:gateId/documents/:index/waive [projects.approve]
// (E40-05): an approver waives a required document with a reason (it then no longer blocks the gate),
// or withdraws the waiver; optional documents and approved gates are refused. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const MISSING = '00000000-0000-4000-8000-0000000000dd';

async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}
const audits = (id: string) =>
  t.db.query<any>(`select * from audit_events where action = 'project.gate_document_waive' and record_id = $1 order by id`, [id]);

async function currentGate(projectId: string) {
  const g = (await t.api.get(`/api/projects/${projectId}/gates`)).body;
  return g.gates.find((x: any) => x.id === g.current_gate_id);
}

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('POST /api/projects/:id/gates/:gateId/documents/:index/waive', () => {
  it('waives a required document with a reason, so it no longer blocks the gate, and audits it', async () => {
    const p = (await t.api.post('/api/projects', { name: 'Invented depot charger rollout' })).body;
    const gate = await currentGate(p.id);
    expect(gate.documents.length).toBeGreaterThan(0);
    const url = `/api/projects/${p.id}/gates/${gate.id}`;
    for (const item of gate.items) await t.api.patch(`${url}/items/${item.id}`, { checked: true });
    for (const i of gate.documents.keys()) if (i > 0) await t.api.patch(`${url}/documents/${i}`, { received: true });

    // The first document is still missing: the gate cannot be approved.
    const blocked = await t.api.post(`${url}/decide`, { decision: 'approved', approver_name: 'Invented approver' });
    expect(blocked.body.error?.code).toBe('gate_blocked');

    expect((await t.api.post(`${url}/documents/0/waive`, { reason: '  ' })).status).toBe(400);
    const res = await t.api.post(`${url}/documents/0/waive`, { reason: 'Covered by the invented program charter.' });
    expect(res.status).toBe(200);
    expect(res.body.documents[0]).toMatchObject({
      name: gate.documents[0].name, required: true, waived: true, waive_reason: 'Covered by the invented program charter.',
      waived_by_name: 'Test Admin', waived_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect((await currentGate(p.id)).documents[0].waived).toBe(true);
    const ev = await audits(p.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toContain('Reason: Covered by the invented program charter.');

    // Waiving again changes nothing and writes no second event.
    await t.api.post(`${url}/documents/0/waive`, { reason: 'Covered by the invented program charter.' });
    expect(await audits(p.id)).toHaveLength(1);

    // Withdrawing the waiver blocks the gate again.
    const back = await t.api.post(`${url}/documents/0/waive`, { waived: false });
    expect(back.body.documents[0]).toMatchObject({ waived: false, waive_reason: null, waived_by_name: null });
    expect((await t.api.post(`${url}/decide`, { decision: 'approved', approver_name: 'Invented approver' })).body.error?.code).toBe('gate_blocked');
    expect(await audits(p.id)).toHaveLength(2);

    // Waived again: the gate can now be approved, and an approved gate's documents are closed.
    await t.api.post(`${url}/documents/0/waive`, { reason: 'Covered by the invented program charter.' });
    expect((await t.api.post(`${url}/decide`, { decision: 'approved', approver_name: 'Invented approver' })).status).toBe(200);
    const closed = await t.api.post(`${url}/documents/0/waive`, { waived: false });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('gate_closed');
  });

  it('refuses an optional document, a document or gate that does not exist, and someone without projects.approve', async () => {
    const p = (await t.api.post('/api/projects', { name: 'Invented shelter refresh' })).body;
    const gate = await currentGate(p.id);
    const url = `/api/projects/${p.id}/gates/${gate.id}`;
    // An optional document first, then a required one.
    const docs = [{ ...gate.documents[0], required: false }, { name: 'Invented sponsor note', required: true }];
    await t.db.query('update project_gates set documents = $2::jsonb where id = $1', [gate.id, JSON.stringify(docs)]);

    const optional = await t.api.post(`${url}/documents/0/waive`, { reason: 'Not needed.' });
    expect(optional.status).toBe(400);
    expect(optional.body.error.code).toBe('not_required');
    expect((await t.api.post(`${url}/documents/99/waive`, { reason: 'x' })).status).toBe(404);
    expect((await t.api.post(`${url}/documents/-1/waive`, { reason: 'x' })).status).toBe(404);
    expect((await t.api.post(`/api/projects/${p.id}/gates/${MISSING}/documents/0/waive`, { reason: 'x' })).status).toBe(404);
    expect((await t.api.post(`/api/projects/${MISSING}/gates/${gate.id}/documents/0/waive`, { reason: 'x' })).status).toBe(404);

    const editor = await withGrants('rb_projects_editor', ['projects.view', 'projects.edit']);
    expect((await editor.post(`${url}/documents/1/waive`, { reason: 'Editors may not waive.' })).status).toBe(403);
    expect((await (await t.as('agent')).post(`${url}/documents/1/waive`, { reason: 'x' })).status).toBe(403);
    const approver = await t.as('approver'); // projects.view and projects.approve
    expect((await approver.post(`${url}/documents/1/waive`, { reason: 'Approver waives it.' })).status).toBe(200);
    expect(await audits(p.id)).toHaveLength(1);
  });
});
