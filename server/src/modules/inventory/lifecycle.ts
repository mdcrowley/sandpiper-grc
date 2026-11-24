import type { FastifyRequest } from 'fastify';
import { approvalEngine } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { featureState, optionOn } from '../../core/features.ts';
import { dayInZone } from '../../core/timezone.ts';
import { wipeProblems } from './fields-wiping.ts';

const ROUTED_ONLY = 'inventory.disposal_routed_only'; // same key as disposal.ts (which imports nothing from here)

/** Asset lifecycle: assignment history, check-out, check-in and the disposal gate. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in the organization's time zone. */
export function today(): string {
  return dayInZone();
}

export interface Problem { status: number; code: string; message: string; fields?: Record<string, string> }

/**
 * Why an asset may not be marked disposed, or null when it may. Disposal always needs a
 * recorded approval (who and when). Equipment in which an outside funder (such as a grant body) keeps an interest also needs the
 * reference of the approval to dispose of it, and is blocked until that is entered; that rule
 * applies only while the "outside funder interest" option is on (`funderRule`, E18-28).
 */
export function disposalProblem(asset: Row, routedOnly = false, funderRule = true): Problem | null {
  const fields: Record<string, string> = {};
  // With routed approval switched on, a typed-in name is not enough: an approver must have decided a request.
  if (routedOnly && asset.disposal_request_status !== 'approved') {
    return {
      status: 409, code: 'approval_required',
      message: 'A disposal needs an approval decided in the application. Request approval, then dispose of the asset once it is approved.',
    };
  }
  if (!String(asset.disposal_approved_by ?? '').trim()) fields.disposal_approved_by = 'Enter the name of the person who approved the disposal.';
  if (!asset.disposal_approved_on) fields.disposal_approved_on = 'Enter the date the disposal was approved.';
  if (funderRule && asset.funder_interest && !String(asset.disposal_approval_ref ?? '').trim()) {
    return {
      status: 409, code: 'funder_interest_block',
      message: 'An outside funder keeps an interest in this asset. It cannot be disposed of until the disposal approval reference is entered.',
      fields: { ...fields, disposal_approval_ref: 'Enter the reference of the funder\'s approval to dispose of this equipment.' },
    };
  }
  // E41-17: an asset that holds data needs its wiping recorded (method, date, who, certificate).
  const wipe = wipeProblems(asset);
  if (Object.keys(wipe).length && !Object.keys(fields).length) {
    return {
      status: 400, code: 'data_wipe_required', fields: wipe,
      message: 'This asset holds data: record how its data was wiped, when, by whom and the certificate reference before it is disposed of.',
    };
  }
  Object.assign(fields, wipe);
  if (Object.keys(fields).length) {
    return { status: 400, code: 'disposal_approval_required', message: 'A disposal needs a recorded approval: who approved it and when.', fields };
  }
  return null;
}

/** Whether the funder-interest option is on (Administration > Features; E18-28). */
export async function funderRuleOn(ctx: Pick<ModuleContext, 'db'>): Promise<boolean> {
  return optionOn(await featureState(ctx.db), 'funder_interest');
}

export function registerLifecycle(ctx: ModuleContext) {
  const { app, db } = ctx;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  async function assetFor(req: FastifyRequest): Promise<Row> {
    const id = (req.params as { id: string }).id;
    return (await ctx.resources.find('asset', id, req.user)) ?? ctx.fail(404, 'not_found', 'Asset not found.');
  }

  const openAssignment = (assetId: string) =>
    db.one<Row>('select * from asset_assignments where asset_id = $1 and checked_in_at is null order by checked_out_at desc limit 1', [assetId]);

  app.get('/api/assets/:id/assignments', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const asset = await assetFor(req);
    const showSites = ctx.can(req.user, 'sites.view');
    const rows = await db.query<Row>(
      `select a.*, u.display_name as user_name, o.display_name as checked_out_by_name,
              i.display_name as checked_in_by_name, s.name as site_name
       from asset_assignments a
       left join users u on u.id = a.user_id
       left join users o on o.id = a.checked_out_by
       left join users i on i.id = a.checked_in_by
       left join sites s on s.id = a.site_id and s.deleted_at is null
       where a.asset_id = $1 order by a.checked_out_at desc`,
      [asset.id],
    );
    return rows.map((r) => ({
      ...r,
      site_name: showSites ? r.site_name : null,
      assignee: r.user_name ?? r.assignee_name ?? 'Unknown',
      open: r.checked_in_at === null,
    }));
  });

  app.post('/api/assets/:id/check-out', { preHandler: ctx.requirePerm('assets.edit') }, async (req, reply) => {
    const asset = await assetFor(req);
    const body = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const userId = text(body.user_id);
    const name = text(body.assignee_name);
    if (!userId && !name) fields.assignee_name = 'Choose a user or enter the name of the person receiving the asset.';
    if (userId && !UUID.test(userId)) fields.user_id = 'User is not a valid reference.';
    const due = text(body.due_back_on);
    if (due && !ISO_DATE.test(due)) fields.due_back_on = 'Due back must be a date (YYYY-MM-DD).';
    const siteId = text(body.site_id);
    if (siteId && !UUID.test(siteId)) fields.site_id = 'Site is not a valid reference.';
    // The site must exist (and is only accepted from someone who may see sites).
    if (siteId && !fields.site_id && !(ctx.can(req.user, 'sites.view') && await ctx.resources.find('site', siteId, req.user))) {
      fields.site_id = 'That site does not exist.';
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

    if (asset.status === 'disposed' || asset.status === 'retired') {
      ctx.fail(409, 'not_available', 'A retired or disposed asset cannot be checked out.');
    }
    if (await openAssignment(asset.id)) {
      ctx.fail(409, 'already_checked_out', 'This asset is already checked out. Check it in first.');
    }
    let userName: string | null = null;
    if (userId) {
      const u = await db.one<{ display_name: string }>('select display_name from users where id = $1 and deleted_at is null', [userId]);
      if (!u) ctx.fail(400, 'validation', 'Check the highlighted fields.', { user_id: 'That user does not exist.' });
      userName = u.display_name;
    }

    const patch: Row = { user_id: userId, assigned_to_name: userId ? null : name, status: 'in_use' };
    // The department: an id, or a name as before E41-01 (the asset's `prepare` hook resolves it).
    const department = text(body.department_id) ?? text(body.department);
    if (department) patch.department_id = department;
    if (siteId) patch.site_id = siteId;
    if (text(body.location)) patch.location = text(body.location);
    const updated = await ctx.resources.update('asset', asset.id, patch, req);

    const row = await db.one<Row>(
      `insert into asset_assignments (asset_id, user_id, assignee_name, department, site_id, location, due_back_on, notes, checked_out_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [asset.id, userId, userId ? null : name, updated.department ?? null, siteId ?? asset.site_id,
        text(body.location) ?? asset.location, due, text(body.notes), req.user!.id],
    );
    await ctx.audit(req, {
      action: 'asset.check_out', recordType: 'asset', recordId: asset.id,
      summary: `Asset ${asset.tag ?? asset.name} checked out to ${userName ?? name}`,
      after: { assignment_id: row!.id, user_id: userId, assignee_name: userId ? null : name, due_back_on: due },
    });
    reply.code(201);
    return row;
  });

  app.post('/api/assets/:id/check-in', { preHandler: ctx.requirePerm('assets.edit') }, async (req) => {
    const asset = await assetFor(req);
    const body = (req.body ?? {}) as Row;
    const open = (await openAssignment(asset.id)) ?? ctx.fail(409, 'not_checked_out', 'This asset is not checked out.');
    const status = text(body.status) ?? 'in_stock';
    if (status === 'disposed') ctx.fail(400, 'validation', 'Use the disposal step to dispose of an asset.', { status: 'Choose another status.' });
    // Checked before anything is written, so a bad status cannot leave the assignment closed and the asset unchanged.
    if (!(await ctx.lookups.values('asset_status')).some((v) => v.value === status)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: `Status: "${status}" is not an allowed value.` });
    }

    const row = await db.one<Row>(
      `update asset_assignments set checked_in_at = now(), checked_in_by = $2, check_in_notes = $3 where id = $1 returning *`,
      [open.id, req.user!.id, text(body.notes)],
    );
    // The resource update validates the status against the lookup list.
    await ctx.resources.update('asset', asset.id, { user_id: null, assigned_to_name: null, status }, req);
    await ctx.audit(req, {
      action: 'asset.check_in', recordType: 'asset', recordId: asset.id,
      summary: `Asset ${asset.tag ?? asset.name} checked in`,
      before: { user_id: open.user_id, assignee_name: open.assignee_name }, after: { assignment_id: open.id, status },
    });
    return row;
  });

  /** The disposal step: records the approval and marks the asset disposed, or explains why it cannot. */
  app.post('/api/assets/:id/dispose', { preHandler: ctx.requirePerm('assets.edit') }, async (req) => {
    const asset = await assetFor(req);
    const body = (req.body ?? {}) as Row;
    if (asset.status === 'disposed') ctx.fail(409, 'already_disposed', 'This asset is already disposed.');
    const patch: Row = { status: 'disposed' };
    for (const f of ['disposal_approved_by', 'disposal_approved_on', 'disposal_approval_ref', 'disposal_method', 'disposed_on',
      'data_bearing', 'data_wipe_method', 'data_wiped_on', 'data_wiped_by', 'data_wipe_certificate']) {
      if (body[f] !== undefined) patch[f] = body[f];
    }
    // An approval decided in the application stands as recorded: the name and date cannot be retyped.
    if (asset.disposal_request_status === 'approved') {
      delete patch.disposal_approved_by;
      delete patch.disposal_approved_on;
    }
    const routedOnly = (await ctx.settings.get<boolean>(ROUTED_ONLY, false)) === true;
    const funderRule = await funderRuleOn(ctx);
    const problem = disposalProblem({ ...asset, ...patch }, routedOnly, funderRule);
    if (problem) {
      const why = problem.code === 'funder_interest_block' ? 'funder interest, no approval reference'
        : problem.code === 'approval_required' ? 'no approval decided in the application'
        : problem.code === 'data_wipe_required' ? 'holds data, no wiping recorded' : 'no recorded approval';
      await ctx.audit(req, {
        action: 'asset.dispose_blocked', recordType: 'asset', recordId: asset.id,
        summary: `Disposal of ${asset.tag ?? asset.name} blocked: ${why}`,
      });
      ctx.fail(problem.status, problem.code, problem.message, problem.fields);
    }
    const open = await openAssignment(asset.id);
    if (open) {
      await db.query(
        `update asset_assignments set checked_in_at = now(), checked_in_by = $2, check_in_notes = 'Checked in on disposal' where id = $1`,
        [open.id, req.user!.id],
      );
      patch.user_id = null;
      patch.assigned_to_name = null;
    }
    let row = await ctx.resources.update('asset', asset.id, patch, req);
    // A request still waiting when the asset goes by a typed-in approval is closed with it.
    const waiting = await db.query(
      `update asset_disposal_requests set status = 'withdrawn', decided_at = now(), decision_comment = 'Asset disposed before a decision'
       where asset_id = $1 and status = 'pending' returning id`, [asset.id],
    );
    if (waiting.length) {
      await approvalEngine(ctx.app)?.cancel('asset_disposal', asset.id, 'The asset was disposed of before a decision.', req);
      row = await ctx.resources.update('asset', asset.id, { disposal_request_status: null });
    }
    await ctx.audit(req, {
      action: 'asset.dispose', recordType: 'asset', recordId: asset.id,
      summary: `Asset ${asset.tag ?? asset.name} disposed; approved by ${row.disposal_approved_by} on ${row.disposal_approved_on}`
        + (funderRule && row.funder_interest ? ` (funder interest, approval reference ${row.disposal_approval_ref})` : '')
        + (row.data_bearing ? `; data wiped on ${String(row.data_wiped_on).slice(0, 10)} by ${row.data_wiped_by} (${row.data_wipe_method}, certificate ${row.data_wipe_certificate})` : ''),
    });
    return row;
  });
}
