import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp, type TestApi } from '../../test/helpers.ts';
import { DEFAULT_APPROVAL_RULES } from './rules.ts';

// E05-13: change approval on the shared approval workflows. The approval rules name workflows of
// the kind `change_approval`; submitting starts one, its outcome moves the change, the change
// still cannot be scheduled or started unapproved, and changes waiting at the upgrade are taken
// over with the approvals already recorded. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
let agent: TestApi & { userId: string };
let ann: TestApi & { userId: string };
let bob: TestApi & { userId: string };
let cy: TestApi & { userId: string };

const LOW = { people_affected: 'few', downtime: 'none', back_out: 'quick', experience: 'routine', testing: 'full' };
const HIGH = { people_affected: 'most', downtime: 'working_hours', back_out: 'slow', experience: 'never', testing: 'partial' };
let day = 0;
const complete = (extra: Row = {}) => {
  day += 1;
  const d = `2033-02-${String(day).padStart(2, '0')}`;
  return {
    title: 'Replace the depot radio gateway', description: 'Swap the gateway.', reason: 'End of support.',
    implementation_plan: 'Swap and test.', backout_plan: 'Refit the old gateway.', risk_answers: LOW,
    planned_start: `${d}T18:00:00Z`, planned_end: `${d}T20:00:00Z`, ...extra,
  };
};
const move = (api: TestApi, id: string, to: string, body: Row = {}) => api.post(`/api/changes/${id}/transition`, { to, ...body });
const panel = async (api: TestApi, id: string) => (await api.get(`/api/workflows/records/change/${id}`)).body;
const change = async (id: string) => (await t.api.get(`/api/changes/${id}`)).body as Row;
const submit = async (extra: Row = {}) => {
  const made = (await agent.post('/api/changes', complete(extra))).body;
  const res = await move(agent, made.id, 'submitted');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return made.id as string;
};

beforeAll(async () => {
  process.env.GRC_MODULES = 'changes,workflows,notifications';
  t = await testApp();
  agent = await t.as('agent');
  ann = await t.as('approver');
  bob = await t.as('approver');
  cy = await t.as('approver');
}, 180_000);
afterAll(async () => { await t.close(); });

describe('change approval on the shared workflows', () => {
  it('turns each approval rule that asks for approval into a workflow, named by the rule', async () => {
    const settings = (await t.api.get('/api/changes/settings')).body;
    const normalHigh = settings.approval_rules.find((r: Row) => r.change_type === 'normal' && r.risk_level === 'high');
    expect(normalHigh).toMatchObject({ approvals: 2, workflow_id: expect.any(String), workflow_name: expect.stringMatching(/normal change, high risk/) });
    expect(settings.approval_rules.find((r: Row) => r.change_type === 'standard').workflow_id).toBeNull();
    expect(settings.workflows.length).toBe(4);
    const def = (await t.api.get(`/api/workflows/definitions/${normalHigh.workflow_id}`)).body;
    expect(def).toMatchObject({ kind: 'change_approval', trigger: 'module', record_type: 'change' });
    expect(def.steps[0]).toMatchObject({ quorum: 2, approvers: { kind: 'permission', permission: 'changes.approve' } });
  });

  it('starts the rule\'s workflow on submission; approval through the Approvals page moves the change, and work waits for it', async () => {
    const id = await submit({ risk_answers: HIGH });
    expect(await change(id)).toMatchObject({ status: 'submitted', approvals_required: 2, approvals_received: 0 });
    // The rule is still enforced: no work before approval.
    expect((await move(agent, id, 'in_progress')).body.error.code).toBe('approvals_missing');
    // It is on the approvers' shared Approvals page (and so in the AI assistant's my_approvals).
    const item = ((await ann.get('/api/workflows/approvals')).body.rows as Row[]).find((r) => r.record_id === id);
    expect(item).toMatchObject({ kind: 'change_approval', required: 2 });
    expect(((await agent.get('/api/workflows/approvals')).body.rows as Row[]).some((r) => r.record_id === id)).toBe(false); // the requester
    await ann.post(`/api/workflows/steps/${item!.step_id}/decision`, { decision: 'approved', comment: 'Fine' });
    expect(await change(id)).toMatchObject({ status: 'submitted', approvals_received: 1 });
    await bob.post(`/api/workflows/steps/${item!.step_id}/decision`, { decision: 'approved' });
    expect(await change(id)).toMatchObject({ status: 'approved', approvals_received: 2, approvals_required: 2 });
    // The change's own approvals card lists both decisions.
    const card = (await agent.get(`/api/changes/${id}/approvals`)).body;
    expect(card.decisions.filter((d: Row) => d.current)).toHaveLength(2);
    expect(card.workflow).toMatchObject({ status: 'approved' });
    expect((await move(agent, id, 'in_progress')).body.status).toBe('in_progress');
  });

  it('a rejection through the workflow rejects the change; back to draft ends a running workflow', async () => {
    const id = await submit();
    const step = (await panel(ann, id)).instances[0].steps[0];
    await ann.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'rejected', comment: 'No test plan' });
    expect((await change(id)).status).toBe('rejected');

    const again = await submit();
    expect((await panel(agent, again)).instances[0].status).toBe('running');
    await move(agent, again, 'draft');
    expect((await panel(agent, again)).instances[0].status).toBe('canceled');
    expect((await change(again)).status).toBe('draft');
  });

  it('canceling the workflow from the approval panel returns the change to draft', async () => {
    const id = await submit();
    const inst = (await panel(agent, id)).instances[0];
    expect(inst.can_cancel).toBe(true);
    await agent.post(`/api/workflows/instances/${inst.id}/cancel`, { reason: 'Wrong window' });
    expect(await change(id)).toMatchObject({ status: 'draft', approvals_received: 0 });
  });

  it('follows steps an administrator adds to the rule\'s workflow, and the rules editor keeps its first step', async () => {
    const settings = (await t.api.get('/api/changes/settings')).body;
    const rule = settings.approval_rules.find((r: Row) => r.change_type === 'normal' && r.risk_level === 'low');
    const def = (await t.api.get(`/api/workflows/definitions/${rule.workflow_id}`)).body;
    const res = await t.api.patch(`/api/workflows/definitions/${def.id}`, {
      steps: [...def.steps, { name: 'Service owner', approvers: { kind: 'users', users: [cy.userId] }, due_hours: 24 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = await submit();
    let step = (await panel(ann, id)).instances[0].steps[0];
    await ann.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved' });
    expect((await change(id)).status).toBe('submitted');
    step = (await panel(cy, id)).instances[0].steps[1];
    expect(step.can_decide).toBe(true);
    await cy.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved' });
    expect(await change(id)).toMatchObject({ status: 'approved', approvals_received: 2 });

    // The rules editor names Ann only for normal, low-risk changes: the workflow's first step follows; the second stays.
    const rules = DEFAULT_APPROVAL_RULES.map((r) => (r.change_type === 'normal' && r.risk_level === 'low' ? { ...r, approver_user_ids: [ann.userId] } : r));
    expect((await t.api.patch('/api/changes/settings', { approval_rules: rules })).status).toBe(200);
    const after = (await t.api.get(`/api/workflows/definitions/${rule.workflow_id}`)).body;
    expect(after.steps).toHaveLength(2);
    expect(after.steps[0].approvers).toEqual({ kind: 'people', users: [ann.userId], roles: [] });
    expect((await t.api.get('/api/changes/settings')).body.approval_rules.find((r: Row) => r.workflow_id === rule.workflow_id).approver_user_ids).toEqual([ann.userId]);
    await t.api.patch(`/api/workflows/definitions/${def.id}`, { steps: def.steps });
    await t.api.patch('/api/changes/settings', { approval_rules: DEFAULT_APPROVAL_RULES });
  });

  it('a stand-in decides a change approval on behalf of the approver', async () => {
    const rules = DEFAULT_APPROVAL_RULES.map((r) => (r.change_type === 'normal' && r.risk_level === 'low' ? { ...r, approver_user_ids: [bob.userId] } : r));
    await t.api.patch('/api/changes/settings', { approval_rules: rules });
    const s = await bob.post('/api/workflows/standins', { standin_id: cy.userId, starts_on: dayInZone(0), ends_on: dayInZone(10) });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const id = await submit();
    expect((await cy.get('/api/changes/waiting')).body.rows.map((r: Row) => r.id)).toContain(id);
    const res = await cy.post(`/api/changes/${id}/approvals`, { decision: 'approved' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.change.status).toBe('approved');
    expect(res.body.approvals.decisions[0].approver_name).toMatch(/on behalf of/);
    await t.api.del(`/api/workflows/standins/${s.body.id}`);
    await t.api.patch('/api/changes/settings', { approval_rules: DEFAULT_APPROVAL_RULES });
  });

  it('takes over a change that was waiting at the upgrade, with the approvals already recorded', async () => {
    // A change submitted under the old rules: one of two approvals recorded, no workflow.
    const made = (await agent.post('/api/changes', complete({ risk_answers: HIGH }))).body;
    await t.db.query(
      `update changes set status = 'submitted', submitted_at = now() - interval '1 hour', approvals_required = 2, approvals_received = 1 where id = $1`, [made.id]);
    await t.db.query(
      `insert into change_approvals (change_id, decision, approver_name, decided_on, recorded_by, recorded_by_name, approver_user_id, created_at)
       values ($1, 'approved', 'Ann (in the meeting)', current_date, $2, 'Ann', $2, now() - interval '30 minutes')`, [made.id, ann.userId]);
    await t.db.query(`delete from workflow_kind_installs where kind = 'change_approval'`);
    const before = (await t.api.get('/api/changes/settings')).body.workflows.length;
    expect(await t.app.workflows!.installKinds('change_approval')).toEqual(['change_approval']);
    expect((await t.api.get('/api/changes/settings')).body.workflows.length).toBe(before); // rules already had workflows
    const step = (await panel(t.api, made.id)).instances[0].steps[0];
    expect(step).toMatchObject({ status: 'pending', required: 2 });
    expect(step.decisions).toEqual([expect.objectContaining({ user_id: ann.userId, adopted: true })]);
    // Ann cannot approve twice; Bob's approval completes it.
    expect((await ann.post(`/api/changes/${made.id}/approvals`, { decision: 'approved' })).body.error.code).toBe('duplicate_approver');
    const done = await bob.post(`/api/changes/${made.id}/approvals`, { decision: 'approved' });
    expect(done.body.change).toMatchObject({ status: 'approved', approvals_received: 2 });
    // The earlier decision stays on the change.
    expect(done.body.approvals.decisions.map((d: Row) => d.approver_name)).toContain('Ann (in the meeting)');
  });
});
