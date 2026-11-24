import type { ModuleContext, Row } from '../../core/module.ts';
import { defineCalendarSource, type CalendarEvent } from '../../core/calendar.ts';
import { defineMetric } from '../../core/metrics.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addMonths, excludedSql, isTarget, loadedTargets, meanings, members, type Member, routeOf, type TargetType, TARGETS, yearsBetween } from './service.ts';
import { targetsFor } from './targets.ts';

/**
 * The state-of-good-repair figures (E32-04): by class, how many records count, how many are past
 * their useful life against the year's target, how many are in poor condition, and their average
 * age. Figures are the same for everyone (docs/security.md): they count every record of the types
 * that are loaded and switched on, and name none. The aging list is a list: it keeps visibility.
 */

export const EVERY_SETTING = 'condition.assessment_every_months';
export const DEFAULT_EVERY_MONTHS = 24;

interface ClassRow { id: string; ref: string; name: string; category: string | null; applies_to: TargetType; poor_rating_at: number; assessment_every_months: number | null; owner_id: string | null; active: boolean }

/** The classes of the kinds of record that are loaded and switched on (no vehicle classes while fleet is off: E18-64). */
export async function classes(ctx: ModuleContext, activeOnly = true): Promise<ClassRow[]> {
  return ctx.db.query<ClassRow>(
    `select id, ref, name, category, applies_to, poor_rating_at, assessment_every_months, owner_id, active from asset_classes
     where deleted_at is null ${activeOnly ? 'and active' : ''} and applies_to = any($1::text[]) order by lower(name)`, [loadedTargets(ctx)]);
}

/** The number behind each rating (`meta.score`, else the value itself). */
export async function scores(ctx: ModuleContext): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const v of await ctx.lookups.values('condition_rating')) {
    const n = Number(v.meta?.score ?? v.value);
    if (Number.isFinite(n)) out.set(v.value, n);
  }
  return out;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** The day a year's figure is taken on: today for this year, the year's last day for the others. */
export function cutoffOfYear(year: number): string {
  const today = dayInZone();
  return year === Number(today.slice(0, 4)) ? today : `${year}-12-31`;
}

export interface ClassFigures {
  id: string; ref: string; name: string; category: string | null; applies_to: TargetType;
  total: number; past_ulb: number; past_ulb_pct: number | null; target_pct: number | null; target_status: string | null; over_target: boolean;
  rated: number; poor: number; poor_pct: number | null; unrated: number; average_age: number | null; no_life: number;
  with_replacement: number; funded: number | null;
}

function figuresOf(cls: ClassRow, mem: Member[], cutoff: string, score: Map<string, number>): Omit<ClassFigures, 'target_pct' | 'target_status' | 'over_target' | 'funded'> {
  const live = mem.filter((m) => m.class_id === cls.id && !m.excluded);
  const past = live.filter((m) => m.useful_life_end && m.useful_life_end < cutoff);
  const rated = live.filter((m) => m.condition_rating && score.has(m.condition_rating));
  const poor = rated.filter((m) => score.get(m.condition_rating!)! <= Number(cls.poor_rating_at ?? 2));
  const ages = live.filter((m) => m.base && m.base <= cutoff).map((m) => yearsBetween(m.base!, cutoff));
  return {
    id: cls.id, ref: cls.ref, name: cls.name, category: cls.category, applies_to: cls.applies_to,
    total: live.length, past_ulb: past.length, past_ulb_pct: pct(past.length, live.length),
    rated: rated.length, poor: poor.length, poor_pct: pct(poor.length, rated.length), unrated: live.length - rated.length,
    average_age: ages.length ? Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10 : null,
    no_life: live.filter((m) => !m.useful_life_end).length,
    with_replacement: past.filter((m) => m.replacement_project_id).length,
  };
}

/** Members past their useful life that are linked to a funding award (`funded_by`), when funding is on. */
async function fundedIds(ctx: ModuleContext): Promise<Set<string> | null> {
  if (!ctx.resources.get('funding_award')) return null;
  const rows = await ctx.db.query<{ id: string }>(
    `select distinct l.from_id::text as id from record_links l join funding_awards a on a.id = l.to_id and a.deleted_at is null
     where l.relation = 'funded_by' and l.to_type = 'funding_award' and l.from_type = any($1::text[])`, [loadedTargets(ctx)]);
  return new Set(rows.map((r) => r.id));
}

export async function dashboard(ctx: ModuleContext, year: number) {
  const cutoff = cutoffOfYear(year);
  const thisYear = Number(dayInZone().slice(0, 4));
  const [list, mem, score, targets, funded] = await Promise.all([classes(ctx), members(ctx), scores(ctx), targetsFor(ctx, year), fundedIds(ctx)]);
  const byClass: ClassFigures[] = list.map((c) => {
    const f = figuresOf(c, mem, cutoff, score);
    const t = targets.get(c.id);
    const past = mem.filter((m) => m.class_id === c.id && !m.excluded && m.useful_life_end && m.useful_life_end < cutoff);
    return {
      ...f, target_pct: t ? Number(t.target_pct) : null, target_status: t?.status ?? null,
      over_target: !!t && f.past_ulb_pct !== null && f.past_ulb_pct > Number(t.target_pct),
      funded: funded ? past.filter((m) => funded.has(m.id)).length : null,
    };
  });
  // The share past useful life in the five years before and after, with today's members.
  const years = Array.from({ length: 10 }, (_, i) => thisYear - 4 + i);
  const trendTargets = await Promise.all(years.map((y) => targetsFor(ctx, y)));
  const trend = years.map((y, i) => {
    const cut = cutoffOfYear(y);
    const live = mem.filter((m) => !m.excluded && list.some((c) => c.id === m.class_id));
    return {
      year: y, projected: y > thisYear,
      past_ulb_pct: pct(live.filter((m) => m.useful_life_end && m.useful_life_end < cut).length, live.length),
      classes: Object.fromEntries(list.map((c) => {
        const mine = live.filter((m) => m.class_id === c.id);
        const t = trendTargets[i].get(c.id);
        return [c.id, { pct: pct(mine.filter((m) => m.useful_life_end && m.useful_life_end < cut).length, mine.length), target: t ? Number(t.target_pct) : null }];
      })),
    };
  });
  const total = byClass.reduce((s, c) => s + c.total, 0);
  const past = byClass.reduce((s, c) => s + c.past_ulb, 0);
  const rated = byClass.reduce((s, c) => s + c.rated, 0);
  const poor = byClass.reduce((s, c) => s + c.poor, 0);
  const unclassed = await unclassedCounts(ctx);
  return {
    year, cutoff, today: dayInZone(), projected: year > thisYear,
    totals: {
      classes: list.length, total, past_ulb: past, past_ulb_pct: pct(past, total), rated, poor, poor_pct: pct(poor, rated),
      over_target: byClass.filter((c) => c.over_target).length, without_class: unclassed,
      with_replacement: byClass.reduce((s, c) => s + c.with_replacement, 0),
      funded: funded ? byClass.reduce((s, c) => s + (c.funded ?? 0), 0) : null,
    },
    classes: byClass, trend, funding: !!funded,
  };
}

/** Records of each loaded kind that have no class yet (in use only). A figure: counts every record. */
async function unclassedCounts(ctx: ModuleContext): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const m = await meanings(ctx);
  for (const type of loadedTargets(ctx)) {
    const r = await ctx.db.one<{ n: number }>(`select count(*)::int as n from ${TARGETS[type].table} t where t.deleted_at is null and t.asset_class_id is null and not (${excludedSql(type, m)})`);
    out[type] = r?.n ?? 0;
  }
  return out;
}

/** Overall share past useful life on a day (every class, records in use only). */
async function pastPctOn(ctx: ModuleContext, cutoff: string): Promise<number | null> {
  const list = new Set((await classes(ctx)).map((c) => c.id));
  const live = (await members(ctx)).filter((m) => !m.excluded && list.has(m.class_id));
  if (!live.length) return null;
  return pct(live.filter((m) => m.useful_life_end && m.useful_life_end < cutoff).length, live.length);
}

/** Share of rated records in poor condition on a day, from the newest assessment of each by then. */
async function poorPctOn(ctx: ModuleContext, cutoff: string): Promise<number | null> {
  const list = new Map((await classes(ctx)).map((c) => [c.id, c]));
  const live = (await members(ctx)).filter((m) => !m.excluded && list.has(m.class_id));
  if (!live.length) return null;
  const score = await scores(ctx);
  const newest = await ctx.db.query<{ target_type: string; target_id: string; rating: string }>(
    `select distinct on (target_type, target_id) target_type, target_id::text as target_id, rating from condition_assessments
     where deleted_at is null and assessed_on <= $1::date order by target_type, target_id, assessed_on desc, created_at desc`, [cutoff]);
  const rating = new Map(newest.map((r) => [`${r.target_type}:${r.target_id}`, r.rating]));
  let rated = 0;
  let poor = 0;
  for (const m of live) {
    const r = rating.get(`${m.type}:${m.id}`);
    if (!r || !score.has(r)) continue;
    rated += 1;
    if (score.get(r)! <= Number(list.get(m.class_id)!.poor_rating_at ?? 2)) poor += 1;
  }
  return pct(poor, rated);
}

function monthCutoff(monthStart: string): string {
  const end = addMonths(monthStart, 1);
  const d = new Date(`${end}T00:00:00Z`);
  d.setUTCDate(0);
  const last = d.toISOString().slice(0, 10);
  const today = dayInZone();
  return last < today ? last : today;
}

/** When a member is next due for an assessment, from its last one (null when never assessed). */
export function nextDue(m: Member, cls: { assessment_every_months: number | null } | undefined, every: number): string | null {
  if (!m.condition_assessed_on) return null;
  return addMonths(m.condition_assessed_on, Number(cls?.assessment_every_months) > 0 ? Number(cls!.assessment_every_months) : every);
}

export async function everyMonths(ctx: ModuleContext): Promise<number> {
  const raw = Math.round(Number(await ctx.settings.get<unknown>(EVERY_SETTING, DEFAULT_EVERY_MONTHS)));
  return Number.isFinite(raw) && raw >= 1 ? Math.min(240, raw) : DEFAULT_EVERY_MONTHS;
}

export function registerFigures(ctx: ModuleContext) {
  const { app } = ctx;

  app.get('/api/condition/dashboard', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const raw = (req.query as Row).year;
    const year = raw === undefined || raw === '' ? Number(dayInZone().slice(0, 4)) : Number(raw);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) ctx.fail(400, 'validation', 'Give a year from 2000 to 2100.');
    return dashboard(ctx, year);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/condition/dashboard', permission: 'assets.view',
    summary: 'State-of-good-repair figures by asset class for one year: past useful life against the target, poor condition, average age, and the trend',
    description: 'Counts every record of the loaded kinds, the same for everyone, and names none. Records retired, disposed of or no longer in use are left out. A past year is taken on its last day, this year on today, a later year is a projection with today\'s records.',
    query: { year: 'Year (default this year)' },
    response: '{ year, cutoff, today, projected, totals, classes: [{ id, ref, name, total, past_ulb, past_ulb_pct, target_pct, target_status, over_target, rated, poor, poor_pct, unrated, average_age, no_life, with_replacement, funded }], trend: [{ year, projected, past_ulb_pct, classes }], funding }',
  });

  app.get('/api/condition/summary', { preHandler: ctx.requirePerm('assets.view') }, async () => {
    const d = await dashboard(ctx, Number(dayInZone().slice(0, 4)));
    return {
      classes: d.classes.map((c) => ({ id: c.id, name: c.name, total: c.total, past_ulb: c.past_ulb, past_ulb_pct: c.past_ulb_pct, target_pct: c.target_pct })),
      poor_pct: d.totals.poor_pct,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/condition/summary', permission: 'assets.view',
    summary: 'This year\'s share past useful life by asset class against its target, and the share in poor condition (figures only)',
    response: '{ classes: [{ id, name, total, past_ulb, past_ulb_pct, target_pct }], poor_pct }',
  });

  app.get('/api/condition/aging', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const q = req.query as Row;
    const classId = typeof q.class === 'string' && /^[0-9a-f-]{36}$/i.test(q.class) ? q.class : undefined;
    const within = q.within_years === undefined || q.within_years === '' ? null : Number(q.within_years);
    if (within !== null && (!Number.isFinite(within) || within < 0 || within > 50)) ctx.fail(400, 'validation', 'Give within_years from 0 to 50.');
    const types = isTarget(q.type) ? [q.type] : undefined;
    const today = dayInZone();
    const until = within === null ? null : addMonths(today, Math.round(within * 12));
    const list = new Map((await classes(ctx, false)).map((c) => [c.id, c]));
    const every = await everyMonths(ctx);
    const rows = (await members(ctx, { classId, user: req.user, types }))
      .filter((m) => list.has(m.class_id) && (until === null || (m.useful_life_end !== null && m.useful_life_end <= until)))
      .sort((a, b) => (a.useful_life_end ?? '9999').localeCompare(b.useful_life_end ?? '9999') || a.label.localeCompare(b.label));
    const projectIds = [...new Set(rows.map((r) => r.replacement_project_id).filter(Boolean))] as string[];
    const projects = new Map<string, string>();
    if (projectIds.length && ctx.resources.get('project') && ctx.can(req.user, 'projects.view')) {
      for (const p of await ctx.db.query<Row>(
        `select id, concat_ws(' ', ref, name) as label from projects p where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere('project', req.user, 'p')}`, [projectIds])) {
        projects.set(p.id, p.label);
      }
    }
    return {
      today,
      rows: rows.slice(0, 2000).map((m) => {
        const cls = list.get(m.class_id)!;
        return {
          type: m.type, id: m.id, label: m.label, route: routeOf(m.type, m.id), class_id: m.class_id, class_name: cls.name,
          useful_life_end: m.useful_life_end, past: !!m.useful_life_end && m.useful_life_end < today,
          condition_rating: m.condition_rating, condition_assessed_on: m.condition_assessed_on,
          next_assessment_due: nextDue(m, cls, every), excluded: m.excluded,
          age_years: m.base ? yearsBetween(m.base, today) : null,
          replacement_project_id: m.replacement_project_id && projects.has(m.replacement_project_id) ? m.replacement_project_id : null,
          replacement_project: m.replacement_project_id ? projects.get(m.replacement_project_id) ?? null : null,
        };
      }),
      total: rows.length,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/condition/aging', permission: 'assets.view',
    summary: 'Records with an asset class, soonest end of useful life first: the drill-down behind the dashboard',
    description: 'A list, not a figure: only the kinds of record the caller may view (each needs the view permission of its own area) and the rows they may see. At most 2,000 rows.',
    query: { class: 'Asset class id', within_years: 'Only records whose useful life ends within this many years (past ones included)', type: 'A kind of record an asset class applies to (its applies_to values)' },
    response: '{ today, total, rows: [{ type, id, label, route, class_id, class_name, useful_life_end, past, condition_rating, condition_assessed_on, next_assessment_due, excluded, age_years, replacement_project_id, replacement_project }] }',
  });

  defineMetric(app, {
    key: 'condition.past_useful_life_pct', label: 'Share past useful life', unit: 'percent', recordType: 'asset_class',
    description: 'Records with an active asset class whose useful life had ended by the end of the month (or today, for the month still running), as a percentage of those in use.',
    compute: (c, month) => pastPctOn(c, monthCutoff(month)),
  });
  defineMetric(app, {
    key: 'condition.poor_condition_pct', label: 'Share in poor condition', unit: 'percent', recordType: 'asset_class',
    description: "Rated records with an asset class whose newest assessment by the end of the month was at or below their class's poor rating, as a percentage of those rated.",
    compute: (c, month) => poorPctOn(c, monthCutoff(month)),
  });

  defineCalendarSource(app, {
    key: 'condition.assessments_due', label: 'Condition assessments due', recordType: 'condition_assessment', permission: 'assets.view',
    work: true, kind: 'Condition assessments', // E41-03: My work
    events: async (c, user, from, to) => {
      const list = new Map((await classes(c)).map((x) => [x.id, x]));
      const every = await everyMonths(c);
      const out: CalendarEvent[] = [];
      for (const m of await members(c, { user })) {
        const cls = list.get(m.class_id);
        if (!cls || m.excluded) continue;
        if (cls.owner_id !== user.id && m.owner_id !== user.id) continue; // only what this person looks after
        const due = nextDue(m, cls, every);
        if (!due || due < from || due > to) continue;
        out.push({
          uid: `condition.assessments_due:${m.type}:${m.id}:${due}`, title: `Condition assessment due: ${m.label}`,
          start: due, allDay: true, url: routeOf(m.type, m.id), recordType: m.type, recordId: m.id,
        });
      }
      return out;
    },
  });
}
