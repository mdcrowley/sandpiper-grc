// Evidence that is about to lapse (E45-07).
//
// Reminders: once a day, an evidence record whose "valid until" date is near reminds its owner (or,
// without one, the person who filed it) at each step of the setting `evidence.reminder_days` (30, 7
// and 0 days before, unless changed), once per step and date (the notification's `once` key), and
// only the nearest step when several are already due, so nobody gets three at once. A new date is a
// new occasion. Evidence that lapsed more than 30 days ago when first seen is not announced. Runs on
// the job queue as `evidence.expiry_reminders`.
//
// My work and the compliance calendar: the calendar source `evidence.expiry` lists evidence to renew
// by its "valid until" date, for its owner (core/calendar.ts).
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { displayDate, todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { EVIDENCE_TYPE } from './links.ts';
import { reminderSteps } from './settings.ts';

const DAY = 24 * 3_600_000;
const STALE_DAYS = 30;
const dayCount = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

export async function runEvidenceReminders(ctx: ModuleContext, today = todayInZone()): Promise<{ checked: number; sent: number }> {
  if (!ctx.app.hasDecorator('notify') || !ctx.resources.get(EVIDENCE_TYPE)) return { checked: 0, sent: 0 };
  const steps = await reminderSteps(ctx);
  const due = await ctx.db.query<Row>(
    `select id, ref, title, owner_id, created_by, valid_until::text as valid_until, (valid_until - $1::date)::int as days_left
     from evidence_records
     where deleted_at is null and valid_until is not null and valid_until <= $2::date and valid_until >= $3::date
     order by valid_until, ref limit 5000`,
    [today, addDays(today, Math.max(...steps)), addDays(today, -STALE_DAYS)]);
  let sent = 0;
  for (const e of due) {
    const left = Number(e.days_left);
    // The nearest step already reached: 30 until 8 days are left, then 7, then 0 on and after the day.
    const step = [...steps].sort((a, b) => a - b).find((s) => left <= s) ?? 0;
    const when = left > 0 ? `in ${dayCount(left)}` : left === 0 ? 'today' : `${dayCount(-left)} ago`;
    const name = [e.ref, e.title].filter(Boolean).join(' ');
    const r = await ctx.app.notify({
      userIds: [e.owner_id ?? e.created_by], kind: 'reminder', recordType: EVIDENCE_TYPE, recordId: e.id,
      once: `evidence.expiry:${e.id}:${e.valid_until}:${step}`,
      title: `Evidence ${left < 0 ? 'lapsed' : 'lapses'} ${when}: ${name}`,
      body: `Valid until ${displayDate(e.valid_until)}. Collect a current copy and update the evidence record; every record that uses it then has the new copy.`,
    });
    sent += r.sent;
    if (r.sent) await ctx.db.query('update evidence_records set reminded_for = valid_until where id = $1', [e.id]);
  }
  return { checked: due.length, sent };
}

export async function registerEvidenceReminders(ctx: ModuleContext) {
  await scheduleWork(ctx, 'evidence.expiry_reminders', () => runEvidenceReminders(ctx), { every: DAY, firstRunInMs: 160_000 });

  defineCalendarSource(ctx.app, {
    key: 'evidence.expiry', label: 'Evidence I own that lapses', kind: 'Evidence to renew',
    recordType: EVIDENCE_TYPE, permission: 'evidence.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select e.id, e.ref, e.title, e.valid_until::text as d, coalesce(e.owner_id, e.created_by) as p from evidence_records e
         where e.deleted_at is null and ${c.resources.visibleWhere(EVIDENCE_TYPE, user, 'e')}
           and e.valid_until between $2::date and $3::date and ($1::uuid is null or coalesce(e.owner_id, e.created_by) = $1)
         order by e.valid_until, e.ref limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `evidence.expiry:${r.id}`, title: `Renew evidence: ${[r.ref, r.title].filter(Boolean).join(' ')}`,
        start: day(r.d), allDay: true, url: `/evidence-library/${r.id}`, recordType: EVIDENCE_TYPE, recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });
}
