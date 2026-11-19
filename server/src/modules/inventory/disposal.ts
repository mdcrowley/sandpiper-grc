import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

/**
 * Routed disposal approval. An agent asks for a disposal; someone else who holds
 * `assets.approve` approves or refuses it with a comment. An approval writes the approver's
 * name and the date onto the asset, which is what the disposal step needs. The setting
 * `inventory.disposal_routed_only` makes a decided request the only way to record an approval.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROUTED_ONLY = 'inventory.disposal_routed_only';

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

export function registerDisposalRequests(ctx: ModuleContext) {
  const { app, db } = ctx;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const label = (asset: Row) => [asset.tag, asset.name].filter(Boolean).join(' ');

  async function assetFor(req: FastifyRequest): Promise<Row> {
    const id = (req.params as { id: string }).id;
    return (await ctx.resources.find('asset', id, req.user)) ?? ctx.fail(404, 'not_found', 'Asset not found.');
  }
  const SELECT = `select r.*, rq.display_name as requested_by_name, dc.display_name as decided_by_name
    from asset_disposal_requests r
    left join users rq on rq.id = r.requested_by
    left join users dc on dc.id = r.decided_by`;

  /** The queue: requests across assets, newest first. `status` narrows it (default pending). */
  app.get('/api/assets/disposal-requests', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const status = text((req.query as Record<string, string>).status) ?? 'pending';
    const rows = await db.query<Row>(
      `${SELECT.replace('select r.*,', 'select r.*, a.tag as asset_tag, a.name as asset_name, a.funder_interest, a.status as asset_status,')}
       join assets a on a.id = r.asset_id and a.deleted_at is null and ${ctx.resources.visibleWhere('asset', req.user, 'a')}
       where ($1 = 'all' or r.status = $1) order by r.requested_at desc limit 200`,
      [status],
    );
    return rows.map((r) => ({ ...r, own: r.requested_by === req.user!.id }));
  });

  app.get('/api/assets/:id/disposal-requests', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const asset = await assetFor(req);
    const rows = await db.query<Row>(`${SELECT} where r.asset_id = $1 order by r.requested_at desc`, [asset.id]);
    return rows.map((r) => ({ ...r, own: r.requested_by === req.user!.id }));
  });

  app.post('/api/assets/:id/disposal-requests', { preHandler: ctx.requirePerm('assets.edit') }, async (req, reply) => {
    const asset = await assetFor(req);
    const body = (req.body ?? {}) as Row;
    if (asset.status === 'disposed') ctx.fail(409, 'already_disposed', 'This asset is already disposed.');
    if (await db.one('select 1 from asset_disposal_requests where asset_id = $1 and status = \'pending\'', [asset.id])) {
      ctx.fail(409, 'already_requested', 'A disposal request for this asset is already awaiting approval.');
    }
    const reason = text(body.reason) ?? ctx.fail(400, 'validation', 'Check the highlighted fields.', { reason: 'Say why the asset should be disposed of.' });
    const row = (await db.one<Row>(
      `insert into asset_disposal_requests (asset_id, reason, disposal_method, approval_ref, requested_by)
       values ($1,$2,$3,$4,$5) returning *`,
      [asset.id, reason, text(body.disposal_method), text(body.disposal_approval_ref), req.user!.id],
    ))!;
    const patch: Row = { disposal_request_status: 'pending' };
    if (row.disposal_method) patch.disposal_method = row.disposal_method;
    if (row.approval_ref) patch.disposal_approval_ref = row.approval_ref;
    await ctx.resources.update('asset', asset.id, patch); // system write: the status field is read-only to people
    await ctx.audit(req, {
      action: 'asset.disposal_requested', recordType: 'asset', recordId: asset.id,
      summary: `Disposal of ${label(asset)} requested; awaiting approval`, after: { request_id: row.id, reason },
    });
    // Everyone who may decide, except the person asking (they cannot approve their own request).
    const approvers = (await usersWith(ctx, 'assets.approve')).filter((id) => id !== req.user!.id);
    const sent = await notify(ctx, {
      userIds: approvers, kind: 'approval', recordType: 'asset', recordId: asset.id,
      title: `Disposal of ${label(asset)} is waiting for your decision`,
      body: `${req.user!.displayName} asked: ${reason}`, route: `/assets/${asset.id}?tab=disposal`,
    });
    reply.code(201);
    return { ...row, approvers: approvers.length, notified: sent };
  });

  async function pendingFor(req: FastifyRequest, asset: Row): Promise<Row> {
    const rid = (req.params as { rid: string }).rid;
    const row = UUID.test(rid) ? await db.one<Row>('select * from asset_disposal_requests where id = $1 and asset_id = $2', [rid, asset.id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Disposal request not found.');
    if (row.status !== 'pending') ctx.fail(409, 'already_decided', 'This request has already been decided or withdrawn.');
    return row;
  }

  /** Body: { decision: 'approve' | 'refuse', comment }. */
  app.post('/api/assets/:id/disposal-requests/:rid/decision', { preHandler: ctx.requirePerm('assets.approve') }, async (req) => {
    const asset = await assetFor(req);
    const request = await pendingFor(req, asset);
    const body = (req.body ?? {}) as Row;
    const approve = body.decision === 'approve';
    if (!approve && body.decision !== 'refuse') ctx.fail(400, 'validation', 'Check the highlighted fields.', { decision: 'Choose approve or refuse.' });
    if (request.requested_by === req.user!.id) {
      ctx.fail(403, 'self_approval', 'You asked for this disposal, so someone else must decide it.');
    }
    const comment = text(body.comment);
    if (!approve && !comment) ctx.fail(400, 'validation', 'Check the highlighted fields.', { comment: 'Say why the disposal is refused.' });

    const row = await db.one<Row>(
      `update asset_disposal_requests set status = $2, decided_by = $3, decided_at = now(), decision_comment = $4 where id = $1 returning *`,
      [request.id, approve ? 'approved' : 'refused', req.user!.id, comment],
    );
    await ctx.resources.update('asset', asset.id, approve
      ? { disposal_request_status: 'approved', disposal_approved_by: req.user!.displayName, disposal_approved_on: todayInZone() }
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
      [request.id, req.user!.id],
    );
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
