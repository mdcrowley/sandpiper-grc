// Daily notification housekeeping (E14-17), a job-queue schedule:
//   - read notifications older than `notifications.keep_read_days` (90 unless changed) are removed;
//   - notifications a person deleted are removed for good two days later (until then they
//     still count for reminders sent "once a day");
//   - records of reminders sent once (`notification_once`) are kept for 400 days.
// Unread notifications and those still waiting for a daily email summary are never removed.
import type { ModuleContext } from '../../core/module.ts';
import { DEFAULT_KEEP_READ_DAYS, KEEP_READ_SETTING } from './reminder-settings.ts';

export interface HousekeepingResult { read: number; deleted: number; once: number; keepReadDays: number }

export async function keepReadDays(ctx: ModuleContext): Promise<number> {
  const n = Math.round(Number(await ctx.settings.get<unknown>(KEEP_READ_SETTING, DEFAULT_KEEP_READ_DAYS)));
  return Number.isFinite(n) ? Math.min(730, Math.max(7, n)) : DEFAULT_KEEP_READ_DAYS;
}

export async function runHousekeeping(ctx: ModuleContext): Promise<HousekeepingResult> {
  const days = await keepReadDays(ctx);
  const waiting = `coalesce(email_state, '') <> 'digest'`;
  const read = await ctx.db.query(
    `delete from notifications where read_at is not null and dismissed_at is null and ${waiting}
       and created_at < now() - make_interval(days => $1::int) returning 1`, [days],
  );
  const deleted = await ctx.db.query(
    `delete from notifications where dismissed_at is not null and dismissed_at < now() - interval '2 days' and ${waiting} returning 1`,
  );
  const once = await ctx.db.query(`delete from notification_once where created_at < now() - interval '400 days' returning 1`);
  return { read: read.length, deleted: deleted.length, once: once.length, keepReadDays: days };
}
