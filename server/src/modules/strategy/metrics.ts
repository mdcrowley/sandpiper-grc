// Metrics of the strategy area (core/metrics.ts): figures other modules (key risk indicators, safety
// indicators, figures over time, measures of another plan) can follow. Each counts every record.
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { monthEndOf } from '../../../../shared/dates.ts';
import { quarterOf } from './periods.ts';

/** The end of the month, or today for the month still running. */
const asOf = (monthStart: string) => {
  const end = monthEndOf(monthStart);
  const today = todayInZone();
  return end < today ? end : today;
};

/** Objectives of adopted plans whose latest update reported by then has this status. */
async function objectivesWith(ctx: ModuleContext, monthStart: string, status: string): Promise<number> {
  const end = asOf(monthStart);
  const r = await ctx.db.one<Row>(
    `select count(*)::int as n from (
       select distinct on (u.objective_id) u.status from strategy_updates u
       join strategy_objectives o on o.id = u.objective_id and o.deleted_at is null
       join strategy_plans p on p.id = o.plan_id and p.deleted_at is null and p.status = 'adopted'
       where u.deleted_at is null and u.period <= $2 and coalesce(u.reported_on, u.created_at::date) <= $1::date
       order by u.objective_id, u.period desc, u.reported_on desc nulls last, u.created_at desc) x
     where x.status = $3`, [end, quarterOf(end), status]);
  return Number(r?.n ?? 0);
}

export function registerStrategyMetrics(ctx: ModuleContext) {
  defineMetric(ctx.app, {
    key: 'strategy.objectives_off_track', label: 'Strategic objectives off track', unit: 'count', recordType: 'strategic_objective',
    description: 'Objectives of adopted strategic plans whose latest quarterly update by the end of the month says off track.',
    compute: (c, m) => objectivesWith(c, m, 'off_track'),
  });
  defineMetric(ctx.app, {
    key: 'strategy.objectives_at_risk', label: 'Strategic objectives at risk', unit: 'count', recordType: 'strategic_objective',
    description: 'Objectives of adopted strategic plans whose latest quarterly update by the end of the month says at risk.',
    compute: (c, m) => objectivesWith(c, m, 'at_risk'),
  });
  defineMetric(ctx.app, {
    key: 'strategy.submissions_overdue', label: 'Statistical reports overdue', unit: 'count', recordType: 'stat_submission',
    description: 'Statistical reports to outside bodies that were due by the end of the month and not submitted by then.',
    async compute(c, m) {
      const end = asOf(m);
      const r = await c.db.one<Row>(
        `select count(*)::int as n from strategy_submissions where deleted_at is null and due_on < $1::date
           and (submitted_on is null or submitted_on > $1::date)`, [end]);
      return Number(r?.n ?? 0);
    },
  });
  defineMetric(ctx.app, {
    key: 'strategy.measures_met_pct', label: 'Strategic measures meeting target', unit: 'percent', recordType: 'strategic_measure',
    description: 'Of the measures of adopted plans with an actual for a period ended by the end of the month, the share whose latest such actual meets its target.',
    async compute(c, m) {
      const end = asOf(m);
      const r = await c.db.one<Row>(
        `select count(*)::int as n, count(*) filter (where x.state = 'met')::int as met from (
           select distinct on (v.measure_id) v.state from strategy_measure_values v
           join strategy_measures s on s.id = v.measure_id and s.deleted_at is null
           join strategy_plans p on p.id = s.plan_id and p.deleted_at is null and p.status = 'adopted'
           where v.deleted_at is null and v.actual is not null and v.state is not null and v.state <> 'no_target' and v.period_end <= $1::date
           order by v.measure_id, v.period_start desc) x`, [end]);
      const n = Number(r?.n ?? 0);
      return n ? Math.round((Number(r!.met) / n) * 1000) / 10 : null;
    },
  });
}
