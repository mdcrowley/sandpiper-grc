// Hazard review reminders (E20-12), sent through `app.notify` when the notifications module is
// loaded; without it nothing is sent.
//
// A hazard's owner is told once when its review date comes within the lead time (setting
// `safety.hazard_review_reminder_days`, 14 unless changed) and once when the date is reached or
// has passed (up to 30 days afterwards). A hazard without an owner goes to everyone who may
// edit safety records. Closed hazards are left alone. A new review date is a new occasion.
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

export const HAZARD_REVIEW_SETTING = 'safety.hazard_review_reminder_days';
export const DEFAULT_HAZARD_REVIEW_DAYS = 14;
const GRACE_DAYS = 30;

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plain = (ymd: string) => dateFormat.format(new Date(`${ymd}T00:00:00Z`));

export interface HazardReminderRun { available: boolean; soon: number; due: number; notified: number }

export async function runHazardReviewReminders(ctx: ModuleContext): Promise<HazardReminderRun> {
  const run: HazardReminderRun = { available: ctx.app.hasDecorator('notify'), soon: 0, due: 0, notified: 0 };
  if (!run.available) return run;
  const raw = Math.round(Number(await ctx.settings.get<unknown>(HAZARD_REVIEW_SETTING, DEFAULT_HAZARD_REVIEW_DAYS)));
  const lead = Number.isFinite(raw) ? Math.min(365, Math.max(0, raw)) : DEFAULT_HAZARD_REVIEW_DAYS;
  const closed = (await ctx.lookups.values('hazard_status')).filter((v) => v.meta?.closed === true).map((v) => v.value);
  const today = dayInZone();
  const rows = await ctx.db.query<Row>(
    `select id, ref, title, owner_id, review_date::text as review_on from hazards
     where deleted_at is null and review_date is not null and review_date >= $1::date and review_date <= $2::date
       and not (coalesce(status, '') = any($3::text[]))
     order by review_date, ref limit 2000`,
    [dayInZone(-GRACE_DAYS), dayInZone(lead), closed.length ? closed : ['closed']],
  );
  for (const h of rows) {
    const due = h.review_on <= today;
    const name = [h.ref, h.title].filter(Boolean).join(' ');
    const res = await ctx.app.notify({
      ...(h.owner_id ? { userIds: [h.owner_id] } : { permission: 'safety.edit' }),
      kind: 'reminder',
      title: h.review_on === today ? `Hazard review due today: ${name}`
        : due ? `Hazard review overdue: ${name}` : `Hazard review due on ${plain(h.review_on)}: ${name}`,
      body: due
        ? `The review date was ${plain(h.review_on)}. Review the rating and controls, then set the next review date.`
        : 'Check the rating and controls before then, and set the next review date.',
      recordType: 'hazard', recordId: h.id,
      once: `hazard.review_${due ? 'due' : 'soon'}:${h.id}:${h.review_on}`,
    });
    if (due) run.due += 1; else run.soon += 1;
    run.notified += res.sent;
  }
  return run;
}
