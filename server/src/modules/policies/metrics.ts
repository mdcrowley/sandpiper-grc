// Document-control figures for the shared metrics registry (core/metrics.ts, E43). Figures count
// every document, restricted ones included, and never name one ("Figures are the same for everyone").
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays, monthEndOf } from '../../../../shared/dates.ts';

/** The last day of the month, or today for the month still running. */
const asOf = (monthStart: string): string => {
  const end = monthEndOf(monthStart);
  const today = dayInZone();
  return end < today ? end : today;
};

export function registerDocumentMetrics(ctx: ModuleContext): void {
  defineMetric(ctx.app, {
    key: 'policies.reviews_overdue', label: 'Documents overdue for review', unit: 'count', recordType: 'policy',
    description: 'Effective documents whose next review date had passed at the end of the month (today, for the month still running).',
    async compute(c, monthStart) {
      const d = asOf(monthStart);
      return (await c.db.one<{ n: number }>(
        `select count(*)::int as n from policies where deleted_at is null and status = 'published' and review_date < $1::date`, [d]))!.n;
    },
  });
  defineMetric(ctx.app, {
    key: 'policies.reviews_due_90', label: 'Document reviews due within 90 days', unit: 'count', recordType: 'policy',
    description: 'Effective documents whose next review falls within 90 days after the end of the month (today, for the month still running).',
    async compute(c, monthStart) {
      const d = asOf(monthStart);
      return (await c.db.one<{ n: number }>(
        `select count(*)::int as n from policies where deleted_at is null and status = 'published' and review_date >= $1::date and review_date <= $2::date`,
        [d, addDays(d, 90)]))!.n;
    },
  });
  defineMetric(ctx.app, {
    key: 'policies.ack_completion_pct', label: 'Document acknowledgments completed', unit: 'percent', recordType: 'policy',
    description: 'Of the acknowledgment requests for effective versions made by the end of the month, the share acknowledged.',
    async compute(c, monthStart) {
      const d = asOf(monthStart);
      const r = (await c.db.one<{ asked: number; done: number }>(
        `select count(*)::int as asked, count(*) filter (where a.acknowledged_at is not null and a.acknowledged_at::date <= $1::date)::int as done
         from policy_acknowledgements a join policies p on p.id = a.policy_id and p.deleted_at is null
         where a.requested_at::date <= $1::date and (a.superseded_at is null or a.superseded_at::date > $1::date or a.acknowledged_at is not null)`, [d]))!;
      return r.asked ? Math.round((r.done / r.asked) * 1000) / 10 : null;
    },
  });
  defineMetric(ctx.app, {
    key: 'policies.documents_without_owner', label: 'Documents without an owner', unit: 'count', recordType: 'policy',
    description: 'Documents that are not obsolete and have no owner (current state, also for past months).',
    async compute(c) {
      return (await c.db.one<{ n: number }>(`select count(*)::int as n from policies where deleted_at is null and status <> 'retired' and owner_id is null`))!.n;
    },
  });
}
