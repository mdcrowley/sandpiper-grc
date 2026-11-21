import type { FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import { metricsAvailable, monthStartOf } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import type { Scale, Scales } from './scales.ts';

// Enterprise risk (E30, GP-18): the risk appetite per category and the breach flag on each risk
// (E30-06), key risk indicators with amber and red thresholds (E30-07), and parent risks with a
// roll-up (E30-08). Risks are restricted records, so every route here needs `security.view` as well
// as the risks permission, and key risk indicators are a restricted type of their own.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 4000;

export interface AppetiteRow {
  category: string; statement: string | null; max_rating: string | null; max_score: number | null;
  approved_on: string | null; approved_by_name: string | null; reference: string | null;
}

/** The lists of enterprise risk. Called from risks/index.ts `seedDefaults`; must stay idempotent. */
export async function seedEnterpriseDefaults(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('kri_direction', [
    { value: 'higher_is_worse', label: 'Higher is worse', color: 'red', sort: 10 },
    { value: 'lower_is_worse', label: 'Lower is worse', color: 'blue', sort: 20 },
  ], { module: 'risks' });
  await ctx.lookups.ensure('kri_frequency', [
    { value: 'monthly', label: 'Monthly', color: 'blue', sort: 10, meta: { months: 1 } },
    { value: 'quarterly', label: 'Quarterly', color: 'teal', sort: 20, meta: { months: 3 } },
  ], { module: 'risks' });
  await ctx.lookups.ensure('kri_status', [
    { value: 'active', label: 'Active', color: 'green', sort: 10 },
    { value: 'retired', label: 'Retired', color: 'gray', sort: 20, meta: { closed: true } },
  ], { module: 'risks' });
  await ctx.lookups.ensure('kri_unit', [
    { value: 'count', label: 'Count', color: 'blue', sort: 10 },
    { value: 'percent', label: 'Percent', color: 'teal', sort: 20 },
    { value: 'number', label: 'Number', color: 'gray', sort: 30 },
  ], { module: 'risks' });
}

/** green, amber or red for a value against an indicator's thresholds (null: no value or no thresholds). */
export function kriLevel(kri: Row, value: number | null | undefined): 'green' | 'amber' | 'red' | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const amber = kri.amber === null || kri.amber === undefined ? null : Number(kri.amber);
  const red = kri.red === null || kri.red === undefined ? null : Number(kri.red);
  if (amber === null && red === null) return null;
  if (kri.direction === 'lower_is_worse') {
    if (red !== null && v <= red) return 'red';
    if (amber !== null && v <= amber) return 'amber';
    return 'green';
  }
  if (red !== null && v >= red) return 'red';
  if (amber !== null && v >= amber) return 'amber';
  return 'green';
}

/** The appetite helpers that risks/index.ts uses while saving a risk and after re-rating. */
export function makeEnterprise(ctx: ModuleContext, scales: Scales) {
  async function appetite(): Promise<Map<string, AppetiteRow>> {
    const rows = await ctx.db.query<AppetiteRow>(
      `select category, statement, max_rating, max_score, approved_on::text as approved_on, approved_by_name, reference from risk_appetite`);
    return new Map(rows.map((r) => [r.category, r]));
  }

  async function closedStatuses(): Promise<string[]> {
    return (await ctx.lookups.values('risk_status')).filter((v) => v.meta?.closed).map((v) => v.value);
  }

  /** Whether a risk (its computed ratings filled) is above its category's appetite. Null: no appetite or not rated. */
  function breachOf(risk: Row, scale: Scale | undefined, a: AppetiteRow | undefined, closed: string[]): boolean | null {
    if (!a || !scale || (a.max_rating === null && a.max_score === null)) return null;
    const ratingKey = risk.residual_rating ?? risk.inherent_rating ?? null;
    const score = risk.residual_score ?? risk.inherent_score ?? null;
    if (!ratingKey) return null;
    if (closed.includes(risk.status)) return false;
    const rating = scale.ratings.find((r) => r.key === ratingKey);
    const max = scale.ratings.find((r) => r.key === a.max_rating);
    if (rating && max && rating.sort > max.sort) return true;
    if (a.max_score !== null && score !== null && Number(score) > Number(a.max_score)) return true;
    return false;
  }

  /** The breach flag for a risk being saved (merged row with its computed ratings). */
  async function breachFor(merged: Row, scale: Scale): Promise<boolean | null> {
    return breachOf(merged, scale, (await appetite()).get(merged.category), await closedStatuses());
  }

  /** Brings every risk's breach flag up to date (after the appetite or a scale changes). Answers how many changed. */
  async function refreshBreaches(): Promise<number> {
    const map = await appetite();
    const all = new Map((await scales.all()).map((s) => [s.key, s]));
    const closed = await closedStatuses();
    let changed = 0;
    for (const r of await ctx.db.query<Row>(
      'select id, category, scale_key, status, inherent_rating, residual_rating, inherent_score, residual_score, appetite_breach from risks where deleted_at is null')) {
      const b = breachOf(r, all.get(r.scale_key), map.get(r.category), closed);
      if ((r.appetite_breach ?? null) === b) continue;
      await ctx.db.query('update risks set appetite_breach = $2 where id = $1', [r.id, b]);
      changed += 1;
    }
    return changed;
  }

  /** Checks a parent risk: it exists, is not the risk itself, and the hierarchy stays two levels deep. */
  async function checkParent(existing: Row | null, parentId: unknown): Promise<string | null> {
    if (parentId === null || parentId === undefined || parentId === '') return null;
    if (!UUID.test(String(parentId))) return 'Choose a risk as the parent.';
    if (existing && existing.id === parentId) return 'A risk cannot be its own parent.';
    const parent = await ctx.db.one<Row>('select id, parent_id from risks where id = $1 and deleted_at is null', [parentId]);
    if (!parent) return 'The parent risk does not exist.';
    if (parent.parent_id) return 'The parent risk is itself under another risk. Choose a top-level (enterprise) risk.';
    if (existing && await ctx.db.one('select 1 from risks where parent_id = $1 and deleted_at is null limit 1', [existing.id])) {
      return 'This risk has risks under it, so it cannot be put under another risk.';
    }
    return null;
  }

  return { appetite, breachFor, refreshBreaches, checkParent };
}

export type Enterprise = ReturnType<typeof makeEnterprise>;

interface Deps {
  scales: Scales;
  enterprise: Enterprise;
  riskPre: (action: string) => ((req: FastifyRequest, reply: any) => Promise<void>)[];
}

/** Registers appetite, KRI and roll-up routes. Called from risks/index.ts `register`, after the obligations. */
export async function registerEnterpriseRisk(ctx: ModuleContext, deps: Deps): Promise<void> {
  const { scales, enterprise, riskPre } = deps;
  registerAppetite(ctx, scales, enterprise, riskPre);
  registerRollup(ctx, scales, riskPre);
  // The daily check also keeps every risk's breach flag in step (a scale changed elsewhere, a status list edited).
  await registerKris(ctx, riskPre, () => enterprise.refreshBreaches());
}

// ------------------------------------------------------------------ appetite (E30-06)

function registerAppetite(ctx: ModuleContext, scales: Scales, enterprise: Enterprise, riskPre: Deps['riskPre']): void {
  async function view() {
    const categories = await ctx.lookups.values('risk_category');
    const map = await enterprise.appetite();
    const all = await scales.all();
    const counts = await ctx.db.query<{ category: string; open: number; breaches: number }>(
      `select category, count(*)::int as open, count(*) filter (where appetite_breach)::int as breaches from risks
       where deleted_at is null and not (coalesce(status, '') = any($1::text[])) group by 1`,
      [(await ctx.lookups.values('risk_status')).filter((v) => v.meta?.closed).map((v) => v.value)]);
    return {
      categories: categories.map((c) => {
        const scale = all.find((s) => s.key === (c.meta?.scale ?? 'cyber_5x5')) ?? all[0];
        const a = map.get(c.value);
        const n = counts.find((x) => x.category === c.value);
        return {
          category: c.value, label: c.label, color: c.color ?? 'gray',
          scale_key: scale?.key ?? null, scale_name: scale?.name ?? null,
          ratings: (scale?.ratings ?? []).map((r) => ({ key: r.key, label: r.label, color: r.color, sort: r.sort })),
          statement: a?.statement ?? null, max_rating: a?.max_rating ?? null, max_score: a?.max_score ?? null,
          approved_on: a?.approved_on ?? null, approved_by_name: a?.approved_by_name ?? null, reference: a?.reference ?? null,
          open: n?.open ?? 0, breaches: n?.breaches ?? 0,
        };
      }),
    };
  }

  ctx.app.get('/api/risks/appetite', { preHandler: riskPre('view') }, async () => view());
  ctx.describeRoute({
    method: 'GET', path: '/api/risks/appetite', permission: 'risks.view',
    summary: 'The risk appetite per category, with open risks and those above it',
    description: 'Needs security.view as well (risks are restricted).',
    response: '{ categories: [{ category, label, color, scale_key, scale_name, ratings, statement, max_rating, max_score, approved_on, approved_by_name, reference, open, breaches }] }',
  });

  ctx.app.put('/api/risks/appetite', { preHandler: riskPre('administer') }, async (req) => {
    const body = (req.body ?? {}) as Row;
    const list = Array.isArray(body.categories) ? body.categories as Row[] : ctx.fail(400, 'validation', 'Give the appetite as a list of categories.');
    const categories = await ctx.lookups.values('risk_category');
    const all = await scales.all();
    const before = [...(await enterprise.appetite()).values()];
    const errors: Record<string, string> = {};
    const rows: AppetiteRow[] = [];
    const text = (v: unknown) => { const s = String(v ?? '').trim(); return s ? s : null; };
    for (const [i, raw] of list.entries()) {
      const c = categories.find((x) => x.value === raw?.category);
      if (!c) { errors[`categories.${i}.category`] = 'Unknown risk category.'; continue; }
      const scale = all.find((s) => s.key === (c.meta?.scale ?? 'cyber_5x5')) ?? all[0];
      const row: AppetiteRow = {
        category: c.value, statement: text(raw.statement), max_rating: text(raw.max_rating),
        max_score: raw.max_score === null || raw.max_score === undefined || raw.max_score === '' ? null : Number(raw.max_score),
        approved_on: text(raw.approved_on), approved_by_name: text(raw.approved_by_name), reference: text(raw.reference),
      };
      if (row.max_rating && !scale?.ratings.some((r) => r.key === row.max_rating)) errors[`categories.${i}.max_rating`] = `${c.label}: choose a rating of the ${scale?.name ?? ''} scale.`;
      if (row.max_score !== null && (!Number.isInteger(row.max_score) || row.max_score < 0 || row.max_score > 100000)) errors[`categories.${i}.max_score`] = `${c.label}: the highest score is a whole number, 0 or more.`;
      if (row.approved_on && (!DATE.test(row.approved_on) || Number.isNaN(Date.parse(row.approved_on)))) errors[`categories.${i}.approved_on`] = `${c.label}: approved on must be a date (YYYY-MM-DD).`;
      if ((row.statement?.length ?? 0) > MAX_TEXT) errors[`categories.${i}.statement`] = `${c.label}: the statement is at most 4,000 characters.`;
      for (const k of ['approved_by_name', 'reference'] as const) if ((row[k]?.length ?? 0) > 200) errors[`categories.${i}.${k}`] = `${c.label}: at most 200 characters.`;
      rows.push(row);
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    for (const r of rows) {
      const empty = !r.statement && !r.max_rating && r.max_score === null && !r.approved_on && !r.approved_by_name && !r.reference;
      if (empty) { await ctx.db.query('delete from risk_appetite where category = $1', [r.category]); continue; }
      await ctx.db.query(
        `insert into risk_appetite (category, statement, max_rating, max_score, approved_on, approved_by_name, reference, updated_at, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7, now(), $8)
         on conflict (category) do update set statement = excluded.statement, max_rating = excluded.max_rating, max_score = excluded.max_score,
           approved_on = excluded.approved_on, approved_by_name = excluded.approved_by_name, reference = excluded.reference, updated_at = now(), updated_by = excluded.updated_by`,
        [r.category, r.statement, r.max_rating, r.max_score, r.approved_on, r.approved_by_name, r.reference, req.user!.id]);
    }
    const changed = await enterprise.refreshBreaches();
    await ctx.audit(req, {
      action: 'risk_appetite.update', recordType: 'risk_appetite', recordId: 'appetite',
      summary: `Risk appetite changed (${rows.length} categories; ${changed} risks changed breach)`,
      before, after: [...(await enterprise.appetite()).values()],
    });
    return view();
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/risks/appetite', permission: 'risks.administer',
    summary: 'Saves the risk appetite of the categories given, and re-checks every risk against it',
    description: 'Needs security.view as well. A category given with nothing set has its appetite removed. max_rating is a rating key of the category\'s scale; a risk whose residual (or, unscored, inherent) rating is above it, or whose score is above max_score, is in breach.',
    body: { type: 'object', required: ['categories'], properties: { categories: { type: 'array', items: { type: 'object', required: ['category'], properties: { category: { type: 'string' }, statement: { type: 'string' }, max_rating: { type: 'string' }, max_score: { type: 'integer' }, approved_on: { type: 'string', format: 'date' }, approved_by_name: { type: 'string' }, reference: { type: 'string' } } } } } },
    response: 'The appetite, as GET returns it',
  });
}

// ------------------------------------------------------------------ roll-up (E30-08)

function registerRollup(ctx: ModuleContext, scales: Scales, riskPre: Deps['riskPre']): void {
  ctx.app.get('/api/risks/rollup', { preHandler: riskPre('view') }, async () => {
    const closed = (await ctx.lookups.values('risk_status')).filter((v) => v.meta?.closed).map((v) => v.value);
    const all = new Map((await scales.all()).map((s) => [s.key, s]));
    const parents = await ctx.db.query<Row>(
      `select p.id, p.ref, p.title, p.category, p.scale_key, p.status, coalesce(p.residual_rating, p.inherent_rating) as rating,
              coalesce(p.residual_score, p.inherent_score) as score, p.appetite_breach, u.display_name as owner_name
       from risks p left join users u on u.id = p.owner_id
       where p.deleted_at is null and exists (select 1 from risks c where c.parent_id = p.id and c.deleted_at is null)
       order by coalesce(p.residual_score, p.inherent_score) desc nulls last, p.ref`);
    const children = await ctx.db.query<Row>(
      `select c.id, c.ref, c.title, c.parent_id, c.scale_key, c.status, coalesce(c.residual_rating, c.inherent_rating) as rating,
              coalesce(c.residual_score, c.inherent_score) as score, c.appetite_breach
       from risks c where c.deleted_at is null and c.parent_id is not null
       order by coalesce(c.residual_score, c.inherent_score) desc nulls last, c.ref`);
    const ratingOf = (scaleKey: string, key: string | null) => {
      const r = all.get(scaleKey)?.ratings.find((x) => x.key === key);
      return r ? { key: r.key, label: r.label, color: r.color } : null;
    };
    return parents.map((p) => {
      const mine = children.filter((c) => c.parent_id === p.id);
      const open = mine.filter((c) => !closed.includes(c.status));
      const worst = open.find((c) => c.score !== null) ?? null;
      return {
        id: p.id, ref: p.ref, title: p.title, category: p.category, status: p.status, owner_name: p.owner_name,
        rating: ratingOf(p.scale_key, p.rating), score: p.score, appetite_breach: p.appetite_breach,
        children: mine.length, open_children: open.length,
        breaches: open.filter((c) => c.appetite_breach).length,
        worst: worst ? { id: worst.id, ref: worst.ref, title: worst.title, rating: ratingOf(worst.scale_key, worst.rating), score: worst.score } : null,
        risks: mine.map((c) => ({ id: c.id, ref: c.ref, title: c.title, status: c.status, closed: closed.includes(c.status), rating: ratingOf(c.scale_key, c.rating), score: c.score, appetite_breach: c.appetite_breach })),
      };
    });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/risks/rollup', permission: 'risks.view',
    summary: 'Parent (enterprise) risks with the risks under them, their worst open rating and appetite breaches',
    description: 'Needs security.view as well (risks are restricted).',
    response: '[{ id, ref, title, category, status, owner_name, rating, score, appetite_breach, children, open_children, breaches, worst, risks }]',
  });
}

// ------------------------------------------------------------------ key risk indicators (E30-07)

async function registerKris(ctx: ModuleContext, riskPre: Deps['riskPre'], daily: () => Promise<unknown>): Promise<void> {
  const metric = (key: string) => metricsAvailable(ctx.app, ctx.resources).find((m) => m.key === key);

  async function prepareKri(existing: Row | null, data: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...data };
    const errors: Record<string, string> = {};
    for (const k of ['amber', 'red'] as const) {
      const v = merged[k];
      if (v !== null && v !== undefined && !Number.isFinite(Number(v))) errors[k] = 'Give a number.';
    }
    if (merged.unit === 'count' || merged.unit === 'percent') {
      for (const k of ['amber', 'red'] as const) if (merged[k] !== null && merged[k] !== undefined && Number(merged[k]) < 0) errors[k] = 'A threshold cannot be below zero.';
    }
    if (merged.unit === 'percent') {
      for (const k of ['amber', 'red'] as const) if (merged[k] !== null && merged[k] !== undefined && Number(merged[k]) > 100) errors[k] = 'A percentage is at most 100.';
    }
    if (!errors.amber && !errors.red && merged.amber !== null && merged.amber !== undefined && merged.red !== null && merged.red !== undefined) {
      const lower = merged.direction === 'lower_is_worse';
      if (lower ? Number(merged.red) > Number(merged.amber) : Number(merged.red) < Number(merged.amber)) {
        errors.red = lower ? 'When lower is worse, red is at or below amber.' : 'When higher is worse, red is at or above amber.';
      }
    }
    if (data.metric_key !== undefined && data.metric_key !== null && data.metric_key !== '') {
      const m = metric(String(data.metric_key));
      if (!m) errors.metric_key = 'Choose a metric that is available.';
      else if (data.unit === undefined && !existing?.unit) data.unit = m.unit;
    }
    if (data.metric_key === '') data.metric_key = null;
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    return data;
  }

  /** Recomputes an indicator's latest value and level; on a move to red, tells the owners and brings the risk's review forward. */
  async function refresh(kriId: string): Promise<void> {
    const kri = await ctx.db.one<Row>('select * from key_risk_indicators where id = $1', [kriId]);
    if (!kri) return;
    const latest = await ctx.db.one<Row>('select period::text as period, value from kri_values where kri_id = $1 and value is not null order by period desc limit 1', [kriId]);
    const level = latest ? kriLevel(kri, Number(latest.value)) : null;
    const period = latest?.period ?? null;
    const lastPeriod = kri.last_period ? String(kri.last_period instanceof Date ? kri.last_period.toISOString().slice(0, 10) : kri.last_period).slice(0, 10) : null;
    await ctx.db.query('update key_risk_indicators set last_period = $2, last_value = $3, last_level = $4 where id = $1', [kriId, period, latest?.value ?? null, level]);
    if (level !== 'red' || (kri.last_level === 'red' && lastPeriod === period)) return;
    if (kri.status === 'retired') return;
    const risk = kri.risk_id ? await ctx.db.one<Row>('select id, ref, owner_id, review_on::text as review_on from risks where id = $1 and deleted_at is null', [kri.risk_id]) : undefined;
    const today = dayInZone();
    if (risk && (!risk.review_on || risk.review_on > today)) {
      await ctx.resources.update('risk', risk.id, { review_on: today });
    }
    if (ctx.app.hasDecorator('notify')) {
      const userIds = [...new Set([kri.owner_id, risk?.owner_id].filter(Boolean))];
      if (userIds.length) {
        await ctx.app.notify({
          userIds, kind: 'reminder',
          title: `Key risk indicator at red: ${[kri.ref, kri.name].filter(Boolean).join(' ')}`,
          body: risk ? `The value for ${period?.slice(0, 7)} is at or past the red threshold. The review of ${risk.ref} is now due.` : `The value for ${period?.slice(0, 7)} is at or past the red threshold.`,
          recordType: 'kri', recordId: kri.id,
          once: `kri.red:${kri.id}:${period}`,
        });
      }
    }
  }

  ctx.defineResource({
    type: 'kri', table: 'key_risk_indicators', module: 'risks', label: 'Key risk indicator', plural: 'Key risk indicators',
    path: '/api/kris', route: '/kris', titleField: 'name', ref: { field: 'ref', prefix: 'KRI-' },
    restricted: true,
    searchable: ['name', 'description'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Indicator', type: 'text', required: true },
      description: { label: 'What it measures', type: 'longtext', personal: false },
      risk_id: { label: 'Risk', type: 'ref', to: 'risk' },
      metric_key: { label: 'Computed from', type: 'text' },
      unit: { label: 'Unit', type: 'lookup', list: 'kri_unit', default: 'count' },
      direction: { label: 'Direction', type: 'lookup', list: 'kri_direction', default: 'higher_is_worse' },
      amber: { label: 'Amber at', type: 'number' },
      red: { label: 'Red at', type: 'number' },
      frequency: { label: 'Frequency', type: 'lookup', list: 'kri_frequency', default: 'monthly' },
      owner_id: { label: 'Owner', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'kri_status', default: 'active' },
      last_period: { label: 'Latest month', type: 'date', readOnly: true },
      last_value: { label: 'Latest value', type: 'number', readOnly: true },
      last_level: { label: 'Latest level', type: 'text', readOnly: true },
    },
    hooks: {
      beforeCreate: (_req, data) => prepareKri(null, data),
      beforeUpdate: (_req, existing, patch) => prepareKri(existing, patch),
      afterUpdate: async (_req, before, after) => {
        if (['amber', 'red', 'direction'].some((k) => String(before[k] ?? '') !== String(after[k] ?? ''))) await refresh(after.id);
      },
    },
  });

  const visibleKri = async (req: FastifyRequest) => {
    const id = String((req.params as any).id);
    return (UUID.test(id) && await ctx.resources.find('kri', id, req.user)) || ctx.fail(404, 'not_found', 'Key risk indicator not found.');
  };

  ctx.app.get('/api/kris/:id/values', { preHandler: riskPre('view') }, async (req) => {
    const kri = await visibleKri(req);
    const values = await ctx.db.query<Row>(
      `select v.id, to_char(v.period, 'YYYY-MM') as period, v.value::float8 as value, v.level, v.note, v.entered_by, u.display_name as entered_by_name, v.updated_at
       from kri_values v left join users u on u.id = v.entered_by where v.kri_id = $1 order by v.period desc limit 60`, [kri.id]);
    const m = kri.metric_key ? metric(kri.metric_key) : undefined;
    // The level follows the thresholds as they are now, so a changed threshold re-colors the history.
    for (const v of values) v.level = kriLevel(kri, v.value);
    return { values, computed: Boolean(kri.metric_key), metric: m ? { key: m.key, label: m.label, unit: m.unit, description: m.description } : null };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/kris/:id/values', permission: 'risks.view',
    summary: "A key risk indicator's monthly values, newest first", description: 'Needs security.view as well.',
    response: '{ values: [{ id, period (YYYY-MM), value, level, note, entered_by, entered_by_name }], computed, metric }',
  });

  ctx.app.put('/api/kris/:id/values/:period', { preHandler: riskPre('edit') }, async (req) => {
    const kri = await visibleKri(req);
    if (kri.metric_key) ctx.fail(409, 'computed', 'This indicator is computed from a metric. Its values are filled in every day.');
    const month = monthStartOf((req.params as any).period);
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    if (!month) errors.period = 'Give the month as YYYY-MM.';
    else if (month > `${dayInZone().slice(0, 7)}-01`) errors.period = 'A value cannot be entered for a month that has not started.';
    const value = b.value === null || b.value === undefined || b.value === '' ? NaN : Number(b.value);
    if (!Number.isFinite(value)) errors.value = 'Give a number.';
    else if ((kri.unit === 'count' || kri.unit === 'percent') && value < 0) errors.value = 'The value cannot be below zero.';
    else if (kri.unit === 'percent' && value > 100) errors.value = 'A percentage is at most 100.';
    else if (Math.abs(value) > 1e12) errors.value = 'The value is too large.';
    const note = String(b.note ?? '').trim();
    if (note.length > 2000) errors.note = 'The note is at most 2,000 characters.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const before = await ctx.db.one<Row>('select value::float8 as value, note from kri_values where kri_id = $1 and period = $2', [kri.id, month]);
    await ctx.db.query(
      `insert into kri_values (kri_id, period, value, level, note, entered_by) values ($1,$2,$3,$4,$5,$6)
       on conflict (kri_id, period) do update set value = excluded.value, level = excluded.level, note = excluded.note, entered_by = excluded.entered_by, updated_at = now()`,
      [kri.id, month, value, kriLevel(kri, value), note || null, req.user!.id]);
    await ctx.audit(req, {
      action: 'kri.value', recordType: 'kri', recordId: kri.id,
      summary: `${kri.ref} value for ${month!.slice(0, 7)}: ${value}`, before: before ?? null, after: { period: month!.slice(0, 7), value, note: note || null },
    });
    await refresh(kri.id);
    return (await ctx.resources.find('kri', kri.id, req.user))!;
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/kris/:id/values/:period', permission: 'risks.edit',
    summary: "Enters or corrects a key risk indicator's value for one month (YYYY-MM)",
    description: 'Needs security.view as well. Refused with 409 `computed` for an indicator computed from a metric. A value at red brings the risk\'s review forward and tells its owners.',
    body: { type: 'object', required: ['value'], properties: { value: { type: 'number' }, note: { type: 'string' } } },
    response: 'The indicator',
  });

  /** Daily: fills the values of indicators computed from metrics (this month and last), then re-checks every indicator. */
  async function check(): Promise<{ computed: number; checked: number }> {
    if (!ctx.resources.get('kri')) return { computed: 0, checked: 0 };
    const thisMonth = `${dayInZone().slice(0, 7)}-01`;
    const lastMonth = (() => { const d = new Date(`${thisMonth}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
    let computed = 0;
    const kris = await ctx.db.query<Row>(`select * from key_risk_indicators where deleted_at is null and coalesce(status, 'active') <> 'retired'`);
    for (const k of kris.filter((x) => x.metric_key)) {
      const m = metric(k.metric_key);
      if (!m) continue;
      for (const month of [lastMonth, thisMonth]) {
        let value: number | null;
        try { value = await m.compute(ctx, month); } catch (err) { console.error(`[risks.kri_check] ${k.ref} ${m.key} ${month}:`, err); continue; }
        await ctx.db.query(
          `insert into kri_values (kri_id, period, value, level) values ($1,$2,$3,$4)
           on conflict (kri_id, period) do update set value = excluded.value, level = excluded.level, updated_at = now()`,
          [k.id, month, value, kriLevel(k, value)]);
        computed += 1;
      }
    }
    for (const k of kris) await refresh(k.id);
    return { computed, checked: kris.length };
  }
  await scheduleWork(ctx, 'risks.kri_check', async () => { const r = await check(); await daily(); return r; }, { every: 24 * 3_600_000, firstRunInMs: 150_000 });
  kriCheckers.set(ctx.app, check);
}

const kriCheckers = new WeakMap<object, () => Promise<{ computed: number; checked: number }>>();

/** Runs the daily key-risk-indicator check now (tests and the seed). */
export async function runKriCheck(ctx: ModuleContext): Promise<{ computed: number; checked: number }> {
  const run = kriCheckers.get(ctx.app);
  return run ? run() : { computed: 0, checked: 0 };
}
