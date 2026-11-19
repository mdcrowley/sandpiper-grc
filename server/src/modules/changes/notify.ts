import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { TIME_ZONE } from '../../core/timezone.ts';

/**
 * Who is told what about changes, through the notification service when it is loaded:
 * approvers when a change is submitted for their decision, the owner, implementer and
 * requester when a decision is recorded, and the owner and implementer shortly before an
 * approved change is due to start. Every call names the change, so the service leaves out
 * anyone who may not see it, and nobody is told about their own action.
 */

const label = (c: Row) => [c.ref, c.title].filter(Boolean).join(' ');
const others = (ids: unknown[], actorId: string | null) =>
  [...new Set(ids.filter((v): v is string => typeof v === 'string' && v !== '' && v !== actorId))];

const fmt = (v: unknown) => {
  const d = v ? new Date(v as string) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE,
  });
};

export async function notifyApprovalRequested(ctx: ModuleContext, change: Row, approvers: SessionUser[], actorId: string | null): Promise<number> {
  if (!ctx.app.hasDecorator('notify')) return 0;
  const userIds = others(approvers.map((u) => u.id), actorId);
  if (!userIds.length) return 0;
  const n = Number(change.approvals_required);
  const when = change.planned_start ? ` Planned to start ${fmt(change.planned_start)}.` : '';
  const res = await ctx.app.notify({
    userIds, kind: 'approval', title: `Change waiting for your approval: ${label(change)}`,
    body: `It needs ${n} ${n === 1 ? 'approval' : 'approvals'}.${when}`,
    recordType: 'change', recordId: change.id, route: `/changes/${change.id}?tab=approvals`,
  });
  return res.sent;
}

export async function notifyDecision(
  ctx: ModuleContext, change: Row, d: { decision: string; by: string; actorId: string | null; received: number; required: number },
): Promise<number> {
  if (!ctx.app.hasDecorator('notify')) return 0;
  const userIds = others([change.owner_id, change.assignee_id, change.created_by], d.actorId);
  if (!userIds.length) return 0;
  const title = d.decision === 'rejected'
    ? `Change rejected: ${label(change)}`
    : d.received >= d.required ? `Change approved: ${label(change)}` : `Approval recorded on ${label(change)}`;
  const body = d.decision === 'rejected'
    ? `${d.by} rejected it. Return it to draft to rework and submit it again.`
    : `${d.by} approved it: ${d.received} of ${d.required} ${d.required === 1 ? 'approval' : 'approvals'}.`;
  return (await ctx.app.notify({ userIds, kind: 'approval', title, body, recordType: 'change', recordId: change.id })).sent;
}

export interface StartSweepResult { changes: number; notifications: number }

/**
 * Tells the owner and implementer of each approved or scheduled change that starts within
 * `hours`. The planned start told about is stored on the change, so a run repeats nothing;
 * moving the change gives a new reminder for the new window.
 */
export async function sweepStartingSoon(ctx: ModuleContext, hours = 24): Promise<StartSweepResult> {
  if (!ctx.app.hasDecorator('notify')) return { changes: 0, notifications: 0 };
  const rows = await ctx.db.query<Row>(
    `select id, ref, title, owner_id, assignee_id, planned_start, planned_end from changes
     where deleted_at is null and status in ('approved', 'scheduled') and planned_start is not null
       and planned_start > now() and planned_start <= now() + ($1 || ' hours')::interval
       and start_notified_for is distinct from planned_start
     order by planned_start`, [String(hours)],
  );
  let notifications = 0;
  for (const c of rows) {
    const userIds = others([c.owner_id, c.assignee_id], null);
    if (userIds.length) {
      notifications += (await ctx.app.notify({
        userIds, kind: 'reminder', title: `Change starting soon: ${label(c)}`,
        body: `Planned from ${fmt(c.planned_start)} to ${fmt(c.planned_end)}.`,
        recordType: 'change', recordId: c.id,
      })).sent;
    }
    await ctx.db.query('update changes set start_notified_for = planned_start where id = $1', [c.id]);
  }
  return { changes: rows.length, notifications };
}

const HOUR = 3_600_000;

/** The reminder sweep, every quarter of an hour on the job queue (Administration > Background jobs). */
export async function registerStartSweep(ctx: ModuleContext): Promise<void> {
  await scheduleWork(ctx, 'changes.starting_soon', () => sweepStartingSoon(ctx), { every: HOUR / 4, firstRunInMs: 60_000 });
}
