// The risk-ranked audit plan (E45-13, wave 25): each area of the audit universe gets a risk score from
// the residual ratings of the risks linked to it, the time since its last audit, the opinion of that
// audit, and how much it has changed and how significant it is. An administrator weights the factors
// (setting `audits.plan_settings`); the plan ranks the areas and proposes the top ones, up to the
// yearly capacity, besides those due by their cycle. A plan year is saved as versions; an approved
// version records who approved it and when, and is never changed.
//
// Figures are the same for everyone: the score counts every linked risk, restricted or not, and
// shows only numbers about them (how many, the highest residual score), never their titles.
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { addMonths, isDate } from './dates.ts';
import { daysBetween } from '../../../../shared/dates.ts';

export const PLAN_SETTINGS_KEY = 'audits.plan_settings';
export const FACTORS = ['residual', 'time', 'result', 'change', 'significance'] as const;
export type Factor = (typeof FACTORS)[number];

export interface PlanSettings {
  /** Weight of each factor, a whole number from 0 to 100; only their proportions matter. */
  weights: Record<Factor, number>;
  /** Audits the team can carry out in a year: the plan proposes the highest-scoring areas up to it (null: by threshold). */
  capacity: number | null;
  /** Without a capacity, areas scoring at least this are proposed. */
  threshold: number;
  /** Cycle in months assumed for an area that has none, when working out the time since its last audit. */
  default_cycle_months: number;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  weights: { residual: 35, time: 25, result: 20, change: 10, significance: 10 },
  capacity: 6, threshold: 60, default_cycle_months: 36,
};

export const FACTOR_LABELS: Record<Factor, string> = {
  residual: 'Residual risk of linked risks', time: 'Time since the last audit', result: 'Result of the last audit',
  change: 'Change in the area', significance: 'Significance',
};

/** The stored settings, with every missing or bad value taken from the defaults. */
export function cleanSettings(raw: unknown): PlanSettings {
  const v = raw && typeof raw === 'object' ? raw as Row : {};
  const w = v.weights && typeof v.weights === 'object' ? v.weights as Row : {};
  const weights = Object.fromEntries(FACTORS.map((f) => {
    const n = Number(w[f]);
    return [f, Number.isInteger(n) && n >= 0 && n <= 100 ? n : DEFAULT_PLAN_SETTINGS.weights[f]];
  })) as Record<Factor, number>;
  if (FACTORS.every((f) => weights[f] === 0)) Object.assign(weights, DEFAULT_PLAN_SETTINGS.weights);
  const cap = v.capacity === null ? null : Number(v.capacity);
  const threshold = Number(v.threshold);
  const cycle = Number(v.default_cycle_months);
  return {
    weights,
    capacity: cap === null ? null : Number.isInteger(cap) && cap >= 0 && cap <= 500 ? cap : DEFAULT_PLAN_SETTINGS.capacity,
    threshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 100 ? threshold : DEFAULT_PLAN_SETTINGS.threshold,
    default_cycle_months: Number.isInteger(cycle) && cycle >= 1 && cycle <= 120 ? cycle : DEFAULT_PLAN_SETTINGS.default_cycle_months,
  };
}

/** What each factor is for one area, from 0 (lowest risk) to 1 (highest). */
export interface AreaFactors { residual: number; time: number; result: number; change: number; significance: number }

/** The weighted score, 0 to 100 with one decimal. */
export function scoreOf(f: AreaFactors, weights: Record<Factor, number>): number {
  const total = FACTORS.reduce((t, k) => t + weights[k], 0);
  if (!total) return 0;
  const sum = FACTORS.reduce((t, k) => t + weights[k] * Math.min(1, Math.max(0, f[k])), 0);
  return Math.round((sum / total) * 1000) / 10;
}

/** Built-in factor of a list value, used when the value has no `meta.factor` of its own. */
const DEFAULT_FACTOR: Record<string, number> = {
  high: 1, medium: 0.6, low: 0.3, none: 0, ineffective: 1, needs_improvement: 0.6, effective: 0.2,
};
export function factorOfValue(values: LookupValue[], value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const v = values.find((x) => x.value === value);
  const m = Number(v?.meta?.factor);
  if (Number.isFinite(m)) return Math.min(1, Math.max(0, m));
  return DEFAULT_FACTOR[String(value)] ?? fallback;
}

/** Time since the last audit as a share of its cycle (never audited counts as fully due). */
export function timeFactor(lastAudited: string | null, cycleMonths: number | null, today: string, defaultCycle: number): number {
  if (!lastAudited) return 1;
  const cycle = cycleMonths && cycleMonths > 0 ? cycleMonths : defaultCycle;
  const days = daysBetween(lastAudited.slice(0, 10), today);
  const cycleDays = Math.max(1, daysBetween(lastAudited.slice(0, 10), addMonths(lastAudited.slice(0, 10), cycle)));
  return Math.min(1, Math.max(0, days / cycleDays));
}

export interface RankedArea {
  id: string; name: string; category: string | null; risk_level: string | null; significance: string | null; change_level: string | null;
  cycle_months: number | null; last_audited_on: string | null; next_due_on: string | null; owner_name: string | null;
  factors: AreaFactors; score: number; rank: number;
  linked_risks: number; highest_residual: { score: number; max: number } | null;
  last_opinion: string | null; due_by_cycle: boolean; never_audited: boolean; proposed: boolean; reasons: string[];
}

const day = (v: unknown) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);

/** Ranks every active area for the plan of `year` (the default is next year from the fourth quarter on, else this year). */
export async function rankAreas(ctx: ModuleContext, year: number, settings?: PlanSettings): Promise<{ settings: PlanSettings; areas: RankedArea[] }> {
  const { db } = ctx;
  const s = settings ?? cleanSettings(await ctx.settings.get<unknown>(PLAN_SETTINGS_KEY, DEFAULT_PLAN_SETTINGS));
  const today = dayInZone();
  const yearEnd = `${year}-12-31`;
  const areas = await db.query<Row>(
    `select a.id, a.name, a.category, a.risk_level, a.significance, a.change_level, a.cycle_months, a.last_audited_on::text as last_audited_on,
            a.next_due_on::text as next_due_on, u.display_name as owner_name
     from audit_areas a left join users u on u.id = a.owner_id
     where a.deleted_at is null and a.active order by a.name, a.id limit 2000`);
  const ids = areas.map((a) => a.id);
  // Linked risks, either direction of a record link (any relation), with each risk's residual score
  // as a share of the largest its scale gives. Closed risks are left out.
  const risks = new Map<string, { n: number; best: { score: number; max: number } | null; share: number }>();
  if (ctx.resources.get('risk') && ids.length) {
    const closed = (await ctx.lookups.values('risk_status')).filter((v) => v.meta?.closed === true).map((v) => v.value);
    const rows = await db.query<Row>(
      `with l as (
         select from_id as area_id, to_id as risk_id from record_links where from_type = 'audit_area' and to_type = 'risk' and from_id = any($1::uuid[])
         union select to_id, from_id from record_links where to_type = 'audit_area' and from_type = 'risk' and to_id = any($1::uuid[]))
       select l.area_id,
              coalesce(r.residual_likelihood, r.inherent_likelihood) * coalesce(r.residual_impact, r.inherent_impact) as li,
              (select max((x->>'value')::numeric) from jsonb_array_elements(s.likelihood_levels) x)
                * (select max((x->>'value')::numeric) from jsonb_array_elements(s.impact_levels) x) as max_score
       from l join risks r on r.id = l.risk_id and r.deleted_at is null and not (coalesce(r.status, '') = any($2::text[]))
       left join risk_scales s on s.key = r.scale_key`, [ids, closed]);
    for (const r of rows) {
      const cur = risks.get(r.area_id) ?? { n: 0, best: null, share: -1 };
      cur.n += 1;
      // Residual likelihood times impact (inherent where no residual is given), against the largest the scale allows.
      const score = r.li === null ? NaN : Number(r.li);
      const max = Number(r.max_score);
      if (Number.isFinite(score) && Number.isFinite(max) && max > 0 && score / max > cur.share) {
        cur.share = score / max;
        cur.best = { score, max };
      }
      risks.set(r.area_id, cur);
    }
  }
  // The opinion of each area's newest closed audit.
  const opinions = new Map<string, string | null>();
  if (ids.length) {
    for (const r of await db.query<Row>(
      `select distinct on (area_id) area_id, opinion from audits
       where deleted_at is null and status = 'closed' and area_id = any($1::uuid[])
       order by area_id, coalesce(fieldwork_end, closed_on) desc nulls last, created_at desc`, [ids])) opinions.set(r.area_id, r.opinion ?? null);
  }
  const [levels, significance, change, opinionList] = await Promise.all([
    ctx.lookups.values('audit_risk_level'), ctx.lookups.values('audit_significance'),
    ctx.lookups.values('audit_change_level'), ctx.lookups.values('audit_opinion'),
  ]);
  const ranked: RankedArea[] = areas.map((a) => {
    const linked = risks.get(a.id);
    const last = day(a.last_audited_on);
    const factors: AreaFactors = {
      residual: linked && linked.share >= 0 ? Math.min(1, linked.share) : factorOfValue(levels, a.risk_level, 0.5),
      time: timeFactor(last, a.cycle_months === null ? null : Number(a.cycle_months), today, s.default_cycle_months),
      result: factorOfValue(opinionList, opinions.get(a.id) ?? null, 0.5),
      change: factorOfValue(change, a.change_level, 0),
      significance: factorOfValue(significance, a.significance, 0.5),
    };
    const next = day(a.next_due_on);
    return {
      id: a.id, name: a.name, category: a.category ?? null, risk_level: a.risk_level ?? null, significance: a.significance ?? null,
      change_level: a.change_level ?? null, cycle_months: a.cycle_months === null ? null : Number(a.cycle_months),
      last_audited_on: last, next_due_on: next, owner_name: a.owner_name ?? null,
      factors, score: scoreOf(factors, s.weights), rank: 0,
      linked_risks: linked?.n ?? 0, highest_residual: linked?.best ?? null, last_opinion: opinions.get(a.id) ?? null,
      due_by_cycle: !last || (next !== null && next <= yearEnd), never_audited: !last, proposed: false, reasons: [],
    };
  });
  ranked.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  ranked.forEach((r, i) => {
    r.rank = i + 1;
    r.proposed = s.capacity === null ? r.score >= s.threshold : r.rank <= s.capacity;
    if (r.proposed) r.reasons.push(s.capacity === null ? `Scores ${r.score}, at or above ${s.threshold}` : `Ranked ${r.rank} of ${ranked.length} by risk`);
    if (r.never_audited) r.reasons.push('Never audited');
    else if (r.due_by_cycle && r.next_due_on) r.reasons.push(`Due by its cycle on ${displayDate(r.next_due_on)}`);
  });
  return { settings: s, areas: ranked };
}

/** Stores each area's score, so the universe list can sort by it. Returns how many changed. */
export async function refreshScores(ctx: ModuleContext): Promise<number> {
  const year = Number(dayInZone().slice(0, 4));
  const { areas } = await rankAreas(ctx, year);
  let changed = 0;
  for (const a of areas) {
    const r = await ctx.db.query<Row>(
      `update audit_areas set risk_score = $2, risk_scored_at = now() where id = $1 and risk_score is distinct from $2::numeric returning id`, [a.id, a.score]);
    changed += r.length;
  }
  return changed;
}

export async function registerPlan(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const yearOf = (q: unknown): number => {
    const n = Number(q);
    if (q !== undefined && q !== '' && (!Number.isInteger(n) || n < 2000 || n > 2100)) invalid({ year: 'Give a year such as 2027.' });
    if (Number.isInteger(n) && n >= 2000) return n;
    const today = dayInZone();
    return Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 10 ? 1 : 0);
  };

  const planRow = (p: Row) => ({
    id: p.id, plan_year: p.plan_year, version: p.version, status: p.status, note: p.note ?? null,
    entries: p.entries ?? [], settings: p.settings ?? {},
    prepared_by_name: p.prepared_by_name ?? null, prepared_at: p.prepared_at,
    approved_by_name: p.approved_by_name ?? null, approved_on: day(p.approved_on), approval_note: p.approval_note ?? null,
    included: Array.isArray(p.entries) ? p.entries.filter((e: Row) => e.included).length : 0,
  });

  // ---------- settings ----------
  app.get('/api/audits/plan/settings', { preHandler: ctx.requirePerm('audits.view') }, async (req) => ({
    settings: cleanSettings(await ctx.settings.get<unknown>(PLAN_SETTINGS_KEY, DEFAULT_PLAN_SETTINGS)),
    defaults: DEFAULT_PLAN_SETTINGS, factors: FACTORS.map((f) => ({ key: f, label: FACTOR_LABELS[f] })),
    can_change: ctx.can(req.user, 'audits.administer'),
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/plan/settings', tag: 'Audits', permission: 'audits.view',
    summary: 'How the audit plan scores areas: the weight of each risk factor, the yearly capacity and the threshold',
    response: '{ settings: { weights: { residual, time, result, change, significance }, capacity, threshold, default_cycle_months }, defaults, factors: [{ key, label }], can_change }',
  });

  app.put('/api/audits/plan/settings', { preHandler: ctx.requirePerm('audits.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const w = b.weights && typeof b.weights === 'object' ? b.weights as Row : null;
    if (!w) errors.weights = 'Give a weight for each factor.';
    else {
      for (const f of FACTORS) {
        const n = Number(w[f]);
        if (!Number.isInteger(n) || n < 0 || n > 100) errors[`weights.${f}`] = 'A whole number from 0 to 100.';
      }
      if (!Object.keys(errors).length && FACTORS.every((f) => Number(w[f]) === 0)) errors.weights = 'At least one factor needs a weight.';
    }
    if (b.capacity !== null && b.capacity !== undefined && b.capacity !== '') {
      const n = Number(b.capacity);
      if (!Number.isInteger(n) || n < 0 || n > 500) errors.capacity = 'A whole number of audits from 0 to 500, or empty to propose by threshold.';
    }
    if (b.threshold !== undefined && (!Number.isFinite(Number(b.threshold)) || Number(b.threshold) < 0 || Number(b.threshold) > 100)) errors.threshold = 'A score from 0 to 100.';
    if (b.default_cycle_months !== undefined && (!Number.isInteger(Number(b.default_cycle_months)) || Number(b.default_cycle_months) < 1 || Number(b.default_cycle_months) > 120)) {
      errors.default_cycle_months = 'A whole number of months from 1 to 120.';
    }
    if (Object.keys(errors).length) invalid(errors);
    const before = cleanSettings(await ctx.settings.get<unknown>(PLAN_SETTINGS_KEY, DEFAULT_PLAN_SETTINGS));
    const next = cleanSettings({
      weights: w, capacity: b.capacity === '' || b.capacity === undefined ? before.capacity : b.capacity,
      threshold: b.threshold ?? before.threshold, default_cycle_months: b.default_cycle_months ?? before.default_cycle_months,
    });
    await ctx.settings.set(PLAN_SETTINGS_KEY, next, req);
    await ctx.audit(req, {
      action: 'audits.plan_settings', recordType: 'setting', recordId: PLAN_SETTINGS_KEY,
      summary: `Audit plan scoring changed: ${FACTORS.map((f) => `${FACTOR_LABELS[f].toLowerCase()} ${next.weights[f]}`).join(', ')}; capacity ${next.capacity ?? 'none'}`,
      before, after: next,
    });
    await refreshScores(ctx);
    return { settings: next };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/audits/plan/settings', tag: 'Audits', permission: 'audits.administer',
    summary: 'Change the weights of the audit plan\'s risk factors, the yearly capacity and the threshold; every area\'s score is worked out again',
    body: '{ weights: { residual, time, result, change, significance } (0 to 100 each), capacity?: number | null, threshold?: number, default_cycle_months?: number }',
    response: '{ settings }',
  });

  // ---------- the ranking ----------
  app.get('/api/audits/plan', { preHandler: ctx.requirePerm('audits.view') }, async (req) => {
    const year = yearOf((req.query as Row).year);
    const { settings, areas } = await rankAreas(ctx, year);
    // The audits already planned for that year, by area (restricted ones the caller may not see show as such).
    const audits = await db.query<Row>(
      `select a.id, a.ref, a.title, a.status, a.area_id, (${ctx.resources.visibleWhere('audit_engagement', req.user, 'a')}) as visible
       from audits a where a.deleted_at is null and coalesce(a.status, '') <> 'canceled' and a.area_id is not null
         and coalesce(a.plan_year, extract(year from a.planned_start)::int) = $1`, [year]);
    const versions = await db.query<Row>('select * from audit_plans where plan_year = $1 order by version desc', [year]);
    return {
      year, today: dayInZone(), settings,
      areas: areas.map((a) => ({
        ...a,
        audits: audits.filter((x) => x.area_id === a.id).map((x) => (x.visible
          ? { id: x.id, ref: x.ref, title: x.title, status: x.status }
          : { id: null, ref: null, title: 'Restricted audit', status: x.status })),
      })),
      proposed: areas.filter((a) => a.proposed).length,
      versions: versions.map(planRow),
      can_save: ctx.can(req.user, 'audits.edit'), can_approve: ctx.can(req.user, 'audits.approve'), can_administer: ctx.can(req.user, 'audits.administer'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/plan', tag: 'Audits', permission: 'audits.view',
    summary: 'The audit universe ranked by risk score for a plan year, with the areas proposed for audit and the saved versions of that year\'s plan',
    description: 'Each area\'s score (0 to 100) weights five factors from 0 to 1: the highest residual score of its linked open risks as a share of its scale (the area\'s own risk level when no risk is linked), the time since its last audit as a share of its cycle, the opinion of its last audit, its change level and its significance. Linked risks are counted whether or not the caller may see them; only figures about them are given.',
    query: { year: 'Plan year (default: this year, or next year from October)' },
    response: '{ year, today, settings, areas: [{ id, name, score, rank, factors, linked_risks, highest_residual, last_opinion, due_by_cycle, never_audited, proposed, reasons, audits }], proposed, versions, can_save, can_approve, can_administer }',
  });

  // ---------- versions ----------
  app.get('/api/audits/plans/:id', { preHandler: ctx.requirePerm('audits.view') }, async (req) => {
    const id = String((req.params as Row).id);
    const p = UUID_RE.test(id) ? await db.one<Row>('select * from audit_plans where id = $1', [id]) : undefined;
    if (!p) ctx.fail(404, 'not_found', 'Audit plan not found.');
    return planRow(p!);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/plans/:id', tag: 'Audits', permission: 'audits.view',
    summary: 'One saved version of an annual audit plan, with the ranking it was made from',
    response: '{ id, plan_year, version, status: "draft" | "approved" | "superseded", note, entries: [{ area_id, name, score, rank, proposed, included, reasons }], settings, prepared_by_name, prepared_at, approved_by_name, approved_on, approval_note, included }',
  });

  app.post('/api/audits/plans', { preHandler: ctx.requirePerm('audits.edit') }, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const year = yearOf(b.year ?? b.plan_year);
    if (b.included !== undefined && (!Array.isArray(b.included) || b.included.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x)))) {
      invalid({ included: 'The areas included are a list of audit areas.' });
    }
    const { settings, areas } = await rankAreas(ctx, year);
    const chosen = Array.isArray(b.included) ? new Set(b.included as string[]) : new Set(areas.filter((a) => a.proposed).map((a) => a.id));
    const unknown = [...chosen].filter((id) => !areas.some((a) => a.id === id));
    if (unknown.length) invalid({ included: 'An area included is not in the active audit universe.' });
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 4000) || null : null;
    const by = actorOf(req);
    const entries = areas.map((a) => ({
      area_id: a.id, name: a.name, score: a.score, rank: a.rank, proposed: a.proposed, included: chosen.has(a.id),
      reasons: a.reasons, due_by_cycle: a.due_by_cycle, factors: a.factors,
    }));
    const row = await db.tx(async (tx) => {
      const next = Number((await tx.one<Row>('select coalesce(max(version), 0) + 1 as v from audit_plans where plan_year = $1', [year]))?.v ?? 1);
      return (await tx.one<Row>(
        `insert into audit_plans (plan_year, version, status, entries, settings, note, prepared_by, prepared_by_name, created_by, updated_by)
         values ($1, $2, 'draft', $3::jsonb, $4::jsonb, $5, $6, $7, $8, $8) returning *`,
        [year, next, JSON.stringify(entries), JSON.stringify(settings), note, by.id, by.name, req.user!.id]))!;
    });
    await ctx.audit(req, {
      action: 'audits.plan_save', recordType: 'audit_plan', recordId: row.id,
      summary: `Audit plan ${year} version ${row.version} saved with ${chosen.size} of ${areas.length} areas`,
      after: { year, version: row.version, included: [...chosen] },
    });
    reply.code(201);
    return planRow(row);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/plans', tag: 'Audits', permission: 'audits.edit',
    summary: 'Save a new version of a year\'s audit plan from the current ranking, with the areas to include (default: the proposed ones)',
    body: '{ year, included?: string[] (audit area ids), note? }', response: 'the saved version (status draft)',
  });

  app.post('/api/audits/plans/:id/approve', { preHandler: ctx.requirePerm('audits.approve') }, async (req) => {
    const id = String((req.params as Row).id);
    const p = UUID_RE.test(id) ? await db.one<Row>('select * from audit_plans where id = $1', [id]) : undefined;
    if (!p) ctx.fail(404, 'not_found', 'Audit plan not found.');
    if (p!.status !== 'draft') ctx.fail(409, 'not_draft', 'Only a draft version of the plan can be approved.');
    const newest = await db.one<Row>('select max(version) as v from audit_plans where plan_year = $1', [p!.plan_year]);
    if (Number(newest?.v) !== Number(p!.version)) ctx.fail(409, 'not_latest', 'A later version of this plan has been saved; approve that one.');
    const by = actorOf(req);
    const sameAsPreparer = (by.id && p!.prepared_by && by.id === p!.prepared_by) || (!by.id && by.name && by.name === p!.prepared_by_name);
    if (sameAsPreparer) ctx.fail(403, 'not_independent', 'The plan is approved by someone other than the person who prepared it.');
    const b = (req.body ?? {}) as Row;
    let on = dayInZone();
    if (b.approved_on !== undefined && b.approved_on !== null && b.approved_on !== '') {
      if (!isDataLoad(req)) invalid({ approved_on: 'The approval date is today; another date can be given only in data load mode.' });
      if (!isDate(b.approved_on) || b.approved_on > on) invalid({ approved_on: 'Give a date, not in the future.' });
      on = b.approved_on;
    }
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 4000) || null : null;
    await db.tx(async (tx) => {
      await tx.query(`update audit_plans set status = 'superseded', updated_at = now(), updated_by = $2 where plan_year = $1 and status in ('approved', 'draft') and id <> $3`,
        [p!.plan_year, req.user!.id, p!.id]);
      await tx.query(
        `update audit_plans set status = 'approved', approved_by = $2, approved_by_name = $3, approved_on = $4, approval_note = $5, updated_at = now(), updated_by = $6 where id = $1`,
        [p!.id, by.id, by.name, on, note, req.user!.id]);
    });
    await ctx.audit(req, {
      action: 'audits.plan_approve', recordType: 'audit_plan', recordId: p!.id,
      summary: `Audit plan ${p!.plan_year} version ${p!.version} approved by ${by.name ?? 'someone'} on ${displayDate(on)}`,
      after: { approved_on: on, note },
    });
    return planRow((await db.one<Row>('select * from audit_plans where id = $1', [p!.id]))!);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/plans/:id/approve', tag: 'Audits', permission: 'audits.approve',
    summary: 'Approve the newest draft version of a year\'s audit plan (someone other than its preparer); an earlier approved version is superseded',
    description: '409 `not_draft` or `not_latest`; 403 `not_independent` when the approver prepared it. In data load mode `approved_on` may give a past date and `on_behalf_of` the approver.',
    body: '{ note?, approved_on? (data load only) }', response: 'the approved version',
  });

  app.post('/api/audits/plans/:id/create-audits', { preHandler: ctx.requirePerm('audits.create') }, async (req, reply) => {
    const id = String((req.params as Row).id);
    const p = UUID_RE.test(id) ? await db.one<Row>('select * from audit_plans where id = $1', [id]) : undefined;
    if (!p) ctx.fail(404, 'not_found', 'Audit plan not found.');
    if (p!.status !== 'approved') ctx.fail(409, 'not_approved', 'Audits are created from the approved version of the plan.');
    const b = (req.body ?? {}) as Row;
    const type = typeof b.audit_type === 'string' && b.audit_type ? b.audit_type : 'internal_audit';
    const created: Row[] = [];
    for (const e of (p!.entries as Row[]).filter((x) => x.included)) {
      const area = await db.one<Row>('select id, name from audit_areas where id = $1 and deleted_at is null', [e.area_id]);
      if (!area) continue;
      const there = await db.one(
        `select 1 from audits where deleted_at is null and area_id = $1 and coalesce(status, '') <> 'canceled' and coalesce(plan_year, extract(year from planned_start)::int) = $2`,
        [area.id, p!.plan_year]);
      if (there) continue;
      const row = await ctx.resources.create('audit_engagement', {
        title: `${area.name} audit ${p!.plan_year}`.slice(0, 200), audit_type: type, area_id: area.id, plan_year: p!.plan_year, status: 'planned',
      }, req);
      created.push({ id: row.id, ref: row.ref, title: row.title });
    }
    reply.code(201);
    return { created };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/plans/:id/create-audits', tag: 'Audits', permission: 'audits.create',
    summary: 'Create a planned audit for each area in the approved plan that has no audit that year yet',
    body: '{ audit_type? (default internal_audit) }', response: '{ created: [{ id, ref, title }] }',
  });

  // Scores change with time and with linked risks: worked out again every day.
  await scheduleWork(ctx, 'audits.risk_scores', () => refreshScores(ctx), { every: 24 * 3_600_000, firstRunInMs: 120_000 });
}

/** For tests and the area hooks: one area's score, worked out now. */
export async function scoreArea(ctx: ModuleContext, areaId: string): Promise<number | null> {
  const { areas } = await rankAreas(ctx, Number(dayInZone().slice(0, 4)));
  return areas.find((a) => a.id === areaId)?.score ?? null;
}

