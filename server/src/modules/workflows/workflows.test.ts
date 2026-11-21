import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from '../../core/module.ts';
import { WEBHOOK_EVENTS } from '../../core/webhooks.ts';
import { testApp } from '../../test/helpers.ts';

// E14-06: approval workflows through the API. A stand-in record type (permission module `tickets`,
// restricted by flag) keeps the tests independent of the other modules. Invented data only.

const requests: ModuleDef = {
  key: 'testwfrequests',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_wf_requests (
      id uuid primary key default gen_random_uuid(), ref text, title text not null, status text not null default 'new',
      priority text, cost numeric, owner_id uuid, department text, approved_on date, approver_id uuid,
      restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
    await ctx.lookups.ensure('test_wf_status', ['new', 'submitted', 'approved', 'rejected'].map((value, i) => ({ value, label: value, sort: i })), { module: 'tickets' });
    await ctx.lookups.ensure('test_wf_priority', ['low', 'high'].map((value, i) => ({ value, label: value, sort: i })), { module: 'tickets' });
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'wf_request', table: 'test_wf_requests', module: 'tickets', label: 'Purchase request', plural: 'Purchase requests',
      path: '/api/test-wf-requests', route: '/test-wf-requests', titleField: 'title', ref: { field: 'ref', prefix: 'PRQ-' }, restricted: 'flag',
      fields: {
        title: { label: 'Title', type: 'text', required: true },
        status: { label: 'Status', type: 'lookup', list: 'test_wf_status', default: 'new' },
        priority: { label: 'Priority', type: 'lookup', list: 'test_wf_priority' },
        cost: { label: 'Cost', type: 'currency' },
        owner_id: { label: 'Owner', type: 'user' },
        department: { label: 'Department', type: 'text' },
        approved_on: { label: 'Approved on', type: 'date' },
        approver_id: { label: 'Approved by', type: 'user' },
        restricted: { label: 'Restricted', type: 'boolean' },
        ref: { label: 'Reference', type: 'text', readOnly: true },
      },
    });
  },
};

type T = Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<T['as']>>;
let t: T;
let alice: Client; // asks
let bob: Client; // approves
let cara: Client; // approves
let dan: Client; // escalation
let sec: Client; // security lead (sees restricted records)
const created: string[] = [];

const define = async (body: Row) => {
  const res = await t.api.post('/api/workflows/definitions', { record_type: 'wf_request', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(res.body.id);
  return res.body;
};
/** Switches off every workflow made so far, so each test sees only its own. */
const clearDefinitions = async () => {
  for (const id of created.splice(0)) await t.api.patch(`/api/workflows/definitions/${id}`, { active: false });
};
const make = async (client: Client | T['api'], data: Row) => {
  const res = await client.post('/api/test-wf-requests', { title: 'Spare radios for depot', ...data });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row;
};
const onRecord = async (client: Client | T['api'], id: string) => (await client.get(`/api/workflows/records/wf_request/${id}`)).body;
const waitingFor = async (client: Client) => (await client.get('/api/workflows/approvals')).body.rows as Row[];
const record = async (id: string) => (await t.api.get(`/api/test-wf-requests/${id}`)).body;
const decide = (client: Client | T['api'], stepId: string, decision: string, comment?: string) =>
  client.post(`/api/workflows/steps/${stepId}/decision`, { decision, comment });

beforeAll(async () => {
  t = await testApp({ extraModules: [requests] });
  alice = await t.as('agent');
  bob = await t.as('agent');
  cara = await t.as('agent');
  dan = await t.as('agent');
  sec = await t.as('security_lead');
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('defining workflows', () => {
  it('is for administrators only', async () => {
    expect((await alice.get('/api/workflows/definitions')).status).toBe(403);
    expect((await alice.post('/api/workflows/definitions', {})).status).toBe(403);
    expect((await alice.get('/api/workflows/options')).status).toBe(403);
  });

  it('offers record types, their fields and lists, and checks what is sent', async () => {
    const options = (await t.api.get('/api/workflows/options')).body;
    const type = options.types.find((x: Row) => x.type === 'wf_request');
    expect(type.fields.map((f: Row) => f.name)).toContain('cost');
    expect(options.lookups.test_wf_status.map((v: Row) => v.value)).toContain('submitted');
    const bad = await t.api.post('/api/workflows/definitions', { record_type: 'wf_request', name: '', trigger: 'create', steps: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toMatchObject({ name: expect.any(String), steps: expect.any(String) });
  });
});

describe('a workflow started by a new record', () => {
  let wf: Row;
  beforeAll(async () => {
    await clearDefinitions();
    wf = await define({
      name: 'High-priority purchase', trigger: 'create',
      conditions: [{ field: 'priority', op: 'eq', value: 'high' }],
      steps: [
        // Alice is named too, but she asks, so she is never one of the approvers.
        { name: 'Two buyers', approvers: { kind: 'users', users: [alice.userId, bob.userId, cara.userId] }, quorum: 'all' },
        { name: 'Owner for large amounts', approvers: { kind: 'field', field: 'owner_id' }, conditions: [{ field: 'cost', op: 'gt', value: 1000 }] },
      ],
      on_approve: [{ field: 'status', value: 'approved' }, { field: 'approved_on', value: 'today' }, { field: 'approver_id', value: 'approver' }],
      on_reject: [{ field: 'status', value: 'rejected' }],
    });
  });

  it('does not start when its conditions do not hold', async () => {
    const r = await make(alice, { priority: 'low' });
    expect((await onRecord(alice, r.id)).instances).toEqual([]);
  });

  it('routes the steps in order, needs every approval, skips a step whose condition fails and sets the outcome', async () => {
    const r = await make(alice, { priority: 'high', cost: 500, owner_id: dan.userId });
    let view = await onRecord(alice, r.id);
    expect(view.instances).toHaveLength(1);
    const step = view.instances[0].steps[0];
    expect(step.status).toBe('pending');
    expect(step.approvers.map((a: Row) => a.id).sort()).toEqual([bob.userId, cara.userId].sort());
    expect(step.required).toBe(2);
    expect(step.can_decide).toBe(false);

    // Nobody approves their own request.
    expect((await decide(alice, step.id, 'approved')).status).toBe(403);
    // Someone not named cannot either.
    expect((await decide(dan, step.id, 'approved')).status).toBe(403);

    const inbox = await waitingFor(bob);
    expect(inbox.map((x) => x.record_id)).toContain(r.id);
    expect(inbox.find((x) => x.record_id === r.id)).toMatchObject({ workflow: 'High-priority purchase', step: 'Two buyers', approvals: 0, required: 2, steps_total: 2 });
    expect((await bob.get('/api/workflows/approvals/count')).body.waiting).toBeGreaterThan(0);

    const first = await decide(bob, step.id, 'approved', 'Fine by me');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ stepOutcome: 'pending', approvalsReceived: 1, approvalsRequired: 2 });
    expect((await decide(bob, step.id, 'approved')).status).toBe(409); // once each
    expect((await waitingFor(bob)).map((x) => x.record_id)).not.toContain(r.id);

    const second = await decide(cara, step.id, 'approved');
    expect(second.body.stepOutcome).toBe('approved');
    view = await onRecord(alice, r.id);
    expect(view.instances[0].status).toBe('approved');
    expect(view.instances[0].steps[1].status).toBe('skipped'); // cost is under 1000

    const after = await record(r.id);
    expect(after.status).toBe('approved');
    expect(after.approved_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(after.approver_id).toBe(cara.userId);

    // Every decision is on the record's history.
    const history = (await t.api.get(`/api/history?record_type=wf_request&record_id=${r.id}`)).body;
    const actions = (history.rows ?? history).map((e: Row) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['workflow.start', 'workflow.decide', 'workflow.finish']));
    expect(actions.filter((a: string) => a === 'workflow.decide')).toHaveLength(2);

    // Bob's decided list and Alice's requests.
    expect((await bob.get('/api/workflows/approvals?view=decided')).body.rows.find((x: Row) => x.record_id === r.id)).toMatchObject({ decision: 'approved', comment: 'Fine by me' });
    expect((await alice.get('/api/workflows/approvals?view=requested')).body.rows.find((x: Row) => x.record_id === r.id)).toMatchObject({ status: 'approved' });

    if (t.ctx.app.hasDecorator('notify')) {
      const notes = (await alice.get('/api/notifications?pageSize=50')).body.rows as Row[];
      expect(notes.some((n) => /^Approved:/.test(n.title))).toBe(true);
      const bobs = (await bob.get('/api/notifications?pageSize=50')).body.rows as Row[];
      expect(bobs.some((n) => /^Approval needed/.test(n.title) && n.kind === 'approval')).toBe(true);
    }
  });

  it('goes to the owner for a large amount, and a rejection needs a reason and ends it', async () => {
    const r = await make(alice, { priority: 'high', cost: 5000, owner_id: dan.userId });
    let step = (await onRecord(alice, r.id)).instances[0].steps[0];
    await decide(bob, step.id, 'approved');
    await decide(cara, step.id, 'approved');
    const view = await onRecord(dan, r.id);
    step = view.instances[0].steps[1];
    expect(step.status).toBe('pending');
    expect(step.can_decide).toBe(true);
    const noReason = await decide(dan, step.id, 'rejected');
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.fields.comment).toBeTruthy();
    expect((await decide(dan, step.id, 'rejected', 'Over budget this quarter')).body.stepOutcome).toBe('rejected');
    expect((await record(r.id)).status).toBe('rejected');
    expect((await onRecord(alice, r.id)).instances[0]).toMatchObject({ status: 'rejected', outcome_note: 'Over budget this quarter' });
  });
});

describe('a workflow started by a status change, or by hand', () => {
  let wf: Row;
  beforeAll(async () => {
    await clearDefinitions();
    wf = await define({
      name: 'Submitted requests', trigger: 'status', trigger_field: 'status', trigger_value: 'submitted',
      steps: [{ name: 'Any buyer', approvers: { kind: 'users', users: [bob.userId, cara.userId] } }],
      on_approve: [{ field: 'status', value: 'approved' }],
    });
  });

  it('starts when the status becomes the chosen value, and its own outcome starts nothing new', async () => {
    const r = await make(alice, { priority: 'low' });
    expect((await onRecord(alice, r.id)).instances).toHaveLength(0);
    expect((await alice.patch(`/api/test-wf-requests/${r.id}`, { status: 'submitted' })).status).toBe(200);
    const view = await onRecord(alice, r.id);
    expect(view.instances).toHaveLength(1);
    expect(view.instances[0].requested_by).toBe(alice.userId);
    await decide(cara, view.instances[0].steps[0].id, 'approved'); // any one is enough
    expect((await record(r.id)).status).toBe('approved');
    expect((await onRecord(alice, r.id)).instances).toHaveLength(1);
  });

  it('can be started by hand once at a time by someone who may edit, and canceled by the requester', async () => {
    const r = await make(t.api, { priority: 'low' });
    const offered = await onRecord(alice, r.id);
    expect(offered.startable.map((w: Row) => w.id)).toContain(wf.id);
    const started = await alice.post(`/api/workflows/records/wf_request/${r.id}/start`, { workflow_id: wf.id, note: 'Please look today' });
    expect(started.status).toBe(201);
    expect((await alice.post(`/api/workflows/records/wf_request/${r.id}/start`, { workflow_id: wf.id })).status).toBe(409);
    expect((await bob.post(`/api/workflows/instances/${started.body.instance_id}/cancel`, {})).status).toBe(403);
    const canceled = await alice.post(`/api/workflows/instances/${started.body.instance_id}/cancel`, { reason: 'Raised by mistake' });
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('canceled');
    expect((await waitingFor(bob)).map((x) => x.record_id)).not.toContain(r.id);
  });
});

describe('restricted records and switched-off areas', () => {
  let wf: Row;
  beforeAll(async () => {
    await clearDefinitions();
    wf = await define({ name: 'Restricted check', trigger: 'manual', steps: [{ name: 'Review', approvers: { kind: 'users', users: [bob.userId, sec.userId] } }] });
  });

  it('routes a restricted record only to people who may see it', async () => {
    const r = await make(t.api, { priority: 'low', restricted: true });
    const started = await t.api.post(`/api/workflows/records/wf_request/${r.id}/start`, { workflow_id: wf.id });
    expect(started.status).toBe(201);
    const step = (await onRecord(t.api, r.id)).instances[0].steps[0];
    expect(step.approvers.map((a: Row) => a.id)).toEqual([sec.userId]);
    expect((await waitingFor(bob)).map((x) => x.record_id)).not.toContain(r.id);
    expect((await bob.get(`/api/workflows/records/wf_request/${r.id}`)).status).toBe(404);
    expect((await decide(bob, step.id, 'approved')).status).toBe(404);
    expect((await waitingFor(sec)).map((x) => x.record_id)).toContain(r.id);
  });

  it('hides the workflows of a switched-off area and brings them back', async () => {
    const r = await make(t.api, { priority: 'low' });
    await t.api.post(`/api/workflows/records/wf_request/${r.id}/start`, { workflow_id: wf.id });
    expect((await waitingFor(bob)).map((x) => x.record_id)).toContain(r.id);
    await t.ctx.settings.set('features', { tickets: false });
    try {
      expect((await waitingFor(bob)).map((x) => x.record_id)).not.toContain(r.id);
      expect((await t.api.get(`/api/workflows/records/wf_request/${r.id}`)).status).toBe(404);
      // Hidden with its area (E14-34): not listed, and not found by id.
      expect((await t.api.get('/api/workflows/definitions')).body.rows.some((d: Row) => d.id === wf.id)).toBe(false);
      expect((await t.api.get(`/api/workflows/definitions/${wf.id}`)).status).toBe(404);
    } finally {
      await t.ctx.settings.set('features', { tickets: true });
    }
    expect((await waitingFor(bob)).map((x) => x.record_id)).toContain(r.id);
  });
});

describe('escalation, department heads and webhooks', () => {
  it('escalates an overdue step to the people named, who may then decide', async () => {
    await clearDefinitions();
    const wf = await define({
      name: 'Escalating', trigger: 'manual',
      steps: [{ name: 'Quick look', approvers: { kind: 'users', users: [bob.userId] }, due_hours: 4, escalate_to: { users: [dan.userId] } }],
    });
    const r = await make(t.api, { priority: 'low' });
    await alice.post(`/api/workflows/records/wf_request/${r.id}/start`, { workflow_id: wf.id });
    const step = (await onRecord(alice, r.id)).instances[0].steps[0];
    expect(new Date(step.due_at).getTime()).toBeGreaterThan(Date.now() + 3.9 * 3_600_000);
    expect((await decide(dan, step.id, 'approved')).status).toBe(403);
    expect((await t.ctx.app.workflows!.escalateDue()).escalated).toBe(0); // not yet due

    await t.db.query(`update workflow_steps set due_at = now() - interval '1 minute' where id = $1`, [step.id]);
    expect((await t.ctx.app.workflows!.escalateDue()).escalated).toBe(1);
    expect((await t.ctx.app.workflows!.escalateDue()).escalated).toBe(0); // once
    const after = (await onRecord(alice, r.id)).instances[0].steps[0];
    expect(after.escalated_at).toBeTruthy();
    expect(after.approvers.map((a: Row) => a.id)).toEqual([bob.userId, dan.userId]);
    expect((await waitingFor(dan)).find((x) => x.record_id === r.id)).toMatchObject({ escalated: true, overdue: true });
    expect((await decide(dan, step.id, 'approved')).body.stepOutcome).toBe('approved');
    if (t.ctx.app.hasDecorator('notify')) {
      const notes = (await dan.get('/api/notifications?pageSize=50')).body.rows as Row[];
      expect(notes.some((n) => /^Approval escalated to you/.test(n.title))).toBe(true);
    }
  });

  it('sends a department-head step to the head of the requester\'s department', async () => {
    await clearDefinitions();
    const dept = await t.db.one<Row>(`insert into departments (name) values ('Rail Operations Test') returning id`);
    await t.db.query('update users set department_id = $1 where id = $2', [dept!.id, alice.userId]);
    expect((await t.api.put(`/api/workflows/department-heads/${dept!.id}`, { user_id: cara.userId })).status).toBe(200);
    const options = (await t.api.get('/api/workflows/options')).body;
    expect(options.departments.find((d: Row) => d.id === dept!.id)).toMatchObject({ head_id: cara.userId });
    const wf = await define({ name: 'Head of department', trigger: 'manual', steps: [{ name: 'Head', approvers: { kind: 'department_head', from: 'requester' } }] });
    const r = await make(alice, { priority: 'low' });
    await alice.post(`/api/workflows/records/wf_request/${r.id}/start`, { workflow_id: wf.id });
    const step = (await onRecord(alice, r.id)).instances[0].steps[0];
    expect(step.approvers.map((a: Row) => a.id)).toEqual([cara.userId]);
  });

  it('raises a webhook event for each decision and for the end', async () => {
    await clearDefinitions();
    await t.ctx.settings.set('integrations.outbound_enabled', true);
    const hook = await t.api.post('/api/admin/webhooks', { name: 'Approvals', url: 'https://hooks.example.test/in', events: ['workflow.*'] });
    expect(hook.status, JSON.stringify(hook.body)).toBe(201);
    const wf = await define({ name: 'Hooked', trigger: 'manual', steps: [{ name: 'One', approvers: { kind: 'users', users: [bob.userId] } }] });
    const r = await make(t.api, { priority: 'low' });
    await alice.post(`/api/workflows/records/wf_request/${r.id}/start`, { workflow_id: wf.id });
    const step = (await onRecord(alice, r.id)).instances[0].steps[0];
    await decide(bob, step.id, 'approved');
    const sent = await t.db.query<Row>('select event, payload from webhook_deliveries where webhook_id = $1 order by created_at', [hook.body.id]);
    expect(sent.map((s) => s.event)).toEqual(['workflow.decided', 'workflow.finished']);
    const payload = typeof sent[0].payload === 'string' ? JSON.parse(sent[0].payload) : sent[0].payload;
    expect(payload.data).toMatchObject({ workflow: 'Hooked', decision: 'approved', stepOutcome: 'approved' });
    expect(payload.record).toMatchObject({ type: 'wf_request', id: r.id });
    // The event catalog offered to integrators names every field the payloads carry.
    for (const s of sent) {
      const body = typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload;
      const documented = Object.keys(WEBHOOK_EVENTS.find((e) => e.event === s.event)!.data);
      expect(documented, s.event as string).toEqual(expect.arrayContaining(Object.keys(body.data)));
    }
    await t.ctx.settings.set('integrations.outbound_enabled', false);
  });

  it('lists running workflows for administrators and keeps running ones on the version they started with', async () => {
    await clearDefinitions();
    const wf = await define({ name: 'Versioned', trigger: 'manual', steps: [{ name: 'First', approvers: { kind: 'users', users: [bob.userId] } }] });
    const r = await make(t.api, { priority: 'low' });
    await alice.post(`/api/workflows/records/wf_request/${r.id}/start`, { workflow_id: wf.id });
    const changed = await t.api.patch(`/api/workflows/definitions/${wf.id}`, { steps: [{ name: 'Renamed', approvers: { kind: 'users', users: [cara.userId] } }] });
    expect(changed.status).toBe(200);
    expect(changed.body.version).toBe(2);
    expect((await onRecord(alice, r.id)).instances[0].steps[0].name).toBe('First');
    const running = (await t.api.get('/api/workflows/running')).body.rows as Row[];
    expect(running.find((x) => x.record_id === r.id)).toMatchObject({ workflow: 'Versioned', step_name: 'First' });
    expect((await alice.get('/api/workflows/running')).status).toBe(403);
    expect((await t.api.del(`/api/workflows/definitions/${wf.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/workflows/definitions/${wf.id}`)).status).toBe(404);
  });
});
