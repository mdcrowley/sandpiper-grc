import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind, type FinishEvent, type InstallHelpers } from '../../core/approval-kinds.ts';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

/**
 * Routed disposal approval, on the shared approval workflows (E04-24). An agent asks for a
 * disposal; the "Asset disposal" approval workflow (an administrator changes its steps and
 * approvers under Administration > Approval workflows) routes it to people who hold
 * `assets.approve`, with a second step when an outside funder keeps an interest in the asset.
 * Its approval writes the approver's name and the date onto the asset, which is what the
 * disposal step needs. The request row stays as the history the screens show. The setting
 * `inventory.disposal_routed_only` makes a decided request the only way to record an approval.
 * When no disposal workflow is active, a request is decided once, by anyone with `assets.approve`
 * (how it worked before workflows).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROUTED_ONLY = 'inventory.disposal_routed_only';
export const DISPOSAL_KIND = 'asset_disposal';

/** Active users whose enabled roles grant `perm`. */
export async function usersWith(ctx: ModuleContext, perm: string): Promise<string[]> {
  const rows = await ctx.db.query<Row>(
    `select u.id, coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
     from users u
     left join user_roles ur on ur.user_id = u.id
     left join roles r on r.id = ur.role_id
     left join role_permissions rp on rp.role_id = r.id
     where u.status = 'active' and u.deleted_at is null
     group by u.id`,
  );
  return rows.filter((r) => ctx.can({ id: r.id, permissions: r.permissions } as SessionUser, perm)).map((r) => r.id as string);
}

export async function notify(ctx: ModuleContext, input: Record<string, unknown>): Promise<number> {
  const app = ctx.app as unknown as { hasDecorator(name: string): boolean; notify?: (i: unknown) => Promise<{ sent: number }> };
  if (!app.hasDecorator('notify') || !app.notify) return 0;
  return (await app.notify(input)).sent;
}

/** The ready-made workflow: the inventory manager, then the funder's approval when a funder keeps an interest. */
export const DEFAULT_DISPOSAL_WORKFLOW = {
  name: 'Asset disposal',
  description: 'Asked for with the Dispose button on an asset. Someone who holds the approval permission for assets approves it; '
    + 'when an outside funder keeps an interest in the asset, a second approval confirms the funder has agreed. '
    + 'The approval writes the approver and the date onto the asset.',
  steps: [
    { key: 'inventory-manager', name: 'Inventory manager', approvers: { kind: 'permission', permission: 'assets.approve' }, quorum: 'any' },
    {
      key: 'funder', name: 'Funder\'s approval', approvers: { kind: 'permission', permission: 'assets.approve' }, quorum: 'any',
      // A boolean field "is filled in" when it is true; while the funder-interest option is off the field is hidden and the step is skipped.
      conditions: [{ field: 'funder_interest', op: 'set' }],
    },
  ],
};

export function registerDisposalRequests(ctx: ModuleContext) {
  const { app, db } = ctx;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const label = (asset: Row) => [asset.tag, asset.name].filter(Boolean).join(' ');
  const engine = () => approvalEngine(app);

  async function assetFor(req: FastifyRequest): Promise<Row> {
    const id = (req.params as { id: string }).id;
    return (await ctx.resources.find('asset', id, req.user)) ?? ctx.fail(404, 'not_found', 'Asset not found.');
  }
  const SELECT = `select r.*, rq.display_name as requested_by_name, dc.display_name as decided_by_name
    from asset_disposal_requests r
    left join users rq on rq.id = r.requested_by
    left join users dc on dc.id = r.decided_by`;

  /** Where the workflow of a pending request stands, for the screens. Null when it is decided the old way. */
  async function workflowOf(request: Row, user: SessionUser): Promise<Row | null> {
    const e = engine();
    if (!e || request.status !== 'pending') return null;
    const p = await e.progress(DISPOSAL_KIND, request.asset_id, user.id);
    if (!p.instance || p.instance.status !== 'running' || p.instance.data?.request_id !== request.id) return null;
    return { name: p.instance.name, approvals: p.approvals, required: p.required, waiting_for: p.waitingFor, can_decide: p.canDecide };
  }
  const present = async (rows: Row[], user: SessionUser) =>
    Promise.all(rows.map(async (r) => ({ ...r, own: r.requested_by === user.id, workflow: await workflowOf(r, user) })));

  // ---------- the approval kind ----------

  /** The workflow ended: record the decision on the request and the asset, as a decision did before. */
  async function onFinish(e: FinishEvent): Promise<void> {
    if (e.byModule) return; // withdrawn or disposed: the module has already closed the request
    const requestId = String(e.instance.data?.request_id ?? '');
    const request = UUID.test(requestId) ? await db.one<Row>('select * from asset_disposal_requests where id = $1', [requestId]) : undefined;
    if (!request || request.status !== 'pending') return;
    const asset = await ctx.resources.find('asset', request.asset_id);
    if (!asset) return;
    if (e.outcome === 'canceled') {
      await db.query(`update asset_disposal_requests set status = 'withdrawn', decided_at = now(), decision_comment = $2 where id = $1`,
        [request.id, e.comment ?? 'The approval workflow was canceled.']);
      await ctx.resources.update('asset', asset.id, { disposal_request_status: null });
      await ctx.audit(e.req, {
        action: 'asset.disposal_withdrawn', recordType: 'asset', recordId: asset.id,
        summary: `Disposal request for ${label(asset)} withdrawn: its approval workflow was canceled`, before: { request_id: request.id },
      });
      return;
    }
    const approve = e.outcome === 'approved';
    const by = e.approverName ? `${e.approverName}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}` : 'an approver';
    await db.query(
      `update asset_disposal_requests set status = $2, decided_by = $3, decided_at = now(), decision_comment = $4, decided_on_behalf_of_name = $5 where id = $1`,
      [request.id, approve ? 'approved' : 'refused', e.approverId, e.comment, e.onBehalfOfName ?? null]);
    await ctx.resources.update('asset', asset.id, approve
      ? { disposal_request_status: 'approved', disposal_approved_by: by, disposal_approved_on: todayInZone() }
      : { disposal_request_status: 'refused' });
    await ctx.audit(e.req, {
      action: approve ? 'asset.disposal_approved' : 'asset.disposal_refused', recordType: 'asset', recordId: asset.id,
      summary: `Disposal of ${label(asset)} ${approve ? 'approved' : 'refused'} by ${by}${e.comment ? `: ${e.comment}` : ''}`,
      after: { request_id: request.id, decision: approve ? 'approved' : 'refused', comment: e.comment, workflow: e.instance.name },
    });
    // The workflow tells the requester the outcome itself.
  }

  /** Once: the ready-made workflow (unless one exists), and the requests that were waiting become running workflows. */
  async function install(h: InstallHelpers): Promise<void> {
    if (!(await h.hasDefinitions())) await h.define(DEFAULT_DISPOSAL_WORKFLOW);
    const wf = (await h.definitions())[0];
    if (!wf) return; // no active disposal workflow: waiting requests are decided the old way
    const holders = await h.usersWith('assets.approve');
    const waiting = await h.db.query<Row>(
      `select r.* from asset_disposal_requests r join assets a on a.id = r.asset_id and a.deleted_at is null where r.status = 'pending' order by r.requested_at`);
    for (const r of waiting) {
      await h.adopt({
        definitionId: wf.id, recordId: r.asset_id, requestedBy: r.requested_by, startedAt: r.requested_at instanceof Date ? r.requested_at.toISOString() : r.requested_at,
        note: r.reason ?? null, data: { request_id: r.id }, approvers: holders.filter((id) => id !== r.requested_by), required: 1,
      });
    }
  }

  defineApprovalKind(app, {
    key: DISPOSAL_KIND, recordType: 'asset', label: 'Asset disposal',
    startsWhen: 'Someone asks for an asset to be disposed of (the Dispose button)',
    outcome: 'Approved: the approver and the date are written on the asset, which can then be marked as disposed; rejected: the request is refused with the reason',
    approverPermission: 'assets.approve',
    onFinish, install,
  });

  // ---------- routes ----------

  /** The queue: requests across assets, newest first. `status` narrows it (default pending). */
  app.get('/api/assets/disposal-requests', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const status = text((req.query as Record<string, string>).status) ?? 'pending';
    const rows = await db.query<Row>(
      `${SELECT.replace('select r.*,', 'select r.*, a.tag as asset_tag, a.name as asset_name, a.funder_interest, a.status as asset_status,')}
       join assets a on a.id = r.asset_id and a.deleted_at is null and ${ctx.resources.visibleWhere('asset', req.user, 'a')}
       where ($1 = 'all' or r.status = $1) order by r.requested_at desc limit 200`,
      [status],
    );
    return present(rows, req.user!);
  });

  app.get('/api/assets/:id/disposal-requests', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const asset = await assetFor(req);
    const rows = await db.query<Row>(`${SELECT} where r.asset_id = $1 order by r.requested_at desc`, [asset.id]);
    return present(rows, req.user!);
  });

  app.post('/api/assets/:id/disposal-requests', { preHandler: ctx.requirePerm('assets.edit') }, async (req, reply) => {
    const asset = await assetFor(req);
    const body = (req.body ?? {}) as Row;
    if (asset.status === 'disposed') ctx.fail(409, 'already_disposed', 'This asset is already disposed.');
    if (await db.one('select 1 from asset_disposal_requests where asset_id = $1 and status = \'pending\'', [asset.id])) {
      ctx.fail(409, 'already_requested', 'A disposal request for this asset is already awaiting approval.');
    }
    const reason = text(body.reason) ?? ctx.fail(400, 'validation', 'Check the highlighted fields.', { reason: 'Say why the asset should be disposed of.' });
    // E18-94: a load records the request of the person it names (they need an account).
    const requester = actorOf(req).id
      ?? ctx.fail(400, 'validation', 'Check the highlighted fields.', { on_behalf_of: 'A disposal request is asked for by a person with an account (disabled accounts too).' });
    const row = (await db.one<Row>(
      `insert into asset_disposal_requests (asset_id, reason, disposal_method, approval_ref, requested_by)
       values ($1,$2,$3,$4,$5) returning *`,
      [asset.id, reason, text(body.disposal_method), text(body.disposal_approval_ref), requester],
    ))!;
    const patch: Row = { disposal_request_status: 'pending' };
    if (row.disposal_method) patch.disposal_method = row.disposal_method;
    if (row.approval_ref) patch.disposal_approval_ref = row.approval_ref;
    const updated = await ctx.resources.update('asset', asset.id, patch); // system write: the status field is read-only to people
    await ctx.audit(req, {
      action: 'asset.disposal_requested', recordType: 'asset', recordId: asset.id,
      summary: `Disposal of ${label(asset)} requested; awaiting approval`, after: { request_id: row.id, reason },
    });
    // The disposal workflow routes it (and tells its approvers); without one, everyone who may decide is told.
    const started = await engine()?.start(DISPOSAL_KIND, updated, { requester: req.user!.id, req, note: reason, data: { request_id: row.id } }) ?? null;
    if (started) {
      const p = await engine()!.progress(DISPOSAL_KIND, asset.id, null);
      reply.code(201);
      return { ...row, workflow: started.name, approvers: p.waitingFor.length, notified: p.waitingFor.length };
    }
    const approvers = (await usersWith(ctx, 'assets.approve')).filter((id) => id !== req.user!.id);
    const sent = await notify(ctx, {
      userIds: approvers, kind: 'approval', recordType: 'asset', recordId: asset.id,
      title: `Disposal of ${label(asset)} is waiting for your decision`,
      body: `${req.user!.displayName} asked: ${reason}`, route: `/assets/${asset.id}?tab=disposal`,
    });
    reply.code(201);
    return { ...row, workflow: null, approvers: approvers.length, notified: sent };
  });

  async function pendingFor(req: FastifyRequest, asset: Row): Promise<Row> {
    const rid = (req.params as { rid: string }).rid;
    const row = UUID.test(rid) ? await db.one<Row>('select * from asset_disposal_requests where id = $1 and asset_id = $2', [rid, asset.id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Disposal request not found.');
    if (row.status !== 'pending') ctx.fail(409, 'already_decided', 'This request has already been decided or withdrawn.');
    return row;
  }

  /** Body: { decision: 'approve' | 'refuse', comment }. On a workflow, it is the reader's decision on its current step. */
  app.post('/api/assets/:id/disposal-requests/:rid/decision', { preHandler: ctx.requirePerm('assets.approve') }, async (req) => {
    const asset = await assetFor(req);
    const request = await pendingFor(req, asset);
    const body = (req.body ?? {}) as Row;
    const approve = body.decision === 'approve';
    if (!approve && body.decision !== 'refuse') ctx.fail(400, 'validation', 'Check the highlighted fields.', { decision: 'Choose approve or refuse.' });
    if (request.requested_by === actorOf(req).id) {
      ctx.fail(403, 'self_approval', 'You asked for this disposal, so someone else must decide it.');
    }
    const comment = text(body.comment);
    if (!approve && !comment) ctx.fail(400, 'validation', 'Check the highlighted fields.', { comment: 'Say why the disposal is refused.' });

    const running = await engine()?.running(DISPOSAL_KIND, asset.id);
    if (running && running.data?.request_id === request.id) {
      await engine()!.decide(DISPOSAL_KIND, asset.id, req, approve ? 'approved' : 'rejected', comment);
      return (await db.one<Row>(`${SELECT} where r.id = $1`, [request.id]))!;
    }

    // No workflow (none was active when it was asked for): one decision settles it, as before.
    const row = await db.one<Row>(
      `update asset_disposal_requests set status = $2, decided_by = $3, decided_at = now(), decision_comment = $4 where id = $1 returning *`,
      [request.id, approve ? 'approved' : 'refused', actorOf(req).id, comment],
    );
    await ctx.resources.update('asset', asset.id, approve
      ? { disposal_request_status: 'approved', disposal_approved_by: actorOf(req).name, disposal_approved_on: todayInZone() }
      : { disposal_request_status: 'refused' });
    await ctx.audit(req, {
      action: approve ? 'asset.disposal_approved' : 'asset.disposal_refused', recordType: 'asset', recordId: asset.id,
      summary: `Disposal of ${label(asset)} ${approve ? 'approved' : 'refused'} by ${req.user!.displayName}${comment ? `: ${comment}` : ''}`,
      after: { request_id: request.id, decision: approve ? 'approved' : 'refused', comment },
    });
    await notify(ctx, {
      userIds: [request.requested_by], kind: 'approval', recordType: 'asset', recordId: asset.id,
      title: `Disposal of ${label(asset)} was ${approve ? 'approved' : 'refused'}`,
      body: comment, route: `/assets/${asset.id}?tab=disposal`,
    });
    return row;
  });

  app.post('/api/assets/:id/disposal-requests/:rid/withdraw', { preHandler: ctx.requirePerm('assets.edit') }, async (req) => {
    const asset = await assetFor(req);
    const request = await pendingFor(req, asset);
    const row = await db.one<Row>(
      `update asset_disposal_requests set status = 'withdrawn', decided_by = $2, decided_at = now() where id = $1 returning *`,
      [request.id, actorOf(req).id],
    );
    await engine()?.cancel(DISPOSAL_KIND, asset.id, 'The disposal request was withdrawn.', req);
    await ctx.resources.update('asset', asset.id, { disposal_request_status: null });
    await ctx.audit(req, {
      action: 'asset.disposal_withdrawn', recordType: 'asset', recordId: asset.id,
      summary: `Disposal request for ${label(asset)} withdrawn`, before: { request_id: request.id },
    });
    return row;
  });

  // ---------- settings ----------

  app.get('/api/inventory/settings', { preHandler: ctx.requirePerm('assets.view') }, async () => ({
    disposalRoutedOnly: (await ctx.settings.get<boolean>(ROUTED_ONLY, false)) === true,
  }));

  app.patch('/api/inventory/settings', { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
    const body = (req.body ?? {}) as Row;
    if (typeof body.disposalRoutedOnly !== 'boolean') ctx.fail(400, 'validation', 'Check the highlighted fields.', { disposalRoutedOnly: 'Send true or false.' });
    const before = (await ctx.settings.get<boolean>(ROUTED_ONLY, false)) === true;
    // settings.set writes the audit event.
    if (before !== body.disposalRoutedOnly) await ctx.settings.set(ROUTED_ONLY, body.disposalRoutedOnly, req);
    return { disposalRoutedOnly: body.disposalRoutedOnly };
  });
}
