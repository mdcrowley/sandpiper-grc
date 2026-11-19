import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { loadPolicy, recalculateDueDates } from './policy.ts';

/**
 * Who is told what about findings, through the notification service when it is loaded:
 * the new owner when a finding is assigned, and the owner when a finding passes its fix-by
 * date. Every call names a finding, so the service leaves out anyone who may not see it.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-18" -> "18 Nov 2026". */
export function plainDate(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}

const hostOf = (f: Row) => String(f.host_name || f.host_ip || '').trim();
const named = (f: Row) => [f.ref, f.title].filter(Boolean).join(' ');
/** Above this many findings for one person at once, one notification with a count is sent instead. */
const ONE_BY_ONE = 3;

async function severityLabel(ctx: ModuleContext, value: unknown): Promise<string> {
  return (await ctx.lookups.values('vulnerability_severity')).find((s) => s.value === value)?.label ?? String(value ?? '');
}

async function describe(ctx: ModuleContext, f: Row): Promise<string> {
  const host = hostOf(f);
  return `${await severityLabel(ctx, f.severity)} severity${host ? ` on ${host}` : ''}.`;
}

/** Tells the new owner of one finding, unless they assigned it to themselves. */
export async function notifyAssigned(ctx: ModuleContext, f: Row, actorId: string | null): Promise<number> {
  if (!ctx.app.hasDecorator('notify') || !f.owner_id || f.owner_id === actorId) return 0;
  const due = f.due_on ? ` Fix by ${plainDate(f.due_on)}.` : '';
  const res = await ctx.app.notify({
    userIds: [f.owner_id], kind: 'assignment', title: `Vulnerability assigned to you: ${named(f)}`,
    body: `${await describe(ctx, f)}${due}`, recordType: 'vulnerability', recordId: f.id,
  });
  return res.sent;
}

/**
 * Tells the owner chosen for an import about the findings it gave them: one notification
 * each for a few, one with the count (opening the list of them) for many.
 */
export async function notifyImportAssigned(
  ctx: ModuleContext, input: { ownerId: string; actorId: string | null; findings: Row[]; source: string; batchId: string },
): Promise<number> {
  const { ownerId, actorId, findings, source, batchId } = input;
  if (!ctx.app.hasDecorator('notify') || !findings.length || ownerId === actorId) return 0;
  if (findings.length <= ONE_BY_ONE) {
    let sent = 0;
    for (const f of findings) sent += await notifyAssigned(ctx, f, actorId);
    return sent;
  }
  const res = await ctx.app.notify({
    userIds: [ownerId], kind: 'assignment',
    title: `${findings.length} vulnerabilities from ${source} were assigned to you`,
    body: 'They were added by an import. Open the list to see them.',
    // One of the findings stands for the set, so the service checks the recipient may see findings at all.
    recordType: 'vulnerability', recordId: findings[0].id,
    route: `/vulnerabilities/imports/${batchId}?f.owner_id=${ownerId}`,
  });
  return res.sent;
}

export interface SweepResult { recalculated: number; findings: number; notifications: number }

/**
 * The scheduled sweep. Recalculates fix-by dates (so a change to a system's criticality
 * reaches its findings), then tells each owner about findings that have passed their fix-by
 * date. A finding is reported once per fix-by date: the date told about is stored on the
 * finding, so running the sweep again sends nothing.
 */
export async function sweepOverdue(ctx: ModuleContext): Promise<SweepResult> {
  const recalculated = await recalculateDueDates(ctx, await loadPolicy(ctx));
  if (recalculated) {
    await ctx.audit(null, {
      action: 'vulnerability.recalculate', recordType: 'vulnerability',
      summary: `Fix-by dates recalculated for ${recalculated} open findings (daily check against the severity policy and system criticality)`,
    });
  }
  // Without the notification service nothing is marked, so owners are told once it is there.
  if (!ctx.app.hasDecorator('notify')) return { recalculated, findings: 0, notifications: 0 };

  const rows = await ctx.db.query<Row>(
    `select id, ref, title, severity, host_name, host_ip, owner_id, due_on from vulnerabilities
     where deleted_at is null and not closed and owner_id is not null and due_on is not null and due_on < current_date
       and overdue_notified_for is distinct from due_on
     order by due_on, ref`,
  );
  const byOwner = new Map<string, Row[]>();
  for (const r of rows) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r]);

  let notifications = 0;
  for (const [ownerId, mine] of byOwner) {
    if (mine.length <= ONE_BY_ONE) {
      for (const f of mine) {
        notifications += (await ctx.app.notify({
          userIds: [ownerId], kind: 'due', title: `Past its fix-by date: ${named(f)}`,
          body: `${await describe(ctx, f)} It was due on ${plainDate(f.due_on)}.`,
          recordType: 'vulnerability', recordId: f.id, oncePerDay: true,
        })).sent;
      }
    } else {
      notifications += (await ctx.app.notify({
        userIds: [ownerId], kind: 'due', title: `${mine.length} of your vulnerabilities are past their fix-by date`,
        body: `The oldest was due on ${plainDate(mine[0].due_on)}.`,
        recordType: 'vulnerability', recordId: mine[0].id, oncePerDay: true,
        route: `/vulnerabilities?f.overdue=true&f.owner_id=${ownerId}&sort=due_on&dir=asc`,
      })).sent;
    }
  }
  if (rows.length) {
    await ctx.db.query('update vulnerabilities set overdue_notified_for = due_on where id = any($1::uuid[])', [rows.map((r) => r.id)]);
  }
  return { recalculated, findings: rows.length, notifications };
}

const HOUR = 3_600_000;

/** The overdue sweep, hourly on the job queue (Administration > Background jobs). */
export async function registerSweep(ctx: ModuleContext): Promise<void> {
  await scheduleWork(ctx, 'vulnerabilities.overdue_sweep', () => sweepOverdue(ctx), { every: HOUR, firstRunInMs: 90_000 });
}
