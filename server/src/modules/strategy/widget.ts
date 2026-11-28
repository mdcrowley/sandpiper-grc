// The dashboard widget for one strategic measure (E46-60): its latest actual against the target of
// that period, and its targets and actuals over the last periods, in the report engine's result shape
// so the screen, the print-ready document, the PDF and scheduled deliveries draw it like any chart.
// The reports module's widget runner calls it (reports/widgets.ts, kind `measure`). It answers
// nothing when the strategy area is switched off or not loaded here, and refuses a viewer who may
// not view the strategy area, as any other widget about records they cannot see.
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { periodLabel } from './periods.ts';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

export interface MeasureWidgetData {
  status: 'ok' | 'unavailable' | 'forbidden';
  message?: string;
  measure?: {
    id: string; ref: string | null; title: string; unit: string | null; direction: string | null; frequency: string | null; source: string | null;
    objective: string | null; latest_period: string | null; latest_label: string | null; latest_value: number | null; latest_target: number | null;
    latest_state: string | null; latest_state_label: string | null; route: string;
  };
  /** Up to `periods` periods, oldest first: Period (g0), Target (a0), Actual (a1). */
  result?: Row;
}

export async function measureWidget(ctx: ModuleContext, user: SessionUser | null, id: string, periods = 8, now = new Date()): Promise<MeasureWidgetData> {
  const def = ctx.resources.get('strategic_measure');
  if (!def) return { status: 'unavailable', message: 'This needs a part of the application that is not switched on here.' };
  if (user && !ctx.can(user, 'strategy.view')) return { status: 'forbidden', message: 'Your role does not include this information.' };
  const m = await ctx.resources.find('strategic_measure', id, user);
  if (!m) return { status: 'unavailable', message: 'This measure has been removed, or it is not available to you here.' };
  const n = Math.min(24, Math.max(2, Math.round(Number(periods) || 8)));
  const rows = (await ctx.db.query<Row>(
    `select period, target, actual, state from strategy_measure_values where measure_id = $1 and deleted_at is null
     order by period_start desc nulls last, period desc limit $2`, [m.id, n])).reverse();
  const states = new Map((await ctx.lookups.values('measure_state')).map((v) => [v.value, v]));
  const objective = m.objective_id ? await ctx.resources.labelFor('strategic_objective', String(m.objective_id)) : null;
  const unit = m.unit ? ` (${m.unit})` : '';
  const result = {
    type: 'measure_value', typeLabel: 'Period', plural: 'Periods', route: `/strategy/measures/${m.id}`, mode: 'groups',
    total: rows.length, truncated: false, drill: '', drillExact: false, globalsApplied: [], restricted: false,
    recordTypes: ['strategic_measure', 'measure_value'], generatedAt: now.toISOString(),
    columns: [
      { key: 'g0', label: 'Period', type: 'text', role: 'dim', values: rows.map((r) => periodLabel(String(r.period))) },
      { key: 'a0', label: `Target${unit}`, type: 'number', role: 'agg', fn: 'sum' },
      { key: 'a1', label: `Actual${unit}`, type: 'number', role: 'agg', fn: 'sum' },
    ],
    rows: rows.map((r) => ({ v: { g0: r.period, a0: num(r.target), a1: num(r.actual) }, d: { g0: periodLabel(String(r.period)) } })),
  };
  const state = m.latest_state ? states.get(String(m.latest_state)) : undefined;
  return {
    status: 'ok',
    measure: {
      id: m.id, ref: m.ref ?? null, title: m.title, unit: m.unit ?? null, direction: m.direction ?? null, frequency: m.frequency ?? null, source: m.source ?? null,
      objective, latest_period: m.latest_period ?? null, latest_label: m.latest_period ? periodLabel(String(m.latest_period)) : null,
      latest_value: num(m.latest_value), latest_target: num(m.latest_target), latest_state: m.latest_state ?? null,
      latest_state_label: state?.label ?? null, route: `/strategy/measures/${m.id}`,
    },
    result,
  };
}

/** One line for a print-ready document or a delivery: "2026 Q3: 85.2 % against a target of 85 % (Meets target)". */
export function measureSentence(d: MeasureWidgetData['measure']): string {
  if (!d) return '';
  if (d.latest_value === null) return 'No actual yet.';
  const u = d.unit ? ` ${d.unit}` : '';
  return `${d.latest_label}: ${d.latest_value}${u}${d.latest_target !== null ? ` against a target of ${d.latest_target}${u}` : ''}${d.latest_state_label ? ` (${d.latest_state_label})` : ''}.`;
}
