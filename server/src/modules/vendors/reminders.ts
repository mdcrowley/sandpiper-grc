import type { ModuleContext, Row } from '../../core/module.ts';
import { addDays, daysBetween, localDate } from './dates.ts';

export const REMINDER_SETTING = 'contracts.reminder_days';
export const DEFAULT_REMINDER_DAYS = [120, 90, 60, 30];

/** Contracts in these statuses no longer need a renewal decision. */
export const CLOSED_CONTRACT_STATUSES = ['terminated', 'expired'];

export async function reminderThresholds(ctx: ModuleContext): Promise<number[]> {
  const raw = await ctx.settings.get<unknown>(REMINDER_SETTING, DEFAULT_REMINDER_DAYS);
  const list = (Array.isArray(raw) ? raw : DEFAULT_REMINDER_DAYS)
    .map((n) => Math.trunc(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const unique = [...new Set(list)].sort((a, b) => b - a);
  return unique.length ? unique : DEFAULT_REMINDER_DAYS;
}

export interface FiredReminder {
  contract_id: string;
  ref: string | null;
  title: string;
  threshold_days: number;
  due_on: string;
  notice_date: string;
}

/**
 * Fires renewal reminders. Each threshold (120, 90, 60, 30 days before the notice date by
 * default) fires once per contract, when `now` reaches notice date minus the threshold.
 * When several thresholds are already behind us (a contract entered late), only the
 * nearest one writes an audit event; the earlier ones are marked as superseded so they
 * never fire afterwards. Changing a contract's notice date re-arms its reminders.
 */
export async function runContractReminders(ctx: ModuleContext, now: Date = new Date()): Promise<FiredReminder[]> {
  const today = localDate(now);
  const thresholds = await reminderThresholds(ctx);
  const contracts = await ctx.db.query<Row>(
    `select id, ref, title, notice_date, status from contracts
     where deleted_at is null and notice_date is not null
       and (status is null or status <> all($1::text[]))`,
    [CLOSED_CONTRACT_STATUSES],
  );
  const fired: FiredReminder[] = [];
  for (const c of contracts) {
    const existing = await ctx.db.query<Row>('select * from contract_reminders where contract_id = $1', [c.id]);
    const byThreshold = new Map(existing.map((r) => [Number(r.threshold_days), r]));
    const due: number[] = [];
    for (const t of thresholds) {
      const dueOn = addDays(c.notice_date, -t);
      let row = byThreshold.get(t);
      if (!row) {
        row = await ctx.db.one<Row>(
          `insert into contract_reminders (contract_id, threshold_days, due_on) values ($1,$2,$3)
           on conflict (contract_id, threshold_days) do update set due_on = excluded.due_on returning *`,
          [c.id, t, dueOn],
        );
      } else if (row.due_on !== dueOn) {
        row = await ctx.db.one<Row>(
          'update contract_reminders set due_on = $2, fired_at = null, superseded = false where id = $1 returning *',
          [row.id, dueOn],
        );
      }
      if (!row!.fired_at && today >= dueOn) due.push(t);
    }
    if (!due.length) continue;
    const nearest = Math.min(...due);
    for (const t of due) {
      // The "fired_at is null" guard keeps this safe if two runs ever overlap.
      const claimed = await ctx.db.one<Row>(
        `update contract_reminders set fired_at = $3, superseded = $4
         where contract_id = $1 and threshold_days = $2 and fired_at is null returning id`,
        [c.id, t, now.toISOString(), t !== nearest],
      );
      if (!claimed || t !== nearest) continue;
      const left = daysBetween(today, c.notice_date);
      const when = left > 0 ? `in ${left} day${left === 1 ? '' : 's'}` : left === 0 ? 'today' : `${-left} day${left === -1 ? '' : 's'} ago`;
      await ctx.audit(null, {
        action: 'contract.reminder', recordType: 'contract', recordId: c.id,
        summary: `Renewal reminder (${t} days): the notice date for ${[c.ref, c.title].filter(Boolean).join(' ')} is ${c.notice_date} (${when})`,
        after: { threshold_days: t, due_on: addDays(c.notice_date, -t), notice_date: c.notice_date },
      });
      fired.push({
        contract_id: c.id, ref: c.ref ?? null, title: c.title, threshold_days: t,
        due_on: addDays(c.notice_date, -t), notice_date: c.notice_date,
      });
    }
  }
  return fired;
}
