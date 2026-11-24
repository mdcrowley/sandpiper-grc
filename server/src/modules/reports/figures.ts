// Figures over time for board reporting (E41-04).
//
// An organization chooses the figures it wants to follow (Reports > Figures over time): a count of
// records of one type that match filters, optionally broken down by one of the type's list fields
// (open risks by level, open audit findings by rating), or a named metric another module offers
// (core/metrics.ts: overdue actions, inspections done on time...). The month-end job records each
// active figure once a month has ended; anyone who may change reports can also record the figures
// now, which keeps a value for the month so far.
//
// Figures are the same for everyone (docs/security.md): a value is worked out once, as the system
// (no person's permissions), counts every record, restricted or not, and holds only numbers and,
// for a breakdown, list values with their labels and colors, never words or people from records.
// Who may look at a figure follows the metrics rule: view permission on the module of the record
// type it counts. A figure whose record type or metric is switched off or not loaded is not shown.
import { addMonths } from '../../../../shared/dates.ts';
import { UUID_RE } from '../../core/errors.ts';
import { metricsAvailable, type MetricDef } from '../../core/metrics.ts';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { bucketLabel, runReport, type Pivot, type ReportResult, type ResultColumn, type ResultRow } from './query.ts';
import { compileWithCustom, reportable, SpecError, type Condition, type FilterGroup } from './spec.ts';

export type FigureSource = 'count' | 'metric';
export interface FigureGroup { value: string | null; label: string; color: string | null; count: number }
export interface FigureValue { period: string; kind: 'month_end' | 'on_demand'; value: number | null; groups: FigureGroup[] | null; recorded_at: string }

/** Months shown by default, and at most. */
export const DEFAULT_MONTHS = 12;
export const MAX_MONTHS = 60;

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export class FigureError extends Error {
  constructor(public field: string, message: string) { super(message); }
}

export function makeFigures(ctx: ModuleContext) {
  const { db } = ctx;

  // ---------- what a figure is about ----------

  const metricOf = (f: Row): MetricDef | undefined => (f.source === 'metric'
    ? metricsAvailable(ctx.app, ctx.resources).find((m) => m.key === f.metric_key) : undefined);
  const typeOf = (f: Row): ResourceDef | undefined => {
    if (f.source === 'metric') { const m = metricOf(f); return m?.recordType ? ctx.resources.get(m.recordType) : undefined; }
    const def = f.record_type ? ctx.resources.get(String(f.record_type)) : undefined;
    return def && reportable(def) ? def : undefined;
  };
  /** The figure can be worked out here: its record type or metric is loaded and switched on. */
  const available = (f: Row): boolean => (f.source === 'metric' ? Boolean(metricOf(f)) : Boolean(typeOf(f)));
  /** May this person see the figure? View permission on the module of what it counts (the figure itself counts every record). */
  const mayRead = (user: SessionUser | null, f: Row): boolean => {
    if (!available(f)) return false;
    const def = typeOf(f);
    return !def || ctx.can(user, `${def.module}.view`);
  };
  const unitOf = (f: Row): 'count' | 'percent' | 'number' => (f.source === 'metric' ? metricOf(f)?.unit ?? 'number' : 'count');

  /** A plain description of the figure for lists and documents. */
  function describe(f: Row) {
    const def = typeOf(f);
    const m = metricOf(f);
    const group = f.group_field && def ? def.fields[String(f.group_field)] : undefined;
    return {
      unit: unitOf(f),
      typeLabel: def?.plural ?? null,
      groupLabel: group?.label ?? null,
      metricLabel: m?.label ?? null,
      what: f.source === 'metric' ? (m?.description ?? '') : `${def?.plural ?? 'Records'} matching the figure's filters${group ? `, by ${group.label.toLowerCase()}` : ''}.`,
    };
  }

  // ---------- checking what people save ----------

  const hasMe = (g: FilterGroup | undefined): boolean => Boolean(g?.items?.some((i) => ((i as FilterGroup).items ? hasMe(i as FilterGroup) : (i as Condition).op === 'me')));

  /** Validates a create or a change; returns the columns to write. */
  async function clean(user: SessionUser | null, input: Row, existing: Row | null): Promise<Row> {
    const merged = { ...(existing ?? {}), ...input };
    const out: Row = {};
    if (input.name !== undefined || !existing) {
      const name = String(input.name ?? '').trim().slice(0, 120);
      if (!name) throw new FigureError('name', 'Give the figure a name.');
      out.name = name;
    }
    if (input.description !== undefined) out.description = input.description === null ? null : String(input.description).trim().slice(0, 1000) || null;
    if (input.active !== undefined) out.active = input.active !== false;
    const source = String(merged.source ?? 'count');
    if (source !== 'count' && source !== 'metric') throw new FigureError('source', 'Choose whether the figure counts records or is a metric.');
    out.source = source;
    if (source === 'metric') {
      const m = metricsAvailable(ctx.app, ctx.resources).find((x) => x.key === merged.metric_key);
      const def = m?.recordType ? ctx.resources.get(m.recordType) : undefined;
      if (!m || (def && !ctx.can(user, `${def.module}.view`))) throw new FigureError('metric_key', 'Choose a metric from the list.');
      Object.assign(out, { metric_key: m.key, record_type: null, filters: null, group_field: null });
      return out;
    }
    const def = merged.record_type ? ctx.resources.get(String(merged.record_type)) : undefined;
    if (!def || !reportable(def) || !ctx.can(user, `${def.module}.view`)) throw new FigureError('record_type', 'Choose the records to count.');
    let filters = (merged.filters ?? null) as FilterGroup | null;
    if (filters !== null && (typeof filters !== 'object' || !Array.isArray(filters.items))) throw new FigureError('filters', 'The filters are not valid.');
    if (filters && !filters.items.length) filters = null;
    // Worked out as the system, so a filter on "me" would mean nobody.
    if (hasMe(filters ?? undefined)) throw new FigureError('filters', 'A figure is the same for everyone, so it cannot be filtered by "me".');
    const group = merged.group_field ? String(merged.group_field) : null;
    if (group && def.fields[group]?.type !== 'lookup') throw new FigureError('group_field', 'Break the count down by a list field, or not at all.');
    try {
      await compileWithCustom(ctx, null, { type: def.type, filters: filters ?? undefined, groupBy: group ? [{ field: group }] : undefined });
    } catch (err) {
      if (err instanceof SpecError) throw new FigureError(err.field === 'type' ? 'record_type' : 'filters', err.message);
      throw err;
    }
    Object.assign(out, { metric_key: null, record_type: def.type, filters: filters ? JSON.stringify(filters) : null, group_field: group });
    return out;
  }

  // ---------- working figures out ----------

  /** The figure now (a count) or for a month (a metric), as the system: every record, the same for everyone. */
  async function measure(f: Row, period: string, now: Date): Promise<{ value: number | null; groups: FigureGroup[] | null }> {
    if (f.source === 'metric') {
      const m = metricOf(f);
      if (!m) throw new Error(`The metric ${f.metric_key} is not available.`);
      const v = await m.compute(ctx, period);
      return { value: v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v), groups: null };
    }
    const def = typeOf(f);
    if (!def) throw new Error(`Records of type ${f.record_type} are not available.`);
    const filters = (typeof f.filters === 'string' ? JSON.parse(f.filters) : f.filters) as FilterGroup | null;
    const group = f.group_field ? String(f.group_field) : null;
    const r = await runReport(ctx, null, { type: def.type, filters: filters ?? undefined, groupBy: group ? [{ field: group }] : undefined, aggregates: [{ fn: 'count' }] }, { now, limit: 500 });
    if (!group) {
      const v = r.rows[0]?.v.a0;
      return { value: typeof v === 'number' ? v : Number(v ?? 0) || 0, groups: null };
    }
    const groups = r.rows.map((row) => ({
      value: row.v.g0 === null || row.v.g0 === undefined ? null : String(row.v.g0),
      label: row.d.g0 ?? String(row.v.g0 ?? 'None'),
      color: row.c?.g0 ?? null,
      count: Number(row.v.a0) || 0,
    }));
    return { value: r.total, groups };
  }

  /** Records a figure's value for a month: at the month end (the job) or on demand (the month so far). */
  async function record(f: Row, period: string, kind: 'month_end' | 'on_demand', by: string | null, now: Date): Promise<FigureValue> {
    const { value, groups } = await measure(f, period, now);
    const row = await db.one<Row>(
      `insert into figure_values (figure_id, period, kind, value, groups, recorded_at, recorded_by) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
       on conflict (figure_id, period, kind) do update set value = excluded.value, groups = excluded.groups, recorded_at = excluded.recorded_at, recorded_by = excluded.recorded_by
       returning period, kind, value, groups, recorded_at`,
      [f.id, period, kind, value, groups ? JSON.stringify(groups) : null, now.toISOString(), by],
    );
    return toValue(row!);
  }

  const toValue = (r: Row): FigureValue => ({
    period: String(r.period).slice(0, 10), kind: r.kind, value: r.value === null || r.value === undefined ? null : Number(r.value),
    groups: (typeof r.groups === 'string' ? JSON.parse(r.groups) : r.groups) ?? null, recorded_at: iso(r.recorded_at),
  });

  // ---------- reading ----------

  async function load(id: string): Promise<Row | undefined> {
    if (!UUID_RE.test(id)) return undefined;
    return db.one<Row>('select * from tracked_figures where id = $1 and deleted_at is null', [id]);
  }

  /** A figure the person may see, or undefined (not found, removed, switched off, or no permission). */
  async function visible(user: SessionUser | null, id: string): Promise<Row | undefined> {
    const f = await load(id);
    return f && mayRead(user, f) ? f : undefined;
  }

  async function all(): Promise<Row[]> {
    return db.query<Row>('select * from tracked_figures where deleted_at is null order by sort, name');
  }

  /** The values of the last `months` months, oldest first: the month-end value where there is one, else the latest on-demand one. */
  async function values(f: Row, months: number, now: Date): Promise<{ period: string; value: FigureValue; current: boolean }[]> {
    const thisMonth = monthStart(todayInZone(now));
    const from = addMonths(thisMonth, -(months - 1));
    const rows = (await db.query<Row>(
      `select period, kind, value, groups, recorded_at from figure_values where figure_id = $1 and period >= $2 and period <= $3 order by period, recorded_at`,
      [f.id, from, thisMonth],
    )).map(toValue);
    const out: { period: string; value: FigureValue; current: boolean }[] = [];
    for (const period of [...new Set(rows.map((r) => r.period))].sort()) {
      const of = rows.filter((r) => r.period === period);
      const chosen = of.find((r) => r.kind === 'month_end') ?? of[of.length - 1];
      out.push({ period, value: chosen, current: period === thisMonth && chosen.kind === 'on_demand' });
    }
    return out;
  }

  /**
   * The figure over time in the report engine's result shape, so dashboards, report packs, the
   * print-ready document, the PDF, the spreadsheet and the screen draw it like any grouped report:
   * one row per month, or (with a breakdown) a month-by-value table whose rows are the months.
   */
  async function result(f: Row, months: number, now: Date): Promise<ReportResult> {
    const series = await values(f, months, now);
    const d = describe(f);
    const pct = d.unit === 'percent';
    const monthLabel = (s: { period: string; current: boolean }) => `${bucketLabel(s.period, 'month')}${s.current ? ' (so far)' : ''}`;
    const month: ResultColumn = { key: 'g0', label: 'Month', type: 'text', role: 'dim', bucket: 'month', values: series.map(monthLabel) };
    const measureCol: ResultColumn = { key: 'a0', label: pct ? `${f.name} (%)` : String(f.name), type: 'number', role: 'agg', fn: pct ? 'pct' : d.unit === 'count' ? 'count' : 'sum' };
    const route = `/reports/figures/${f.id}`;
    const base = {
      type: String(f.record_type ?? 'figure'), typeLabel: 'Month', plural: 'Months', route, mode: 'groups' as const,
      total: series.length, truncated: false, drill: '', drillExact: false, globalsApplied: [], restricted: false,
      recordTypes: typeOf(f) ? [typeOf(f)!.type] : [], generatedAt: now.toISOString(),
    };
    if (!f.group_field) {
      const rows: ResultRow[] = series.map((s) => ({ v: { g0: s.period, a0: s.value.value }, d: { g0: monthLabel(s) } }));
      return { ...base, columns: [month, measureCol], rows };
    }
    // The breakdown's values in the list's own order (as configured), then any no longer in it.
    const def = typeOf(f);
    const list = def?.fields[String(f.group_field)]?.list;
    const order = list ? (await ctx.lookups.values(list)).map((v) => v.value) : [];
    const seen = new Map<string, { value: string | null; label: string; color: string | null }>();
    for (const s of [...series].reverse()) for (const g of s.value.groups ?? []) if (!seen.has(String(g.value))) seen.set(String(g.value), { value: g.value, label: g.label, color: g.color });
    const cols = [...seen.values()].sort((a, b) => {
      const ia = order.indexOf(String(a.value)); const ib = order.indexOf(String(b.value));
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.label.localeCompare(b.label);
    });
    const groupCol: ResultColumn = { key: 'g1', label: d.groupLabel ?? 'Group', type: 'lookup', role: 'dim', list, values: cols.map((c) => c.label) };
    const rows: ResultRow[] = [];
    const cells: Pivot['cells'] = [];
    for (const s of series) {
      const line: Pivot['cells'][number] = [];
      for (const c of cols) {
        const n = s.value.groups?.find((g) => String(g.value) === String(c.value))?.count ?? 0;
        rows.push({ v: { g0: s.period, g1: c.value, a0: n }, d: { g0: monthLabel(s), g1: c.label }, ...(c.color ? { c: { g1: c.color } } : {}) });
        line.push({ v: n, drill: '' });
      }
      cells.push(line);
    }
    const pivot: Pivot = {
      rows: series.map((s) => ({ value: s.period, label: monthLabel(s), drill: '' })),
      cols: cols.map((c) => ({ value: c.value, label: c.label, ...(c.color ? { color: c.color } : {}), drill: '' })),
      cells,
      rowTotals: series.map((s) => s.value.value),
      // Adding a figure up across months means nothing: no column totals.
      colTotals: cols.map(() => null), grand: null, measure: measureCol.label,
    };
    return { ...base, columns: [month, groupCol, measureCol], rows, pivot };
  }

  /** The figure as a person sees it in a list: what it is and its latest value. */
  async function summary(f: Row): Promise<Row> {
    const latest = await db.one<Row>('select period, kind, value, groups, recorded_at from figure_values where figure_id = $1 order by period desc, recorded_at desc limit 1', [f.id]);
    const d = describe(f);
    return {
      id: f.id, key: f.key ?? null, name: f.name, description: f.description ?? null, source: f.source, metric_key: f.metric_key ?? null,
      record_type: f.record_type ?? typeOf(f)?.type ?? null, filters: (typeof f.filters === 'string' ? JSON.parse(f.filters) : f.filters) ?? null,
      group_field: f.group_field ?? null, active: f.active !== false, unit: d.unit, type_label: d.typeLabel, group_label: d.groupLabel,
      metric_label: d.metricLabel, what: d.what, latest: latest ? toValue(latest) : null, updated_at: iso(f.updated_at),
    };
  }

  // ---------- the month end ----------

  /**
   * Records every active figure for the month that has just ended, once. A figure added during the
   * current month has no value for the one before. Runs every hour; a month is recorded at its
   * first run after the month ends (the value's time says when).
   */
  async function monthEnd(now: Date): Promise<{ period: string; recorded: number; failed: number }> {
    const thisMonth = monthStart(todayInZone(now));
    const period = addMonths(thisMonth, -1);
    let recorded = 0;
    let failed = 0;
    for (const f of await all()) {
      if (f.active === false || !available(f)) continue;
      if (todayInZone(new Date(iso(f.created_at))) >= thisMonth) continue;
      if (await db.one('select 1 from figure_values where figure_id = $1 and period = $2 and kind = $3', [f.id, period, 'month_end'])) continue;
      try {
        await record(f, period, 'month_end', null, now);
        recorded += 1;
      } catch (err) {
        failed += 1;
        console.error(`[reports] figure "${f.name}" could not be recorded for ${period}:`, err);
      }
    }
    return { period, recorded, failed };
  }

  /** Records the figures now (the month so far), for a person. */
  async function recordNow(user: SessionUser, ids: string[] | null, now: Date): Promise<{ period: string; recorded: string[] }> {
    const period = monthStart(todayInZone(now));
    const recorded: string[] = [];
    for (const f of await all()) {
      if (ids ? !ids.includes(f.id) : f.active === false) continue;
      if (!mayRead(user, f)) continue;
      await record(f, period, 'on_demand', user.id, now);
      recorded.push(f.id);
    }
    return { period, recorded };
  }

  /** Reads `months` from a query or body value. */
  const monthsOf = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(MAX_MONTHS, n) : DEFAULT_MONTHS;
  };

  return { clean, measure, record, load, visible, all, values, result, summary, monthEnd, recordNow, mayRead, available, describe, monthsOf };
}

export type Figures = ReturnType<typeof makeFigures>;

