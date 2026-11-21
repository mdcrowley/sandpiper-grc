import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import type { ModuleDef, Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// Wave 9 review fixes in the approval workflow engine: a deleted record's workflows end (BS-1), the
// approval kind's permission is checked at decision time (BS-2), a step that can no longer reach its
// approvals is flagged (BS-5), a step's people are never overwritten by a stale write (BS-10), and a
// step may ask for a different person than the other steps (AZ-7). Invented data only.

const loaded = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');

const items: ModuleDef = {
  key: 'testwfsafe',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_wf_safe (
      id uuid primary key default gen_random_uuid(), ref text, title text not null, status text,
      restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'wf_safe', table: 'test_wf_safe', module: 'tickets', label: 'Tool request', plural: 'Tool requests',
      path: '/api/test-wf-safe', route: '/test-wf-safe', titleField: 'title', restricted: 'flag',
      fields: {
        title: { label: 'Title', type: 'text', required: true },
        status: { label: 'Status', type: 'text' },
        restricted: { label: 'Restricted', type: 'boolean' },
      },
    });
    defineApprovalKind(ctx.app, {
      key: 'test_safe_kind', recordType: 'wf_safe', label: 'Tool request approval',
      startsWhen: 'A tool request is sent', outcome: 'Approved: approved', approverPermission: 'tickets.approve',
      async install(h) {
        if (!(await h.hasDefinitions())) await h.define({ name: 'Tool approval', steps: [{ name: 'Buyer', approvers: { kind: 'permission', permission: 'tickets.approve' } }] });
      },
      async onFinish() { /* nothing to record */ },
    });
    ctx.app.post('/api/test-wf-safe/:id/send', async (req) => {
      const row = (await ctx.resources.find('wf_safe', (req.params as Row).id, req.user))!;
      return approvalEngine(ctx.app)!.start('test_safe_kind', row, { requester: req.user!.id, req });
    });
  },
};

type T = Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<T['as']>>;
let t: T;
let alice: Client; // asks
let bob: Client;
let cara: Client;
let dan: Client;
const defs: string[] = [];

const define = async (body: Row) => {
  for (const id of defs.splice(0)) await t.api.patch(`/api/workflows/definitions/${id}`, { active: false });
  const res = await t.api.post('/api/workflows/definitions', { record_type: 'wf_safe', trigger: 'create', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  defs.push(res.body.id);
  return res.body as Row;
};
const make = async (title: string, client: Client = alice) => {
  const res = await client.post('/api/test-wf-safe', { title });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row;
};
const instanceOf = async (recordId: string) => (await t.db.one<Row>(
  `select * from workflow_instances where record_type = 'wf_safe' and record_id = $1 order by started_at desc limit 1`, [recordId]))!;
const pendingStep = async (instanceId: string) => t.db.one<Row>(
  `select * from workflow_steps where instance_id = $1 and status = 'pending' order by position limit 1`, [instanceId]);
const decide = (c: Client | T['api'], stepId: string, decision = 'approved') => c.post(`/api/workflows/steps/${stepId}/decision`, { decision, comment: 'Invented' });
const svc = () => t.app.workflows!;

describe.runIf(loaded)('approval workflow safeguards (wave 9)', () => {
  beforeAll(async () => {
    t = await testApp({ extraModules: [items] });
    alice = await t.as('agent');
    bob = await t.as('agent');
    cara = await t.as('agent');
    dan = await t.as('agent');
  }, 60_000);
  afterAll(async () => { await t?.close(); });

  it('BS-1: deleting a record cancels its running workflows', async () => {
    await define({ name: 'Delete probe', steps: [{ name: 'Check', approvers: { kind: 'users', users: [bob.userId] }, due_hours: 1, escalate_to: { users: [dan.userId], role: null } }] });
    const r = await make('Torque wrench set');
    expect((await instanceOf(r.id)).status).toBe('running');
    expect((await t.api.del(`/api/test-wf-safe/${r.id}`)).status).toBe(200);
    const inst = await instanceOf(r.id);
    expect(inst).toMatchObject({ status: 'canceled', outcome_note: 'The record was deleted.' });
    expect((await t.api.get('/api/workflows/running')).body.rows.some((x: Row) => x.id === inst.id)).toBe(false);
    expect((await t.db.one<Row>(`select count(*)::int as n from audit_events where action = 'workflow.cancel' and record_id = $1`, [r.id]))!.n).toBe(1);
  });

  it('BS-1: a workflow whose record went another way can be ended by an administrator and by the sweep', async () => {
    await define({ name: 'Gone probe', steps: [{ name: 'Check', approvers: { kind: 'users', users: [bob.userId] }, due_hours: 1, escalate_to: { users: [dan.userId], role: null } }] });
    const a = await make('Pipe bender');
    const b = await make('Rivet gun');
    // Deleted without the resource engine (a module's own route, an import): no listener ran.
    await t.db.query(`update test_wf_safe set deleted_at = now() where id = any($1::uuid[])`, [[a.id, b.id]]);
    const ia = await instanceOf(a.id);
    expect((await alice.post(`/api/workflows/instances/${ia.id}/cancel`, {})).status).toBe(404); // the requester can no longer see it
    const res = await t.api.post(`/api/workflows/instances/${ia.id}/cancel`, { reason: 'Record removed' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('canceled');
    // The sweep ends the other one instead of escalating it.
    const ib = await instanceOf(b.id);
    await t.db.query(`update workflow_steps set due_at = now() - interval '1 minute' where instance_id = $1`, [ib.id]);
    const swept = await svc().escalateDue();
    expect(swept.canceled).toBeGreaterThanOrEqual(1);
    expect((await instanceOf(b.id)).status).toBe('canceled');
    expect((await t.db.one<Row>(`select count(*)::int as n from audit_events where action = 'workflow.escalate' and record_id = $1`, [b.id]))!.n).toBe(0);
  });

  it('BS-2: the approval kind\'s permission is checked again when the approver decides', async () => {
    const role = (await t.db.one<{ id: string }>(`insert into roles (key, name) values ('safe_buyer', 'Invented buyer') returning id`))!;
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'tickets.view'), ($1, 'tickets.approve')`, [role.id]);
    const buyer = await t.as('safe_buyer');
    const r = await make('Cable crimper');
    const started = await alice.post(`/api/test-wf-safe/${r.id}/send`, {});
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const step = (await pendingStep(started.body.id))!;
    expect(JSON.stringify(step.approvers)).toContain(buyer.userId);
    expect((await buyer.get('/api/workflows/approvals')).body.rows.some((x: Row) => x.record_id === r.id)).toBe(true);
    await t.db.query(`delete from role_permissions where role_id = $1 and permission = 'tickets.approve'`, [role.id]);
    // No longer offered, and refused.
    expect((await buyer.get('/api/workflows/approvals')).body.rows.some((x: Row) => x.record_id === r.id)).toBe(false);
    const refused = await decide(buyer, step.id);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/no longer hold the permission/);
    expect((await t.db.one<Row>('select count(*)::int as n from workflow_decisions where step_id = $1', [step.id]))!.n).toBe(0);
  });

  it('BS-5: a step that can no longer reach its approvals is flagged once and administrators are told', async () => {
    await define({ name: 'Stuck probe', steps: [{ name: 'Both', approvers: { kind: 'users', users: [bob.userId, cara.userId] }, quorum: 'all' }] });
    const r = await make('Hydraulic jack');
    const inst = await instanceOf(r.id);
    const step = (await pendingStep(inst.id))!;
    expect((await decide(bob, step.id)).status).toBe(200);
    await t.db.query(`update users set status = 'disabled' where id = $1`, [cara.userId]);
    try {
      const first = await svc().escalateDue();
      expect(first.stuck).toBe(1);
      const row = (await t.api.get('/api/workflows/running')).body.rows.find((x: Row) => x.id === inst.id);
      expect(row.problem).toMatch(/can no longer decide/);
      const told = await t.db.one<Row>(`select count(*)::int as n from notifications where title like 'Approval stuck:%'`);
      expect(told!.n).toBeGreaterThanOrEqual(1);
      expect((await svc().escalateDue()).stuck).toBe(0); // told once
    } finally {
      await t.db.query(`update users set status = 'active' where id = $1`, [cara.userId]);
    }
  });

  it('BS-10: a step\'s people are written only when nobody changed them meanwhile', async () => {
    await define({ name: 'Race probe', steps: [{ name: 'One', approvers: { kind: 'users', users: [bob.userId] } }] });
    const r = await make('Bench grinder');
    const inst = await instanceOf(r.id);
    const stale = (await pendingStep(inst.id))!;
    // An administrator hands the step to Cara; a sweep that read the step before must not undo it.
    expect((await t.api.post(`/api/workflows/steps/${stale.id}/reassign`, { from_user_id: bob.userId, to_user_id: cara.userId })).status).toBe(200);
    const wrote = await svc().writePeople(stale, { approvers: [bob.userId, dan.userId], principals: [bob.userId], standins: { [dan.userId]: [bob.userId] } });
    expect(wrote).toBe(false);
    const now = (await pendingStep(inst.id))!;
    expect(now.principals).toEqual([cara.userId]);
    // With the current row it writes.
    expect(await svc().writePeople(now, { approvers: [cara.userId], principals: [cara.userId], standins: {} })).toBe(true);
  });

  it('AZ-7: a step may ask for someone who decided no other step of the request', async () => {
    const both = { kind: 'users', users: [bob.userId, cara.userId] };
    const w = await define({ name: 'Two people', steps: [{ name: 'First', approvers: both }, { name: 'Second', approvers: both, distinct_approvers: true }] });
    expect(w.steps[1].distinct_approvers).toBe(true);
    expect(w.steps[0].distinct_approvers).toBeUndefined();
    const r = await make('Thread gauge');
    const inst = await instanceOf(r.id);
    const s1 = (await pendingStep(inst.id))!;
    expect((await decide(bob, s1.id)).status).toBe(200);
    const s2 = (await pendingStep(inst.id))!;
    expect(s2.principals).toEqual([cara.userId]); // Bob decided the first step
    expect((await bob.get('/api/workflows/approvals')).body.rows.some((x: Row) => x.record_id === r.id)).toBe(false);
    expect((await decide(bob, s2.id)).status).toBe(403);
    // Nor can an administrator hand it back to Bob.
    const back = await t.api.post(`/api/workflows/steps/${s2.id}/reassign`, { from_user_id: cara.userId, to_user_id: bob.userId });
    expect(back.status).toBe(400);
    expect(back.body.error.message).toMatch(/decided another step/);
    // Even if Bob is put back by hand, the decision itself is refused.
    await t.db.query(`update workflow_steps set approvers = $2::jsonb, principals = $2::jsonb where id = $1`, [s2.id, JSON.stringify([cara.userId, bob.userId])]);
    const refused = await decide(bob, s2.id);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/decided another step/);
    expect((await decide(cara, s2.id)).status).toBe(200);
    expect((await instanceOf(r.id)).status).toBe('approved');

    // Without the rule, the same person may decide both steps.
    await define({ name: 'Same person allowed', steps: [{ name: 'First', approvers: both }, { name: 'Second', approvers: both }] });
    const r2 = await make('Feeler gauge');
    const i2 = await instanceOf(r2.id);
    expect((await decide(bob, (await pendingStep(i2.id))!.id)).status).toBe(200);
    expect((await decide(bob, (await pendingStep(i2.id))!.id)).status).toBe(200);
    expect((await instanceOf(r2.id)).status).toBe('approved');
  });

  it('AZ-7: the upgrade gives an existing Risk acceptance workflow the rule on its executive step', async () => {
    const steps = [{ key: 'risk-approver', name: 'Risk approver', approvers: { kind: 'permission', permission: 'risks.approve' }, quorum: 'any', conditions: [] },
      { key: 'executive', name: 'Executives', approvers: { kind: 'role', role: 'admin' }, quorum: 'any', conditions: [] }];
    const row = (await t.db.one<{ id: string }>(
      `insert into workflow_definitions (record_type, kind, name, trigger, conditions, steps, on_approve, on_reject)
       values ('risk', 'risk_acceptance', 'Older acceptance', 'module', '[]', $1::jsonb, '[]', '[]') returning id`, [JSON.stringify(steps)]))!;
    await t.db.exec(readFileSync(join(import.meta.dirname, 'migrations', '004_distinct_approvers.sql'), 'utf8'));
    const after = (await t.db.one<Row>('select steps from workflow_definitions where id = $1', [row.id]))!.steps as Row[];
    expect(after.map((s) => s.distinct_approvers ?? false)).toEqual([false, true]);
    expect(after[1].name).toBe('Executives');
    await t.db.query('delete from workflow_definitions where id = $1', [row.id]);
  });
});
