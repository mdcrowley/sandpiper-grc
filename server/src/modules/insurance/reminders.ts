// Daily insurance upkeep (job `insurance.daily`): reminders to policy owners before a policy expires
// and before its renewal application is due, and to the person following up a certificate of insurance
// before it expires (each step of the settings once per date, the nearest step only); and the check of
// certificates and contract requirements again, since certificates expire by themselves.
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { displayDate, todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { CERTIFICATE, type CertificateChecks } from './certificates.ts';
import { POLICY } from './policies.ts';
import { stepsOf, type SettingName } from './settings.ts';

const DAY = 24 * 3_600_000;
/** Dates further in the past than this when first seen are not announced. */
const STALE_DAYS = 30;
const dayCount = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const whenText = (left: number) => (left > 0 ? `in ${dayCount(left)}` : left === 0 ? 'today' : `${dayCount(-left)} ago`);
const named = (r: Row) => [r.ref, r.title].filter(Boolean).join(' ');

export async function runInsuranceReminders(ctx: ModuleContext, today = todayInZone()): Promise<{ sent: number }> {
  if (!ctx.app.hasDecorator('notify')) return { sent: 0 };
  let sent = 0;

  async function remind(name: SettingName, sql: string, type: string, make: (r: Row, left: number) => { title: string; body: string }) {
    if (!ctx.resources.get(type)) return;
    const steps = await stepsOf(ctx, name);
    const rows = await ctx.db.query<Row>(sql, [today, addDays(today, Math.max(...steps)), addDays(today, -STALE_DAYS)]);
    for (const r of rows) {
      const left = Number(r.days_left);
      const step = [...steps].sort((a, b) => a - b).find((s) => left <= s) ?? 0;
      const m = make(r, left);
      const res = await ctx.app.notify({
        userIds: [r.who], kind: 'reminder', recordType: type, recordId: r.id, once: `insurance.${name}:${r.id}:${r.d}:${step}`, ...m,
      });
      sent += res.sent;
    }
  }

  const window = `between $3::date and $2::date`;
  await remind('renewal',
    `select id, ref, title, expires_on::text as d, (expires_on - $1::date)::int as days_left, coalesce(owner_id, created_by) as who from insurance_policies
     where deleted_at is null and status in ('draft', 'active') and coalesce(renewal_status, '') not in ('bound', 'not_renewing')
       and expires_on ${window} order by expires_on limit 5000`, POLICY,
    (r, left) => ({
      title: `Insurance policy ${left < 0 ? 'expired' : 'expires'} ${whenText(left)}: ${named(r)}`,
      body: `The policy term ends on ${displayDate(r.d)}. Start the renewal (Renew on the policy) or record that it is not being renewed.`,
    }));
  await remind('application',
    `select id, ref, title, renewal_application_due::text as d, (renewal_application_due - $1::date)::int as days_left, coalesce(owner_id, created_by) as who
     from insurance_policies
     where deleted_at is null and status in ('draft', 'active') and coalesce(renewal_status, '') not in ('submitted', 'quoted', 'bound', 'not_renewing')
       and renewal_application_due ${window} order by renewal_application_due limit 5000`, POLICY,
    (r, left) => ({
      title: `Renewal application ${left < 0 ? 'was due' : 'due'} ${whenText(left)}: ${named(r)}`,
      body: `The renewal application is due on ${displayDate(r.d)}. Set the renewal to "Application submitted" once it is sent.`,
    }));
  await remind('certificate',
    `select id, ref, title, expires_on::text as d, (expires_on - $1::date)::int as days_left, coalesce(owner_id, created_by) as who from insurance_certificates
     where deleted_at is null and status in ('received', 'accepted') and expires_on ${window} order by expires_on limit 5000`, CERTIFICATE,
    (r, left) => ({
      title: `Certificate of insurance ${left < 0 ? 'expired' : 'expires'} ${whenText(left)}: ${named(r)}`,
      body: `The coverage shown ends on ${displayDate(r.d)}. Ask the vendor for a current certificate and add it; the old one is then superseded.`,
    }));
  return { sent };
}

export async function registerInsuranceDaily(ctx: ModuleContext, checks: CertificateChecks) {
  await scheduleWork(ctx, 'insurance.daily', async () => {
    const rechecked = await checks.recheck('all');
    const reminders = await runInsuranceReminders(ctx);
    return { ...rechecked, ...reminders };
  }, { every: DAY, firstRunInMs: 170_000 });
}
