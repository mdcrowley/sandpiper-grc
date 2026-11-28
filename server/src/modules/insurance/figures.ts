// The insurance area's figures (the same for every viewer), the renewal calendar, the monthly metrics,
// the calendar sources for My work and the compliance calendar, and the area's settings.
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays, addMonths, monthEndOf } from '../../../../shared/dates.ts';
import { CERTIFICATE } from './certificates.ts';
import { CLAIM } from './claims.ts';
import { CONDITION, POLICY } from './policies.ts';
import { cleanSteps, EXPIRING_DAYS, SETTINGS, stepsOf, type SettingName } from './settings.ts';

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const named = (r: Row) => [r.ref, r.title].filter(Boolean).join(' ');
/** Policy statuses whose renewal is still to come. */
const OPEN_POLICY = `('draft', 'active')`;
const RENEWAL_DONE = `('bound', 'not_renewing')`;
const CLAIM_OPEN = `coalesce(status, 'open') not in ('closed', 'denied', 'withdrawn')`;
const CERT_LIVE = `coalesce(status, '') in ('received', 'accepted')`;

export function registerFigures(ctx: ModuleContext) {
  const { app, db } = ctx;

  // ---------- figures: every record counts, restricted claims included ----------

  app.get('/api/insurance/summary', { preHandler: ctx.requirePerm('insurance.view') }, async () => {
    const today = todayInZone();
    const soon = addDays(today, EXPIRING_DAYS);
    const p = (await db.one<Row>(
      `select count(*) filter (where status = 'active')::int as in_force,
              count(*) filter (where status in ${OPEN_POLICY} and expires_on between $1::date and $2::date)::int as expiring,
              count(*) filter (where status = 'active' and expires_on < $1::date)::int as lapsed,
              count(*) filter (where status in ${OPEN_POLICY} and coalesce(renewal_status, '') not in ${RENEWAL_DONE}
                                 and renewal_application_due < $1::date)::int as applications_overdue,
              coalesce(sum(premium) filter (where status = 'active'), 0)::float8 as premium
       from insurance_policies where deleted_at is null`, [today, soon]))!;
    const c = (await db.one<Row>(
      `select count(*) filter (where ${CERT_LIVE} and expires_on < $1::date)::int as expired,
              count(*) filter (where ${CERT_LIVE} and expires_on between $1::date and $2::date)::int as expiring,
              count(*) filter (where ${CERT_LIVE} and check_result = 'short')::int as short
       from insurance_certificates where deleted_at is null`, [today, addDays(today, 30)]))!;
    const r = ctx.resources.get('contract') ? (await db.one<Row>(
      `select count(*) filter (where r.state in ('missing', 'expired', 'short'))::int as unmet from insurance_requirements r
       join contracts k on k.id = r.contract_id where r.deleted_at is null and k.deleted_at is null and coalesce(k.status, '') not in ('expired', 'terminated', 'closed')`))! : { unmet: 0 };
    const k = (await db.one<Row>(
      `select count(*) filter (where ${CLAIM_OPEN})::int as open_claims,
              coalesce(sum(reserve) filter (where ${CLAIM_OPEN}), 0)::float8 as open_reserves,
              coalesce(sum(paid), 0)::float8 as paid, coalesce(sum(recovered), 0)::float8 as recovered
       from insurance_claims where deleted_at is null`))!;
    const n = (await db.one<Row>(
      `select count(*)::int as not_met from insurance_conditions c join insurance_policies p on p.id = c.policy_id
       where c.deleted_at is null and p.deleted_at is null and p.status in ${OPEN_POLICY} and c.status in ('not_met', 'partly')`))!;
    return {
      today, expiring_days: EXPIRING_DAYS,
      policies: { in_force: p.in_force, expiring: p.expiring, lapsed: p.lapsed, applications_overdue: p.applications_overdue, premium: Number(p.premium) },
      certificates: { expired: c.expired, expiring: c.expiring, short: c.short, requirements_unmet: Number(r.unmet) },
      claims: { open: k.open_claims, open_reserves: Number(k.open_reserves), paid: Number(k.paid), recovered: Number(k.recovered) },
      conditions: { not_met: n.not_met },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/summary', tag: 'Insurance', permission: 'insurance.view',
    summary: 'Figures of the insurance program, the same for every viewer: policies in force and expiring, certificates expired or short, open claims and reserves',
    response: '{ today, expiring_days, policies: { in_force, expiring, lapsed, applications_overdue, premium }, certificates: { expired, expiring, short, requirements_unmet }, claims: { open, open_reserves, paid, recovered }, conditions: { not_met } }',
  });

  // ---------- the renewal calendar: a list, so only what the viewer may open ----------

  app.get('/api/insurance/renewals', { preHandler: ctx.requirePerm('insurance.view') }, async (req) => {
    const q = req.query as Row;
    const today = todayInZone();
    const months = Math.min(24, Math.max(1, Math.round(Number(q.months ?? 12)) || 12));
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from ?? '')) ? String(q.from) : addMonths(today, -1);
    const to = monthEndOf(addMonths(from, months - 1));
    const items: Row[] = [];
    const policies = await db.query<Row>(
      `select p.id, p.ref, p.title, p.line, p.status, p.renewal_status, p.owner_id, p.expires_on::text as expires_on,
              p.renewal_application_due::text as due, p.premium
       from insurance_policies p where p.deleted_at is null and p.status in ${OPEN_POLICY} and ${ctx.resources.visibleWhere(POLICY, req.user, 'p')}
         and (p.expires_on between $1::date and $2::date or p.renewal_application_due between $1::date and $2::date)`, [from, to]);
    for (const p of policies) {
      const base = { record_type: POLICY, id: p.id, ref: p.ref, title: p.title, line: p.line, status: p.status, renewal_status: p.renewal_status, owner_id: p.owner_id, route: `/insurance/${p.id}` };
      if (p.expires_on && p.expires_on >= from && p.expires_on <= to) items.push({ ...base, kind: 'policy_expires', date: p.expires_on, premium: p.premium });
      if (p.due && p.due >= from && p.due <= to && !['bound', 'not_renewing'].includes(p.renewal_status)) items.push({ ...base, kind: 'application_due', date: p.due });
    }
    const certs = await db.query<Row>(
      `select c.id, c.ref, c.title, c.line, c.status, c.owner_id, c.expires_on::text as expires_on, c.check_result from insurance_certificates c
       where c.deleted_at is null and ${CERT_LIVE} and ${ctx.resources.visibleWhere(CERTIFICATE, req.user, 'c')} and c.expires_on between $1::date and $2::date`, [from, to]);
    for (const c of certs) {
      items.push({ record_type: CERTIFICATE, id: c.id, ref: c.ref, title: c.title, line: c.line, status: c.status, owner_id: c.owner_id, kind: 'certificate_expires', date: c.expires_on, check_result: c.check_result, route: `/insurance/certificates/${c.id}` });
    }
    items.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.ref ?? '').localeCompare(String(b.ref ?? '')));
    return { today, from, to, items };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/renewals', tag: 'Insurance', permission: 'insurance.view',
    summary: 'The renewal calendar: policy expiry dates, renewal applications due and certificates of insurance expiring, by date',
    query: { from: 'First day (YYYY-MM-DD; default a month ago)', months: 'How many months (1 to 24, default 12)' },
    response: '{ today, from, to, items: [{ kind: policy_expires | application_due | certificate_expires, date, record_type, id, ref, title, line, status, owner_id, route }] }',
  });

  // ---------- settings (Insurance > Settings) ----------

  app.get('/api/insurance/settings', { preHandler: ctx.requirePerm('insurance.view') }, async () => {
    const out: Row = {};
    for (const name of Object.keys(SETTINGS) as SettingName[]) {
      const s = SETTINGS[name];
      out[name] = { key: s.key, label: s.label, max: s.max, default: s.default, value: await stepsOf(ctx, name) };
    }
    return out;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/settings', tag: 'Insurance', permission: 'insurance.view',
    summary: 'When policy, renewal application and certificate owners are reminded (days before the date)',
    response: '{ renewal: { key, label, max, default, value }, application: {...}, certificate: {...} }',
  });

  app.put('/api/insurance/settings', { preHandler: ctx.requirePerm('insurance.administer') }, async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const changes: [SettingName, number[]][] = [];
    for (const name of Object.keys(SETTINGS) as SettingName[]) {
      if (b[name] === undefined) continue;
      const s = SETTINGS[name];
      const raw = Array.isArray(b[name]) ? b[name] : [b[name]];
      const steps = cleanSteps(raw, s.max);
      if (!steps.length || steps.length !== raw.length) errors[name] = `Give whole numbers of days from 0 to ${s.max}, each once.`;
      else changes.push([name, steps]);
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    for (const [name, steps] of changes) await ctx.settings.set(SETTINGS[name].key, steps, req);
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/insurance/settings', tag: 'Insurance', permission: 'insurance.administer',
    summary: 'Change when owners are reminded', body: '{ renewal?: number[], application?: number[], certificate?: number[] }', response: '{ ok: true }',
  });

  // ---------- metrics (figures over time, indicators) ----------

  const asOf = (monthStart: string): string | null => {
    const today = todayInZone();
    if (monthStart > today) return null;
    const end = monthEndOf(monthStart);
    return end < today ? end : today;
  };
  defineMetric(app, {
    key: 'insurance.policies_expiring', label: 'Insurance policies expiring within 90 days', unit: 'count', recordType: POLICY,
    description: 'Policies in force or being placed at the end of the month (today for the month still running) whose term ends within the next 90 days.',
    async compute(c, monthStart) {
      const at = asOf(monthStart);
      if (!at) return null;
      const r = await c.db.one<Row>(
        `select count(*)::int as n from insurance_policies where deleted_at is null and status in ${OPEN_POLICY}
           and expires_on between $1::date and $2::date`, [at, addDays(at, EXPIRING_DAYS)]);
      return Number(r?.n ?? 0);
    },
  });
  defineMetric(app, {
    key: 'insurance.certificates_expired', label: 'Vendor certificates of insurance expired', unit: 'count', recordType: CERTIFICATE,
    description: 'Certificates of insurance on file (received or accepted, not superseded) whose coverage had ended at the end of the month (today for the month still running).',
    async compute(c, monthStart) {
      const at = asOf(monthStart);
      if (!at) return null;
      const r = await c.db.one<Row>(
        `select count(*)::int as n from insurance_certificates where deleted_at is null and ${CERT_LIVE} and expires_on < $1::date`, [at]);
      return Number(r?.n ?? 0);
    },
  });
  defineMetric(app, {
    key: 'insurance.open_claims', label: 'Open insurance claims', unit: 'count', recordType: CLAIM,
    description: 'Claims whose incident happened by the end of the month (today for the month still running) and that were not closed by then.',
    async compute(c, monthStart) {
      const at = asOf(monthStart);
      if (!at) return null;
      const r = await c.db.one<Row>(
        `select count(*)::int as n from insurance_claims where deleted_at is null and coalesce(incident_on, created_at::date) <= $1::date
           and (closed_on > $1::date or (closed_on is null and ${CLAIM_OPEN}))`, [at]);
      return Number(r?.n ?? 0);
    },
  });
  defineMetric(app, {
    key: 'insurance.open_reserves', label: 'Reserves on open insurance claims', unit: 'number', recordType: CLAIM,
    description: 'The reserves of the claims open at the end of the month (today for the month still running), as recorded now, in the organization\'s currency.',
    async compute(c, monthStart) {
      const at = asOf(monthStart);
      if (!at) return null;
      const r = await c.db.one<Row>(
        `select coalesce(sum(reserve), 0)::float8 as n from insurance_claims where deleted_at is null and coalesce(incident_on, created_at::date) <= $1::date
           and (closed_on > $1::date or (closed_on is null and ${CLAIM_OPEN}))`, [at]);
      return Number(r?.n ?? 0);
    },
  });

  // ---------- My work and the compliance calendar ----------

  defineCalendarSource(app, {
    key: 'insurance.renewals', label: 'Insurance policies I renew', kind: 'Insurance renewals',
    recordType: POLICY, permission: 'insurance.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select p.id, p.ref, p.title, p.expires_on::text as expires_on, p.renewal_application_due::text as due, coalesce(p.owner_id, p.created_by) as who
         from insurance_policies p
         where p.deleted_at is null and p.status in ${OPEN_POLICY} and coalesce(p.renewal_status, '') not in ${RENEWAL_DONE}
           and ${c.resources.visibleWhere(POLICY, user, 'p')} and ($1::uuid is null or coalesce(p.owner_id, p.created_by) = $1)
           and (p.expires_on between $2::date and $3::date or p.renewal_application_due between $2::date and $3::date)
         order by p.expires_on limit 2000`, [whoFor(user, scope), from, to]);
      const out = [];
      for (const r of rows) {
        const base = { allDay: true, url: `/insurance/${r.id}`, recordType: POLICY, recordId: r.id, ref: r.ref ?? null, personId: r.who ?? null };
        if (r.due && r.due >= from && r.due <= to) out.push({ ...base, uid: `insurance.application:${r.id}`, title: `Renewal application due: ${named(r)}`, start: day(r.due) });
        if (r.expires_on && r.expires_on >= from && r.expires_on <= to) out.push({ ...base, uid: `insurance.renewal:${r.id}`, title: `Policy expires: ${named(r)}`, start: day(r.expires_on) });
      }
      return out;
    },
  });
  defineCalendarSource(app, {
    key: 'insurance.certificates', label: 'Certificates of insurance I follow up', kind: 'Certificates of insurance to renew',
    recordType: CERTIFICATE, permission: 'insurance.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select x.id, x.ref, x.title, x.expires_on::text as d, coalesce(x.owner_id, x.created_by) as who from insurance_certificates x
         where x.deleted_at is null and ${CERT_LIVE} and ${c.resources.visibleWhere(CERTIFICATE, user, 'x')}
           and x.expires_on between $2::date and $3::date and ($1::uuid is null or coalesce(x.owner_id, x.created_by) = $1)
         order by x.expires_on, x.ref limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `insurance.certificate:${r.id}`, title: `Certificate of insurance expires: ${named(r)}`, start: day(r.d), allDay: true,
        url: `/insurance/certificates/${r.id}`, recordType: CERTIFICATE, recordId: r.id, ref: r.ref ?? null, personId: r.who ?? null,
      }));
    },
  });
  defineCalendarSource(app, {
    key: 'insurance.conditions', label: 'Policy conditions I must meet', kind: 'Insurance conditions',
    recordType: CONDITION, permission: 'insurance.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select x.id, x.title, x.due_on::text as d, coalesce(x.owner_id, p.owner_id, x.created_by) as who, p.ref as policy_ref from insurance_conditions x
         join insurance_policies p on p.id = x.policy_id
         where x.deleted_at is null and p.deleted_at is null and p.status in ${OPEN_POLICY} and coalesce(x.status, '') <> 'met'
           and ${c.resources.visibleWhere(CONDITION, user, 'x')} and x.due_on between $2::date and $3::date
           and ($1::uuid is null or coalesce(x.owner_id, p.owner_id, x.created_by) = $1)
         order by x.due_on limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `insurance.condition:${r.id}`, title: `Policy condition to meet${r.policy_ref ? ` (${r.policy_ref})` : ''}: ${r.title}`, start: day(r.d), allDay: true,
        url: `/insurance/conditions/${r.id}`, recordType: CONDITION, recordId: r.id, ref: null, personId: r.who ?? null,
      }));
    },
  });
}
