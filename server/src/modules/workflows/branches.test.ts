import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// Wave 8: steps that run side by side and routes chosen by condition (E14-32), and status moves
// that wait for an approval workflow (E14-37), through the API. Invented data only.

const requests: ModuleDef = {
  key: 'testwfbranches',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_wf_orders (
      id uuid primary key default gen_random_uuid(), ref text, title text not null, status text not null default 'draft',
      cost numeric, safety boolean not null default false, notes text,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
    await ctx.lookups.ensure('test_wf_order_status', ['draft', 'review', 'scheduled', 'done'].map((value, i) => ({ value, label: value[0].toUpperCase() + value.slice(1), sort: i })), { module: 'tickets' });
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'wf_order', table: 'test_wf_orders', module: 'tickets', label: 'Work order', plural: 'Work orders',
      path: '/api/test-wf-orders', route: '/test-wf-orders', titleField: 'title', ref: { field: 'ref', prefix: 'WO-' },
      fields: {
        title: { label: 'Title', type: 'text', required: true },
        status: { label: 'Status', type: 'lookup', list: 'test_wf_order_status', default: 'draft' },
        cost: { label: 'Cost', type: 'currency' },
        safety: { label: 'Safety related', type: 'boolean' },
        notes: { label: 'Notes', type: 'longtext' },
        ref: { label: 'Reference', type: 'text', readOnly: true },
      },
    });
  },
};

type T = Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<T['as']>>;
let t: T;
let alice: Client; // asks
let finance: Client;
let safety: Client;
let director: Client;
const created: string[] = [];

const define = async (body: Row) => {
  const res = await t.api.post('/api/workflows/definitions', { record_type: 'wf_order', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(res.body.id);
  return res.body as Row;
};
const clearDefinitions = async () => {
  for (const id of created.splice(0)) await t.api.patch(`/api/workflows/definitions/${id}`, { active: false });
};
const make = async (data: Row) => {
  const res = await alice.post('/api/test-wf-orders', { title: 'Replace platform lighting', ...data });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row;
};
const onRecord = async (client: Client | T['api'], id: string) => (await client.get(`/api/workflows/records/wf_order/${id}`)).body;
const record = async (id: string) => (await t.api.get(`/api/test-wf-orders/${id}`)).body;
const decide = (client: Client, stepId: string, decision: string, comment?: string) =>
  client.post(`/api/workflows/steps/${stepId}/decision`, { decision, comment });
const start = (id: string, workflowId: string) => alice.post(`/api/workflows/records/wf_order/${id}/start`, { workflow_id: workflowId });
const users = (c: Client) => ({ kind: 'users', users: [c.userId] });

beforeAll(async () => {
  t = await testApp({ extraModules: [requests] });
  alice = await t.as('agent');
  finance = await t.as('agent');
  safety = await t.as('agent');
  director = await t.as('agent');
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('steps that run side by side (E14-32)', () => {
  let wf: Row;
  beforeAll(async () => {
    await clearDefinitions();
    wf = await define({
      name: 'Finance and safety together', trigger: 'manual',
      steps: [
        {
          name: 'Finance and safety', branches: [
            { name: 'Finance', approvers: users(finance) },
            { name: 'Safety', approvers: users(safety), conditions: [{ field: 'safety', op: 'set' }] },
          ],
        },
        { name: 'Director', approvers: users(director) },
      ],
    });
  });

  it('keeps the branches in the stored definition', () => {
    expect(wf.steps[0].branches.map((b: Row) => b.name)).toEqual(['Finance', 'Safety']);
    expect(wf.steps[0].approvers).toBeUndefined();
  });

  it('starts every branch at once and moves on only when all have approved', async () => {
    const r = await make({ safety: true });
    expect((await start(r.id, wf.id)).status).toBe(201);
    let view = await onRecord(alice, r.id);
    const group = view.instances[0].steps[0];
    expect(group.status).toBe('pending');
    expect(group.branches.map((b: Row) => b.status)).toEqual(['pending', 'pending']);
    // Each branch is in its approver's list, named "Step: Branch".
    const inbox = (await finance.get('/api/workflows/approvals')).body.rows as Row[];
    expect(inbox.find((x) => x.record_id === r.id)).toMatchObject({ step: 'Finance and safety: Finance', group: 'Finance and safety', branch: 'Finance' });

    expect((await decide(finance, group.branches[0].id, 'approved')).body.stepOutcome).toBe('approved');
    view = await onRecord(alice, r.id);
    expect(view.instances[0].steps[0].status).toBe('pending'); // safety still to decide
    expect(view.instances[0].steps[1].status).toBe('waiting');
    expect((await decide(safety, group.branches[1].id, 'approved')).status).toBe(200);
    view = await onRecord(alice, r.id);
    expect(view.instances[0].steps[0].status).toBe('approved');
    expect(view.instances[0].steps[1].status).toBe('pending');
    // The administrators' list of running workflows shows one row per workflow, not per branch.
    const running = (await t.api.get('/api/workflows/running')).body.rows as Row[];
    expect(running.filter((x) => x.record_id === r.id)).toHaveLength(1);
  });

  it('is rejected by one rejection, which stops the other branches', async () => {
    const r = await make({ safety: true });
    await start(r.id, wf.id);
    const group = (await onRecord(alice, r.id)).instances[0].steps[0];
    expect((await decide(safety, group.branches[1].id, 'rejected', 'No method statement')).status).toBe(200);
    const view = await onRecord(alice, r.id);
    expect(view.instances[0].status).toBe('rejected');
    expect(view.instances[0].steps[0].branches.map((b: Row) => b.status)).toEqual(['canceled', 'rejected']);
  });

  it('starts only the branches whose conditions hold', async () => {
    const r = await make({ safety: false });
    await start(r.id, wf.id);
    const group = (await onRecord(alice, r.id)).instances[0].steps[0];
    expect(group.branches.map((b: Row) => b.status)).toEqual(['pending', 'skipped']);
    await decide(finance, group.branches[0].id, 'approved');
    expect((await onRecord(alice, r.id)).instances[0].steps[1].status).toBe('pending');
  });

  it('needs at least two branches, each with a name and approvers', async () => {
    const bad = await t.api.post('/api/workflows/definitions', {
      record_type: 'wf_order', name: 'Bad', trigger: 'manual',
      steps: [{ name: 'Together', branches: [{ name: '', approvers: { kind: 'users', users: [] } }] }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toMatchObject({ 'steps.0.branches': expect.any(String), 'steps.0.branches.0.name': expect.any(String), 'steps.0.branches.0.approvers': expect.any(String) });
  });
});

describe('routes chosen by condition (E14-32)', () => {
  let wf: Row;
  beforeAll(async () => {
    await clearDefinitions();
    wf = await define({
      name: 'Cost routing', trigger: 'manual',
      steps: [
        { key: 'triage', name: 'Triage', approvers: users(finance), routes: [{ conditions: [{ field: 'cost', op: 'gt', value: 10000 }], to: 'director' }] },
        { key: 'small', name: 'Small purchase', approvers: users(safety), routes: [{ conditions: [], to: 'end' }] },
        { key: 'director', name: 'Director', approvers: users(director) },
      ],
    });
  });

  it('goes to the step a route names and records the steps it passes over', async () => {
    const r = await make({ cost: 25000 });
    await start(r.id, wf.id);
    let view = await onRecord(alice, r.id);
    await decide(finance, view.instances[0].steps[0].id, 'approved');
    view = await onRecord(alice, r.id);
    expect(view.instances[0].steps.map((s: Row) => s.status)).toEqual(['approved', 'skipped', 'pending']);
    expect(view.instances[0].steps[1].note).toMatch(/Not on this record's route/);
  });

  it('otherwise goes on to the next step, and a route to the end approves', async () => {
    const r = await make({ cost: 200 });
    await start(r.id, wf.id);
    let view = await onRecord(alice, r.id);
    await decide(finance, view.instances[0].steps[0].id, 'approved');
    view = await onRecord(alice, r.id);
    await decide(safety, view.instances[0].steps[1].id, 'approved');
    view = await onRecord(alice, r.id);
    expect(view.instances[0].status).toBe('approved');
    expect(view.instances[0].steps.map((s: Row) => s.status)).toEqual(['approved', 'approved', 'skipped']);
  });

  it('only goes forward', async () => {
    const bad = await t.api.post('/api/workflows/definitions', {
      record_type: 'wf_order', name: 'Loop', trigger: 'manual',
      steps: [
        { key: 'a', name: 'A', approvers: users(finance) },
        { key: 'b', name: 'B', approvers: users(safety), routes: [{ conditions: [], to: 'a' }] },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields['steps.1.routes.0']).toMatch(/later step/);
  });
});

describe('definitions saved before wave 8', () => {
  it('run unchanged: a stored step without branches or routes is an ordinary step', async () => {
    await clearDefinitions();
    // Written straight to the table, in the shape stored before (no branches, no routes).
    const old = (await t.db.one<Row>(
      `insert into workflow_definitions (record_type, name, trigger, steps) values ('wf_order', 'Older workflow', 'manual', $1::jsonb) returning id`,
      [JSON.stringify([
        { key: 'step-1', name: 'One', approvers: users(finance), quorum: 'any', conditions: [], due_hours: null, escalate_to: null },
        { key: 'step-2', name: 'Two', approvers: users(safety), quorum: 'any', conditions: [{ field: 'cost', op: 'gt', value: 100 }], due_hours: null, escalate_to: null },
      ])]))!;
    const r = await make({ cost: 50 });
    await start(r.id, old.id);
    let view = await onRecord(alice, r.id);
    expect(view.instances[0].steps.map((s: Row) => [s.status, s.branch])).toEqual([['pending', null], ['waiting', null]]);
    await decide(finance, view.instances[0].steps[0].id, 'approved');
    view = await onRecord(alice, r.id);
    expect(view.instances[0].status).toBe('approved');
    expect(view.instances[0].steps[1].status).toBe('skipped');
    // Opening and saving it in the editor keeps its shape.
    const saved = await t.api.patch(`/api/workflows/definitions/${old.id}`, {});
    expect(saved.status).toBe(200);
    expect(saved.body.steps[0]).not.toHaveProperty('branches');
    expect(saved.body.steps[0]).not.toHaveProperty('routes');
    await t.api.patch(`/api/workflows/definitions/${old.id}`, { active: false });
  });
});

describe('a status move that waits for approval (E14-37)', () => {
  let wf: Row;
  let other: Row;
  beforeAll(async () => {
    await clearDefinitions();
    wf = await define({ name: 'Schedule sign-off', trigger: 'manual', steps: [{ name: 'Director', approvers: users(director) }] });
    other = await define({ name: 'Only big ones', trigger: 'manual', conditions: [{ field: 'cost', op: 'gt', value: 1000 }], steps: [{ name: 'Finance', approvers: users(finance) }] });
    const res = await t.api.put('/api/admin/lifecycles/wf_order', { blocked: [], required: {}, who: {}, approvals: [['review', 'scheduled', wf.id], ['scheduled', 'done', other.id]] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rules.approvals).toEqual([['review', 'scheduled', wf.id], ['scheduled', 'done', other.id]]);
    expect(res.body.workflows.map((w: Row) => w.name)).toEqual(expect.arrayContaining(['Schedule sign-off', 'Only big ones']));
  });

  it('is offered and checked on the Lifecycles page', async () => {
    const bad = await t.api.put('/api/admin/lifecycles/wf_order', { approvals: [['', 'review', wf.id]] });
    expect(bad.status).toBe(400);
    const blocked = await t.api.put('/api/admin/lifecycles/wf_order', { blocked: [['review', 'scheduled']], approvals: [['review', 'scheduled', wf.id]] });
    expect(blocked.status).toBe(400);
    expect((await t.api.get('/api/admin/lifecycles')).body.types.find((x: Row) => x.type === 'wf_order').approvals).toBe(2);
    // The form learns which moves wait, without the workflow ids.
    const meta = (await alice.get('/api/meta')).body;
    const lc = (meta.resources ?? meta.types ?? meta).wf_order?.lifecycle ?? Object.values(meta.resources ?? {}).find((r) => (r as Row).type === 'wf_order');
    expect(JSON.stringify(lc)).toContain('"approvals":[["review","scheduled"],["scheduled","done"]]');
  });

  it('keeps the status, saves the other fields, starts the workflow and shows the pending move', async () => {
    const r = await make({ status: 'review' });
    const res = await alice.patch(`/api/test-wf-orders/${r.id}`, { status: 'scheduled', notes: 'Night possession booked' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('review');
    expect(res.body.notes).toBe('Night possession booked');
    expect(res.body._pending_move).toMatchObject({ field: 'status', from: 'review', to: 'scheduled' });
    const view = await onRecord(alice, r.id);
    expect(view.pending_move).toMatchObject({ workflow: 'Schedule sign-off', from_label: 'Review', to_label: 'Scheduled' });
    expect(view.instances[0]).toMatchObject({ workflow: 'Schedule sign-off', status: 'running', requested_by: alice.userId });

    // Other fields stay editable; another status change is refused until the approval ends.
    expect((await alice.patch(`/api/test-wf-orders/${r.id}`, { notes: 'Crew confirmed' })).status).toBe(200);
    const again = await alice.patch(`/api/test-wf-orders/${r.id}`, { status: 'draft' });
    expect(again.status).toBe(400);
    expect(again.body.error.fields.status).toMatch(/waiting for approval to move to "Scheduled"/);

    // Approval makes the move through the engine: audited, and the status is now Scheduled.
    await decide(director, view.instances[0].steps[0].id, 'approved');
    expect((await record(r.id)).status).toBe('scheduled');
    expect((await onRecord(alice, r.id)).pending_move).toBeNull();
    const history = await t.db.query<Row>(`select action from audit_events where record_id = $1 order by id`, [r.id]);
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(['lifecycle.move_held', 'workflow.start', 'wf_order.update', 'lifecycle.move_approved']));
  });

  it('leaves the record as it was when rejected or canceled', async () => {
    const r = await make({ status: 'review' });
    await alice.patch(`/api/test-wf-orders/${r.id}`, { status: 'scheduled' });
    const view = await onRecord(alice, r.id);
    await decide(director, view.instances[0].steps[0].id, 'rejected', 'Possession not confirmed');
    expect((await record(r.id)).status).toBe('review');

    await alice.patch(`/api/test-wf-orders/${r.id}`, { status: 'scheduled' });
    const second = (await onRecord(alice, r.id)).instances.find((i: Row) => i.status === 'running');
    expect((await alice.post(`/api/workflows/instances/${second.id}/cancel`, { reason: 'Asked too early' })).status).toBe(200);
    expect((await record(r.id)).status).toBe('review');
    // Free to move again.
    expect((await alice.patch(`/api/test-wf-orders/${r.id}`, { status: 'draft' })).body.status).toBe('draft');
    const actions = (await t.db.query<Row>(`select action from audit_events where record_id = $1`, [r.id])).map((h) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['lifecycle.move_rejected', 'lifecycle.move_canceled']));
  });

  it('needs no approval when the workflow\'s own conditions do not hold', async () => {
    const r = await make({ status: 'scheduled', cost: 300 });
    expect((await alice.patch(`/api/test-wf-orders/${r.id}`, { status: 'done' })).body.status).toBe('done');
    const big = await make({ status: 'scheduled', cost: 3000 });
    expect((await alice.patch(`/api/test-wf-orders/${big.id}`, { status: 'done' })).body.status).toBe('scheduled');
  });

  it('applies to system work only through the module (no person, no hold)', async () => {
    const r = await make({ status: 'review' });
    await t.ctx.resources.update('wf_order', r.id, { status: 'scheduled' }, null);
    expect((await record(r.id)).status).toBe('scheduled');
  });

  it('is refused while the workflow it names is inactive', async () => {
    await t.api.patch(`/api/workflows/definitions/${wf.id}`, { active: false });
    const r = await make({ status: 'review' });
    const res = await alice.patch(`/api/test-wf-orders/${r.id}`, { status: 'scheduled' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.status).toMatch(/no longer active/);
    expect((await t.api.get(`/api/workflows/definitions/${wf.id}`)).body.moves).toBe(1);
    await t.api.patch(`/api/workflows/definitions/${wf.id}`, { active: true });
  });

  it('holds moves made by an import too; its check keeps nothing', async () => {
    const r = await make({ title: 'Imported crossing repair', status: 'review' });
    const text = 'Title,Status\nImported crossing repair,scheduled\n';
    const body = { fileName: 'orders.csv', content: Buffer.from(text).toString('base64'), mapping: { Title: 'title', Status: 'status' }, mode: 'update', matchKey: 'title' };
    const dry = await t.api.post('/api/import/wf_order', { ...body, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect((await onRecord(alice, r.id)).pending_move).toBeNull();
    const real = await t.api.post('/api/import/wf_order', { ...body, dryRun: false });
    expect(real.body).toMatchObject({ updated: 1, errors: 0 });
    expect((await record(r.id)).status).toBe('review');
    expect((await onRecord(alice, r.id)).pending_move).toMatchObject({ to: 'scheduled' });
  });
});
