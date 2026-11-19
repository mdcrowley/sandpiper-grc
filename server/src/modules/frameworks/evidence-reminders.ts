// Reminders when evidence notes on framework outcomes expire (E07-24), sent through `app.notify`
// when the notifications module is loaded. Each note's expiry date is announced at most twice:
// once when it comes within the lead time (setting `frameworks.evidence_reminder_days`, 30
// unless changed) and once when it has passed (for up to 30 days afterwards, so a note that
// expired long ago does not start a flood). The outcome's owner is told; an outcome with no
// owner goes to everyone who may edit framework outcomes. Files attached as evidence follow the
// attachments module's own expiry rules.
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

export const EVIDENCE_LEAD_SETTING = 'frameworks.evidence_reminder_days';
export const DEFAULT_EVIDENCE_LEAD_DAYS = 30;
const GRACE_DAYS = 30;

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plain = (ymd: string) => dateFormat.format(new Date(`${ymd}T00:00:00Z`));

export interface EvidenceReminderRun { available: boolean; expiring: number; expired: number; notified: number }

export async function sendEvidenceReminders(ctx: ModuleContext): Promise<EvidenceReminderRun> {
  if (!ctx.app.hasDecorator('notify')) return { available: false, expiring: 0, expired: 0, notified: 0 };
  const raw = Math.round(Number(await ctx.settings.get<unknown>(EVIDENCE_LEAD_SETTING, DEFAULT_EVIDENCE_LEAD_DAYS)));
  const lead = Number.isFinite(raw) ? Math.min(365, Math.max(0, raw)) : DEFAULT_EVIDENCE_LEAD_DAYS;
  const today = dayInZone();
  const rows = await ctx.db.query<Row>(
    `select e.id, e.title, e.expires_on::text as expires_on, o.id as outcome_id, o.code, o.owner_id
     from outcome_evidence e join framework_outcomes o on o.id = e.outcome_id and o.deleted_at is null
     where e.expires_on is not null and e.expires_on >= $1::date and e.expires_on <= $2::date
     order by e.expires_on, o.code limit 1000`,
    [dayInZone(-GRACE_DAYS), dayInZone(lead)],
  );
  const run: EvidenceReminderRun = { available: true, expiring: 0, expired: 0, notified: 0 };
  for (const e of rows) {
    const expired = e.expires_on < today;
    const res = await ctx.app.notify({
      ...(e.owner_id ? { userIds: [e.owner_id] } : { permission: 'frameworks.edit' }),
      kind: 'reminder',
      title: expired ? `Evidence for ${e.code} has expired: ${e.title}` : `Evidence for ${e.code} expires on ${plain(e.expires_on)}: ${e.title}`,
      body: expired
        ? `It expired on ${plain(e.expires_on)}. Collect new evidence, or update the note.`
        : 'Collect new evidence before then, or update the note’s expiry date.',
      recordType: 'framework_outcome', recordId: e.outcome_id,
      once: `framework.evidence_${expired ? 'expired' : 'expiring'}:${e.id}:${e.expires_on}`,
    });
    if (expired) run.expired += 1; else run.expiring += 1;
    run.notified += res.sent;
  }
  return run;
}
