// Works out the data behind one dashboard widget, as the viewer. A widget never fails the
// dashboard: when its record type is not loaded, or the viewer has no access, it answers with a
// status the page shows in place of the figures.
import { todayInZone } from '../../core/config.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { AccessError, runReport, type ReportResult } from './query.ts';
import { SpecError, type FilterGroup, type GlobalFilters, type ReportSpec } from './spec.ts';

export const WIDGET_KINDS = ['report', 'number', 'gauge', 'progress', 'chart', 'table', 'list', 'countdown', 'calendar', 'text'] as const;

export interface Widget {
  id: string;
  kind: string;
  title?: string;
  x: number; y: number; w: number; h: number;
  config?: Row;
}

export interface WidgetData {
  status: 'ok' | 'unavailable' | 'forbidden' | 'error';
  message?: string;
  result?: ReportResult;
  chart?: Row;
  report?: { id: string; name: string };
  /** number, gauge, progress */
  value?: number | null;
  denominator?: number | null;
  trend?: { current: number; previous: number; days: number };
}

const and = (...groups: (FilterGroup | undefined | null)[]): FilterGroup => ({ op: 'and', items: groups.filter((g): g is FilterGroup => Boolean(g && Array.isArray(g.items))) });
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** The first measure of a specification as one number over every matching record. */
async function total(ctx: ModuleContext, user: SessionUser | null, spec: ReportSpec, opts: { globals?: GlobalFilters; dateField?: string; now?: Date }) {
  const r = await runReport(ctx, user, { type: spec.type, filters: spec.filters, aggregates: spec.aggregates?.length ? [spec.aggregates[0]] : [{ fn: 'count' }] }, opts);
  const v = r.rows[0]?.v.a0;
  return { result: r, value: typeof v === 'number' ? v : v === null || v === undefined ? null : Number(v) };
}

export interface WidgetRunOptions {
  globals?: GlobalFilters;
  now?: Date;
  /** Calendar widgets: the month to show, YYYY-MM. */
  month?: string;
  /** Looks up a saved report the viewer may run from this dashboard. */
  loadReport?: (id: string) => Promise<Row | undefined>;
}

export async function runWidget(ctx: ModuleContext, user: SessionUser | null, widget: Widget, opts: WidgetRunOptions = {}): Promise<WidgetData> {
  const cfg = (widget.config ?? {}) as Row;
  const now = opts.now ?? new Date();
  try {
    if (widget.kind === 'text') return { status: 'ok' };
    if (widget.kind === 'countdown' && !cfg.spec) return { status: 'ok' };

    let spec = cfg.spec as ReportSpec | undefined;
    let chart = cfg.chart as Row | undefined;
    let report: WidgetData['report'];
    if (widget.kind === 'report') {
      const row = cfg.reportId ? await opts.loadReport?.(String(cfg.reportId)) : undefined;
      if (!row) return { status: 'unavailable', message: 'This report has been removed or is not shared with you.' };
      spec = row.spec as ReportSpec;
      chart = { ...(row.chart as Row), ...(cfg.chart as Row | undefined) };
      report = { id: row.id, name: row.name };
    }
    if (!spec || typeof spec.type !== 'string') return { status: 'error', message: 'This widget has not been set up yet.' };
    if (!ctx.resources.get(spec.type)) {
      return { status: 'unavailable', message: 'This needs a part of the application that is not switched on here.' };
    }
    const dateField = typeof cfg.dateField === 'string' ? cfg.dateField : spec.groupBy?.find((g) => g.bucket)?.field;
    const run = { globals: opts.globals, dateField, now };

    if (widget.kind === 'number' || widget.kind === 'gauge' || widget.kind === 'progress') {
      const main = await total(ctx, user, spec, run);
      const out: WidgetData = { status: 'ok', result: main.result, value: main.value };
      // "Out of": either the same count over a wider filter (`of`), or any other single figure (`denominator`).
      if (cfg.denominator && typeof cfg.denominator === 'object') {
        out.denominator = (await total(ctx, user, { ...(cfg.denominator as ReportSpec), type: (cfg.denominator as ReportSpec).type ?? spec.type }, run)).value;
      } else if (cfg.of !== undefined) {
        out.denominator = (await total(ctx, user, { type: spec.type, filters: cfg.of ?? undefined }, run)).value;
      }
      if (widget.kind === 'number' && cfg.trend) {
        const days = Math.min(366, Math.max(1, Math.round(Number(cfg.trend.days) || 30)));
        const field = typeof cfg.trend.field === 'string' ? cfg.trend.field : 'created_at';
        // `filters: null` counts every record in the period; leaving it out keeps the widget's own filters.
        const base = 'filters' in cfg.trend ? (cfg.trend.filters as FilterGroup | null) : spec.filters;
        const today = todayInZone(now);
        const count = async (from: string, to: string) => (await total(ctx, user, {
          type: spec!.type, filters: and(base, { op: 'and', items: [{ field, op: 'between', value: [from, to] }] }),
        }, { globals: { ...opts.globals, from: undefined, to: undefined }, now })).value ?? 0;
        out.trend = { current: await count(shift(today, -days + 1), today), previous: await count(shift(today, -2 * days + 1), shift(today, -days)), days };
      }
      return out;
    }

    if (widget.kind === 'calendar') {
      const field = typeof cfg.dateField === 'string' ? cfg.dateField : 'created_at';
      const month = /^\d{4}-\d{2}$/.test(String(opts.month)) ? String(opts.month) : todayInZone(now).slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const result = await runReport(ctx, user, {
        type: spec.type,
        filters: and(spec.filters, { op: 'and', items: [{ field, op: 'between', value: [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`] }] }),
        groupBy: [{ field, bucket: 'day' }],
      }, { ...run, globals: { ...opts.globals, from: undefined, to: undefined } });
      return { status: 'ok', result, chart: { kind: 'calendar', month } };
    }

    if (widget.kind === 'countdown') {
      const field = String(cfg.dateField ?? '');
      const def = ctx.resources.get(spec.type)!;
      const result = await runReport(ctx, user, {
        type: spec.type, columns: [def.titleField, field],
        filters: and(spec.filters, { op: 'and', items: [{ field, op: 'gte', value: todayInZone(now) }] }),
        sort: [{ by: field, dir: 'asc' }], limit: Math.min(10, Number(cfg.limit) || 5),
      }, run);
      return { status: 'ok', result };
    }

    if (widget.kind === 'list' || widget.kind === 'table') {
      const result = await runReport(ctx, user, { ...spec, pivot: widget.kind === 'table' ? spec.pivot : false }, { ...run, limit: Math.min(100, Number(cfg.limit ?? spec.limit) || (widget.kind === 'list' ? 6 : 25)) });
      return { status: 'ok', result, chart: { kind: 'table' } };
    }

    // chart, report
    const result = await runReport(ctx, user, spec, run);
    return { status: 'ok', result, chart: chart ?? { kind: 'bar' }, report };
  } catch (err) {
    if (err instanceof AccessError) return { status: 'forbidden', message: 'Your role does not include this information.' };
    if (err instanceof SpecError) return { status: 'error', message: err.message };
    throw err;
  }
}
