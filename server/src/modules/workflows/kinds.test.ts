import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalEngine, defineApprovalKind, type FinishEvent } from '../../core/approval-kinds.ts';
import type { ModuleDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Wave 7: approval kinds (a module hands its own approval to the shared workflows) and approver
// stand-ins (E14-32). A stand-in record type with its own kind keeps the tests independent of the
// modules that use kinds. Invented data only.

const finished: FinishEvent[] = [];
let installs = 0;

const orders: ModuleDef = {
  key: 'testwfkinds',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_wf_orders (
      id uuid primary key default gen_random_uuid(), ref text, title text not null, status text not null default 'draft',
      cost numeric, restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'wf_order', table: 'test_wf_orders', module: 'tickets', label: 'Parts order', plural: 'Parts orders',
      path: '/api/test-wf-orders', route: '/test-wf-orders', titleField: 'title', restricted: 'flag',
      fields: {
        title: { label: 'Title', type: 'text', required: true },
        status: { label: 'Status', type: 'text' },
        cost: { label: 'Cost', type: 'currency' },
        restricted: { label: 'Restricted', type: 'boolean' },
      },
    });
    defineApprovalKind(ctx.app, {
      key: 'test_order_approval', recordType: 'wf_order', label: 'Parts order approval',
      startsWhen: 'An order is sent for approval', outcome: 'Approved: the order is approved; rejected: back to draft',
      approverPermission: 'tickets.approve',
      async install(h) {
        installs += 1;
        if (!(await h.hasDefinitions())) {
          await h.define({ name: 'Parts order approval', steps: [{ name: 'Buyer', approvers: { kind: 'permission', permission: 'tickets.approve' } }] });
          await h.define({
            name: 'Large parts order', conditions: [{ field: 'cost', op: 'gt', value: 1000 }],
            steps: [{ name: 'Two buyers', approvers: { kind: 'permission', permission: 'tickets.approve' }, quorum: 2 }],
          });
        }
        // An order that was waiting under the module's own rules (status `submitted`).
        const waiting = await h.db.query<Row>(`select * from test_wf_orders where status = 'submitted' and deleted_at is null`);
        const plain = await h.db.one<Row>(`select id from workflow_definitions where kind = 'test_order_approval' and name = 'Parts order approval'`);
        for (const o of waiting) {
          const people = (await h.usersWith('tickets.approve')).filter((u) => u !== o.created_by);
          await h.adopt({
            definitionId: plain!.id, recordId: o.id, requestedBy: o.created_by, approvers: people, required: 2,
            decisions: (o.title as string).includes('half') ? [{ userId: people[0], decision: 'approved', comment: 'Given before the move' }] : [],
          });
        }
      },
      async onFinish(e) {
        finished.push(e);
        if (e.byModule) return;
        if (e.outcome === 'approved') await ctx.resources.update('wf_order', e.instance.recordId, { status: 'approved' });
        if (e.outcome === 'rejected') await ctx.resources.update('wf_order', e.instance.recordId, { status: 'draft' });
        if ((e.instance.data as Row).fail) throw new Error('The order system refused it.');
      },
    });
    // A module's older decision route, deciding for the signed-in person (as POST /api/changes/:id/approvals does).
    ctx.app.post('/api/test-wf-orders/:id/decide-old', async (req) => approvalEngine(ctx.app)!.decide('test_order_approval', (req.params as Row).id, req, 'approved', null));
    // The module's own route: sending an order for approval starts its kind.
    ctx.app.post('/api/test-wf-orders/:id/send', async (req) => {
      const order = (await ctx.resources.find('wf_order', (req.params as Row).id, req.user))!;
      const started = await approvalEngine(ctx.app)!.start('test_order_approval', order, { requester: req.user!.id, req, data: (req.body ?? {}) as Row });
      if (!started) return { status: 'approved', instance: null };
      await ctx.resources.update('wf_order', order.id, { status: 'submitted' });
      return { status: 'submitted', instance: started };
    });
  },
};

type T = Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<T['as']>>;
let t: T;
let asker: Client;
let buyer1: Client; // the approver who goes away
let buyer2: Client;
let standin: Client; // stands in for buyer1
let outsider: Client; // sees orders but holds no tickets.approve
const engine = () => approvalEngine(t.app)!;

const make = async (client: Client | T['api'], data: Row) => (await client.post('/api/test-wf-orders', { title: 'Brake pads for depot', ...data })).body as Row;
const send = (client: Client, id: string, data: Row = {}) => client.post(`/api/test-wf-orders/${id}/send`, data);
const onRecord = async (client: Client | T['api'], id: string) => (await client.get(`/api/workflows/records/wf_order/${id}`)).body;
const decide = (client: Client | T['api'], stepId: string, decision: string, comment?: string) => client.post(`/api/workflows/steps/${stepId}/decision`, { decision, comment });
const order = async (id: string) => (await t.api.get(`/api/test-wf-orders/${id}`)).body as Row;

beforeAll(async () => {
  t = await testApp({ extraModules: [orders] });
  // `approver` holds tickets.view and tickets.approve; `project_manager` only tickets.view.
  asker = await t.as('agent');
  buyer1 = await t.as('approver');
  buyer2 = await t.as('approver');
  standin = await t.as('approver');
  outsider = await t.as('project_manager'); // sees parts orders but cannot approve them

}, 60_000);
afterAll(async () => { await t?.close(); });

/** Approvers of the order's current step, by id. */
const approversOf = async (id: string) => ((await onRecord(t.api, id)).instances[0].steps.find((s: Row) => s.status === 'pending')?.approvers ?? []).map((a: Row) => a.id);

describe('approval kinds', () => {
  it('installs the module\'s workflows once, as module-started workflows of the kind', async () => {
    expect(installs).toBe(1);
    const defs = (await t.api.get('/api/workflows/definitions?record_type=wf_order')).body.rows as Row[];
    expect(defs.map((d) => d.name).sort()).toEqual(['Large parts order', 'Parts order approval']);
    expect(defs[0]).toMatchObject({ kind: 'test_order_approval', trigger: 'module', kind_label: 'Parts order approval' });
    expect(await t.app.workflows!.installKinds()).toEqual([]); // already installed
    const options = (await t.api.get('/api/workflows/options')).body;
    expect(options.kinds.find((k: Row) => k.key === 'test_order_approval')).toMatchObject({ record_type: 'wf_order', approver_permission: 'tickets.approve' });
  });

  it('is started by its module only, choosing the workflow with the most conditions that hold', async () => {
    const small = await make(asker, { cost: 200 });
    // Not offered for a hand start on the record.
    expect((await onRecord(asker, small.id)).startable).toEqual([]);
    expect((await send(asker, small.id)).body.instance.name).toBe('Parts order approval');
    const large = await make(asker, { cost: 5000 });
    expect((await send(asker, large.id)).body.instance.name).toBe('Large parts order');
    // Only people holding the kind's permission are asked (the plain agent is not), never the asker.
    const people = await approversOf(small.id);
    expect(people).toEqual(expect.arrayContaining([buyer1.userId, buyer2.userId]));
    expect(people).not.toContain(outsider.userId);
    expect(people).not.toContain(asker.userId);
    // Starting it again while it runs is refused.
    expect((await send(asker, small.id)).status).toBe(409);
  });

  it('calls the module back on approval, and the old-route decide works through the engine', async () => {
    const o = await make(asker, { cost: 300 });
    await send(asker, o.id);
    const before = finished.length;
    const res = await buyer1.post(`/api/test-wf-orders/${o.id}/decide-old`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await order(o.id)).status).toBe('approved');
    expect(finished.slice(before)).toHaveLength(1);
    expect(finished[finished.length - 1]).toMatchObject({ outcome: 'approved', approverId: buyer1.userId, byModule: false });
    const p = await engine().progress('test_order_approval', o.id, buyer2.userId);
    expect(p).toMatchObject({ approvals: 1, required: 1, canDecide: false });
    expect(p.instance!.status).toBe('approved');
  }, 30_000);

  it('rejects with the reason, keeps a module error as the outcome error, and the module can cancel', async () => {
    const o = await make(asker, { cost: 100 });
    await send(asker, o.id);
    const step = (await onRecord(buyer2, o.id)).instances[0].steps[0];
    await decide(buyer2, step.id, 'rejected', 'Wrong part number');
    expect((await order(o.id)).status).toBe('draft');
    expect(finished[finished.length - 1]).toMatchObject({ outcome: 'rejected', comment: 'Wrong part number' });

    const bad = await make(asker, { cost: 100 });
    await send(asker, bad.id, { fail: true });
    const s2 = (await onRecord(buyer2, bad.id)).instances[0].steps[0];
    await decide(buyer2, s2.id, 'approved');
    expect((await onRecord(t.api, bad.id)).instances[0].outcome_error).toMatch(/order system refused/);

    const c = await make(asker, { cost: 100 });
    await send(asker, c.id);
    expect(await engine().cancel('test_order_approval', c.id, 'Withdrawn by the module', null)).toBe(true);
    expect(finished[finished.length - 1]).toMatchObject({ outcome: 'canceled', byModule: true, comment: 'Withdrawn by the module' });
    expect(await engine().running('test_order_approval', c.id)).toBeNull();
  }, 30_000);

  it('adopts an approval that was waiting when the module moved to workflows, with the decisions already given', async () => {
    const waiting = await make(asker, { cost: 100, title: 'Seat covers, half approved' });
    await t.db.query(`update test_wf_orders set status = 'submitted' where id = $1`, [waiting.id]);
    await t.db.query(`delete from workflow_kind_installs where kind = 'test_order_approval'`);
    expect(await t.app.workflows!.installKinds('test_order_approval')).toEqual(['test_order_approval']);
    // The definitions are not added twice.
    expect((await t.api.get('/api/workflows/definitions?record_type=wf_order')).body.rows).toHaveLength(2);
    const view = await onRecord(t.api, waiting.id);
    expect(view.instances).toHaveLength(1);
    const step = view.instances[0].steps[0];
    expect(step).toMatchObject({ status: 'pending', required: 2 });
    expect(step.decisions).toHaveLength(1);
    expect(step.decisions[0]).toMatchObject({ decision: 'approved', adopted: true });
    // The second approval finishes it, through the module's callback.
    const next = [buyer1, buyer2, standin].find((c) => c.userId !== step.decisions[0].user_id)!;
    expect((await decide(next, step.id, 'approved')).body.stepOutcome).toBe('approved');
    expect((await order(waiting.id)).status).toBe('approved');
    // Running the install again adopts nothing new.
    await t.app.workflows!.installKinds('test_order_approval');
    expect((await onRecord(t.api, waiting.id)).instances).toHaveLength(1);
  }, 30_000);

  it('offers the kind\'s workflows for a module picker, and refuses a kind on the wrong record type', async () => {
    expect((await engine().definitions('test_order_approval')).map((d) => d.name).sort()).toEqual(['Large parts order', 'Parts order approval']);
    const wrong = await t.api.post('/api/workflows/definitions', {
      record_type: 'user', kind: 'test_order_approval', name: 'Wrong', steps: [{ name: 'X', approvers: { kind: 'permission', permission: 'tickets.approve' } }],
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.kind ?? wrong.body.error.fields.record_type).toBeTruthy();
    // A kind's workflow keeps its kind when changed.
    const def = (await t.api.get('/api/workflows/definitions?record_type=wf_order')).body.rows[0];
    const changed = await t.api.patch(`/api/workflows/definitions/${def.id}`, { kind: null, description: 'Edited' });
    expect(changed.body).toMatchObject({ kind: 'test_order_approval', trigger: 'module', description: 'Edited' });
  });

  it('hides the kind with its area', async () => {
    const o = await make(asker, { cost: 100 });
    await send(asker, o.id);
    await t.ctx.settings.set('features', { tickets: false });
    try {
      expect((await t.api.get('/api/workflows/options')).body.kinds.some((k: Row) => k.key === 'test_order_approval')).toBe(false);
      expect((await t.api.get('/api/workflows/definitions')).body.rows.some((d: Row) => d.record_type === 'wf_order')).toBe(false);
      expect(((await buyer1.get('/api/workflows/approvals')).body.rows as Row[]).some((r) => r.record_id === o.id)).toBe(false);
    } finally {
      await t.ctx.settings.set('features', { tickets: true });
    }
  });
});

describe('approver stand-ins (E14-32)', () => {
  const today = () => dayInZone(0);

  it('checks a stand-in period, and only administrators name one for someone else', async () => {
    const self = await buyer1.post('/api/workflows/standins', { standin_id: buyer1.userId, ends_on: dayInZone(5) });
    expect(self.status).toBe(400);
    expect(self.body.error.fields.standin_id).toBeTruthy();
    const backwards = await buyer1.post('/api/workflows/standins', { standin_id: standin.userId, starts_on: dayInZone(5), ends_on: dayInZone(1) });
    expect(backwards.body.error.fields.ends_on).toBeTruthy();
    const other = await buyer2.post('/api/workflows/standins', { user_id: buyer1.userId, standin_id: standin.userId, ends_on: dayInZone(3) });
    expect(other.status).toBe(403);
  });

  it('sends a step to the stand-in too; either may decide; a stand-in decision is recorded on behalf of the approver', async () => {
    const set = await buyer1.post('/api/workflows/standins', { standin_id: outsider.userId, starts_on: today(), ends_on: dayInZone(7), note: 'Away at a conference' });
    // The outsider lacks the kind's permission, so is never added to this kind's steps.
    expect(set.status).toBe(201);
    const real = await buyer1.post('/api/workflows/standins', { standin_id: standin.userId, starts_on: today(), ends_on: dayInZone(7) });
    expect(real.status).toBe(201);
    expect(real.body).toMatchObject({ active: true, mine: true });
    expect((await standin.get('/api/workflows/standins')).body.rows.some((r: Row) => r.for_me && r.user_id === buyer1.userId)).toBe(true);

    // Only buyer1 and the stand-in approve here: a workflow naming one person.
    const def = (await t.api.post('/api/workflows/definitions', {
      record_type: 'wf_order', kind: 'test_order_approval', name: 'Named buyer', conditions: [{ field: 'cost', op: 'eq', value: 777 }],
      steps: [{ name: 'Named buyer', approvers: { kind: 'users', users: [buyer1.userId] } }],
    })).body;
    const o = await make(asker, { cost: 777 });
    expect((await send(asker, o.id)).body.instance.name).toBe('Named buyer');
    const step = (await onRecord(t.api, o.id)).instances[0].steps[0];
    expect(step.approvers.map((a: Row) => a.id)).toEqual([buyer1.userId]);
    expect(step.standins).toEqual([expect.objectContaining({ id: standin.userId, for: [expect.objectContaining({ id: buyer1.userId })] })]);
    expect(step.standins.some((s: Row) => s.id === outsider.userId)).toBe(false);
    expect(step.required).toBe(1);

    // The stand-in sees it waiting, marked as standing in.
    const inbox = (await standin.get('/api/workflows/approvals')).body.rows as Row[];
    expect(inbox.find((r) => r.record_id === o.id)).toMatchObject({ on_behalf_of: buyer1.userId });
    const res = await decide(standin, step.id, 'approved', 'Covering while away');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ stepOutcome: 'approved', onBehalfOf: buyer1.userId });
    expect((await order(o.id)).status).toBe('approved');
    const after = (await onRecord(t.api, o.id)).instances[0].steps[0];
    expect(after.decisions[0]).toMatchObject({ user_id: standin.userId, on_behalf_of: buyer1.userId });
    const history = (await t.api.get(`/api/history?record_type=wf_order&record_id=${o.id}`)).body;
    expect((history.rows ?? history).some((e: Row) => e.action === 'workflow.decide' && /on behalf of/.test(e.summary))).toBe(true);
    await t.api.patch(`/api/workflows/definitions/${def.id}`, { active: false });
  }, 30_000);

  it('a stand-in never approves their own request, chains are not followed, and the approver and the stand-in decide once between them', async () => {
    // standin stands in for buyer1 (from the test above); buyer2 stands in for standin: no chain.
    await standin.post('/api/workflows/standins', { standin_id: buyer2.userId, starts_on: today(), ends_on: dayInZone(2) });
    const def = (await t.api.post('/api/workflows/definitions', {
      record_type: 'wf_order', kind: 'test_order_approval', name: 'Named buyer two', conditions: [{ field: 'cost', op: 'eq', value: 778 }],
      steps: [{ name: 'Named buyer', approvers: { kind: 'users', users: [buyer1.userId] } }],
    })).body;
    // The stand-in asks: they are not added to their own request.
    const own = await make(t.api, { cost: 778 });
    await send(standin, own.id);
    let step = (await onRecord(t.api, own.id)).instances[0].steps[0];
    expect(step.standins).toEqual([]);
    expect(step.approvers.map((a: Row) => a.id)).toEqual([buyer1.userId]);

    const o = await make(asker, { cost: 778 });
    await send(asker, o.id);
    step = (await onRecord(t.api, o.id)).instances[0].steps[0];
    expect(step.standins.map((s: Row) => s.id)).toEqual([standin.userId]); // buyer2 is not added through standin
    expect((await decide(buyer2, step.id, 'approved')).status).toBe(403);
    // The approver decides in person; the stand-in then cannot add a second decision for them.
    await t.db.query(`update workflow_definitions set steps = jsonb_set(steps, '{0,quorum}', '"all"') where id = $1`, [def.id]);
    expect((await decide(buyer1, step.id, 'approved')).body.stepOutcome).toBe('approved');
    await t.api.patch(`/api/workflows/definitions/${def.id}`, { active: false });
  }, 30_000);

  it('a period saved while a step waits joins it; an ended period stops the stand-in; administrators set and end anyone\'s', async () => {
    const def = (await t.api.post('/api/workflows/definitions', {
      record_type: 'wf_order', kind: 'test_order_approval', name: 'Named buyer three', conditions: [{ field: 'cost', op: 'eq', value: 779 }],
      steps: [{ name: 'Named buyer', approvers: { kind: 'users', users: [buyer2.userId] } }],
    })).body;
    const o = await make(asker, { cost: 779 });
    await send(asker, o.id);
    let step = (await onRecord(t.api, o.id)).instances[0].steps[0];
    expect(step.standins).toEqual([]);
    // An administrator names buyer1 as buyer2's stand-in: the waiting step gets them.
    const set = await t.api.post('/api/workflows/standins', { user_id: buyer2.userId, standin_id: buyer1.userId, starts_on: today(), ends_on: dayInZone(1) });
    expect(set.status).toBe(201);
    expect(set.body.steps_added).toBeGreaterThan(0);
    step = (await onRecord(t.api, o.id)).instances[0].steps[0];
    expect(step.standins.map((s: Row) => s.id)).toEqual([buyer1.userId]);
    expect((await t.api.get('/api/workflows/standins?all=1')).body.rows.some((r: Row) => r.id === set.body.id)).toBe(true);
    expect((await buyer1.get('/api/workflows/standins?all=1')).status).toBe(403);
    // Ended: the stand-in can no longer decide.
    expect((await t.api.del(`/api/workflows/standins/${set.body.id}`)).status).toBe(200);
    expect((await decide(buyer1, step.id, 'approved')).status).toBe(409);
    expect((await buyer2.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved' })).body.stepOutcome).toBe('approved');
    await t.api.patch(`/api/workflows/definitions/${def.id}`, { active: false });
  }, 30_000);

  it('restricted records go only to stand-ins who may see them', async () => {
    const sec = await t.as('security_lead');
    const secStandin = await t.as('approver'); // cannot see restricted records
    await sec.post('/api/workflows/standins', { standin_id: secStandin.userId, starts_on: today(), ends_on: dayInZone(1) });
    const def = (await t.api.post('/api/workflows/definitions', {
      record_type: 'wf_order', name: 'Restricted order', trigger: 'manual',
      steps: [{ name: 'Security lead', approvers: { kind: 'users', users: [sec.userId] } }],
    })).body;
    const o = await make(t.api, { cost: 1, restricted: true });
    const started = await t.api.post(`/api/workflows/records/wf_order/${o.id}/start`, { workflow_id: def.id });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const step = (await onRecord(sec, o.id)).instances[0].steps[0];
    expect(step.approvers.map((a: Row) => a.id)).toEqual([sec.userId]);
    expect(step.standins).toEqual([]);
    await t.api.patch(`/api/workflows/definitions/${def.id}`, { active: false });
  }, 30_000);

  it('administrators reassign a waiting step, audited', async () => {
    const def = (await t.api.post('/api/workflows/definitions', {
      record_type: 'wf_order', name: 'Reassignable', trigger: 'manual',
      steps: [{ name: 'Buyer', approvers: { kind: 'users', users: [buyer2.userId] } }],
    })).body;
    const o = await make(asker, { cost: 2 });
    await asker.post(`/api/workflows/records/wf_order/${o.id}/start`, { workflow_id: def.id });
    const step = (await onRecord(t.api, o.id)).instances[0].steps[0];
    expect((await buyer1.post(`/api/workflows/steps/${step.id}/reassign`, { from_user_id: buyer2.userId, to_user_id: buyer1.userId })).status).toBe(403);
    expect((await t.api.post(`/api/workflows/steps/${step.id}/reassign`, { from_user_id: buyer2.userId, to_user_id: asker.userId })).status).toBe(400); // the requester
    const ok = await t.api.post(`/api/workflows/steps/${step.id}/reassign`, { from_user_id: buyer2.userId, to_user_id: buyer1.userId });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await decide(buyer2, step.id, 'approved')).status).toBe(403);
    expect((await decide(buyer1, step.id, 'approved')).body.stepOutcome).toBe('approved');
    const history = (await t.api.get(`/api/history?record_type=wf_order&record_id=${o.id}`)).body;
    expect((history.rows ?? history).some((e: Row) => e.action === 'workflow.reassign')).toBe(true);
  }, 30_000);
});
