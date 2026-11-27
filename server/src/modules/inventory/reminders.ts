import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { displayDate } from '../../core/timezone.ts';
import { notify, usersWith } from './disposal.ts';

/**
 * Date reminders: warranty and support end dates coming up, and loans due back. Run daily.
 * Each asset date is announced once per step (30, 7 and 0 days before by default; the setting
 * `inventory.reminder_days` changes the steps), recorded in `asset_reminders`. Notifications go
 * through `app.notify` when the notifications module is loaded; without it nothing is sent.
 */

const DEFAULT_STEPS = [30, 7, 0];
const LOAN_STEPS = [3, 0];
/** A date that passed while the server was off is still announced for this many days. */
const GRACE_DAYS = 7;

export interface ReminderResult { available: boolean; warranty: number; support: number; loans: number; systems: number }

/** "in 20 days (Dec 11, 2026)": the date as people read it (BW-08). */
export function when(days: number, iso: string): string {
  const date = displayDate(iso);
  if (days > 1) return `in ${days} days (${date})`;
  if (days === 1) return `tomorrow (${date})`;
  if (days === 0) return `today (${date})`;
  return `${-days} ${days === -1 ? 'day' : 'days'} ago (${date})`;
}

/** The tightest step that applies `days` before the date, or null when it is still too far off. */
export function stepFor(days: number, steps: number[]): number | null {
  const fits = steps.filter((s) => days <= s).sort((a, b) => a - b);
  return fits.length ? fits[0] : null;
}

export async function runReminders(ctx: ModuleContext): Promise<ReminderResult> {
  const result: ReminderResult = { available: ctx.app.hasDecorator('notify'), warranty: 0, support: 0, loans: 0, systems: 0 };
  if (!result.available) return result;
  const { db } = ctx;
  const configured = await ctx.settings.get<number[]>('inventory.reminder_days', DEFAULT_STEPS);
  const steps = Array.isArray(configured) && configured.every((n) => Number.isInteger(n) && n >= 0) && configured.length ? configured : DEFAULT_STEPS;
  const horizon = Math.max(...steps);
  let editors: string[] | null = null;

  /** Sends one reminder unless this step (or a tighter one) has already gone out for this date. */
  // `key` is the asset, or the assignment for a loan (so a second loan of one asset is announced again).
  async function once(key: string, assetId: string, kind: string, dueOn: string, step: number, input: Record<string, unknown>, recordType = 'asset'): Promise<boolean> {
    const done = await db.one(
      'select 1 from asset_reminders where asset_id = $1 and kind = $2 and due_on = $3 and threshold <= $4', [key, kind, dueOn, step],
    );
    if (done) return false;
    // Claimed before it is sent (BS-7): of two runs at once (the daily job and "run now"), only the
    // one whose insert lands sends it. A reminder nobody received is released for the next run.
    const claimed = await db.one(
      'insert into asset_reminders (asset_id, kind, due_on, threshold) values ($1,$2,$3,$4) on conflict do nothing returning 1 as ok', [key, kind, dueOn, step],
    );
    if (!claimed) return false;
    const sent = await notify(ctx, { ...input, recordType, recordId: assetId });
    if (!sent) {
      await db.query('delete from asset_reminders where asset_id = $1 and kind = $2 and due_on = $3 and threshold = $4', [key, kind, dueOn, step]);
      return false;
    }
    return true;
  }

  for (const [column, kind, word] of [['warranty_end', 'warranty', 'Warranty'], ['support_end', 'support', 'Support']] as const) {
    const rows = await db.query<Row>(
      `select id, tag, name, owner_id, ${column}::text as due_on, (${column} - current_date)::int as days
       from assets
       where deleted_at is null and coalesce(status, '') not in ('retired', 'disposed')
         and ${column} between current_date - $1::int and current_date + $2::int
       order by ${column}`,
      [GRACE_DAYS, horizon],
    );
    for (const a of rows) {
      const step = stepFor(a.days, steps);
      if (step === null) continue;
      // The owner when there is one; otherwise everyone who looks after assets.
      const userIds = a.owner_id ? [a.owner_id] : (editors ??= await usersWith(ctx, 'assets.edit'));
      const label = [a.tag, a.name].filter(Boolean).join(' ');
      const verb = a.days < 0 ? 'ended' : 'ends';
      if (await once(a.id, a.id, column, a.due_on, step, {
        userIds, kind: 'reminder', title: `${word} for ${label} ${verb} ${when(a.days, a.due_on)}`,
        body: kind === 'warranty' ? 'Check whether to renew the cover or plan a replacement.' : 'Out-of-support equipment no longer receives fixes. Plan its replacement.',
      })) result[kind] += 1;
    }
  }

  // E45-42: a system's end of vendor support, to its technical owner (then its business owner, then
  // everyone who looks after systems). Same steps; the reminder rows share the table, keyed by the system.
  const systems = await db.query<Row>(
    `select id, ref, name, technical_owner_id, business_owner_id, support_end::text as due_on, (support_end - current_date)::int as days
     from systems
     where deleted_at is null and coalesce(status, '') <> 'retired'
       and support_end between current_date - $1::int and current_date + $2::int
     order by support_end`,
    [GRACE_DAYS, horizon],
  );
  let systemEditors: string[] | null = null;
  for (const s of systems) {
    const step = stepFor(s.days, steps);
    if (step === null) continue;
    const owner = s.technical_owner_id ?? s.business_owner_id;
    const userIds = owner ? [owner] : (systemEditors ??= await usersWith(ctx, 'systems.edit'));
    const label = [s.ref, s.name].filter(Boolean).join(' ');
    if (await once(s.id, s.id, 'system_support_end', s.due_on, step, {
      userIds, kind: 'reminder', title: `Vendor support for ${label} ${s.days < 0 ? 'ended' : 'ends'} ${when(s.days, s.due_on)}`,
      body: 'A system out of vendor support no longer receives fixes. Plan an upgrade or its replacement.',
    }, 'system')) result.systems += 1;
  }

  const loans = await db.query<Row>(
    `select l.id as assignment_id, l.user_id, l.checked_out_by, l.due_back_on::text as due_on, (l.due_back_on - current_date)::int as days,
            coalesce(u.display_name, l.assignee_name, 'someone') as assignee, a.id, a.tag, a.name
     from asset_assignments l
     join assets a on a.id = l.asset_id and a.deleted_at is null
     left join users u on u.id = l.user_id
     where l.checked_in_at is null and l.due_back_on is not null
       and l.due_back_on between current_date - $1::int and current_date + $2::int`,
    [GRACE_DAYS, Math.max(...LOAN_STEPS)],
  );
  for (const l of loans) {
    const step = stepFor(l.days, LOAN_STEPS);
    if (step === null) continue;
    const label = [l.tag, l.name].filter(Boolean).join(' ');
    if (await once(l.assignment_id, l.id, 'loan', l.due_on, step, {
      userIds: [l.checked_out_by, l.user_id], kind: 'due',
      title: `${label} ${l.days < 0 ? 'was' : 'is'} due back from ${l.assignee} ${when(l.days, l.due_on)}`,
    })) result.loans += 1;
  }
  return result;
}

export async function registerReminders(ctx: ModuleContext) {
  const { app } = ctx;
  app.post('/api/inventory/reminders/run', { preHandler: ctx.requirePerm('admin.administer') }, async () => runReminders(ctx));

  // Several times a day on the job queue (Administration > Background jobs); each reminder still goes out once.
  await scheduleWork(ctx, 'inventory.reminders', () => runReminders(ctx), { every: 6 * 3_600_000, firstRunInMs: 120_000 });
}
