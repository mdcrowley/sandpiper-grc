// Control test reminders (E26-04), sent through `app.notify` when the notifications module is
// loaded; without it nothing is sent.
//
// A control's owner is told once when its next test comes within the lead time (setting
// `controls.test_reminder_days`, 14 unless changed) and once when the date is reached or has passed
// (up to 60 days afterwards, so an old backlog does not start a flood). A control without an owner
// goes to everyone who may edit controls. Retired controls are left alone; a new due date is a new
// occasion. Runs hourly on the job queue as `controls.tests_due`.
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { meanings } from './lists.ts';

export const TEST_REMINDER_SETTING = 'controls.test_reminder_days';
export const DEFAULT_TEST_REMINDER_DAYS = 14;
const GRACE_DAYS = 60;
const HOUR = 3_600_000;

export interface TestReminderRun { available: boolean; soon: number; due: number; notified: number }

export async function runTestReminders(ctx: ModuleContext): Promise<TestReminderRun> {
  const run: TestReminderRun = { available: ctx.app.hasDecorator('notify') && !!ctx.resources.get('control'), soon: 0, due: 0, notified: 0 };
  if (!run.available) return run;
  const raw = Math.round(Number(await ctx.settings.get<unknown>(TEST_REMINDER_SETTING, DEFAULT_TEST_REMINDER_DAYS)));
  const lead = Number.isFinite(raw) ? Math.min(365, Math.max(0, raw)) : DEFAULT_TEST_REMINDER_DAYS;
  const { retired } = await meanings(ctx);
  const today = dayInZone();
  const rows = await ctx.db.query<Row>(
    `select id, ref, title, owner_id, next_test_due::text as due_on from controls
     where deleted_at is null and next_test_due is not null and next_test_due >= $1::date and next_test_due <= $2::date
       and not (coalesce(status, '') = any($3::text[]))
     order by next_test_due, ref limit 2000`,
    [dayInZone(-GRACE_DAYS), dayInZone(lead), retired],
  );
  for (const c of rows) {
    const due = c.due_on <= today;
    const name = [c.ref, c.title].filter(Boolean).join(' ');
    const res = await ctx.app.notify({
      ...(c.owner_id ? { userIds: [c.owner_id] } : { permission: 'controls.edit' }),
      kind: 'controls',
      title: c.due_on === today ? `Control test due today: ${name}`
        : due ? `Control test overdue: ${name}` : `Control test due on ${displayDate(c.due_on)}: ${name}`,
      body: due
        ? `The test was due on ${displayDate(c.due_on)}. Plan and record the test, or change the test interval.`
        : 'Plan the test and record it before then.',
      recordType: 'control', recordId: c.id,
      once: `control.test_${due ? 'due' : 'soon'}:${c.id}:${c.due_on}`,
    });
    if (due) run.due += 1; else run.soon += 1;
    run.notified += res.sent;
  }
  return run;
}

export async function registerReminders(ctx: ModuleContext) {
  await scheduleWork(ctx, 'controls.tests_due', () => runTestReminders(ctx), { every: HOUR, firstRunInMs: 110_000 });
}
