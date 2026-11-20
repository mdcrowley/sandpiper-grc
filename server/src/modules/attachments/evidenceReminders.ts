// Reminders for evidence files about to expire (E14-18).
//
// Once a day, an evidence file with an expiry date raises a `reminder` notification to the owner of
// its record: 30 days before, 7 days before and on the day it expires. Each step is sent once per
// person for that file and date (the notification's `once` key), and only the nearest step when
// several are already due (a file entered late), so nobody gets three at once. Changing the expiry
// date re-arms the reminders. The record's owner is its `owner_id` person field (or the first person
// field named like an owner); a record without one reminds the person who attached the file.
// Notifications go only to people who can see the record, as for any notification.
//
// Vendor evidence items are left out: their own reminders follow the item's expiry date
// (vendors module, `vendors.evidence_reminder_days`), and the evidence page aligns the two dates.
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

export const EVIDENCE_REMINDER_STEPS = [30, 7, 0];
/** Evidence that ran out longer ago than this is not announced when first seen. */
const STALE_DAYS = 30;
const SKIP_TYPES = new Set(['evidence_item']);

/** The person field that names a record's owner, if the type has one. */
export function ownerField(def: ResourceDef): string | null {
  if (def.fields.owner_id?.type === 'user') return 'owner_id';
  return Object.entries(def.fields).find(([name, f]) => f.type === 'user' && /owner/.test(name))?.[0] ?? null;
}

const dayCount = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const isoDay = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

export async function runEvidenceFileReminders(ctx: ModuleContext, today = todayInZone()): Promise<{ checked: number; sent: number }> {
  if (!ctx.app.hasDecorator('notify')) return { checked: 0, sent: 0 };
  const notify = (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify;
  const due = await ctx.db.query<Row>(
    `select id, record_type, record_id, file_name, expires_on, created_by, (expires_on - $1::date)::int as days_left from attachments
     where deleted_at is null and kind = 'evidence' and expires_on is not null
       and expires_on <= $1::date + $2::int and expires_on >= $1::date - $3::int
     order by record_type, expires_on limit 5000`,
    [today, Math.max(...EVIDENCE_REMINDER_STEPS), STALE_DAYS]);
  let sent = 0;
  const owners = new Map<string, string | null | undefined>();
  for (const f of due) {
    if (SKIP_TYPES.has(f.record_type)) continue;
    const def = ctx.resources.get(f.record_type);
    if (!def) continue; // that module is not loaded, or it is not a record type (a vendor's holding area)
    const key = `${f.record_type}:${f.record_id}`;
    if (!owners.has(key)) {
      const field = ownerField(def);
      const row = await ctx.db.one<Row>(`select ${field ? `${field} as owner, ` : ''}deleted_at from ${def.table} where id = $1`, [f.record_id]);
      owners.set(key, row && !row.deleted_at ? (row.owner ?? null) : undefined);
    }
    const owner = owners.get(key);
    if (owner === undefined) continue; // the record is gone or deleted
    const left = Number(f.days_left);
    // The nearest step already reached: 30 until 8 days are left, then 7, then 0 on and after the day.
    const step = [...EVIDENCE_REMINDER_STEPS].sort((a, b) => a - b).find((s) => left <= s)!;
    const when = left > 0 ? `in ${dayCount(left)}` : left === 0 ? 'today' : `${dayCount(-left)} ago`;
    const r = await notify({
      userIds: [owner ?? f.created_by], kind: 'reminder', recordType: f.record_type, recordId: f.record_id,
      route: `${def.route}/${f.record_id}?tab=attachments`,
      once: `attachments.evidence_expiry:${f.id}:${isoDay(f.expires_on)}:${step}`,
      title: `Evidence file ${left < 0 ? 'expired' : 'expires'} ${when}: ${f.file_name}`,
      body: `Attached as evidence to a ${def.label.toLowerCase()}. Attach a current copy before it lapses.`,
    });
    sent += r.sent;
  }
  return { checked: due.length, sent };
}
