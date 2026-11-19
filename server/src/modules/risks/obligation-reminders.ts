// Obligation due-date reminders (E08-22), sent through `app.notify` when the notifications
// module is loaded; without it nothing is sent.
//
// An obligation's owner is told once when its next due date comes within the window (setting
// `obligations.reminder_days`, 30 unless changed), and once more when the date is reached or
// has passed (up to 30 days afterwards, so obligations long past due do not all announce
// themselves the first time this runs). An obligation without an owner goes to everyone who
// may edit obligations. Setting a new next due date makes a new pair of reminders.
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

export const OBLIGATION_REMINDER_SETTING = 'obligations.reminder_days';
export const DEFAULT_OBLIGATION_REMINDER_DAYS = 30;
const GRACE_DAYS = 30;

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plain = (ymd: string) => dateFormat.format(new Date(`${ymd}T00:00:00Z`));

export async function obligationReminderDays(ctx: ModuleContext): Promise<number> {
  const n = Math.round(Number(await ctx.settings.get<unknown>(OBLIGATION_REMINDER_SETTING, DEFAULT_OBLIGATION_REMINDER_DAYS)));
  return Number.isFinite(n) ? Math.min(365, Math.max(0, n)) : DEFAULT_OBLIGATION_REMINDER_DAYS;
}

export interface ObligationReminderRun { available: boolean; soon: number; due: number; notified: number }

export async function runObligationReminders(ctx: ModuleContext): Promise<ObligationReminderRun> {
  const run: ObligationReminderRun = { available: ctx.app.hasDecorator('notify') && Boolean(ctx.resources.get('obligation')), soon: 0, due: 0, notified: 0 };
  if (!run.available) return run;
  const today = dayInZone();
  const rows = await ctx.db.query<Row>(
    `select id, ref, title, owner_id, next_due_on::text as due_on from obligations
     where deleted_at is null and next_due_on is not null and next_due_on >= $1::date and next_due_on <= $2::date
     order by next_due_on, ref limit 2000`,
    [dayInZone(-GRACE_DAYS), dayInZone(await obligationReminderDays(ctx))],
  );
  for (const o of rows) {
    const due = o.due_on <= today;
    const name = [o.ref, o.title].filter(Boolean).join(' ');
    const title = o.due_on === today ? `Obligation due today: ${name}`
      : due ? `Obligation past its due date: ${name}` : `Obligation due on ${plain(o.due_on)}: ${name}`;
    const res = await ctx.app.notify({
      ...(o.owner_id ? { userIds: [o.owner_id] } : { permission: 'obligations.edit' }),
      kind: 'due', title,
      body: due
        ? `It was due on ${plain(o.due_on)}. Record how it was met, then set the next due date.`
        : 'Check how it will be met, and record the evidence when it is.',
      recordType: 'obligation', recordId: o.id,
      once: `obligation.${due ? 'due' : 'soon'}:${o.id}:${o.due_on}`,
    });
    if (due) run.due += 1; else run.soon += 1;
    run.notified += res.sent;
  }
  return run;
}
