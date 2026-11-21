import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { DEFAULT_GATE_WORKFLOW } from './gate-approval.ts';

// E11-25: project gate decisions on the shared approval workflows. Invented data only.
// Needs the workflows module; skipped when GRC_MODULES leaves it out.
const loaded = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');

type T = Awaited<ReturnType<typeof testApp>>;
let t: T;
let approver: Awaited<ReturnType<T['as']>>;
let workflowId: string;

const project = async (name: string) => {
  const res = await t.api.post('/api/projects', { name, budget: 1000 });
  expect(res.status).toBe(201);
  return res.body as Row;
};
const gates = async (id: string) => (await t.api.get(`/api/projects/${id}/gates`)).body;
const currentGate = async (id: string) => { const g = await gates(id); return g.gates.find((x: Row) => x.id === g.current_gate_id); };
/** Ticks every checklist item and receives every document on the current gate. */
async function complete(id: string, leaveOne = false) {
  const gate = await currentGate(id);
  const url = `/api/projects/${id}/gates/${gate.id}`;
  for (const item of gate.items.slice(leaveOne ? 1 : 0)) await t.api.patch(`${url}/items/${item.id}`, { checked: true });
  for (const i of gate.documents.keys()) await t.api.patch(`${url}/documents/${i}`, { received: true });
  return gate;
}
const ask = (id: string, gateId: string) => t.api.post(`/api/projects/${id}/gates/${gateId}/request-approval`, { note: 'Ready for the board' });
const waiting = async () => (await approver.get('/api/workflows/approvals')).body.rows as Row[];
const decideOn = async (projectId: string, decision: string, comment?: string) => {
  const step = (await waiting()).find((a) => a.record_id === projectId);
  expect(step).toBeTruthy();
  const res = await approver.post(`/api/workflows/steps/${step!.step_id}/decision`, { decision, comment });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe.runIf(loaded)('gate decisions on approval workflows', () => {
  beforeAll(async () => {
    t = await testApp();
    approver = await t.as('approver');
    const defs = (await t.api.get('/api/projects/gate-workflows')).body.rows as Row[];
    workflowId = defs.find((d) => d.name === DEFAULT_GATE_WORKFLOW)!.id;
  }, 60_000);
  afterAll(async () => { await t?.close(); });

  it('installs one default workflow, attached to no template', async () => {
    const defs = (await t.api.get('/api/projects/gate-workflows')).body.rows as Row[];
    expect(defs.filter((d) => d.name === DEFAULT_GATE_WORKFLOW)).toHaveLength(1);
    const templates = (await t.api.get('/api/projects/gate-definitions')).body as Row[];
    expect(templates.every((d) => !d.approval_workflow_id)).toBe(true);
    // Running the install again (as a restart would) adds nothing.
    await t.app.workflows!.installKinds('project_gate');
    expect((await t.api.get('/api/projects/gate-workflows')).body.rows.filter((d: Row) => d.name === DEFAULT_GATE_WORKFLOW)).toHaveLength(1);
  });

  it('a template names a workflow; only an active gate decision workflow is accepted', async () => {
    expect((await t.api.patch('/api/projects/gate-definitions/intake', { approval_workflow_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    const res = await t.api.patch('/api/projects/gate-definitions/intake', { approval_workflow_id: workflowId });
    expect(res.status).toBe(200);
    expect(res.body.approval_workflow_id).toBe(workflowId);
  });

  it('asking is refused while the checklist is incomplete, or without a workflow', async () => {
    const p = await project('Depot radio refresh');
    const gate = await complete(p.id, true);
    const view = await currentGate(p.id);
    expect(view.approval).toMatchObject({ workflow_id: workflowId, can_request: false, running: false });
    const blocked = await ask(p.id, gate.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('gate_blocked');
    // The charter gate's template names none: decisions there are by hand only.
    expect((await t.api.get('/api/projects/gate-definitions')).body.find((d: Row) => d.key === 'charter').approval_workflow_id ?? null).toBeNull();
  });

  it('approval passes the gate and moves the stage, recorded as a decision', async () => {
    const p = await project('Fare system upgrade');
    const gate = await complete(p.id);
    expect((await currentGate(p.id)).approval.can_request).toBe(true);
    const started = await ask(p.id, gate.id);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect((await ask(p.id, gate.id)).status).toBe(409); // already asked
    expect((await currentGate(p.id)).approval.running).toBe(true);
    // The person who asked cannot approve it.
    expect((await t.api.get('/api/workflows/approvals')).body.rows.some((a: Row) => a.record_id === p.id)).toBe(false);
    await decideOn(p.id, 'approved');
    const after = await gates(p.id);
    const passed = after.gates.find((g: Row) => g.id === gate.id);
    expect(passed.status).toBe('approved');
    expect(passed.decisions[0]).toMatchObject({ decision: 'approved', reference: `Approval workflow "${DEFAULT_GATE_WORKFLOW}"` });
    expect(passed.decisions[0].approver_name).toBeTruthy();
    expect(after.stage).toBe('initiate');
    expect(passed.approval.last_status).toBe('approved');
  });

  it('rejection keeps the gate open with the reason', async () => {
    const p = await project('Timetable display pilot');
    const gate = await complete(p.id);
    expect((await ask(p.id, gate.id)).status).toBe(201);
    await decideOn(p.id, 'rejected', 'Funding not confirmed');
    const g = await currentGate(p.id);
    expect(g.id).toBe(gate.id);
    expect(g.status).toBe('rejected');
    expect(g.is_current).toBe(true);
    expect(g.decisions[0]).toMatchObject({ decision: 'rejected', notes: 'Funding not confirmed' });
    expect((await t.api.get(`/api/projects/${p.id}`)).body.stage).toBe('idea');
    // It may be asked again.
    expect(g.approval.can_request).toBe(true);
  });

  it('a decision recorded by hand still works and stops the running workflow', async () => {
    const p = await project('Ticket office refit');
    const gate = await complete(p.id);
    expect((await ask(p.id, gate.id)).status).toBe(201);
    const res = await t.api.post(`/api/projects/${p.id}/gates/${gate.id}/decide`, { decision: 'approved', approver_name: 'B. Board', approver_role: 'Board' });
    expect(res.status).toBe(200);
    const g = (await gates(p.id)).gates.find((x: Row) => x.id === gate.id);
    expect(g.status).toBe('approved');
    expect(g.decisions).toHaveLength(1);
    expect(g.approval).toMatchObject({ running: false, last_status: 'canceled' });
    expect((await waiting()).some((a) => a.record_id === p.id)).toBe(false);
  });

  it('a switched-off projects area hides the gate workflows', async () => {
    await t.ctx.settings.set('features', { projects: false });
    try {
      const options = (await t.api.get('/api/workflows/options')).body;
      expect(options.kinds.some((k: Row) => k.key === 'project_gate')).toBe(false);
      expect((await t.api.get('/api/workflows/definitions')).body.rows.some((d: Row) => d.kind === 'project_gate')).toBe(false);
    } finally {
      await t.ctx.settings.set('features', { projects: true });
    }
    expect((await t.api.get('/api/workflows/definitions')).body.rows.some((d: Row) => d.kind === 'project_gate')).toBe(true);
  });
});
