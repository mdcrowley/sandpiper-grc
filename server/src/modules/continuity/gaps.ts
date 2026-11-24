// The gap report (E31-05), the continuity summary (contract C5), its metrics (C6) and calendar
// sources (C3).
//
// Gap rule: an active process has a gap when its maximum tolerable downtime is shorter than the
// largest recovery time objective of the systems it critically depends on, directly or through a
// critical service (fleet services, when that part is on). Its own recovery time target below a
// system's recovery time is a target gap. A critical system with no recovery time is "not known".
// Dependencies of a switched-off type are left out.
import { defineCalendarSource } from '../../core/calendar.ts';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays, EXERCISED_BY, ymd } from './shared.ts';

export interface GapSystem {
  id: string; name: string | null; hidden: boolean; rto_hours: number | null; via: { id: string; label: string | null } | null;
  exceeds_mtd: boolean; exceeds_target: boolean;
}
export interface GapRow {
  id: string; ref: string; name: string; criticality: string | null; owner_id: string | null;
  mtd_hours: number | null; rto_target_hours: number | null;
  gap: boolean; target_gap: boolean; unknown: number; worst_rto: number | null; systems: GapSystem[];
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Every active process with what its critical systems need. `user` null: the figure (every process,
 * every system named); otherwise the list a person may see, with systems they may not see unnamed.
 */
export async function gapAnalysis(ctx: ModuleContext, user: SessionUser | null): Promise<GapRow[]> {
  const { db } = ctx;
  const processes = await db.query<Row>(
    `select p.id, p.ref, p.name, p.criticality, p.owner_id, p.mtd_hours, p.rto_target_hours from business_processes p
     where p.deleted_at is null and p.status = 'active' ${user ? `and ${ctx.resources.visibleWhere('business_process', user, 'p')}` : ''}
     order by p.name`);
  if (!processes.length) return [];
  const ids = processes.map((p) => p.id);
  const sysVisible = user ? ctx.resources.visibleWhere('system', user, 'y') : 'true';
  const direct = await db.query<Row>(
    `select d.process_id, y.id::text as id, y.name, y.rto_hours, (${sysVisible}) as visible, null::text as via_id, null::text as via_label
     from process_dependencies d join systems y on y.id = d.dep_id and y.deleted_at is null
     where d.process_id = any($1::uuid[]) and d.dep_type = 'system' and d.critical`, [ids]);
  let viaService: Row[] = [];
  if (ctx.resources.get('service')) {
    const svcVisible = user ? ctx.resources.visibleWhere('service', user, 's') : 'true';
    viaService = await db.query<Row>(
      `select d.process_id, y.id::text as id, y.name, y.rto_hours, (${sysVisible}) as visible,
              s.id::text as via_id, case when ${svcVisible} then s.route_code || ' ' || s.name end as via_label
       from process_dependencies d join services s on s.id = d.dep_id and s.deleted_at is null
       join service_systems ss on ss.service_id = s.id
       join systems y on y.id = ss.system_id and y.deleted_at is null
       where d.process_id = any($1::uuid[]) and d.dep_type = 'service' and d.critical`, [ids]);
  }
  const out: GapRow[] = [];
  for (const p of processes) {
    const mtd = num(p.mtd_hours);
    const target = num(p.rto_target_hours);
    const seen = new Set<string>();
    const systems: GapSystem[] = [];
    // A system reached directly is shown once, before the same system reached through a service.
    for (const s of [...direct, ...viaService].filter((r) => r.process_id === p.id)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const rto = num(s.rto_hours);
      systems.push({
        id: s.id, name: s.visible ? s.name : null, hidden: !s.visible, rto_hours: rto,
        via: s.via_id ? { id: s.via_id, label: s.via_label ?? null } : null,
        exceeds_mtd: rto !== null && mtd !== null && rto > mtd,
        exceeds_target: rto !== null && target !== null && rto > target,
      });
    }
    const known = systems.map((s) => s.rto_hours).filter((v): v is number => v !== null);
    const worst = known.length ? Math.max(...known) : null;
    out.push({
      id: p.id, ref: p.ref, name: p.name, criticality: p.criticality, owner_id: p.owner_id, mtd_hours: mtd, rto_target_hours: target,
      gap: systems.some((s) => s.exceeds_mtd), target_gap: systems.some((s) => s.exceeds_target),
      unknown: systems.filter((s) => s.rto_hours === null).length, worst_rto: worst,
      systems: systems.sort((a, b) => (b.rto_hours ?? -1) - (a.rto_hours ?? -1)),
    });
  }
  return out;
}

/** Plans whose review date has passed on `day` (approved or in review; drafts and retired plans have no cycle yet). */
async function plansReviewOverdue(ctx: ModuleContext, day: string): Promise<number> {
  return (await ctx.db.one<{ n: number }>(
    `select count(*)::int as n from continuity_plans where deleted_at is null and status in ('approved', 'in_review') and next_review_on < $1::date`, [day]))!.n;
}

export function registerGaps(ctx: ModuleContext) {
  const { app, db } = ctx;

  app.get('/api/continuity/gaps', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    // Gaps first, then target gaps, then unknown recovery times.
    const rank = (r: GapRow) => (r.gap ? 0 : r.target_gap ? 1 : r.unknown ? 2 : 3);
    const rows = (await gapAnalysis(ctx, req.user)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const q = req.query as { all?: string };
    return {
      services_included: Boolean(ctx.resources.get('service')),
      rows: q.all === '1' ? rows : rows.filter((r) => r.gap || r.target_gap || r.unknown > 0),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity/gaps', tag: 'Continuity', permission: 'continuity.view',
    summary: 'Active business processes whose tolerable downtime or recovery target is shorter than the recovery time of a system they critically depend on, or that depend on a system with no recovery time',
    description: 'Systems reached through a critical service are included while fleet services are on. A system the caller may not see is listed without its name.',
    query: { all: '1: every active process, with or without a gap' },
    response: '{ services_included, rows: [{ id, ref, name, criticality, owner_id, mtd_hours, rto_target_hours, gap, target_gap, unknown, worst_rto, systems: [{ id, name, hidden, rto_hours, via: { id, label } | null, exceeds_mtd, exceeds_target }] }] }',
  });

  app.get('/api/continuity/summary', { preHandler: ctx.requirePerm('continuity.view') }, async () => {
    // Figures: every record counts, whoever asks.
    const processes = (await db.one<{ n: number }>(`select count(*)::int as n from business_processes where deleted_at is null and status = 'active'`))!.n;
    const gaps = await gapAnalysis(ctx, null);
    const plans = (await db.one<Row>(
      `select count(*)::int as total, count(*) filter (where status not in ('approved', 'retired'))::int as unapproved
       from continuity_plans where deleted_at is null and status <> 'retired'`))!;
    const active = (await db.one<{ n: number }>(`select count(*)::int as n from emergency_activations where deleted_at is null and status = 'active'`))!.n;
    const byCriticality = await db.query<Row>(
      `select criticality as value, count(*)::int as count from business_processes where deleted_at is null and status = 'active' group by criticality`);
    return {
      processes, with_gap: gaps.filter((g) => g.gap).length,
      plans: { total: plans.total, review_overdue: await plansReviewOverdue(ctx, dayInZone()), unapproved: plans.unapproved },
      activations: { active },
      by_criticality: byCriticality,
      with_target_gap: gaps.filter((g) => g.target_gap).length,
      with_unknown: gaps.filter((g) => g.unknown > 0).length,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity/summary', tag: 'Continuity', permission: 'continuity.view',
    summary: 'Continuity figures (the same for everyone; no names): processes, gaps, plans and active activations',
    response: '{ processes, with_gap, plans: { total, review_overdue, unapproved }, activations: { active }, by_criticality: [{ value, count }], with_target_gap, with_unknown }',
  });

  app.get('/api/continuity/dashboard', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    const today = dayInZone();
    const plansDue = await db.query<Row>(
      `select id, ref, title, status, next_review_on::text as next_review_on from continuity_plans p
       where deleted_at is null and status <> 'retired' and next_review_on is not null and next_review_on <= $1::date
         and ${ctx.resources.visibleWhere('continuity_plan', req.user, 'p')}
       order by next_review_on limit 20`, [addDays(today, 60)]);
    const activations = await db.query<Row>(
      `select id, ref, title, event_type, level, status, declared_at from emergency_activations a
       where deleted_at is null and status in ('active', 'stood_down') and ${ctx.resources.visibleWhere('emergency_activation', req.user, 'a')}
       order by declared_at desc limit 20`);
    const biaDue = await db.query<Row>(
      `select id, ref, name, next_bia_due::text as next_bia_due from business_processes p
       where deleted_at is null and status = 'active' and next_bia_due is not null and next_bia_due <= $1::date
         and ${ctx.resources.visibleWhere('business_process', req.user, 'p')}
       order by next_bia_due limit 20`, [addDays(today, 60)]);
    return { today, plans_due: plansDue, activations, bia_due: biaDue };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity/dashboard', tag: 'Continuity', permission: 'continuity.view',
    summary: 'The lists on the continuity dashboard: plan reviews and impact analyses due within 60 days, and activations not yet closed',
    response: '{ today, plans_due: [{ id, ref, title, status, next_review_on }], activations: [{ id, ref, title, event_type, level, status, declared_at }], bia_due: [{ id, ref, name, next_bia_due }] }',
  });

  // ---------- metrics (C6) ----------

  defineMetric(app, {
    key: 'continuity.processes_with_gap', label: 'Business processes with a recovery gap', unit: 'count', recordType: 'business_process',
    description: 'Active business processes whose maximum tolerable downtime is shorter than the recovery time of a system they critically depend on. Worked out from the records as they are now, so only the current month has a figure.',
    async compute(c, monthStart) {
      const now = dayInZone();
      if (monthStart.slice(0, 7) !== now.slice(0, 7)) return null;
      return (await gapAnalysis(c, null)).filter((g) => g.gap).length;
    },
  });
  defineMetric(app, {
    key: 'continuity.plans_review_overdue', label: 'Continuity plans overdue for review', unit: 'count', recordType: 'continuity_plan',
    description: 'Approved or in-review continuity plans whose next review date had passed at the end of the month (today, for the month still running).',
    async compute(c, monthStart) {
      const today = dayInZone();
      const next = new Date(`${monthStart}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const end = addDays(next.toISOString().slice(0, 10), -1);
      return plansReviewOverdue(c, end < today ? end : today);
    },
  });

  // ---------- calendar sources (C3) ----------

  defineCalendarSource(app, {
    key: 'continuity.reviews', label: 'Continuity plan reviews and impact analyses due (mine)', recordType: 'continuity_plan', permission: 'continuity.view',
    work: true, kind: 'Plan reviews', // E41-03: My work
    async events(c, user, from, to) {
      const plans = await c.db.query<Row>(
        `select id, ref, title, next_review_on::text as d from continuity_plans p
         where deleted_at is null and status <> 'retired' and owner_id = $1 and next_review_on between $2::date and $3::date
           and ${c.resources.visibleWhere('continuity_plan', user, 'p')}`, [user.id, from, to]);
      const processes = c.resources.get('business_process') ? await c.db.query<Row>(
        `select id, ref, name, next_bia_due::text as d from business_processes p
         where deleted_at is null and status = 'active' and owner_id = $1 and next_bia_due between $2::date and $3::date
           and ${c.resources.visibleWhere('business_process', user, 'p')}`, [user.id, from, to]) : [];
      return [
        ...plans.map((p) => ({
          uid: `continuity.reviews:plan:${p.id}:${p.d}`, title: `Plan review due: ${p.ref} ${p.title}`, start: ymd(p.d)!, allDay: true,
          url: `/continuity/plans/${p.id}`, recordType: 'continuity_plan', recordId: p.id,
        })),
        ...processes.map((p) => ({
          uid: `continuity.reviews:bia:${p.id}:${p.d}`, title: `Impact analysis due: ${p.ref} ${p.name}`, start: ymd(p.d)!, allDay: true,
          url: `/continuity/processes/${p.id}`, recordType: 'business_process', recordId: p.id,
        })),
      ];
    },
  });
  defineCalendarSource(app, {
    key: 'continuity.exercises', label: 'Exercises of continuity plans I own', recordType: 'exercise', permission: 'continuity.view', kind: 'Continuity exercises',
    async events(c, user, from, to) {
      if (!c.can(user, 'exercises.view') || !c.resources.get('exercise')) return [];
      const rows = await c.db.query<Row>(
        `select distinct e.id, e.ref, e.title, e.exercise_date::text as d from record_links l
         join continuity_plans p on p.id = l.from_id and p.deleted_at is null and p.owner_id = $1
         join exercises e on e.id = l.to_id and e.deleted_at is null
         where l.from_type = 'continuity_plan' and l.to_type = 'exercise' and l.relation = $2
           and e.exercise_date between $3::date and $4::date
           and ${c.resources.visibleWhere('continuity_plan', user, 'p')} and ${c.resources.visibleWhere('exercise', user, 'e')}`,
        [user.id, EXERCISED_BY, from, to]);
      return rows.map((e) => ({
        uid: `continuity.exercises:${e.id}`, title: `Exercise: ${e.ref ?? ''} ${e.title}`.replace(/\s+/g, ' '), start: ymd(e.d)!, allDay: true,
        url: `/exercises/${e.id}`, recordType: 'exercise', recordId: e.id,
      }));
    },
  });
}
