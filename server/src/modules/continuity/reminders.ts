// Continuity reminders (job `continuity.reminders`, daily), through `app.notify` when the
// notifications module is loaded:
//
// - Plan review: a plan (not a draft or retired) whose next review is within
//   `continuity.plan_review_reminder_days` (30) or past; its owner is told once per review date, and
//   once more when the date has passed.
// - Impact analysis: an active process whose next analysis is due within
//   `continuity.bia_reminder_days` (30) or past; its owner is told once per due date.
//
// Each occasion is claimed (`review_reminded_for`, `bia_reminded_for`) in one statement before
// anything is sent, so two runs at once send it once; the claim is released when nobody received it.
// Without an owner, everyone who may edit continuity records is told.
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { addDays } from './shared.ts';

export const PLAN_REVIEW_SETTING = 'continuity.plan_review_reminder_days';
export const BIA_SETTING = 'continuity.bia_reminder_days';
export const DEFAULT_DAYS = 30;
const DAY = 86_400_000;

export interface ContinuityReminderRun { available: boolean; plans: number; overdue: number; analyses: number; notified: number }

async function daysOf(ctx: ModuleContext, key: string): Promise<number> {
  const raw = Math.round(Number(await ctx.settings.get<unknown>(key, DEFAULT_DAYS)));
  return Number.isFinite(raw) ? Math.min(365, Math.max(0, raw)) : DEFAULT_DAYS;
}

export async function runContinuityReminders(ctx: ModuleContext): Promise<ContinuityReminderRun> {
  const run: ContinuityReminderRun = { available: ctx.app.hasDecorator('notify'), plans: 0, overdue: 0, analyses: 0, notified: 0 };
  if (!run.available) return run;
  const { db } = ctx;
  const today = dayInZone();
  const to = (ownerId: string | null) => (ownerId ? { userIds: [ownerId] } : { permission: 'continuity.edit' });

  const plans = await db.query<Row>(
    `select id, ref, title, owner_id, next_review_on::text as due from continuity_plans
     where deleted_at is null and status in ('approved', 'in_review') and next_review_on is not null and next_review_on <= $1::date
       and review_reminded_for is distinct from next_review_on
     order by next_review_on limit 500`, [addDays(today, await daysOf(ctx, PLAN_REVIEW_SETTING))]);
  for (const p of plans) {
    // Claimed first: of two runs at once, only the one whose write lands sends it.
    const claimed = await db.one<{ was: string | null }>(
      `update continuity_plans x set review_reminded_for = x.next_review_on from (select id, review_reminded_for as was from continuity_plans where id = $1) old
       where x.id = old.id and x.review_reminded_for is distinct from x.next_review_on returning old.was::text as was`, [p.id]);
    if (!claimed) continue;
    const late = p.due < today;
    const res = await ctx.app.notify({
      ...to(p.owner_id), kind: 'continuity',
      title: `${late ? 'Plan review overdue' : 'Plan review due'}: ${p.ref} ${p.title}`,
      body: `The review date ${late ? 'was' : 'is'} ${displayDate(p.due)}. Review the plan, then submit it for approval again.`,
      recordType: 'continuity_plan', recordId: p.id,
    });
    if (res.sent > 0) { run.plans += 1; run.notified += res.sent; } else {
      await db.query('update continuity_plans set review_reminded_for = $2::date where id = $1', [p.id, claimed.was]);
    }
  }

  // Once the date has passed, the owner hears once more (claimed per person by `once`).
  const late = await db.query<Row>(
    `select id, ref, title, owner_id, next_review_on::text as due from continuity_plans
     where deleted_at is null and status in ('approved', 'in_review') and next_review_on < $1::date and review_reminded_for = next_review_on
       and next_review_on >= $2::date
     order by next_review_on limit 500`, [today, addDays(today, -365)]);
  for (const p of late) {
    const res = await ctx.app.notify({
      ...to(p.owner_id), kind: 'continuity',
      title: `Plan review overdue: ${p.ref} ${p.title}`,
      body: `The review date was ${displayDate(p.due)}. Review the plan, then submit it for approval again.`,
      recordType: 'continuity_plan', recordId: p.id, once: `continuity.review_overdue:${p.id}:${p.due}`,
    });
    if (res.sent > 0) { run.overdue += 1; run.notified += res.sent; }
  }

  const due = await db.query<Row>(
    `select id, ref, name, owner_id, next_bia_due::text as due from business_processes
     where deleted_at is null and status = 'active' and next_bia_due is not null and next_bia_due <= $1::date
       and bia_reminded_for is distinct from next_bia_due
     order by next_bia_due limit 500`, [addDays(today, await daysOf(ctx, BIA_SETTING))]);
  for (const p of due) {
    const claimed = await db.one<{ was: string | null }>(
      `update business_processes x set bia_reminded_for = x.next_bia_due from (select id, bia_reminded_for as was from business_processes where id = $1) old
       where x.id = old.id and x.bia_reminded_for is distinct from x.next_bia_due returning old.was::text as was`, [p.id]);
    if (!claimed) continue;
    const res = await ctx.app.notify({
      ...to(p.owner_id), kind: 'continuity',
      title: `Impact analysis ${p.due < today ? 'overdue' : 'due'}: ${p.ref} ${p.name}`,
      body: `The next business impact analysis ${p.due < today ? 'was' : 'is'} due on ${displayDate(p.due)}. Start one from the process's Impact analysis tab.`,
      recordType: 'business_process', recordId: p.id,
    });
    if (res.sent > 0) { run.analyses += 1; run.notified += res.sent; } else {
      await db.query('update business_processes set bia_reminded_for = $2::date where id = $1', [p.id, claimed.was]);
    }
  }
  return run;
}

export async function registerContinuityReminders(ctx: ModuleContext) {
  ctx.app.post('/api/continuity/reminders/run', { preHandler: ctx.requirePerm('continuity.administer') }, async () => runContinuityReminders(ctx));
  ctx.describeRoute({
    method: 'POST', path: '/api/continuity/reminders/run', tag: 'Continuity', permission: 'continuity.administer',
    summary: 'Send the plan review and impact analysis reminders now (they also run every day; each occasion is announced once)',
    response: '{ available, plans, overdue, analyses, notified }',
  });
  await scheduleWork(ctx, 'continuity.reminders', () => runContinuityReminders(ctx), { every: DAY, firstRunInMs: 130_000 });
}
