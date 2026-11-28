// Governed vehicle retirement (wave 26, E46): retiring a vehicle needs an approval, as disposing of
// an asset does (inventory/disposal.ts). Someone asks for it with the reason, the disposal method and
// the expected proceeds; the "Vehicle retirement" approval workflow routes it to people who hold
// `fleet.approve`, with a second step when an outside funder keeps an interest in the vehicle. The
// approval writes the approver's name and the date onto the vehicle; then the vehicle can be marked
// retired, which records the date, method and proceeds (and the funder's approval reference when a
// funder keeps an interest). A person cannot set the Retired status any other way; system work and
// data loads (historical records) can.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind, type FinishEvent, type InstallHelpers } from '../../core/approval-kinds.ts';
import { actorOf, dataLoadFor, isDataLoad } from '../../core/dataload.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { isRetired } from './shared.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RETIREMENT_KIND = 'vehicle_retirement';

export const DEFAULT_RETIREMENT_WORKFLOW = {
  name: 'Vehicle retirement',
  description: 'Asked for with the Retire button on a vehicle. Someone who holds the approval permission for fleet approves it; '
    + 'when an outside funder keeps an interest in the vehicle, a second approval confirms the funder has agreed. '
    + 'The approval writes the approver and the date onto the vehicle, which can then be marked as retired.',
  steps: [
    { key: 'fleet-manager', name: 'Fleet manager', approvers: { kind: 'permission', permission: 'fleet.approve' }, quorum: 'any' },
    {
      key: 'funder', name: 'Funder\'s approval', approvers: { kind: 'permission', permission: 'fleet.approve' }, quorum: 'any', distinct_approvers: true,
      conditions: [{ field: 'funder_interest', op: 'set' }],
    },
  ],
};

export const RETIREMENT_METHODS = [
  { value: 'sale', label: 'Sold', sort: 10 },
  { value: 'auction', label: 'Sold at auction', sort: 20 },
  { value: 'trade_in', label: 'Traded in', sort: 30 },
  { value: 'transfer', label: 'Transferred to another organization', sort: 40 },
  { value: 'scrap', label: 'Scrapped or recycled', sort: 50 },
  { value: 'other', label: 'Other', sort: 90 },
];

/** Fields the vehicle record takes (spread into the vehicle type in index.ts). */
export const RETIREMENT_VEHICLE_FIELDS = {
  retirement_request_status: { label: 'Retirement approval', type: 'lookup' as const, list: 'disposal_request_status', readOnly: true },
  retirement_approved_by: { label: 'Retirement approved by', type: 'text' as const, readOnly: true, personal: true },
  retirement_approved_on: { label: 'Retirement approved on', type: 'date' as const, readOnly: true },
  retirement_method: { label: 'Disposal method', type: 'lookup' as const, list: 'vehicle_disposal_method', help: 'How the vehicle left the fleet: sold, auctioned, traded in, transferred, scrapped or other.' },
  retirement_proceeds: { label: 'Disposal proceeds', type: 'currency' as const, help: 'What the sale or trade-in brought in.' },
  retirement_funder_ref: { label: 'Funder approval reference', type: 'text' as const, help: 'The reference of the outside funder\'s agreement to the disposal (a letter or email reference).' },
  retired_on: { label: 'Retired on', type: 'date' as const },
};

/** Fills in and checks the retirement record when a person sets the Retired status. Called from the vehicle's hooks. */
export async function checkRetirement(ctx: ModuleContext, req: FastifyRequest | null, existing: Row | null, merged: Row, patch: Row): Promise<void> {
  const to = patch.status;
  if (to === undefined || to === existing?.status || !(await isRetired(ctx, to))) return;
  if (!patch.retired_on && !merged.retired_on) patch.retired_on = isDataLoad(req) && merged.updated_at ? String(merged.updated_at).slice(0, 10) : dayInZone();
  // System work and data loads record what happened; a person needs the approval.
  if (!req || isDataLoad(req)) return;
  if (!existing) ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: 'A new vehicle cannot start retired. Add it, then ask for its retirement.' });
  if (merged.retirement_request_status !== 'approved') {
    ctx.fail(409, 'retirement_not_approved', 'Retiring a vehicle needs an approval. Ask for it with the Retire button; once approved, mark it retired.');
  }
  const funderOn = await funderOptionOn(ctx);
  if (funderOn && merged.funder_interest === true && !String(merged.retirement_funder_ref ?? '').trim()) {
    ctx.fail(400, 'validation', 'Check the highlighted fields.', { retirement_funder_ref: 'An outside funder keeps an interest in this vehicle. Enter the reference of the funder\'s approval.' });
  }
}

async function funderOptionOn(ctx: ModuleContext): Promise<boolean> {
  const opts = await ctx.settings.get<Record<string, { on?: boolean }> | null>('feature_options', {});
  return opts?.funder_interest?.on !== false;
}

export function registerRetirement(ctx: ModuleContext) {
  const { app, db } = ctx;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 4000) : null);
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const engine = () => approvalEngine(app);
  const label = (v: Row) => `vehicle ${v.fleet_number}`;
  const SELECT = `select r.*, rq.display_name as requested_by_name, dc.display_name as decided_by_name
    from vehicle_retirement_requests r left join users rq on rq.id = r.requested_by left join users dc on dc.id = r.decided_by`;

  async function vehicleFor(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('vehicle', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Vehicle not found.');
  }
  async function notify(input: Row) {
    if (!app.hasDecorator('notify')) return 0;
    return (await app.notify(input as never)).sent;
  }

  async function workflowOf(request: Row, user: SessionUser): Promise<Row | null> {
    const e = engine();
    if (!e || request.status !== 'pending') return null;
    const p = await e.progress(RETIREMENT_KIND, request.vehicle_id, user.id);
    if (!p.instance || p.instance.status !== 'running' || p.instance.data?.request_id !== request.id) return null;
    return { name: p.instance.name, approvals: p.approvals, required: p.required, waiting_for: p.waitingFor, can_decide: p.canDecide };
  }

  async function onFinish(e: FinishEvent): Promise<void> {
    if (e.byModule) return;
    const requestId = String(e.instance.data?.request_id ?? '');
    const request = UUID.test(requestId) ? await db.one<Row>('select * from vehicle_retirement_requests where id = $1', [requestId]) : undefined;
    if (!request || request.status !== 'pending') return;
    const vehicle = await ctx.resources.find('vehicle', request.vehicle_id);
    if (!vehicle) return;
    if (e.outcome === 'canceled') {
      await db.query(`update vehicle_retirement_requests set status = 'withdrawn', decided_at = now(), decision_comment = $2 where id = $1`,
        [request.id, e.comment ?? 'The approval workflow was canceled.']);
      await ctx.resources.update('vehicle', vehicle.id, { retirement_request_status: null });
      return;
    }
    const approve = e.outcome === 'approved';
    const by = e.approverName ? `${e.approverName}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}` : 'an approver';
    await db.query(
      `update vehicle_retirement_requests set status = $2, decided_by = $3, decided_at = now(), decision_comment = $4, decided_on_behalf_of_name = $5 where id = $1`,
      [request.id, approve ? 'approved' : 'refused', e.approverId, e.comment, e.onBehalfOfName ?? null]);
    await ctx.resources.update('vehicle', vehicle.id, approve
      ? { retirement_request_status: 'approved', retirement_approved_by: by, retirement_approved_on: todayInZone() }
      : { retirement_request_status: 'refused' });
    await ctx.audit(e.req, {
      action: approve ? 'vehicle.retirement_approved' : 'vehicle.retirement_refused', recordType: 'vehicle', recordId: vehicle.id,
      summary: `Retirement of ${label(vehicle)} ${approve ? 'approved' : 'refused'} by ${by}${e.comment ? `: ${e.comment}` : ''}`,
      after: { request_id: request.id, decision: approve ? 'approved' : 'refused', comment: e.comment, workflow: e.instance.name },
    });
  }

  async function install(h: InstallHelpers): Promise<void> {
    if (!(await h.hasDefinitions())) await h.define(DEFAULT_RETIREMENT_WORKFLOW);
  }

  defineApprovalKind(app, {
    key: RETIREMENT_KIND, recordType: 'vehicle', label: 'Vehicle retirement',
    startsWhen: 'Someone asks for a vehicle to be retired (the Retire button)',
    outcome: 'Approved: the approver and the date are written on the vehicle, which can then be marked as retired; rejected: the request is refused with the reason',
    approverPermission: 'fleet.approve',
    onFinish, install,
  });

  app.get('/api/vehicles/:id/retirement-requests', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    const vehicle = await vehicleFor(req);
    const rows = await db.query<Row>(`${SELECT} where r.vehicle_id = $1 order by r.requested_at desc`, [vehicle.id]);
    const today = dayInZone();
    const end = vehicle.useful_life_end ? String(vehicle.useful_life_end).slice(0, 10) : null;
    return {
      requests: await Promise.all(rows.map(async (r) => ({ ...r, own: r.requested_by === req.user!.id, workflow: await workflowOf(r, req.user!) }))),
      useful_life_end: end, useful_life_remaining: Boolean(end && end > today),
      can_request: ctx.can(req.user, 'fleet.edit'), can_decide: ctx.can(req.user, 'fleet.approve'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vehicles/:id/retirement-requests', tag: 'Fleet', permission: 'fleet.view',
    summary: 'A vehicle\'s retirement requests, newest first, with where each approval workflow stands and whether useful life remains',
    response: '{ requests: [{ id, status, reason, method, expected_proceeds, funder_ref, requested_by_name, requested_at, decided_by_name, decided_at, decision_comment, own, workflow }], useful_life_end, useful_life_remaining, can_request, can_decide }',
  });

  app.post('/api/vehicles/:id/retirement-requests', { preHandler: ctx.requirePerm('fleet.edit') }, async (req, reply) => {
    const vehicle = await vehicleFor(req);
    const body = (req.body ?? {}) as Row;
    if (await isRetired(ctx, vehicle.status)) ctx.fail(409, 'already_retired', 'This vehicle is already retired.');
    if (await db.one(`select 1 from vehicle_retirement_requests where vehicle_id = $1 and status = 'pending'`, [vehicle.id])) {
      ctx.fail(409, 'already_requested', 'A retirement request for this vehicle is already awaiting approval.');
    }
    const reason = text(body.reason) ?? invalid({ reason: 'Say why the vehicle should be retired.' });
    const method = text(body.method);
    if (method && !(await ctx.lookups.values('vehicle_disposal_method')).some((m) => m.value === method)) invalid({ method: 'Choose a disposal method from the list.' });
    const proceeds = body.expected_proceeds === undefined || body.expected_proceeds === null || body.expected_proceeds === '' ? null : Number(body.expected_proceeds);
    if (proceeds !== null && (!Number.isFinite(proceeds) || proceeds < 0)) invalid({ expected_proceeds: 'Enter zero or more.' });
    const requester = actorOf(req).id ?? invalid({ on_behalf_of: 'A retirement request is asked for by a person with an account (disabled accounts too).' });
    const load = await dataLoadFor(db, req);
    const at = load && typeof body.requested_at === 'string' && !Number.isNaN(Date.parse(body.requested_at)) ? new Date(body.requested_at).toISOString() : null;
    const row = (await db.one<Row>(
      `insert into vehicle_retirement_requests (vehicle_id, reason, method, expected_proceeds, funder_ref, requested_by, requested_at)
       values ($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz, now())) returning *`,
      [vehicle.id, reason, method, proceeds, text(body.funder_ref), requester, at]))!;
    const patch: Row = { retirement_request_status: 'pending' };
    if (method) patch.retirement_method = method;
    if (row.funder_ref) patch.retirement_funder_ref = row.funder_ref;
    const updated = await ctx.resources.update('vehicle', vehicle.id, patch);
    await ctx.audit(req, {
      action: 'vehicle.retirement_requested', recordType: 'vehicle', recordId: vehicle.id,
      summary: `Retirement of ${label(vehicle)} requested; awaiting approval`, after: { request_id: row.id, reason, method, expected_proceeds: proceeds },
    });
    const started = await engine()?.start(RETIREMENT_KIND, updated, { requester: req.user!.id, req, note: reason, data: { request_id: row.id } }) ?? null;
    reply.code(201);
    if (started) return { ...row, workflow: started.name };
    await notify({
      permission: 'fleet.approve', kind: 'approval', recordType: 'vehicle', recordId: vehicle.id,
      title: `Retirement of ${label(vehicle)} is waiting for your decision`, body: reason, route: `/vehicles/${vehicle.id}?tab=retirement`,
    });
    return { ...row, workflow: null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vehicles/:id/retirement-requests', tag: 'Fleet', permission: 'fleet.edit',
    summary: 'Ask for a vehicle to be retired; the "Vehicle retirement" approval workflow routes the request',
    description: '409 `already_retired` or `already_requested`. In data load mode `requested_at` may give the time and `on_behalf_of` the person.',
    body: '{ reason, method?, expected_proceeds?, funder_ref? }', response: 'the request, with `workflow` (the workflow\'s name, or null when none is active)',
  });

  async function pendingFor(req: FastifyRequest, vehicle: Row): Promise<Row> {
    const rid = (req.params as { rid: string }).rid;
    const row = UUID.test(rid) ? await db.one<Row>('select * from vehicle_retirement_requests where id = $1 and vehicle_id = $2', [rid, vehicle.id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Retirement request not found.');
    if (row.status !== 'pending') ctx.fail(409, 'already_decided', 'This request has already been decided or withdrawn.');
    return row;
  }

  app.post('/api/vehicles/:id/retirement-requests/:rid/decision', { preHandler: ctx.requirePerm('fleet.approve') }, async (req) => {
    const vehicle = await vehicleFor(req);
    const request = await pendingFor(req, vehicle);
    const body = (req.body ?? {}) as Row;
    const approve = body.decision === 'approve';
    if (!approve && body.decision !== 'refuse') invalid({ decision: 'Choose approve or refuse.' });
    if (request.requested_by === actorOf(req).id) ctx.fail(403, 'self_approval', 'You asked for this retirement, so someone else must decide it.');
    const comment = text(body.comment);
    if (!approve && !comment) invalid({ comment: 'Say why the retirement is refused.' });
    const running = await engine()?.running(RETIREMENT_KIND, vehicle.id);
    if (running && running.data?.request_id === request.id) {
      await engine()!.decide(RETIREMENT_KIND, vehicle.id, req, approve ? 'approved' : 'rejected', comment);
      return (await db.one<Row>(`${SELECT} where r.id = $1`, [request.id]))!;
    }
    // No workflow: one decision settles it.
    await db.query(
      `update vehicle_retirement_requests set status = $2, decided_by = $3, decided_at = now(), decision_comment = $4 where id = $1`,
      [request.id, approve ? 'approved' : 'refused', actorOf(req).id, comment]);
    await ctx.resources.update('vehicle', vehicle.id, approve
      ? { retirement_request_status: 'approved', retirement_approved_by: actorOf(req).name, retirement_approved_on: todayInZone() }
      : { retirement_request_status: 'refused' });
    await ctx.audit(req, {
      action: approve ? 'vehicle.retirement_approved' : 'vehicle.retirement_refused', recordType: 'vehicle', recordId: vehicle.id,
      summary: `Retirement of ${label(vehicle)} ${approve ? 'approved' : 'refused'} by ${actorOf(req).name}${comment ? `: ${comment}` : ''}`,
      after: { request_id: request.id, decision: approve ? 'approved' : 'refused', comment },
    });
    await notify({
      userIds: [request.requested_by], kind: 'approval', recordType: 'vehicle', recordId: vehicle.id,
      title: `Retirement of ${label(vehicle)} was ${approve ? 'approved' : 'refused'}`, body: comment, route: `/vehicles/${vehicle.id}?tab=retirement`,
    });
    return (await db.one<Row>(`${SELECT} where r.id = $1`, [request.id]))!;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vehicles/:id/retirement-requests/:rid/decision', tag: 'Fleet', permission: 'fleet.approve',
    summary: 'Approve or refuse a vehicle retirement request (on a workflow: the reader\'s decision on its current step); the requester cannot decide',
    body: '{ decision: "approve" | "refuse", comment? (needed to refuse) }', response: 'the request',
  });

  app.post('/api/vehicles/:id/retirement-requests/:rid/withdraw', { preHandler: ctx.requirePerm('fleet.edit') }, async (req) => {
    const vehicle = await vehicleFor(req);
    const request = await pendingFor(req, vehicle);
    await db.query(`update vehicle_retirement_requests set status = 'withdrawn', decided_by = $2, decided_at = now() where id = $1`, [request.id, actorOf(req).id]);
    await engine()?.cancel(RETIREMENT_KIND, vehicle.id, 'The retirement request was withdrawn.', req);
    await ctx.resources.update('vehicle', vehicle.id, { retirement_request_status: null });
    await ctx.audit(req, {
      action: 'vehicle.retirement_withdrawn', recordType: 'vehicle', recordId: vehicle.id,
      summary: `Retirement request for ${label(vehicle)} withdrawn`, before: { request_id: request.id },
    });
    return (await db.one<Row>(`${SELECT} where r.id = $1`, [request.id]))!;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vehicles/:id/retirement-requests/:rid/withdraw', tag: 'Fleet', permission: 'fleet.edit',
    summary: 'Withdraw a vehicle retirement request that is still waiting', response: 'the request',
  });
}
