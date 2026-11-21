import type { FastifyInstance } from 'fastify';
import type { ModuleContext, ResourceRegistry, SessionUser } from './module.ts';

// Metric registry (wave 10, contract C3): named monthly figures that modules offer and other
// modules read, so a safety performance indicator or a key risk indicator can be computed from
// another module's records without knowing its tables. A module defines its metrics in
// `register` with `defineMetric(ctx.app, {...})`; readers list them with `metricsAvailable`.
//
// A metric is a figure, so it follows "Figures are the same for everyone" (docs/security.md):
// `compute` counts every record, restricted or not, never uses `visibleWhere`, and never returns
// words or people. A metric tied to a record type (`recordType`) is left out while that type is not
// loaded or its area is switched off.

export interface MetricDef {
  /** `<module>.<name>`, for example `actions.overdue`. Unique per application. */
  key: string;
  label: string;
  unit: 'count' | 'percent' | 'number';
  /** One or two plain sentences: what is counted and how. */
  description: string;
  /** The record type the figure is about: the metric is skipped while that type is off or not loaded. */
  recordType?: string;
  /**
   * The figure for the month that starts on `monthStart` (`YYYY-MM-01`, the organization's
   * calendar). For a month still running, the figure so far. null when it cannot be worked out
   * (for example a percentage of nothing).
   */
  compute(ctx: ModuleContext, monthStart: string): Promise<number | null>;
}

const KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/;
const registries = new WeakMap<FastifyInstance, Map<string, MetricDef>>();

function registryOf(app: FastifyInstance): Map<string, MetricDef> {
  let map = registries.get(app);
  if (!map) registries.set(app, (map = new Map()));
  return map;
}

/** Adds a metric. Throws on a malformed or duplicate key, so a clash shows at start-up. */
export function defineMetric(app: FastifyInstance, def: MetricDef): void {
  if (!KEY_RE.test(def.key)) throw new Error(`Metric key "${def.key}" must look like <module>.<name> (lowercase, digits and underscores).`);
  if (!['count', 'percent', 'number'].includes(def.unit)) throw new Error(`Metric ${def.key} has an unknown unit "${def.unit}".`);
  const map = registryOf(app);
  if (map.has(def.key)) throw new Error(`Metric ${def.key} is defined twice.`);
  map.set(def.key, def);
}

/**
 * The metrics that can be computed now, sorted by key: those with no record type, and those whose
 * record type is loaded and switched on (`resources.get` answers undefined otherwise).
 */
export function metricsAvailable(app: FastifyInstance, resources: Pick<ResourceRegistry, 'get'>): MetricDef[] {
  return [...registryOf(app).values()]
    .filter((m) => !m.recordType || resources.get(m.recordType))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** `YYYY-MM` or `YYYY-MM-01` as `YYYY-MM-01`; null for anything else. */
export function monthStartOf(value: unknown): string | null {
  const m = MONTH_RE.exec(String(value ?? ''));
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/**
 * Whether `user` may see a metric in the list: one with no record type is for everyone signed in;
 * one with a record type needs view permission on that type's module (the figure itself counts
 * every record, restricted or not).
 */
function mayRead(ctx: Pick<ModuleContext, 'can' | 'resources'>, user: SessionUser | null, m: MetricDef): boolean {
  if (!m.recordType) return true;
  const def = ctx.resources.get(m.recordType);
  return !!def && ctx.can(user, `${def.module}.view`);
}

/** `GET /api/metrics`: the metrics the caller may read, with values for one month when asked. Registered by core. */
export function registerMetrics(ctx: ModuleContext): void {
  ctx.app.get('/api/metrics', async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const month = q.month === undefined || q.month === '' ? null : monthStartOf(q.month);
    if (q.month && !month) ctx.fail(400, 'validation', 'Check the highlighted fields.', { month: 'Give the month as YYYY-MM.' });
    const list = metricsAvailable(ctx.app, ctx.resources).filter((m) => mayRead(ctx, req.user ?? null, m));
    const metrics = [];
    for (const m of list) {
      const item: Record<string, unknown> = { key: m.key, label: m.label, unit: m.unit, description: m.description, recordType: m.recordType ?? null };
      if (month) {
        try {
          item.value = await m.compute(ctx, month);
        } catch (err) {
          console.error(`[metrics] ${m.key} for ${month}:`, err);
          item.value = null;
          item.error = 'This figure could not be worked out. The error has been logged.';
        }
      }
      metrics.push(item);
    }
    return { month, metrics };
  });
  ctx.describeRoute({
    method: 'GET',
    path: '/api/metrics',
    summary: 'Metrics other modules can compute indicators from',
    description: 'The named monthly figures the loaded modules offer (for example overdue actions), for computed safety performance indicators and key risk indicators. A metric about a record type is listed only while that type is switched on, and only to people who may view it. With `month`, each carries its value for that month (the figure so far for the current month); figures count every record, restricted ones included, and are the same for everyone.',
    tag: 'System',
    query: { month: 'Optional month, YYYY-MM: include each metric\'s value for that month' },
    response: {
      type: 'object',
      properties: {
        month: { type: ['string', 'null'], description: 'The first day of the month asked for, or null' },
        metrics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              unit: { type: 'string', enum: ['count', 'percent', 'number'] },
              description: { type: 'string' },
              recordType: { type: ['string', 'null'] },
              value: { type: ['number', 'null'] },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  });
}
