// Condition assessment reminders and the nightly useful-life recompute (E32), on the job queue.
//
// A record with an asset class is due for its next assessment a set number of months after its last
// one (the class's own interval, else the setting `condition.assessment_every_months`, 24). Once a
// due date comes within `condition.assessment_reminder_days` (30), or has passed (up to 60 days, so
// an old backlog does not start a flood), one reminder per class lists how many are due: to the
// class's owner, else to everyone who may edit assets. Each record and due date is claimed in
// `condition_reminders` (one insert) before anyone is told, so two runs at once never remind twice;
// a claim is given back when nobody could be told. Records never assessed are shown on the dashboard
// and the aging list instead. Retired vehicles, disposed assets and sites no longer in use are left alone.
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { classes, everyMonths, nextDue } from './dashboard.ts';
import { members, recompute, followTargets } from './service.ts';

export const REMINDER_SETTING = 'condition.assessment_reminder_days';
export const DEFAULT_REMINDER_DAYS = 30;
const GRACE_DAYS = 60;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface ReminderRun { available: boolean; due: number; claimed: number; notified: number }

export async function runReminders(ctx: ModuleContext): Promise<ReminderRun> {
  const run: ReminderRun = { available: ctx.app.hasDecorator('notify') && !!ctx.resources.get('asset_class'), due: 0, claimed: 0, notified: 0 };
  if (!run.available) return run;
  const raw = Math.round(Number(await ctx.settings.get<unknown>(REMINDER_SETTING, DEFAULT_REMINDER_DAYS)));
  const lead = Number.isFinite(raw) ? Math.min(365, Math.max(0, raw)) : DEFAULT_REMINDER_DAYS;
  const every = await everyMonths(ctx);
  const from = dayInZone(-GRACE_DAYS);
  const until = dayInZone(lead);
  const list = new Map((await classes(ctx)).map((c) => [c.id, c]));
  const due = (await members(ctx))
    .filter((m) => !m.excluded && list.has(m.class_id))
    .map((m) => ({ m, due: nextDue(m, list.get(m.class_id), every) }))
    .filter((x): x is { m: typeof x.m; due: string } => !!x.due && x.due >= from && x.due <= until);
  run.due = due.length;
  if (!due.length) return run;

  // Claimed first, all in one statement: of two runs at once, each record goes to only one.
  const claimed = await ctx.db.query<{ target_type: string; target_id: string; due_on: string }>(
    `insert into condition_reminders (target_type, target_id, due_on)
     select * from unnest($1::text[], $2::uuid[], $3::date[])
     on conflict do nothing returning target_type, target_id::text as target_id, due_on::text as due_on`,
    [due.map((x) => x.m.type), due.map((x) => x.m.id), due.map((x) => x.due)]);
  run.claimed = claimed.length;
  const mine = new Set(claimed.map((c) => `${c.target_type}:${c.target_id}:${c.due_on}`));
  const byClass = new Map<string, typeof due>();
  for (const x of due) {
    if (!mine.has(`${x.m.type}:${x.m.id}:${x.due}`)) continue;
    byClass.set(x.m.class_id, [...(byClass.get(x.m.class_id) ?? []), x]);
  }
  const today = dayInZone();
  for (const [classId, items] of byClass) {
    const cls = list.get(classId)!;
    const overdue = items.filter((x) => x.due < today).length;
    const res = await ctx.app.notify({
      ...(cls.owner_id ? { userIds: [cls.owner_id] } : { permission: 'assets.edit' }),
      kind: 'reminder',
      title: `${items.length} condition assessment${items.length === 1 ? '' : 's'} due: ${cls.name}`,
      body: overdue
        ? `${overdue} ${overdue === 1 ? 'is' : 'are'} overdue. Open the class's members to see which, and record each assessment.`
        : `Due within ${lead} days. Open the class's members to see which, and record each assessment.`,
      recordType: 'asset_class', recordId: classId, route: `/condition/classes/${classId}?tab=members`,
    });
    if (res.sent > 0) run.notified += res.sent;
    else {
      // Nobody could be told: give the claims back so a later run tries again.
      await ctx.db.query(
        `delete from condition_reminders where (target_type, target_id, due_on) in (select * from unnest($1::text[], $2::uuid[], $3::date[]))`,
        [items.map((x) => x.m.type), items.map((x) => x.m.id), items.map((x) => x.due)]);
    }
  }
  return run;
}

export async function registerReminders(ctx: ModuleContext) {
  await scheduleWork(ctx, 'condition.reminders', () => runReminders(ctx), { every: DAY, firstRunInMs: 130_000 });
  // Nightly: useful-life ends follow the classes and dates (and pick up a kind of record that was
  // switched off when the server started).
  await scheduleWork(ctx, 'condition.recompute', async () => {
    followTargets(ctx);
    return { changed: await recompute(ctx) };
  }, { every: DAY, firstRunInMs: 140_000 });
}
