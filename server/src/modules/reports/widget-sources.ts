// Dashboard widgets whose figures come from another module rather than from the report engine
// (wave 27). A number, gauge or table widget with `config.source` set is worked out here; the result
// keeps the report engine's shape, so the screen, the print-ready document, the PDF and deliveries
// draw it like any other widget. Figures are the same for everyone: the module counts every record,
// and the viewer only needs view permission on that module's area.
//
// - `change_success` (E46-54): the change success rate of `changes/success.ts`, the same figure as
//   the home widget and GET /api/changes/success-rate: of the changes finished in the period, the
//   share not failed or backed out and not linked to an incident they caused. The period is the
//   dashboard's date filter, or the last 90 days.
// - `safety_indicators` (E46-68): where each active safety performance indicator stands, from the
//   safety module's `safetyIndicatorStatus` decorator (its latest complete month against its target).
//   As a number: how many missed their target; as a table: one row per indicator. Shown only while
//   the safety area is on (the widget names `safety_indicator` as its type, so a dashboard leaves it
//   out while the area is off).
import { addDays } from '../../../../shared/dates.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { DEFAULT_DAYS, successRate } from '../changes/success.ts';
import type { ReportResult } from './query.ts';
import type { GlobalFilters } from './spec.ts';

export const WIDGET_SOURCES = ['change_success', 'safety_indicators'] as const;

export interface SourcedData {
  status: 'ok' | 'unavailable' | 'forbidden' | 'error';
  message?: string;
  result?: ReportResult;
  value?: number | null;
  denominator?: number | null;
}

/** What one indicator's status says (safety/indicators.ts, GET /api/safety/indicator-status). */
export interface IndicatorStatusRow {
  id: string; name: string;
  latest: { period: string; value: number | null; target: number | null; direction: string | null; met: boolean | null } | null;
  direction: 'better' | 'worse' | 'same' | null;
}
type StatusLookup = (opts?: { activeOnly?: boolean }) => Promise<{ rows: IndicatorStatusRow[] }>;

const UNAVAILABLE: SourcedData = { status: 'unavailable', message: 'This needs a part of the application that is not switched on here.' };
const FORBIDDEN: SourcedData = { status: 'forbidden', message: 'Your role does not include this information.' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1] ?? ''} ${p.slice(0, 4)}`.trim();
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '' : Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

function shell(type: string, typeLabel: string, plural: string, route: string, now: Date, extra: Partial<ReportResult>): ReportResult {
  return {
    type, typeLabel, plural, route, mode: 'rows', columns: [], rows: [], total: 0, truncated: false,
    drill: '', drillExact: false, globalsApplied: [], restricted: false, recordTypes: [type], generatedAt: now.toISOString(), ...extra,
  };
}

/** The widget's figures, or null when the widget has no source (the report engine works it out). */
export async function runSourced(ctx: ModuleContext, user: SessionUser | null, kind: string, cfg: Row, opts: { globals?: GlobalFilters; now?: Date } = {}): Promise<SourcedData | null> {
  const source = typeof cfg.source === 'string' ? cfg.source : null;
  if (!source) return null;
  const now = opts.now ?? new Date();
  if (source === 'change_success') return changeSuccess(ctx, user, opts.globals, now);
  if (source === 'safety_indicators') return safetyIndicators(ctx, user, kind, now);
  return { status: 'error', message: 'This widget\'s figures come from a source this version does not know.' };
}

async function changeSuccess(ctx: ModuleContext, user: SessionUser | null, globals: GlobalFilters | undefined, now: Date): Promise<SourcedData> {
  if (!ctx.resources.get('change')) return UNAVAILABLE;
  if (user && !ctx.can(user, 'changes.view')) return FORBIDDEN;
  const to = globals?.to && DATE.test(globals.to) ? globals.to : todayInZone(now);
  const from = globals?.from && DATE.test(globals.from) ? globals.from : addDays(to, -(DEFAULT_DAYS - 1));
  if (from > to) return { status: 'error', message: 'The dashboard\'s dates run backward.' };
  const r = await successRate(ctx, from, to);
  return {
    status: 'ok', value: r.successful, denominator: r.finished,
    // Selecting the gauge opens the changes finished in the period.
    result: shell('change', 'Change', 'Changes', '/changes', now, {
      mode: 'total', total: r.finished, drill: `f.actual_end.gt=${addDays(from, -1)}&f.actual_end.lt=${addDays(to, 1)}&f.outcome.null=false`,
      globalsApplied: globals?.from || globals?.to ? ['date'] : [],
    }),
  };
}

async function safetyIndicators(ctx: ModuleContext, user: SessionUser | null, kind: string, now: Date): Promise<SourcedData> {
  const lookup = (ctx.app as unknown as { safetyIndicatorStatus?: StatusLookup }).safetyIndicatorStatus;
  if (!ctx.resources.get('safety_indicator') || !lookup) return UNAVAILABLE;
  if (user && !ctx.can(user, 'safety.view')) return FORBIDDEN;
  const { rows } = await lookup({ activeOnly: true });
  const missed = rows.filter((r) => r.latest?.met === false);
  const base = shell('safety_indicator', 'Safety indicator', 'Safety indicators', '/safety/indicators', now, { total: rows.length });
  if (kind === 'number' || kind === 'gauge' || kind === 'progress') {
    // How many missed their target; out of those with a target and a figure.
    const judged = rows.filter((r) => r.latest?.met === true || r.latest?.met === false).length;
    return { status: 'ok', value: missed.length, denominator: judged, result: { ...base, mode: 'total' } };
  }
  const standing = (r: IndicatorStatusRow) => (r.latest?.met === true ? { label: 'On target', color: 'green' }
    : r.latest?.met === false ? { label: 'Missed the target', color: 'red' }
    : r.latest ? { label: 'No target', color: 'gray' } : { label: 'No figure yet', color: 'gray' });
  const trend = (r: IndicatorStatusRow) => (r.direction === 'better' ? 'Better than the month before' : r.direction === 'worse' ? 'Worse than the month before' : r.direction === 'same' ? 'The same as the month before' : '');
  return {
    status: 'ok',
    result: {
      ...base,
      columns: [
        { key: 'c0', label: 'Indicator', type: 'text', role: 'column' },
        { key: 'c1', label: 'Month', type: 'text', role: 'column' },
        { key: 'c2', label: 'Figure', type: 'number', role: 'column' },
        { key: 'c3', label: 'Target', type: 'text', role: 'column' },
        { key: 'c4', label: 'Where it stands', type: 'text', role: 'column' },
        { key: 'c5', label: 'Trend', type: 'text', role: 'column' },
      ],
      rows: rows.map((r) => {
        const s = standing(r);
        const target = r.latest && r.latest.target !== null ? `${r.latest.direction === 'at_least' ? 'At least' : 'At most'} ${fmt(r.latest.target)}` : '';
        return {
          id: r.id,
          v: { c0: r.name, c1: r.latest?.period ?? null, c2: r.latest?.value ?? null, c3: target || null, c4: s.label, c5: trend(r) || null },
          d: { c1: r.latest ? monthName(r.latest.period) : '', c2: fmt(r.latest?.value), c4: s.label },
          c: { c4: s.color },
        };
      }),
    },
  };
}
