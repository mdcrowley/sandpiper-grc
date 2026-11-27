// E45-41: "Send outcomes that need work to their owners". From the outcomes board (live statuses) or
// from an assessment snapshot (the statuses it captured), every outcome below the target status
// becomes an action for its owner, due on the date given. Outcomes with no owner are reported, not
// skipped silently; an outcome that already has an open action from this route gets no second one.
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/config.ts';
import type { Scale } from './index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SendResult {
  needsWork: number;
  created: { id: string; outcome_id: string; code: string }[];
  alreadyOpen: { outcome_id: string; code: string; action_id: string }[];
  withoutOwner: { outcome_id: string; code: string; title: string | null }[];
}

export function registerOwnerActions(ctx: ModuleContext, loadScale: (ctx: ModuleContext) => Promise<Scale>): void {
  const { db } = ctx;

  ctx.app.post('/api/frameworks/:id/send-to-owners', { preHandler: ctx.requirePerm('frameworks.edit') }, async (req) => {
    const id = String((req.params as Row).id ?? '');
    const body = (req.body ?? {}) as Row;
    const dryRun = body.dry_run === true;
    const priorityOnly = body.priority_only === true;
    const fw = UUID.test(id) ? await db.one<Row>('select id, name from frameworks where id = $1 and deleted_at is null', [id]) : undefined;
    if (!fw) ctx.fail(404, 'not_found', 'Framework not found.');
    if (!ctx.resources.get('action')) ctx.fail(409, 'unavailable', 'Actions are not available, so outcomes cannot be sent to their owners.');
    if (!dryRun && !ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'You need permission to create actions.');

    const dueOn = body.due_on == null || body.due_on === '' ? null : String(body.due_on);
    if (!dryRun) {
      const valid = dueOn !== null && DATE.test(dueOn) && !Number.isNaN(new Date(`${dueOn}T00:00:00Z`).getTime());
      if (!valid) ctx.fail(400, 'validation', 'Check the highlighted fields.', { due_on: 'Give the date the actions are due.' });
      if (dueOn! < todayInZone()) ctx.fail(400, 'validation', 'Check the highlighted fields.', { due_on: 'The due date cannot be in the past.' });
    }

    let snapshot: Row | undefined;
    if (body.snapshot_id) {
      const sid = String(body.snapshot_id);
      snapshot = UUID.test(sid)
        ? await db.one<Row>('select id, name, framework_id from assessment_snapshots where id = $1 and deleted_at is null', [sid])
        : undefined;
      if (!snapshot || snapshot.framework_id !== fw!.id) ctx.fail(404, 'not_found', 'Assessment snapshot not found for this framework.');
    }

    // The status judged is the snapshot's when one is named, otherwise today's; the owner is always today's.
    const rows = snapshot
      ? await db.query<Row>(
        `select o.id as outcome_id, o.code, o.title, o.priority, s.status, o.owner_id
         from snapshot_statuses s join framework_outcomes o on o.id = s.outcome_id and o.deleted_at is null
         where s.snapshot_id = $1 order by o.code`, [snapshot.id])
      : await db.query<Row>(
        `select id as outcome_id, code, title, priority, status, owner_id
         from framework_outcomes where framework_id = $1 and deleted_at is null order by code`, [fw!.id]);

    const scale = await loadScale(ctx);
    const targetLabel = scale.values.find((v) => v.value === scale.target.status)?.label ?? scale.target.status;
    const labelOf = (s: string) => scale.values.find((v) => v.value === s)?.label ?? s;
    const needing = rows.filter((r) => scale.weightOf(String(r.status)) < scale.target.weight && (!priorityOnly || r.priority));

    const closed = (await ctx.lookups.values('action_status')).filter((v) => v.meta?.closed).map((v) => v.value);
    const result: SendResult = { needsWork: needing.length, created: [], alreadyOpen: [], withoutOwner: [] };
    for (const r of needing) {
      if (!r.owner_id) {
        result.withoutOwner.push({ outcome_id: r.outcome_id, code: r.code, title: r.title ?? null });
        continue;
      }
      const open = await db.one<{ id: string }>(
        `select id from actions where source_type = 'framework_outcome' and source_id = $1 and deleted_at is null
         and not (status = any($2::text[])) limit 1`, [r.outcome_id, closed]);
      if (open) {
        result.alreadyOpen.push({ outcome_id: r.outcome_id, code: r.code, action_id: open.id });
        continue;
      }
      if (dryRun) {
        result.created.push({ id: '', outcome_id: r.outcome_id, code: r.code });
        continue;
      }
      const from = snapshot ? `In the assessment "${snapshot.name}"` : 'On the outcomes board';
      const action = await ctx.resources.create('action', {
        title: `Bring ${r.code} to ${targetLabel}`,
        description: `${from}, ${r.code}${r.title ? ` (${r.title})` : ''} was ${labelOf(String(r.status))}; the target is ${targetLabel}. `
          + 'Record the work done and the evidence on the outcome.',
        owner_id: r.owner_id,
        due_on: dueOn,
        priority: r.priority ? 'high' : 'medium',
        source: 'assessment',
        source_type: 'framework_outcome',
        source_id: r.outcome_id,
      }, req);
      result.created.push({ id: action.id, outcome_id: r.outcome_id, code: r.code });
    }

    if (!dryRun && result.created.length) {
      await ctx.audit(req, {
        action: 'framework.send_to_owners', recordType: snapshot ? 'assessment_snapshot' : 'framework', recordId: snapshot ? snapshot.id : fw!.id,
        summary: `${result.created.length} outcome(s) that need work sent to their owners as actions due ${dueOn}`
          + (result.withoutOwner.length ? `; ${result.withoutOwner.length} without an owner` : ''),
      });
    }
    return { ...result, dryRun, target: { status: scale.target.status, label: targetLabel } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/frameworks/:id/send-to-owners', permission: 'frameworks.edit',
    summary: 'Send outcomes below the target status to their owners as actions',
    description: 'Creates one action per outcome below the target status that has an owner and no open action from an earlier send. '
      + 'Body: due_on (YYYY-MM-DD, required unless dry_run), snapshot_id (judge the statuses that assessment captured), '
      + 'priority_only, dry_run (count only). Also needs actions.create.',
    body: { type: 'object', properties: { due_on: { type: 'string', format: 'date' }, snapshot_id: { type: 'string' }, priority_only: { type: 'boolean' }, dry_run: { type: 'boolean' } } },
  });
}
