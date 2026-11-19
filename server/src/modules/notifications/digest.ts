// The daily digest: reminders this module raises itself from other modules' records.
//   - owners of actions that are overdue or due within three days
//   - assignees of tickets whose resolution target falls within the next few hours
// Both record types belong to other modules, which may not be loaded: each emitter checks
// the resource registry first and reads through the table the registry names.
// The job may run any number of times a day: `oncePerDay` means a person is told about one
// record at most once a day for each kind.
import type { ModuleContext, Row } from '../../core/module.ts';
import { TIME_ZONE, todayInZone } from '../../core/timezone.ts';
import type { NotifyInput, NotifyResult } from './service.ts';

export const SETTING_ACTION_DAYS = 'notifications.action_due_days';
export const SETTING_ACTION_CLOSED = 'notifications.action_closed_statuses';
export const SETTING_TICKET_HOURS = 'notifications.ticket_breach_hours';

type Notify = (input: NotifyInput) => Promise<NotifyResult>;

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatDay = (ymd: string) => dayFormat.format(new Date(`${ymd}T00:00:00Z`));
const timeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE });

const whole = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

async function actionsDue(ctx: ModuleContext, notify: Notify): Promise<number> {
  const def = ctx.resources.get('action');
  if (!def || !def.fields.owner_id || !def.fields.due_on) return 0;
  const days = whole(await ctx.settings.get<unknown>(SETTING_ACTION_DAYS, 3), 3, 0, 60);
  const closedSetting = await ctx.settings.get<unknown>(SETTING_ACTION_CLOSED, ['done', 'cancelled']);
  const closed = Array.isArray(closedSetting) ? closedSetting.map(String) : ['done', 'cancelled'];
  const today = todayInZone();
  const rows = await ctx.db.query<Row>(
    `select id, ${def.titleField}::text as title, owner_id, due_on from ${def.table}
     where deleted_at is null and owner_id is not null and due_on is not null and due_on <= $1::date + $2::int
       ${def.fields.status ? 'and (status is null or status <> all($3::text[]))' : 'and $3::text[] is not null'}
     order by due_on limit 2000`,
    [today, days, closed],
  );
  let sent = 0;
  for (const a of rows) {
    const when = a.due_on < today ? `overdue since ${formatDay(a.due_on)}` : a.due_on === today ? 'due today' : `due on ${formatDay(a.due_on)}`;
    const res = await notify({
      userIds: [a.owner_id], kind: 'due', title: `Action ${when}: ${a.title}`,
      recordType: 'action', recordId: a.id, oncePerDay: true,
    });
    sent += res.sent;
  }
  return sent;
}

async function ticketsNearingBreach(ctx: ModuleContext, notify: Notify): Promise<number> {
  const def = ctx.resources.get('ticket');
  if (!def || !def.fields.assignee_id) return 0;
  const hours = whole(await ctx.settings.get<unknown>(SETTING_TICKET_HOURS, 4), 4, 1, 72);
  const rows = await ctx.db.query<Row>(
    `select id, ${def.titleField}::text as title, assignee_id, resolve_due_at from ${def.table}
     where deleted_at is null and assignee_id is not null and resolved_at is null and paused_at is null
       and resolve_due_at > now() and resolve_due_at <= now() + make_interval(hours => $1::int)
     order by resolve_due_at limit 2000`,
    [hours],
  );
  let sent = 0;
  for (const t of rows) {
    const res = await notify({
      userIds: [t.assignee_id], kind: 'sla',
      title: `Ticket close to its resolution target: ${t.title}`,
      body: `The target is ${timeFormat.format(new Date(t.resolve_due_at))}.`,
      recordType: 'ticket', recordId: t.id, oncePerDay: true,
    });
    sent += res.sent;
  }
  return sent;
}

export interface DigestResult { actions: number; tickets: number }

/** Runs every emitter. One failing (for example a table that has changed shape) does not stop the other. */
export async function runDigest(ctx: ModuleContext, notify: Notify): Promise<DigestResult> {
  const guarded = async (name: string, fn: () => Promise<number>) => {
    try {
      return await fn();
    } catch (err) {
      console.error(`[notifications] digest "${name}" failed:`, err);
      return 0;
    }
  };
  return {
    actions: await guarded('actions due', () => actionsDue(ctx, notify)),
    tickets: await guarded('tickets nearing breach', () => ticketsNearingBreach(ctx, notify)),
  };
}
