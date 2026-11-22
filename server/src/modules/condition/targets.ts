import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

/**
 * Yearly state-of-good-repair targets (E32-04, E32-08): for one asset class and one year, the most
 * of its members that may be past their useful life, as a percentage. A target is a draft until it
 * is approved: through the approval kind `condition_targets` (an approval workflow, one step of
 * `assets.approve` holders by default), or directly by a holder of `assets.approve`, who may record
 * a meeting decision's reference as the authority. Changing a target's percentage makes it a draft
 * again and ends any approval still waiting.
 */

export const KIND = 'condition_targets';

export const DEFAULT_TARGETS_WORKFLOW = {
  name: 'Asset condition targets',
  description: "A year's state-of-good-repair target for one asset class. Someone who may approve asset records decides; add a step for the capital planning lead or a committee if your organization needs one.",
  steps: [{ key: 'asset-approver', name: 'Asset approver', approvers: { kind: 'permission', permission: 'assets.approve' }, quorum: 'any' }],
};

const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

export interface TargetRow {
  id: string; class_id: string; year: number; target_pct: number; status: string;
  approved_on: string | null; approved_by_name: string | null; decision_ref: string | null; note: string | null;
}

const SELECT = `select id, class_id, year, target_pct::float8 as target_pct, status, approved_on::text as approved_on, approved_by_name,
  decision_ref, note from condition_targets`;

/** Every class's target for one year, by class id. */
export async function targetsFor(ctx: ModuleContext, year: number): Promise<Map<string, TargetRow>> {
  const rows = await ctx.db.query<TargetRow>(`${SELECT} where year = $1`, [year]);
  return new Map(rows.map((r) => [r.class_id, r]));
}

function yearOf(ctx: ModuleContext, raw: unknown): number {
  const y = Number(raw);
  if (!Number.isInteger(y) || y < YEAR_MIN || y > YEAR_MAX) ctx.fail(400, 'validation', `Give a year from ${YEAR_MIN} to ${YEAR_MAX}.`);
  return y;
}

export function registerTargets(ctx: ModuleContext) {
  const { app, db } = ctx;

  const classOf = async (req: FastifyRequest): Promise<Row> => {
    const { id } = req.params as { id: string };
    const cls = await ctx.resources.find('asset_class', id, req.user);
    if (!cls) ctx.fail(404, 'not_found', 'Asset class not found.');
    return cls!;
  };

  app.get('/api/asset-classes/:id/targets', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const cls = await classOf(req);
    return db.query<TargetRow>(`${SELECT} where class_id = $1 order by year desc`, [cls.id]);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-classes/:id/targets', permission: 'assets.view',
    summary: "An asset class's yearly targets, newest year first",
    response: '[{ id, class_id, year, target_pct, status, approved_on, approved_by_name, decision_ref, note }]',
  });

  app.get('/api/asset-classes/:id/targets/:year', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const cls = await classOf(req);
    const year = yearOf(ctx, (req.params as Row).year);
    return (await db.one<TargetRow>(`${SELECT} where class_id = $1 and year = $2`, [cls.id, year])) ?? null;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-classes/:id/targets/:year', permission: 'assets.view',
    summary: "An asset class's target for one year (null when none is set)",
    response: '{ id, class_id, year, target_pct, status, approved_on, approved_by_name, decision_ref, note } | null',
  });

  app.put('/api/asset-classes/:id/targets/:year', { preHandler: ctx.requirePerm('assets.edit') }, async (req) => {
    const cls = await classOf(req);
    const year = yearOf(ctx, (req.params as Row).year);
    const b = (req.body ?? {}) as Row;
    const pct = Number(b.target_pct);
    if (b.target_pct === null || b.target_pct === undefined || b.target_pct === '' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { target_pct: 'Enter a percentage from 0 to 100.' });
    }
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const before = await db.one<TargetRow>(`${SELECT} where class_id = $1 and year = $2`, [cls.id, year]);
    const decision = b.decision_ref === undefined ? before?.decision_ref ?? null : text(b.decision_ref, 200);
    const note = b.note === undefined ? before?.note ?? null : text(b.note, 2000);
    // A changed percentage needs approving again; a note or reference alone does not.
    const keepApproval = before?.status === 'approved' && Number(before.target_pct) === pct;
    // A new percentage ends an approval still waiting for the old one.
    if (before && Number(before.target_pct) !== pct && before.status === 'pending_approval') {
      await approvalEngine(app)?.cancel(KIND, cls.id, 'The target was changed while it waited for approval.', req);
    }
    const keepPending = before?.status === 'pending_approval' && Number(before.target_pct) === pct;
    const row = await db.one<TargetRow>(
      `insert into condition_targets (class_id, year, target_pct, decision_ref, note, status, created_by, updated_by)
       values ($1, $2, $3, $4, $5, 'draft', $6, $6)
       on conflict (class_id, year) do update set target_pct = excluded.target_pct, decision_ref = excluded.decision_ref, note = excluded.note,
         status = case when $7::boolean or $8::boolean then condition_targets.status else 'draft' end,
         approved_on = case when $7::boolean then condition_targets.approved_on end,
         approved_by_name = case when $7::boolean then condition_targets.approved_by_name end,
         updated_at = now(), updated_by = excluded.updated_by
       returning id`, [cls.id, year, pct, decision, note, req.user!.id, keepApproval, keepPending]);
    const after = (await db.one<TargetRow>(`${SELECT} where id = $1`, [row!.id]))!;
    await ctx.audit(req, {
      action: 'asset_class.target', recordType: 'asset_class', recordId: cls.id,
      summary: `Target for ${year} set to ${pct}% past useful life${before?.status === 'approved' && !keepApproval ? ' (approval cleared)' : ''}`,
      before: before ?? undefined, after,
    });
    return after;
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/asset-classes/:id/targets/:year', permission: 'assets.edit',
    summary: "Set an asset class's target for one year (the most of its members that may be past useful life, in percent)",
    description: 'Changing the percentage of an approved target makes it a draft again.',
    body: '{ target_pct, decision_ref?, note? }', response: 'The target',
  });

  app.post('/api/asset-classes/:id/targets/:year/approve', { preHandler: ctx.requirePerm('assets.approve') }, async (req) => {
    const cls = await classOf(req);
    const year = yearOf(ctx, (req.params as Row).year);
    const b = (req.body ?? {}) as Row;
    const before = await db.one<TargetRow>(`${SELECT} where class_id = $1 and year = $2`, [cls.id, year]);
    if (!before) ctx.fail(404, 'not_found', `No target is set for ${year}.`);
    if (before!.status === 'approved') ctx.fail(409, 'already_approved', `The target for ${year} is already approved.`);
    const decision = typeof b.decision_ref === 'string' && b.decision_ref.trim() ? b.decision_ref.trim().slice(0, 200) : before!.decision_ref;
    // A decision made directly replaces a request still waiting in an approval workflow.
    if (before!.status === 'pending_approval') await approvalEngine(app)?.cancel(KIND, cls.id, `Approved directly${decision ? ` (${decision})` : ''}.`, req);
    await db.query(
      `update condition_targets set status = 'approved', approved_on = $2, approved_by_name = $3, decision_ref = $4, updated_at = now(), updated_by = $5
       where id = $1 and status <> 'approved'`, [before!.id, dayInZone(), req.user!.displayName, decision, req.user!.id]);
    const after = (await db.one<TargetRow>(`${SELECT} where id = $1`, [before!.id]))!;
    await ctx.audit(req, {
      action: 'asset_class.target_approve', recordType: 'asset_class', recordId: cls.id,
      summary: `Target for ${year} (${after.target_pct}%) approved${decision ? ` (${decision})` : ''}`, before, after,
    });
    return after;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-classes/:id/targets/:year/approve', permission: 'assets.approve',
    summary: "Approve an asset class's target for one year",
    description: 'Records who approved it and when; a meeting decision reference may be given as the authority.',
    body: '{ decision_ref? }', response: 'The target',
  });
  // ---------- approval workflow (E32-08) ----------

  defineApprovalKind(app, {
    key: KIND, recordType: 'asset_class', label: 'Asset condition targets',
    startsWhen: "Someone asks for an asset class's target for a year to be approved",
    outcome: "Approved: the year's target is recorded as approved (approver and date); rejected: it goes back to a draft, with the reason in its note",
    approverPermission: 'assets.approve',
    route: (id) => `/condition/classes/${id}?tab=targets`,
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_TARGETS_WORKFLOW);
    },
    async onFinish(e) {
      const year = Number(e.instance.data.year);
      const row = await db.one<TargetRow>(`${SELECT} where class_id = $1 and year = $2`, [e.instance.recordId, year]);
      if (!row) {
        if (e.outcome === 'canceled') return;
        throw new Error(`The target for ${year} no longer exists.`);
      }
      if (e.outcome === 'canceled') {
        if (row.status === 'pending_approval') await db.query(`update condition_targets set status = 'draft', updated_at = now() where id = $1`, [row.id]);
        return;
      }
      const who = `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'rejected') {
        await db.query(`update condition_targets set status = 'draft', note = coalesce($2, note), updated_at = now() where id = $1`, [row.id, e.comment ? `Rejected: ${e.comment}`.slice(0, 2000) : null]);
      } else {
        await db.query(
          `update condition_targets set status = 'approved', approved_by_name = $2, approved_on = $3, decision_ref = coalesce(decision_ref, $4), updated_at = now() where id = $1`,
          [row.id, who, dayInZone(), `Approval workflow "${e.instance.name}"`]);
      }
      await ctx.audit(e.req, {
        action: e.outcome === 'approved' ? 'asset_class.target_approve' : 'asset_class.target_reject',
        recordType: 'asset_class', recordId: e.instance.recordId,
        summary: `Target for ${year} ${e.outcome} by ${who}${e.comment ? `: ${e.comment}` : ''}`,
      });
    },
  });

  app.post('/api/asset-classes/:id/targets/:year/approval', { preHandler: ctx.requirePerm('assets.edit') }, async (req, reply) => {
    const cls = await classOf(req);
    const year = yearOf(ctx, (req.params as Row).year);
    const row = (await db.one<TargetRow>(`${SELECT} where class_id = $1 and year = $2`, [cls.id, year])) ?? ctx.fail(404, 'not_found', `No target is set for ${year}.`);
    if (row.status === 'approved') ctx.fail(409, 'already_approved', `The target for ${year} is already approved.`);
    const eng = approvalEngine(app) ?? ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available: approve the target directly instead.');
    if (await eng.running(KIND, cls.id)) ctx.fail(409, 'already_requested', 'A target of this class is already waiting for approval.');
    const note = String(((req.body ?? {}) as Row).note ?? '').trim().slice(0, 2000) || null;
    const started = await eng.start(KIND, cls, { requester: req.user!.id, req, note: note ?? `Target for ${year}: ${row.target_pct}%`, data: { year, target_pct: Number(row.target_pct) } });
    if (!started) ctx.fail(409, 'no_workflow', 'No active Asset condition targets workflow applies. An administrator can set one up under Administration > Approval workflows, or the target can be approved directly.');
    const live = await eng.latest(KIND, cls.id);
    // An approval that finished at once (every step skipped) has already set the outcome.
    if (live?.status === 'running') await db.query(`update condition_targets set status = 'pending_approval', updated_at = now() where id = $1 and status = 'draft'`, [row.id]);
    await ctx.audit(req, { action: 'asset_class.target_approval_requested', recordType: 'asset_class', recordId: cls.id, summary: `Approval of the target for ${year} asked for (${started!.name})` });
    reply.code(201);
    return { instance_id: started!.id, workflow: started!.name, status: live?.status ?? started!.status, target: await db.one<TargetRow>(`${SELECT} where id = $1`, [row.id]) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-classes/:id/targets/:year/approval', permission: 'assets.edit',
    summary: "Ask for a year's target to be approved: starts the Asset condition targets approval workflow",
    body: '{ note? }', response: '{ instance_id, workflow, status, target }',
  });
}
