// Obligation due-date reminders (E08-22), sent through `app.notify` when the notifications
// module is loaded; without it nothing is sent.
//
// An obligation's owner is told once when its next due date comes within the window (setting
// `obligations.reminder_days`, 30 unless changed), and once more when the date is reached or
// has passed (up to 30 days afterwards, so obligations long past due do not all announce
// themselves the first time this runs). An obligation without an owner goes to everyone who
// may edit obligations. Setting a new next due date makes a new pair of reminders.
//
// E30-03: a recurring obligation (one with a frequency) is reminded about the period ending on its
// next due date and asked to attest it; attesting moves the date on, which makes the next pair. A
// period recorded by hand that is still not attested, and whose due date is not the obligation's
// next due date, gets its own pair on the same rules. The obligation keeps the due date it was last
// reminded about in `period_reminded_for`.
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
    `select id, ref, title, owner_id, frequency, next_due_on::text as due_on from obligations
     where deleted_at is null and next_due_on is not null and next_due_on >= $1::date and next_due_on <= $2::date
     order by next_due_on, ref limit 2000`,
    [dayInZone(-GRACE_DAYS), dayInZone(await obligationReminderDays(ctx))],
  );
  const recurring = new Set((await ctx.lookups.values('obligation_frequency')).filter((v) => Number(v.meta?.months ?? 0) > 0).map((v) => v.value));
  for (const o of rows) {
    const due = o.due_on <= today;
    const name = [o.ref, o.title].filter(Boolean).join(' ');
    const title = o.due_on === today ? `Obligation due today: ${name}`
      : due ? `Obligation past its due date: ${name}` : `Obligation due on ${plain(o.due_on)}: ${name}`;
    const periodic = recurring.has(o.frequency);
    const res = await ctx.app.notify({
      ...(o.owner_id ? { userIds: [o.owner_id] } : { permission: 'obligations.edit' }),
      kind: 'due', title,
      body: periodic
        ? (due ? `The period ending ${plain(o.due_on)} is due. Attest it on the Periods tab; that moves the next due date on.`
          : `The period ending ${plain(o.due_on)} is due soon. Attest it on the Periods tab when it is met.`)
        : due
          ? `It was due on ${plain(o.due_on)}. Record how it was met, then set the next due date.`
          : 'Check how it will be met, and record the evidence when it is.',
      recordType: 'obligation', recordId: o.id,
      once: `obligation.${due ? 'due' : 'soon'}:${o.id}:${o.due_on}`,
    });
    if (periodic) await ctx.db.query('update obligations set period_reminded_for = $2::date where id = $1', [o.id, o.due_on]);
    if (due) run.due += 1; else run.soon += 1;
    run.notified += res.sent;
  }

  // Periods recorded by hand that are still to be attested, other than the one ending on the next due date.
  const periods = await ctx.db.query<Row>(
    `select p.id, p.period_start::text as period_start, p.period_end::text as period_end, p.due_on::text as due_on,
            o.id as obligation_id, o.ref, o.title, o.owner_id
     from obligation_periods p join obligations o on o.id = p.obligation_id
     where o.deleted_at is null and p.status is null and p.due_on is not null
       and p.due_on >= $1::date and p.due_on <= $2::date and p.due_on is distinct from o.next_due_on
     order by p.due_on, o.ref limit 2000`,
    [dayInZone(-GRACE_DAYS), dayInZone(await obligationReminderDays(ctx))],
  );
  for (const p of periods) {
    const due = p.due_on <= today;
    const name = [p.ref, p.title].filter(Boolean).join(' ');
    const res = await ctx.app.notify({
      ...(p.owner_id ? { userIds: [p.owner_id] } : { permission: 'obligations.edit' }),
      kind: 'due',
      title: due ? `Period to attest: ${name}` : `Period due on ${plain(p.due_on)}: ${name}`,
      body: `The period ${plain(p.period_start)} to ${plain(p.period_end)} ${due ? 'was due' : 'is due'} on ${plain(p.due_on)}. Attest it on the Periods tab.`,
      recordType: 'obligation', recordId: p.obligation_id,
      once: `obligation.period.${due ? 'due' : 'soon'}:${p.id}:${p.due_on}`,
    });
    if (due) run.due += 1; else run.soon += 1;
    run.notified += res.sent;
  }
  return run;
}
