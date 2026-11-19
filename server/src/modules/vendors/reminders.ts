import type { ModuleContext, Row } from '../../core/module.ts';
import { addDays, daysBetween, displayDate, localDate } from './dates.ts';

export const REMINDER_SETTING = 'contracts.reminder_days';
export const DEFAULT_REMINDER_DAYS = [120, 90, 60, 30];
export const EVIDENCE_REMINDER_SETTING = 'vendors.evidence_reminder_days';
export const DEFAULT_EVIDENCE_REMINDER_DAYS = [60, 30, 7];

/** Contracts in these statuses no longer need a renewal decision. */
export const CLOSED_CONTRACT_STATUSES = ['terminated', 'expired'];

/** Evidence that ran out longer ago than this is not announced when it is first seen. */
const STALE_EVIDENCE_DAYS = 30;

function cleanThresholds(raw: unknown, fallback: number[]): number[] {
  const list = (Array.isArray(raw) ? raw : fallback)
    .map((n) => Math.trunc(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const unique = [...new Set(list)].sort((a, b) => b - a);
  return unique.length ? unique : fallback;
}

export async function reminderThresholds(ctx: ModuleContext): Promise<number[]> {
  return cleanThresholds(await ctx.settings.get<unknown>(REMINDER_SETTING, DEFAULT_REMINDER_DAYS), DEFAULT_REMINDER_DAYS);
}

export async function evidenceThresholds(ctx: ModuleContext): Promise<number[]> {
  return cleanThresholds(
    await ctx.settings.get<unknown>(EVIDENCE_REMINDER_SETTING, DEFAULT_EVIDENCE_REMINDER_DAYS), DEFAULT_EVIDENCE_REMINDER_DAYS,
  );
}

/**
 * Checks a list of reminder days typed by a person: whole days between 1 and 3650, no
 * repeats, at most twelve. Returns them in descending order, or a message saying what is wrong.
 */
export function parseThresholds(input: unknown): { days: number[] } | { error: string } {
  if (!Array.isArray(input) || !input.length) return { error: 'Enter at least one number of days.' };
  if (input.length > 12) return { error: 'Use at most twelve reminders.' };
  const days: number[] = [];
  for (const v of input) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 3650) return { error: 'Each reminder must be a whole number of days between 1 and 3650.' };
    if (days.includes(n)) return { error: `${n} days is listed twice.` };
    days.push(n);
  }
  return { days: days.sort((a, b) => b - a) };
}

interface NotifyInput {
  userIds?: (string | null | undefined)[];
  permission?: string;
  kind: string;
  title: string;
  body?: string | null;
  recordType?: string;
  recordId?: string;
}

/** Sends through the notifications module when it is loaded; returns how many people were told. */
async function notify(ctx: ModuleContext, input: NotifyInput): Promise<number> {
  if (!ctx.app.hasDecorator('notify')) return 0;
  const send = (ctx.app as unknown as { notify: (i: NotifyInput) => Promise<{ sent: number }> }).notify;
  return (await send(input)).sent;
}

const dayCount = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const when = (left: number) => (left > 0 ? `in ${dayCount(left)}` : left === 0 ? 'today' : `${dayCount(-left)} ago`);

export interface FiredReminder {
  contract_id: string;
  ref: string | null;
  title: string;
  threshold_days: number;
  due_on: string;
  notice_date: string;
  /** People who received a notification (0 when the notifications module is not loaded). */
  notified: number;
}

/**
 * Fires renewal reminders. Each threshold (120, 90, 60, 30 days before the notice date by
 * default) fires once per contract, when `now` reaches notice date minus the threshold.
 * When several thresholds are already behind us (a contract entered late), only the
 * nearest one fires; the earlier ones are marked as superseded so they never fire
 * afterwards. Changing a contract's notice date re-arms its reminders.
 *
 * A reminder that fires writes an audit event on the contract and notifies the contract's
 * owner and everyone who may edit contracts (so a contract with no owner still reaches someone).
 */
export async function runContractReminders(ctx: ModuleContext, now: Date = new Date()): Promise<FiredReminder[]> {
  const today = localDate(now);
  const thresholds = await reminderThresholds(ctx);
  const contracts = await ctx.db.query<Row>(
    `select id, ref, title, notice_date, end_date, status, owner_id, renewal_mechanism from contracts
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
      const name = [c.ref, c.title].filter(Boolean).join(' ');
      await ctx.audit(null, {
        action: 'contract.reminder', recordType: 'contract', recordId: c.id,
        summary: `Renewal reminder (${t} days): the notice date for ${name} is ${c.notice_date} (${when(left)})`,
        after: { threshold_days: t, due_on: addDays(c.notice_date, -t), notice_date: c.notice_date },
      });
      const notified = await notify(ctx, {
        userIds: [c.owner_id], permission: 'contracts.edit', kind: 'reminder',
        title: left >= 0
          ? `Notice date ${when(left)}: ${name}`
          : `Notice date passed ${when(left)}: ${name}`,
        body: `The last day to give notice is ${displayDate(c.notice_date)}`
          + `${c.end_date ? `; the contract ends on ${displayDate(c.end_date)}` : ''}. Decide whether to renew, renegotiate or give notice.`,
        recordType: 'contract', recordId: c.id,
      });
      fired.push({
        contract_id: c.id, ref: c.ref ?? null, title: c.title, threshold_days: t,
        due_on: addDays(c.notice_date, -t), notice_date: c.notice_date, notified,
      });
    }
  }
  return fired;
}

export interface FiredEvidenceReminder {
  evidence_id: string;
  title: string;
  threshold_days: number;
  expires_on: string;
  notified: number;
}

/**
 * Fires evidence-expiry reminders the same way: each threshold (60, 30 and 7 days before
 * the expiry date by default) fires once per evidence item, only the nearest when several
 * are already behind us, and changing the expiry date re-arms them. Evidence that ran out
 * more than 30 days before it was first seen is marked quietly.
 *
 * A reminder writes an audit event on the evidence item and notifies everyone who may edit
 * vendors, and the owner of the contract the evidence belongs to.
 */
export async function runEvidenceReminders(ctx: ModuleContext, now: Date = new Date()): Promise<FiredEvidenceReminder[]> {
  const today = localDate(now);
  const thresholds = await evidenceThresholds(ctx);
  const items = await ctx.db.query<Row>(
    `select e.id, e.title, e.expires_on, e.contract_id, v.name as vendor_name, c.owner_id
     from evidence_items e
     join vendors v on v.id = e.vendor_id and v.deleted_at is null
     left join contracts c on c.id = e.contract_id and c.deleted_at is null
     where e.deleted_at is null and e.expires_on is not null and e.expires_on <= $1::date`,
    [addDays(today, Math.max(...thresholds))],
  );
  const fired: FiredEvidenceReminder[] = [];
  for (const e of items) {
    const existing = await ctx.db.query<Row>('select * from evidence_reminders where evidence_id = $1', [e.id]);
    const byThreshold = new Map(existing.map((r) => [Number(r.threshold_days), r]));
    const due: number[] = [];
    for (const t of thresholds) {
      const dueOn = addDays(e.expires_on, -t);
      let row = byThreshold.get(t);
      if (!row) {
        row = await ctx.db.one<Row>(
          `insert into evidence_reminders (evidence_id, threshold_days, due_on) values ($1,$2,$3)
           on conflict (evidence_id, threshold_days) do update set due_on = excluded.due_on returning *`,
          [e.id, t, dueOn],
        );
      } else if (row.due_on !== dueOn) {
        row = await ctx.db.one<Row>(
          'update evidence_reminders set due_on = $2, fired_at = null, superseded = false where id = $1 returning *',
          [row.id, dueOn],
        );
      }
      if (!row!.fired_at && today >= dueOn) due.push(t);
    }
    if (!due.length) continue;
    const left = daysBetween(today, e.expires_on);
    const stale = left < -STALE_EVIDENCE_DAYS;
    const nearest = Math.min(...due);
    for (const t of due) {
      const quiet = stale || t !== nearest;
      const claimed = await ctx.db.one<Row>(
        `update evidence_reminders set fired_at = $3, superseded = $4
         where evidence_id = $1 and threshold_days = $2 and fired_at is null returning id`,
        [e.id, t, now.toISOString(), quiet],
      );
      if (!claimed || quiet) continue;
      await ctx.audit(null, {
        action: 'evidence.reminder', recordType: 'evidence_item', recordId: e.id,
        summary: `Evidence reminder (${t} days): ${e.title} from ${e.vendor_name} ${left >= 0 ? `expires ${when(left)}` : `expired ${when(left)}`}`,
        after: { threshold_days: t, expires_on: e.expires_on },
      });
      const notified = await notify(ctx, {
        userIds: [e.owner_id], permission: 'vendors.edit', kind: 'reminder',
        title: left >= 0
          ? `Evidence expires ${when(left)}: ${e.title} (${e.vendor_name})`
          : `Evidence expired ${when(left)}: ${e.title} (${e.vendor_name})`,
        body: `It runs out on ${displayDate(e.expires_on)}. Ask the vendor for a current copy and record it as a new evidence item.`,
        recordType: 'evidence_item', recordId: e.id,
      });
      fired.push({ evidence_id: e.id, title: e.title, threshold_days: t, expires_on: e.expires_on, notified });
    }
  }
  return fired;
}
