// Review-date reminders for framework outcomes, sent through `app.notify` (the notifications
// module, when it is loaded). Each review date is announced twice at most: once when it comes
// within the lead time, and once on the day it is reached (or the first run after it).
// The owner is told; an outcome with no owner goes to everyone who may edit framework outcomes.
import type { ModuleContext, Row } from '../../core/module.ts';
import { displayDate } from '../../core/timezone.ts';

/** Setting: how many days before the review date the first reminder goes out. */
export const LEAD_SETTING = 'frameworks.review_reminder_days';
export const DEFAULT_LEAD_DAYS = 14;

export interface ReminderRun { available: boolean; soon: number; due: number; notified: number }

export async function sendReviewReminders(ctx: ModuleContext): Promise<ReminderRun> {
  if (!ctx.app.hasDecorator('notify')) return { available: false, soon: 0, due: 0, notified: 0 };
  const lead = Math.min(90, Math.max(0, Math.round(Number(await ctx.settings.get<number>(LEAD_SETTING, DEFAULT_LEAD_DAYS)) || 0)));
  const rows = await ctx.db.query<Row>(
    `select id, code, title, owner_id, review_on::text as review_on, (review_on <= current_date) as due,
            (review_on - current_date) as days
     from framework_outcomes
     where deleted_at is null and review_on is not null and review_on <= current_date + $1::int
       and case when review_on <= current_date then review_due_sent_for is distinct from review_on
                else review_soon_sent_for is distinct from review_on end
     order by review_on, code limit 500`, [lead]);
  const run: ReminderRun = { available: true, soon: 0, due: 0, notified: 0 };
  for (const o of rows) {
    const days = Number(o.days);
    const when = o.due ? (days === 0 ? 'is due for review today' : `was due for review ${-days} day${days === -1 ? '' : 's'} ago`)
      : `is due for review in ${days} day${days === 1 ? '' : 's'}`;
    const sent = await ctx.app.notify({
      ...(o.owner_id ? { userIds: [o.owner_id] } : { permission: 'frameworks.edit' }),
      kind: 'reminder',
      title: `${o.code} ${when}`,
      body: o.title ? `${o.title} (review date ${displayDate(o.review_on)}). Check the status and evidence, then set the next review date.` : null,
      recordType: 'framework_outcome', recordId: o.id,
    });
    // Marked even when nobody could be told, so an unowned or muted outcome is not retried every hour.
    await ctx.db.query(
      `update framework_outcomes set ${o.due ? 'review_due_sent_for' : 'review_soon_sent_for'} = review_on where id = $1`, [o.id]);
    if (o.due) run.due += 1; else run.soon += 1;
    run.notified += sent.sent;
  }
  return run;
}
