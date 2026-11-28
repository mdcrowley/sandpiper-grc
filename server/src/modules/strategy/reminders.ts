// Statistical submissions due (wave 26): reminders to the person preparing each one, the calendar
// source that puts them in My work and the compliance calendar, and the daily pull of automatic
// measures.
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { displayDate, todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { pullAll } from './service.ts';
import { readSettings } from './settings.ts';

const DAY = 24 * 3_600_000;
const STALE_DAYS = 30;
const dayCount = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const OPEN = `s.deleted_at is null and s.submitted_on is null and coalesce(s.status, '') not in ('submitted', 'accepted', 'returned')`;

/**
 * Once a day: a submission not yet made reminds the person preparing it (or whoever recorded it) at
 * each step of `strategy.submission_reminder_days` (30, 7 and 0 days before the due date unless
 * changed), once per step and due date, only the nearest step when several are due. Overdue ones are
 * announced again on the day they fall due; ones overdue by more than 30 days when first seen are not.
 */
export async function runSubmissionReminders(ctx: ModuleContext, today = todayInZone()): Promise<{ checked: number; sent: number }> {
  if (!ctx.app.hasDecorator('notify') || !ctx.resources.get('stat_submission')) return { checked: 0, sent: 0 };
  const steps = (await readSettings(ctx)).submission_reminder_days;
  const due = await ctx.db.query<Row>(
    `select s.id, s.ref, s.report_name, s.recipient, s.owner_id, s.created_by, s.due_on::text as due_on, (s.due_on - $1::date)::int as days_left
     from strategy_submissions s where ${OPEN} and s.due_on is not null and s.due_on <= $2::date and s.due_on >= $3::date
     order by s.due_on, s.ref limit 5000`, [today, addDays(today, Math.max(...steps)), addDays(today, -STALE_DAYS)]);
  let sent = 0;
  for (const s of due) {
    const left = Number(s.days_left);
    const step = [...steps].sort((a, b) => a - b).find((x) => left <= x) ?? 0;
    const when = left > 0 ? `in ${dayCount(left)}` : left === 0 ? 'today' : `${dayCount(-left)} ago`;
    const name = [s.ref, s.report_name].filter(Boolean).join(' ');
    const who = s.owner_id ?? s.created_by;
    if (!who) continue;
    const r = await ctx.app.notify({
      userIds: [who], kind: 'reminder', recordType: 'stat_submission', recordId: s.id,
      once: `strategy.submission:${s.id}:${s.due_on}:${step}`,
      title: `Statistical report ${left < 0 ? 'was due' : 'due'} ${when}: ${name}`,
      body: `Due ${displayDate(s.due_on)}${s.recipient ? ` to ${s.recipient}` : ''}. Record the submission with its confirmation once it is made.`,
    });
    sent += r.sent;
    if (r.sent) await ctx.db.query('update strategy_submissions set reminded_for = due_on where id = $1', [s.id]);
  }
  return { checked: due.length, sent };
}

export async function registerReminders(ctx: ModuleContext) {
  await scheduleWork(ctx, 'strategy.submission_reminders', () => runSubmissionReminders(ctx), { every: DAY, firstRunInMs: 170_000 });
  await scheduleWork(ctx, 'strategy.measure_pull', () => pullAll(ctx), { every: DAY, firstRunInMs: 180_000 });

  defineCalendarSource(ctx.app, {
    key: 'strategy.submissions', label: 'Statistical reports I prepare', kind: 'Statistical reports due',
    recordType: 'stat_submission', permission: 'strategy.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      // Open ones whatever their date (My work lists overdue items too), and any in the range.
      const rows = await c.db.query<Row>(
        `select s.id, s.ref, s.report_name, s.due_on::text as d, coalesce(s.owner_id, s.created_by) as p from strategy_submissions s
         where ${OPEN} and ${c.resources.visibleWhere('stat_submission', user, 's')}
           and s.due_on between $2::date and $3::date and ($1::uuid is null or coalesce(s.owner_id, s.created_by) = $1)
         order by s.due_on, s.ref limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `strategy.submission:${r.id}`, title: `Statistical report due: ${[r.ref, r.report_name].filter(Boolean).join(' ')}`,
        start: day(r.d), allDay: true, url: `/strategy/submissions/${r.id}`, recordType: 'stat_submission', recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });
}
