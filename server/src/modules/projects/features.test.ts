import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { approvalBlockers, missingDocuments, reportDue, templateDocuments } from './rules.ts';

// Required documents, rollback, completion, requests, systems, change links, notifications
// and the escalation permission. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const make = async (data: Record<string, unknown> = {}) => {
  const res = await t.api.post('/api/projects', { name: 'Feature project', ...data });
  expect(res.status).toBe(201);
  return res.body;
};
const currentGate = async (id: string) => {
  const g = (await t.api.get(`/api/projects/${id}/gates`)).body;
  return g.gates.find((x: any) => x.id === g.current_gate_id);
};
const tickAll = async (id: string, gate: any) => {
  for (const item of gate.items) await t.api.patch(`/api/projects/${id}/gates/${gate.id}/items/${item.id}`, { checked: true });
};
const approve = (id: string, gate: any) =>
  t.api.post(`/api/projects/${id}/gates/${gate.id}/decide`, { decision: 'approved', approver_name: 'A. Tester' });
async function passGate(id: string) {
  const gate = await currentGate(id);
  await tickAll(id, gate);
  for (const i of gate.documents.keys()) await t.api.patch(`/api/projects/${id}/gates/${gate.id}/documents/${i}`, { received: true });
  const res = await approve(id, gate);
  expect(res.status).toBe(200);
  return res.body;
}
const hasNotifications = () => t.ctx.app.hasDecorator('notify');
const myNotifications = async (client = t.api) => (await client.get('/api/notifications?pageSize=100')).body.rows as any[];

describe('rules', () => {
  it('reads template documents in both shapes and finds the missing ones', () => {
    expect(templateDocuments(['Plan', { name: 'Budget', required: false }, 'Plan', ''])).toEqual([
      { name: 'Plan', required: true }, { name: 'Budget', required: false },
    ]);
    const docs = [
      { name: 'A', required: true, received: false, reference: '' },
      { name: 'B', required: true, received: true, reference: '' },
      { name: 'C', required: true, received: false, reference: '', waived: true },
      { name: 'D', required: false, received: false, reference: '' },
    ];
    expect(missingDocuments(docs)).toEqual(['A']);
    expect(approvalBlockers({ projectStatus: 'on_hold', statusLabel: 'On hold', outstanding: ['Item'], documents: docs }).map((b) => b.kind))
      .toEqual(['status', 'checklist', 'document']);
    expect(reportDue(null, '2026-11-18', 30)).toBe(true);
    expect(reportDue('2026-10-19', '2026-11-18', 30)).toBe(false);
    expect(reportDue('2026-10-18', '2026-11-18', 30)).toBe(true);
  });
});

describe('required documents (E11-14)', () => {
  it('blocks approval until each required document is received or waived', async () => {
    await t.api.patch('/api/projects/gate-definitions/intake', {
      required_documents: [{ name: 'Request form', required: true }, { name: 'Sketch', required: false }, { name: 'Sponsor note', required: true }],
    });
    const defs = (await t.api.get('/api/projects/gate-definitions')).body;
    expect(defs.find((d: any) => d.key === 'intake').required_documents.map((d: any) => d.required)).toEqual([true, false, true]);

    const p = await make({ name: 'Documents' });
    let gate = await currentGate(p.id);
    const url = `/api/projects/${p.id}/gates/${gate.id}`;
    await tickAll(p.id, gate);
    gate = await currentGate(p.id);
    expect(gate.outstanding).toEqual([]);
    expect(gate.can_approve).toBe(false);
    expect(gate.missing_documents).toEqual(['Request form', 'Sponsor note']);
    expect(gate.blockers).toEqual([{ kind: 'document', label: 'Request form' }, { kind: 'document', label: 'Sponsor note' }]);

    const blocked = await approve(p.id, gate);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe('gate_blocked');
    expect(blocked.body.error.message).toContain('Request form');
    expect(blocked.body.error.fields.documents).toMatch(/2 required documents/);

    // received with a file reference
    const file = '11111111-1111-4111-8111-111111111111';
    const got = await t.api.patch(`${url}/documents/0`, { received: true, attachment_id: file });
    expect(got.body.documents[0]).toMatchObject({ received: true, attachment_id: file });

    // a waiver needs approve, a reason and a required document
    const pm = await t.as('agent');
    expect((await pm.post(`${url}/documents/2/waive`, { reason: 'x' })).status).toBe(403);
    expect((await t.api.post(`${url}/documents/2/waive`, {})).status).toBe(400);
    expect((await t.api.post(`${url}/documents/1/waive`, { reason: 'Optional anyway' })).status).toBe(400);
    expect((await approve(p.id, gate)).status).toBe(400); // still one missing
    const waived = await t.api.post(`${url}/documents/2/waive`, { reason: 'Sponsor agreed in the meeting' });
    expect(waived.body.documents[2]).toMatchObject({ waived: true, waive_reason: 'Sponsor agreed in the meeting', waived_by_name: 'Test Admin' });

    // withdrawing the waiver blocks again; waiving again allows
    await t.api.post(`${url}/documents/2/waive`, { waived: false });
    expect((await currentGate(p.id)).can_approve).toBe(false);
    await t.api.post(`${url}/documents/2/waive`, { reason: 'Sponsor agreed in the meeting' });
    expect((await currentGate(p.id)).can_approve).toBe(true);
    const ok = await approve(p.id, gate);
    expect(ok.status).toBe(200);
    expect(ok.body.project.stage).toBe('initiate');

    const actions = (await t.api.get(`/api/history?record_type=project&record_id=${p.id}`)).body.map((h: any) => h.action);
    expect(actions).toContain('project.gate_document_waive');
    await t.api.patch('/api/projects/gate-definitions/intake', { required_documents: ['Project request'] });
  });
});

describe('rollback and completion (E11-15, E11-18)', () => {
  it('moves a project back a stage with a reason and reopens the earlier gate as it was', async () => {
    const p = await make({ name: 'Back a stage' });
    const first = await currentGate(p.id);
    expect((await t.api.post(`/api/projects/${p.id}/rollback`, { reason: 'Nothing earlier' })).status).toBe(409);
    await passGate(p.id);
    expect((await t.api.get(`/api/projects/${p.id}/gates`)).body.rollback).toMatchObject({ gate_id: first.id, to_stage: 'idea' });

    const agent = await t.as('project_manager');
    expect((await t.api.post(`/api/projects/${p.id}/rollback`, {})).status).toBe(400);
    const viewer = await t.as('agent');
    expect((await viewer.post(`/api/projects/${p.id}/rollback`, { reason: 'x' })).status).toBe(403);
    const back = await agent.post(`/api/projects/${p.id}/rollback`, { reason: 'Sponsor withdrew support' });
    expect(back.status).toBe(200);
    expect(back.body.project.stage).toBe('idea');

    const g = (await t.api.get(`/api/projects/${p.id}/gates`)).body;
    expect(g.current_gate_id).toBe(first.id);
    const reopened = g.gates.find((x: any) => x.id === first.id);
    expect(reopened.status).toBe('open');
    expect(reopened.items.every((i: any) => i.checked)).toBe(true); // the checklist as it was
    expect(reopened.decisions[0]).toMatchObject({ decision: 'reopened', notes: 'Sponsor withdrew support' });
    const history = (await t.api.get(`/api/history?record_type=project&record_id=${p.id}`)).body;
    expect(history.find((h: any) => h.action === 'project.stage_rollback').summary).toContain('Sponsor withdrew support');

    // approving again moves forward and reuses the later gate
    expect((await approve(p.id, reopened)).body.project.stage).toBe('initiate');
    expect((await t.api.get(`/api/projects/${p.id}/gates`)).body.gates.length).toBe(2);
  });

  it('completes the project when its last gate is approved, and reactivates it on rollback', async () => {
    const p = await make({ name: 'To the end' });
    let last: any;
    for (let i = 0; i < 5; i++) last = await passGate(p.id);
    expect(last.project).toMatchObject({ stage: 'close', status: 'completed' });
    const back = await t.api.post(`/api/projects/${p.id}/rollback`, { reason: 'Go-live was reversed' });
    expect(back.body.project).toMatchObject({ stage: 'deliver', status: 'active' });
  });
});

describe('project requests (E11-16)', () => {
  it('lets the people named by the setting submit a request and follow it, but not edit it', async () => {
    const agent = await t.as('agent'); // may view projects, not create them
    expect((await agent.get('/api/projects/intake')).body).toMatchObject({ allowed: false, can_open: true });
    expect((await agent.post('/api/projects/requests', { name: 'Not yet' })).status).toBe(403);
    expect((await t.api.patch('/api/projects/settings', { intakeOpenTo: 'nobody' })).status).toBe(400);
    expect((await agent.patch('/api/projects/settings', { intakeOpenTo: 'everyone' })).status).toBe(403);
    expect((await t.api.patch('/api/projects/settings', { intakeOpenTo: 'view' })).body.intakeOpenTo).toBe('view');

    const made = await agent.post('/api/projects/requests', {
      name: 'Shared calendar for the depot', description: 'So shifts stop clashing', budget: 2000,
      stage: 'close', tier_override: 'tier_3', spend_to_date: 999, // not request fields: ignored
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ stage: 'idea', status: 'active', can_open: true });
    expect(made.body.ref).toMatch(/^PRJ-/);
    const row = (await t.api.get(`/api/projects/${made.body.id}`)).body;
    expect(row).toMatchObject({ stage: 'idea', tier_override: null, spend_to_date: null });
    expect(row._display.requested_by).toBeTruthy();
    expect((await agent.post('/api/projects/requests', {})).status).toBe(400); // name is required

    const intake = (await agent.get('/api/projects/intake')).body;
    expect(intake.allowed).toBe(true);
    expect(intake.requests[0]).toMatchObject({ id: made.body.id, stage_label: 'Idea', gate_name: 'Intake approval', gate_checked: 0 });
    expect((await t.api.get('/api/projects/intake')).body.requests.some((r: any) => r.id === made.body.id)).toBe(false);
    // the requester cannot change the project afterwards
    expect((await agent.patch(`/api/projects/${made.body.id}`, { name: 'Changed' })).status).toBe(403);

    // "everyone" includes people with no permission on projects at all
    await t.api.patch('/api/projects/settings', { intakeOpenTo: 'everyone' });
    expect((await agent.get('/api/projects/intake')).body.allowed).toBe(true);
    await t.api.patch('/api/projects/settings', { intakeOpenTo: 'create' });
    expect((await agent.get('/api/projects/intake')).body.allowed).toBe(false);
    expect((await t.anon.get('/api/projects/intake')).status).toBe(401);
  });
});

describe('status reports', () => {
  it('edits a report in place and recalculates the ratings (E11-19)', async () => {
    const p = await make({ name: 'Edited report' });
    const r = await t.api.post(`/api/projects/${p.id}/status-reports`, { period_end: '2026-10-31', overall: 'amber', schedule: 'amber', budget: 'green', risk: 'green', next_steps: 'Old' });
    const edited = await t.api.patch(`/api/projects/${p.id}/status-reports/${r.body.id}`, { overall: 'green', next_steps: 'New', period_end: '2026-11-01' });
    expect(edited.body).toMatchObject({ overall: 'green', next_steps: 'New', period_end: '2026-11-01' });
    expect((await t.api.get(`/api/projects/${p.id}`)).body).toMatchObject({ rag_overall: 'green', last_report_on: '2026-11-01' });
    expect((await t.api.patch(`/api/projects/${p.id}/status-reports/${r.body.id}`, { overall: 'blue' })).status).toBe(400);
    const actions = (await t.api.get(`/api/history?record_type=project&record_id=${p.id}`)).body.map((h: any) => h.action);
    expect(actions).toContain('project.status_report_update');
  });
});

describe('systems affected and change records (E11-20, E11-21)', () => {
  it('keeps a validated list of systems when the inventory is loaded', async () => {
    const p = await make({ name: 'Touches systems' });
    expect(p.systems_affected).toEqual([]);
    expect((await t.api.patch(`/api/projects/${p.id}`, { systems_affected: 'nonsense' })).status).toBe(400);
    const unknown = await t.api.patch(`/api/projects/${p.id}`, { systems_affected: ['22222222-2222-4222-8222-222222222222'] });
    expect(unknown.status).toBe(400);
    if (t.ctx.resources.get('system')) {
      const sys = await t.ctx.resources.create('system', { name: 'Invented payroll system' });
      const ok = await t.api.patch(`/api/projects/${p.id}`, { systems_affected: [sys.id, sys.id] });
      expect(ok.body.systems_affected).toEqual([sys.id]);
      const list = (await t.api.get(`/api/projects/${p.id}/systems`)).body;
      expect(list).toMatchObject({ available: true, hidden: 0 });
      expect(list.systems[0]).toMatchObject({ id: sys.id, label: 'Invented payroll system' });
      // other edits do not re-check the list
      await t.db.query("insert into departments (name) values ('Finance') on conflict (name) do update set deleted_at = null");
      expect((await t.api.patch(`/api/projects/${p.id}`, { department: 'Finance' })).status).toBe(200);
    } else {
      expect(unknown.body.error.fields.systems_affected).toMatch(/not available/);
      expect((await t.api.get(`/api/projects/${p.id}/systems`)).body).toMatchObject({ available: false, systems: [] });
    }
  });

  it('links the go-live gate to a change record when change records exist', async () => {
    const p = await make({ name: 'Needs a change' });
    for (let i = 0; i < 4; i++) await passGate(p.id);
    const gate = await currentGate(p.id);
    expect(gate.gate_key).toBe('go_live');
    expect(gate.wants_change).toBe(true);
    const url = `/api/projects/${p.id}/gates/${gate.id}`;
    const def = t.ctx.resources.get('change');
    expect(gate.change_available).toBe(Boolean(def));
    if (!def) {
      expect((await t.api.patch(url, { change_id: '22222222-2222-4222-8222-222222222222' })).body.error.code).toBe('changes_unavailable');
      return;
    }
    expect((await t.api.patch(url, { change_id: '22222222-2222-4222-8222-222222222222' })).status).toBe(400);
    const existing = (await t.api.get(`${def.path}?pageSize=1`)).body.rows[0]
      ?? (await t.ctx.resources.create('change', { [def.titleField]: 'Go-live of the invented system' }));
    expect((await t.api.patch(url, { change_id: existing.id })).status).toBe(200);
    const linked = await currentGate(p.id);
    expect(linked.change).toMatchObject({ id: existing.id, route: `${def.route}/${existing.id}` });
    expect((await t.api.patch(url, { change_id: null })).body.change_id).toBeNull();
    const actions = (await t.api.get(`/api/history?record_type=project&record_id=${p.id}`)).body.map((h: any) => h.action);
    expect(actions).toContain('project.gate_change');
  });
});

describe('escalation needs create on risks (E18-30)', () => {
  it('refuses a project editor who cannot create risks', async () => {
    const p = await make({ name: 'Escalation' });
    const risk = (await t.api.post(`/api/projects/${p.id}/items`, { kind: 'risk', title: 'Key person leaves', likelihood: 3, impact: 3 })).body;
    const pm = await t.as('project_manager'); // projects.*, nothing on risks
    const refused = await pm.post(`/api/projects/${p.id}/items/${risk.id}/escalate`);
    if (t.ctx.resources.get('risk')) {
      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toMatch(/permission to create risks/);
      expect((await t.api.get(`/api/projects/${p.id}/items`)).body[0].escalated_risk_id).toBeNull();
      expect((await t.api.post(`/api/projects/${p.id}/items/${risk.id}/escalate`)).status).toBe(201);
    } else {
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('risk_register_unavailable');
    }
  });
});

describe('notifications (E11-22)', () => {
  it('tells approvers and the manager when a gate becomes ready, with or without the notifications module', async () => {
    const pm = await t.as('project_manager');
    const p = await make({ name: 'Ready gate', project_manager_id: pm.userId });
    const gate = await currentGate(p.id);
    await tickAll(p.id, gate);
    for (const i of gate.documents.keys()) await t.api.patch(`/api/projects/${p.id}/gates/${gate.id}/documents/${i}`, { received: true });
    expect((await currentGate(p.id)).can_approve).toBe(true);
    if (!hasNotifications()) return; // the calls above must simply not fail
    const mine = (await myNotifications(pm)).filter((n) => n.record_id === p.id);
    expect(mine.map((n) => n.kind).sort()).toEqual(['approval', 'due']);
    expect(mine[0].route).toBe(`/projects/${p.id}?tab=gate`);
    expect(mine.find((n) => n.kind === 'approval').title).toContain('Gate ready for a decision');
  });

  it('tells the manager when the project turns red, once', async () => {
    const pm = await t.as('project_manager');
    const p = await make({ name: 'Going red', project_manager_id: pm.userId });
    const report = { schedule: 'green', budget: 'green', risk: 'green' };
    await t.api.post(`/api/projects/${p.id}/status-reports`, { ...report, period_end: '2026-09-30', overall: 'amber' });
    await t.api.post(`/api/projects/${p.id}/status-reports`, { ...report, period_end: '2026-10-31', overall: 'red' });
    await t.api.post(`/api/projects/${p.id}/status-reports`, { ...report, period_end: '2026-11-15', overall: 'red' });
    expect((await t.api.get(`/api/projects/${p.id}`)).body.rag_overall).toBe('red');
    if (!hasNotifications()) return;
    const red = (await myNotifications(pm)).filter((n) => n.record_id === p.id && /turned red/.test(n.title));
    expect(red.length).toBe(1);
  });

  it('reminds the manager of a status report that is due', async () => {
    const pm = await t.as('project_manager');
    const p = await make({ name: 'Report overdue', project_manager_id: pm.userId });
    await passGate(p.id); // reminders start once the project has left the idea stage
    expect((await pm.post('/api/projects/reminders/run')).status).toBe(200);
    const first = (await t.api.post('/api/projects/reminders/run')).body;
    expect(first.reportsDue).toBeGreaterThanOrEqual(1);
    expect((await (await t.as('agent')).post('/api/projects/reminders/run')).status).toBe(403);
    expect((await t.api.patch('/api/projects/settings', { reportIntervalDays: 0 })).status).toBe(400);
    expect((await t.api.patch('/api/projects/settings', { reportIntervalDays: 14 })).body.reportIntervalDays).toBe(14);
    if (!hasNotifications()) return;
    const due = (await myNotifications(pm)).filter((n) => n.record_id === p.id && /Status report due/.test(n.title));
    expect(due.length).toBe(1); // twice run, told once that day
    expect(due[0]).toMatchObject({ kind: 'reminder', route: `/projects/${p.id}?tab=reports` });
  });
});
