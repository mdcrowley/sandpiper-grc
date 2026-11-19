import type { ModuleContext, Row } from '../../core/module.ts';
import { localDate } from './dates.ts';

/**
 * Training notifications, through the notification service when it is loaded:
 * - "assigned": a person with an account who has new training to complete (once per record);
 * - "overdue": a person whose training is past its due date, again every reminder interval
 *   (setting `training.reminder_interval_days`, 7 unless changed) until it is completed.
 * The link opens the person's own My training page, which needs no permission, so people
 * who cannot open the training register still reach what they were told about.
 */

export const TRAINING_REMINDER_SETTING = 'training.reminder_interval_days';
export const DEFAULT_TRAINING_REMINDER = 7;
const HOUR = 3_600_000;
/** Above this many items for one person at once, one notification with a count is sent. */
const ONE_BY_ONE = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plain = (d: unknown) => {
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : s;
};
const name = (r: Row) => [r.ref, r.title].filter(Boolean).join(' ');

export async function trainingReminderInterval(ctx: ModuleContext): Promise<number> {
  const raw = Number(await ctx.settings.get<unknown>(TRAINING_REMINDER_SETTING, DEFAULT_TRAINING_REMINDER));
  return Number.isFinite(raw) && raw >= 1 ? Math.trunc(raw) : DEFAULT_TRAINING_REMINDER;
}

export interface TrainingNotifyResult { assigned: number; overdue: number; notifications: number }

export async function notifyTraining(ctx: ModuleContext, now: Date = new Date()): Promise<TrainingNotifyResult> {
  if (!ctx.app.hasDecorator('notify')) return { assigned: 0, overdue: 0, notifications: 0 };
  const today = localDate(now);
  let notifications = 0;
  const send = async (userId: string, kind: string, title: string, body: string) => {
    notifications += (await ctx.app.notify({ userIds: [userId], kind, title, body, route: '/training/mine' })).sent;
  };
  const byUser = (rows: Row[]) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
    return m;
  };

  // Newly assigned. Claimed first, so two runs never tell anyone twice.
  const fresh = await ctx.db.query<Row>(
    `update training_records r set assigned_notified_at = $1
     from courses c, users u
     where r.assigned_notified_at is null and r.deleted_at is null and r.completed_on is null and r.user_id is not null
       and c.id = r.course_id and c.deleted_at is null and u.id = r.user_id and u.status = 'active' and u.deleted_at is null
     returning r.id, r.user_id, r.due_on, r.attempted_on, c.ref, c.title`,
    [now.toISOString()],
  );
  for (const [userId, mine] of byUser(fresh)) {
    if (mine.length <= ONE_BY_ONE) {
      for (const r of mine) await send(userId, 'assignment', `Training assigned to you: ${name(r)}`, r.due_on ? `Please complete it by ${plain(r.due_on)}.` : 'Open My training to see it.');
    } else {
      await send(userId, 'assignment', `${mine.length} training courses were assigned to you`, 'Open My training to see them and when each is due.');
    }
  }

  // Overdue, reminded once per interval.
  const interval = await trainingReminderInterval(ctx);
  const cutoff = new Date(now.getTime() - interval * 24 * HOUR + HOUR).toISOString();
  const late = await ctx.db.query<Row>(
    `update training_records r set overdue_reminded_at = $1
     from courses c, users u
     where r.deleted_at is null and r.completed_on is null and r.user_id is not null and r.due_on < $2::date
       and (r.overdue_reminded_at is null or r.overdue_reminded_at <= $3::timestamptz)
       and c.id = r.course_id and c.deleted_at is null and coalesce(c.status, 'active') = 'active'
       and u.id = r.user_id and u.status = 'active' and u.deleted_at is null
     returning r.id, r.user_id, r.due_on, r.attempted_on, c.ref, c.title`,
    [now.toISOString(), today, cutoff],
  );
  for (const [userId, mine] of byUser(late)) {
    if (mine.length <= ONE_BY_ONE) {
      for (const r of mine) {
        await send(userId, 'due', `Training overdue: ${name(r)}`,
          `It was due on ${plain(r.due_on)}.${r.attempted_on ? ' Your last attempt did not pass, so it is still to complete.' : ''}`);
      }
    } else {
      await send(userId, 'due', `${mine.length} of your training courses are overdue`, 'Open My training to see them.');
    }
  }
  if (fresh.length || late.length) {
    await ctx.audit(null, {
      action: 'training.notify', recordType: 'training_record',
      summary: `Training notifications: ${fresh.length} newly assigned, ${late.length} overdue reminders`,
      after: { assigned: fresh.map((r) => r.id), overdue: late.map((r) => r.id) },
    });
  }
  return { assigned: fresh.length, overdue: late.length, notifications };
}
