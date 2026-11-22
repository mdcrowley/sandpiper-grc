// Reminders for links that have not been checked for a while (E36-05).
//
// A link to a document kept elsewhere is due for a check once `attachments.link_check_days` (90) have
// passed since it was last checked (or added). Once a day, each link that is due reminds the owner of
// its record (the same person evidence-expiry reminders go to; evidenceReminders.ts), once per due
// date: the due date is claimed on the row in one statement before the notification is sent, so two
// runs at the same time send it once. Checking the link (POST /api/attachments/:id/checked) moves the
// due date on and re-arms the reminder. The server never opens the address.
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { ownerField } from './evidenceReminders.ts';
import { DEFAULT_LINK_CHECK_DAYS, SETTING_LINK_CHECK_DAYS } from './links.ts';

/** The link check period in days (at least 1, at most 3650). */
export async function linkCheckDays(ctx: ModuleContext): Promise<number> {
  const raw = Number(await ctx.settings.get<unknown>(SETTING_LINK_CHECK_DAYS, DEFAULT_LINK_CHECK_DAYS));
  return Number.isFinite(raw) && raw >= 1 ? Math.min(3650, Math.round(raw)) : DEFAULT_LINK_CHECK_DAYS;
}

const isoDay = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

export async function runLinkCheckReminders(ctx: ModuleContext, today = todayInZone()): Promise<{ due: number; sent: number }> {
  if (!ctx.app.hasDecorator('notify')) return { due: 0, sent: 0 };
  const notify = (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify;
  const days = await linkCheckDays(ctx);
  const due = await ctx.db.query<Row>(
    `select id, record_type, record_id, file_name, created_by,
            (coalesce(last_checked_on, created_at::date) + $2::int)::text as check_due
       from attachments
      where deleted_at is null and storage_driver = 'link'
        and coalesce(last_checked_on, created_at::date) + $2::int <= $1::date
        and (link_reminded_for is null or link_reminded_for <> coalesce(last_checked_on, created_at::date) + $2::int)
      order by record_type, check_due limit 5000`,
    [today, days]);
  let sent = 0;
  for (const l of due) {
    const def = ctx.resources.get(l.record_type);
    if (!def) continue; // that module is not loaded or is switched off: say nothing about its records
    const field = ownerField(def);
    const row = await ctx.db.one<Row>(`select ${field ? `${field} as owner, ` : ''}deleted_at from ${def.table} where id = $1`, [l.record_id]);
    if (!row || row.deleted_at) continue;
    // Claim this due date before sending: a second run finds it claimed and sends nothing.
    const claimed = await ctx.db.one(
      `update attachments set link_reminded_for = $2::date
        where id = $1 and (link_reminded_for is null or link_reminded_for <> $2::date) returning id`, [l.id, l.check_due]);
    if (!claimed) continue;
    const r = await notify({
      userIds: [row.owner ?? l.created_by], kind: 'reminder', recordType: l.record_type, recordId: l.record_id,
      route: `${def.route}/${l.record_id}?tab=attachments`,
      once: `attachments.link_check:${l.id}:${isoDay(l.check_due)}`,
      title: `Check a linked document: ${l.file_name}`,
      body: `Linked from a ${def.label.toLowerCase()} and not checked for ${days} days. Open it, confirm it is still current, then select Checked.`,
    });
    sent += r.sent;
  }
  return { due: due.length, sent };
}
