// Committee reminders (E28-10), through `app.notify` when the notifications module is loaded.
//
// - Pack due: a meeting coming up within `governance.pack_days` (5 unless changed) with no frozen
//   pack yet; the secretary is told once per meeting date.
// - Minutes waiting: a meeting held more than MINUTES_AFTER_DAYS ago whose minutes have not been
//   submitted for approval; the secretary is told once per meeting.
// Without a secretary, everyone who may edit committee records is told. The chair hears about
// minutes waiting for their approval from the approval workflow itself.
import { approvalEngine } from '../../core/approval-kinds.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { MINUTES_KIND } from './meetings.ts';

export const PACK_DAYS_SETTING = 'governance.pack_days';
export const DEFAULT_PACK_DAYS = 5;
export const MINUTES_AFTER_DAYS = 7;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plain = (ymd: string) => dateFormat.format(new Date(`${ymd}T00:00:00Z`));

export interface GovernanceReminderRun { available: boolean; packsDue: number; minutesWaiting: number; notified: number }

export async function runGovernanceReminders(ctx: ModuleContext, now = new Date()): Promise<GovernanceReminderRun> {
  const run: GovernanceReminderRun = { available: ctx.app.hasDecorator('notify'), packsDue: 0, minutesWaiting: 0, notified: 0 };
  if (!run.available) return run;
  const raw = Math.round(Number(await ctx.settings.get<unknown>(PACK_DAYS_SETTING, DEFAULT_PACK_DAYS)));
  const lead = Number.isFinite(raw) ? Math.min(60, Math.max(0, raw)) : DEFAULT_PACK_DAYS;
  const to = (m: Row) => (m.secretary_id ? { userIds: [m.secretary_id] } : { permission: 'governance.edit' });

  const upcoming = await ctx.db.query<Row>(
    `select id, ref, title, scheduled_at, secretary_id from meetings
     where deleted_at is null and status in ('planned', 'agenda_published') and pack_snapshot_id is null
       and scheduled_at > $1 and scheduled_at <= $2 order by scheduled_at limit 500`,
    [now.toISOString(), new Date(now.getTime() + lead * DAY).toISOString()]);
  for (const m of upcoming) {
    const day = todayInZone(new Date(m.scheduled_at));
    // The occasion is claimed per person by `once` before anything is sent, so a second run sends nothing.
    const res = await ctx.app.notify({
      ...to(m), kind: 'governance',
      title: `Meeting pack due: ${m.ref} ${m.title} on ${plain(day)}`,
      body: 'Freeze the report pack and send it to the members before the meeting.',
      recordType: 'meeting', recordId: m.id, once: `governance.pack:${m.id}:${day}`,
    });
    run.packsDue += 1;
    run.notified += res.sent;
  }

  const held = await ctx.db.query<Row>(
    `select id, ref, title, scheduled_at, secretary_id from meetings
     where deleted_at is null and status = 'held' and scheduled_at < $1 order by scheduled_at limit 500`,
    [new Date(now.getTime() - MINUTES_AFTER_DAYS * DAY).toISOString()]);
  const eng = approvalEngine(ctx.app);
  for (const m of held) {
    if (eng && await eng.running(MINUTES_KIND, m.id)) continue;
    const res = await ctx.app.notify({
      ...to(m), kind: 'governance',
      title: `Minutes waiting: ${m.ref} ${m.title}`,
      body: `The meeting was held on ${plain(todayInZone(new Date(m.scheduled_at)))}. Write up the minutes and submit them for the chair's approval.`,
      recordType: 'meeting', recordId: m.id, once: `governance.minutes:${m.id}`,
    });
    run.minutesWaiting += 1;
    run.notified += res.sent;
  }
  return run;
}

export async function registerGovernanceReminders(ctx: ModuleContext) {
  ctx.app.post('/api/governance/reminders/run', { preHandler: ctx.requirePerm('governance.administer') }, async () => runGovernanceReminders(ctx));
  ctx.describeRoute({
    method: 'POST', path: '/api/governance/reminders/run', tag: 'Governance', permission: 'governance.administer',
    summary: 'Send the meeting pack and minutes reminders now (they also run every hour; each occasion is announced once)',
    response: '{ available, packsDue, minutesWaiting, notified }',
  });
  await scheduleWork(ctx, 'governance.reminders', () => runGovernanceReminders(ctx), { every: HOUR, firstRunInMs: 110_000 });
}
