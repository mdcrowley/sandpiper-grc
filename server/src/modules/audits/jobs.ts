// The daily inspection work (E24-05), on the job queue as `audits.inspections`:
//   1. Each active schedule whose next inspection falls within the reminder lead time gets that
//      inspection created (assigned to the schedule's inspector), and its next due date moves on by
//      the schedule's frequency. A schedule far behind catches up at most 24 inspections a run.
//   2. An inspection still not done a week after its due date is marked Missed (it can still be
//      carried out late).
//   3. Reminders through `app.notify` (only when the notifications module is loaded): the inspector
//      is told once when an inspection comes within `audits.inspection_reminder_days` (2) and once
//      when it is overdue; the person asked for evidence is told once when a request comes within
//      `audits.request_reminder_days` (3) and once when it is overdue. An inspection with no
//      inspector goes to everyone who may edit audits.
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { addDays, advance } from './dates.ts';

export const INSPECTION_REMINDER_SETTING = 'audits.inspection_reminder_days';
export const REQUEST_REMINDER_SETTING = 'audits.request_reminder_days';
export const DEFAULT_INSPECTION_REMINDER_DAYS = 2;
export const DEFAULT_REQUEST_REMINDER_DAYS = 3;
/** Days after the due date an inspection not done is marked Missed. */
export const MISSED_AFTER_DAYS = 7;
const CATCH_UP = 24;
const HOUR = 3_600_000;

export interface InspectionRun { created: number; missed: number; reminded: number; requestsReminded: number; skipped: string[] }

async function leadDays(ctx: ModuleContext, key: string, fallback: number): Promise<number> {
  const raw = Math.round(Number(await ctx.settings.get<unknown>(key, fallback)));
  return Number.isFinite(raw) ? Math.min(60, Math.max(0, raw)) : fallback;
}

export async function runInspectionWork(ctx: ModuleContext): Promise<InspectionRun> {
  const run: InspectionRun = { created: 0, missed: 0, reminded: 0, requestsReminded: 0, skipped: [] };
  const { db } = ctx;
  const today = dayInZone();
  const lead = await leadDays(ctx, INSPECTION_REMINDER_SETTING, DEFAULT_INSPECTION_REMINDER_DAYS);
  const frequencies = await ctx.lookups.values('inspection_frequency');

  // 1. Inspections due from the schedules.
  const schedules = await db.query<Row>(
    `select s.* from inspection_schedules s join checklist_templates t on t.id = s.template_id and t.deleted_at is null and t.active
     where s.deleted_at is null and s.active and s.next_due_on is not null and s.next_due_on <= $1::date
     order by s.next_due_on limit 2000`, [addDays(today, lead)]);
  for (const s of schedules) {
    const meta = frequencies.find((f) => f.value === s.frequency)?.meta;
    let next = String(s.next_due_on);
    try {
      for (let i = 0; i < CATCH_UP && next <= addDays(today, lead); i++) {
        const there = await db.one('select 1 from inspections where schedule_id = $1 and due_on = $2 and deleted_at is null', [s.id, next]);
        if (!there) {
          await ctx.resources.create('inspection', {
            template_id: s.template_id, schedule_id: s.id, target_type: s.target_type, target_id: s.target_id,
            inspector_id: s.assignee_id, due_on: next, status: 'scheduled',
          });
          run.created += 1;
        }
        next = advance(next, meta);
      }
      await ctx.resources.update('inspection_schedule', s.id, { next_due_on: next }, null);
    } catch (err) {
      // A schedule whose record or checklist is gone is left for someone to fix; the others carry on.
      run.skipped.push(`${s.name ?? s.id}: ${(err as Error).message}`);
    }
  }

  // 2. Missed inspections.
  const late = await db.query<Row>(
    `select id from inspections where deleted_at is null and status in ('scheduled', 'in_progress') and due_on < $1::date`, [addDays(today, -MISSED_AFTER_DAYS)]);
  for (const r of late) {
    await ctx.resources.update('inspection', r.id, { status: 'missed' }, null);
    run.missed += 1;
  }

  if (!ctx.app.hasDecorator('notify')) return run;

  // 3. Reminders.
  const due = await db.query<Row>(
    `select id, ref, title, inspector_id, due_on from inspections
     where deleted_at is null and status in ('scheduled', 'in_progress') and due_on is not null and due_on >= $1::date and due_on <= $2::date
     order by due_on limit 2000`, [addDays(today, -MISSED_AFTER_DAYS), addDays(today, lead)]);
  for (const i of due) {
    const overdue = String(i.due_on) < today;
    const name = [i.ref, i.title].filter(Boolean).join(' ');
    const res = await ctx.app.notify({
      ...(i.inspector_id ? { userIds: [i.inspector_id] } : { permission: 'audits.edit' }),
      kind: 'audits', recordType: 'inspection', recordId: i.id, route: `/inspections/${i.id}/run`,
      title: overdue ? `Inspection overdue: ${name}` : String(i.due_on) === today ? `Inspection due today: ${name}` : `Inspection due on ${displayDate(String(i.due_on))}: ${name}`,
      body: overdue ? `It was due on ${displayDate(String(i.due_on))}. Carry it out, or it is marked missed ${MISSED_AFTER_DAYS} days after the due date.` : 'Open it on a phone or tablet to work through the checklist.',
      once: `inspection.${overdue ? 'overdue' : 'due'}:${i.id}:${i.due_on}`,
    });
    run.reminded += res.sent;
  }

  const leadReq = await leadDays(ctx, REQUEST_REMINDER_SETTING, DEFAULT_REQUEST_REMINDER_DAYS);
  const requests = await db.query<Row>(
    `select id, ref, owner_id, due_on from audit_requests
     where deleted_at is null and owner_id is not null and status in ('requested', 'returned') and due_on is not null
       and due_on >= $1::date and due_on <= $2::date order by due_on limit 2000`, [addDays(today, -30), addDays(today, leadReq)]);
  for (const r of requests) {
    const overdue = String(r.due_on) < today;
    // The person asked may not open audits: the notice names only the reference and leads to their own list.
    const res = await ctx.app.notify({
      userIds: [r.owner_id], kind: 'audits', route: '/audits/my-requests',
      title: overdue ? `Evidence request overdue: ${r.ref}` : `Evidence request due on ${displayDate(String(r.due_on))}: ${r.ref}`,
      body: 'Open your evidence requests to answer it.',
      once: `audit_request.${overdue ? 'overdue' : 'due'}:${r.id}:${r.due_on}`,
    });
    run.requestsReminded += res.sent;
  }
  return run;
}

export async function registerJobs(ctx: ModuleContext) {
  ctx.app.post('/api/audits/inspections/run', { preHandler: ctx.requirePerm('audits.administer') }, async () => runInspectionWork(ctx));
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/inspections/run', tag: 'Audits', permission: 'audits.administer',
    summary: 'Run the inspection work now: create due inspections from the schedules, mark missed ones and send reminders (it also runs every few hours)',
    response: '{ created, missed, reminded, requestsReminded, skipped: string[] }',
  });
  // Every three hours on the job queue (Administration > Background jobs); each step is safe to repeat.
  await scheduleWork(ctx, 'audits.inspections', () => runInspectionWork(ctx), { every: 3 * HOUR, firstRunInMs: 120_000 });
}
