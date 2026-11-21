// Multi-year coverage of the audit universe (E24-02) and the dashboard summary (E24-11).
//
// Figures are the same for everyone: the counts include restricted audits and findings. Where a
// restricted audit appears in the coverage grid for someone who may not see it, it shows as
// "Restricted audit" with its status only.
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays, addMonths } from './dates.ts';
import { MISSED_AFTER_DAYS } from './jobs.ts';

const DUE_SOON_DAYS = 90;

export function registerCoverage(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('audits.view') };

  app.get('/api/audits/coverage', view, async (req) => {
    const asked = Number((req.query as Row).years);
    const n = Number.isInteger(asked) && asked >= 1 && asked <= 10 ? asked : 3;
    const today = dayInZone();
    const thisYear = Number(today.slice(0, 4));
    const years = Array.from({ length: n + 1 }, (_, i) => thisYear - n + 1 + i); // the last n years and next year's plan
    const areas = await db.query<Row>(
      `select a.id, a.name, a.category, a.cycle_months, a.last_audited_on, a.next_due_on, a.risk_level, u.display_name as owner_name
       from audit_areas a left join users u on u.id = a.owner_id
       where a.deleted_at is null and a.active order by a.name`);
    const audits = await db.query<Row>(
      `select a.id, a.ref, a.title, a.status, a.area_id, a.restricted,
              coalesce(a.plan_year, extract(year from coalesce(a.fieldwork_start, a.planned_start))::int) as year,
              (${ctx.resources.visibleWhere('audit_engagement', req.user, 'a')}) as visible
       from audits a where a.deleted_at is null and coalesce(a.status, '') <> 'canceled'`);
    const entry = (a: Row) => (a.visible
      ? { id: a.id, ref: a.ref, title: a.title, status: a.status, restricted: Boolean(a.restricted) }
      : { id: null, ref: null, title: 'Restricted audit', status: a.status, restricted: true });
    const byYear = (rows: Row[]) => Object.fromEntries(years.map((y) => [y, rows.filter((a) => Number(a.year) === y).map(entry)]));
    const state = (a: Row) => {
      if (!a.next_due_on) return a.last_audited_on ? 'ok' : 'never';
      if (String(a.next_due_on) < today) return 'overdue';
      if (String(a.next_due_on) <= addDays(today, DUE_SOON_DAYS)) return 'due_soon';
      return 'ok';
    };
    return {
      today, years,
      areas: areas.map((a) => {
        const covered = audits.filter((x) => x.area_id === a.id && x.status === 'closed' && Number(x.year) >= years[0] && Number(x.year) <= thisYear).length;
        return { ...a, state: state(a), audited_in_period: covered > 0, by_year: byYear(audits.filter((x) => x.area_id === a.id)) };
      }),
      unassigned: byYear(audits.filter((x) => !x.area_id)),
      covered: areas.filter((a) => audits.some((x) => x.area_id === a.id && x.status === 'closed' && Number(x.year) >= years[0] && Number(x.year) <= thisYear)).length,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/coverage', tag: 'Audits', permission: 'audits.view',
    summary: 'Coverage of the audit universe: each active area with its cycle, last and next audit, and its audits in each of the last years and next year',
    description: 'Restricted audits the caller may not see appear as "Restricted audit" with their status only.',
    query: { years: 'Years back, including this one (1 to 10, default 3)' },
    response: '{ today, years: number[], areas: [{ id, name, category, cycle_months, last_audited_on, next_due_on, risk_level, owner_name, state: "overdue" | "due_soon" | "ok" | "never", audited_in_period, by_year: { [year]: [{ id, ref, title, status, restricted }] } }], unassigned: { [year]: [...] }, covered }',
  });

  app.get('/api/audits/summary', view, async (req) => {
    const today = dayInZone();
    const year = Number(today.slice(0, 4));
    const since90 = addDays(today, -90);
    const one = async (sql: string, params: unknown[] = []) => Number((await db.one<Row>(sql, params))?.n ?? 0);
    const group = async (list: string, sql: string, params: unknown[] = []) => {
      const counts = await db.query<Row>(sql, params);
      return (await ctx.lookups.values(list)).map((v) => ({ value: v.value, label: v.label, color: v.color ?? 'gray', count: Number(counts.find((c) => c.k === v.value)?.n ?? 0) }));
    };
    const findingClosed = (await ctx.lookups.values('finding_status')).filter((v) => v.meta?.closed === true).map((v) => v.value);
    const closed = findingClosed.length ? findingClosed : ['closed'];

    const months = Array.from({ length: 6 }, (_, i) => addMonths(`${today.slice(0, 7)}-01`, i - 5));
    const byMonth = await db.query<Row>(
      `select to_char(due_on, 'YYYY-MM') as period,
              count(*) filter (where status = 'complete')::int as complete,
              count(*) filter (where status = 'complete' and performed_on <= due_on)::int as on_time,
              count(*) filter (where status = 'missed')::int as missed,
              count(*) filter (where result = 'fail')::int as failed,
              count(*) filter (where status = 'complete' or due_on < $2::date)::int as due
       from inspections where deleted_at is null and due_on >= $1::date and due_on <= $2::date group by 1`, [months[0], today]);
    const ninety = await db.one<Row>(
      `select count(*) filter (where status = 'complete')::int as complete,
              count(*) filter (where status = 'complete' and performed_on <= due_on)::int as on_time,
              count(*) filter (where status = 'complete' or due_on < $2::date)::int as due,
              count(*) filter (where status = 'missed')::int as missed,
              count(*) filter (where result = 'fail')::int as failed
       from inspections where deleted_at is null and due_on >= $1::date and due_on <= $2::date`, [since90, today]);

    const upcoming = await db.query<Row>(
      `select i.id, i.ref, i.title, i.due_on, i.status, i.target_label, u.display_name as inspector_name
       from inspections i left join users u on u.id = i.inspector_id
       where i.deleted_at is null and i.status in ('scheduled', 'in_progress') and ${ctx.resources.visibleWhere('inspection', req.user, 'i')}
       order by i.due_on nulls last, i.ref limit 8`);
    const planned = await db.query<Row>(
      `select a.id, a.ref, a.title, a.status, a.planned_start, a.audit_type from audits a
       where a.deleted_at is null and a.status in ('planned', 'fieldwork', 'reporting') and ${ctx.resources.visibleWhere('audit_engagement', req.user, 'a')}
       order by a.planned_start nulls last, a.ref limit 8`);

    return {
      today, year,
      audits: {
        planned_this_year: await one(`select count(*)::int as n from audits where deleted_at is null and coalesce(plan_year, extract(year from planned_start)::int) = $1 and coalesce(status, '') <> 'canceled'`, [year]),
        open: await one(`select count(*)::int as n from audits where deleted_at is null and status in ('fieldwork', 'reporting')`),
        closed_this_year: await one(`select count(*)::int as n from audits where deleted_at is null and status = 'closed' and closed_on >= $1::date`, [`${year}-01-01`]),
        by_status: await group('audit_status', `select status as k, count(*)::int as n from audits where deleted_at is null group by status`),
      },
      areas: {
        total: await one(`select count(*)::int as n from audit_areas where deleted_at is null and active`),
        overdue: await one(`select count(*)::int as n from audit_areas where deleted_at is null and active and next_due_on < $1::date`, [today]),
        due_soon: await one(`select count(*)::int as n from audit_areas where deleted_at is null and active and next_due_on >= $1::date and next_due_on <= $2::date`, [today, addDays(today, DUE_SOON_DAYS)]),
        never: await one(`select count(*)::int as n from audit_areas where deleted_at is null and active and last_audited_on is null`),
      },
      findings: {
        open: await one(`select count(*)::int as n from audit_findings where deleted_at is null and not (coalesce(status, '') = any($1::text[]))`, [closed]),
        overdue: await one(
          `select count(*)::int as n from audit_findings where deleted_at is null and not (coalesce(status, '') = any($1::text[]))
             and response_due < $2::date and responded_on is null`, [closed, today]),
        by_rating: await group('finding_rating',
          `select rating as k, count(*)::int as n from audit_findings where deleted_at is null and not (coalesce(status, '') = any($1::text[])) group by rating`, [closed]),
      },
      inspections: {
        due_next_30: await one(`select count(*)::int as n from inspections where deleted_at is null and status in ('scheduled', 'in_progress') and due_on >= $1::date and due_on <= $2::date`, [today, addDays(today, 30)]),
        overdue: await one(`select count(*)::int as n from inspections where deleted_at is null and status in ('scheduled', 'in_progress') and due_on < $1::date`, [today]),
        last_90: {
          complete: Number(ninety?.complete ?? 0), missed: Number(ninety?.missed ?? 0), failed: Number(ninety?.failed ?? 0),
          on_time_pct: Number(ninety?.due) ? Math.round((Number(ninety!.on_time) / Number(ninety!.due)) * 1000) / 10 : null,
        },
        by_month: months.map((m) => {
          const r = byMonth.find((x) => x.period === m.slice(0, 7));
          return { period: m.slice(0, 7), complete: r?.complete ?? 0, on_time: r?.on_time ?? 0, missed: r?.missed ?? 0, failed: r?.failed ?? 0, due: r?.due ?? 0 };
        }),
        missed_after_days: MISSED_AFTER_DAYS,
      },
      requests: {
        open: await one(`select count(*)::int as n from audit_requests where deleted_at is null and status in ('requested', 'returned')`),
        overdue: await one(`select count(*)::int as n from audit_requests where deleted_at is null and status in ('requested', 'returned') and due_on < $1::date`, [today]),
      },
      upcoming_inspections: upcoming,
      active_audits: planned,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/summary', tag: 'Audits', permission: 'audits.view',
    summary: 'Dashboard figures: audits by status, the audit universe due and overdue, open and overdue findings by rating, inspections due, overdue, on time, missed and failed, evidence requests open and overdue',
    description: 'Counts include every record (figures are the same for everyone); the lists of upcoming inspections and active audits show only what the caller may see.',
    response: '{ today, year, audits, areas, findings, inspections: { due_next_30, overdue, last_90, by_month, missed_after_days }, requests, upcoming_inspections, active_audits }',
  });
}
