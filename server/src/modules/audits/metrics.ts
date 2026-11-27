// Metrics this module offers to computed indicators (contract C3, core/metrics.ts). Figures: every
// record counts, restricted or not.
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays, nextMonthStart } from './dates.ts';

export function registerMetrics(ctx: ModuleContext) {
  defineMetric(ctx.app, {
    key: 'audits.inspections_on_time_pct', label: 'Inspections done on time', unit: 'percent', recordType: 'inspection',
    description: 'Of the inspections due in the month (those already done, or whose due date has passed; canceled ones are left out), the share completed on or before the due date.',
    async compute(c, monthStart) {
      const today = dayInZone();
      const r = await c.db.one<Row>(
        `select count(*) filter (where status = 'complete' or due_on < $3::date)::int as due,
                count(*) filter (where status = 'complete' and performed_on <= due_on)::int as on_time
         from inspections where deleted_at is null and coalesce(status, '') not in ('canceled', 'cancelled') and due_on >= $1::date and due_on < $2::date`,
        [monthStart, nextMonthStart(monthStart), today]);
      const due = Number(r?.due ?? 0);
      return due ? Math.round((Number(r!.on_time) / due) * 1000) / 10 : null;
    },
  });

  defineMetric(ctx.app, {
    key: 'audits.findings_overdue', label: 'Audit findings overdue', unit: 'count', recordType: 'audit_finding',
    description: 'Findings without a management response or corrective action plan past their response due date, at the end of the month (today for the month still running). Closed findings are not counted.',
    async compute(c, monthStart) {
      const today = dayInZone();
      const end = addDays(nextMonthStart(monthStart), -1);
      const at = end < today ? end : today;
      if (monthStart > today) return null;
      const r = await c.db.one<Row>(
        `select count(*)::int as n from audit_findings
         where deleted_at is null and coalesce(status, '') <> 'closed' and created_at::date <= $1::date
           and response_due < $1::date and (responded_on is null or responded_on > $1::date)`, [at]);
      return Number(r?.n ?? 0);
    },
  });

  defineMetric(ctx.app, {
    key: 'audits.verifications_overdue', label: 'Finding verifications overdue', unit: 'count', recordType: 'audit_finding',
    description: 'Findings whose fix waits for the auditor\'s verification past its due date, at the end of the month (today for the month still running). Current state only: a verification recorded later is not taken back.',
    async compute(c, monthStart) {
      const today = dayInZone();
      if (monthStart > today) return null;
      const end = addDays(nextMonthStart(monthStart), -1);
      const at = end < today ? end : today;
      const r = await c.db.one<Row>(
        `select count(*)::int as n from audit_findings
         where deleted_at is null and verification_due < $1::date and (verified_on is null or verified_on > $1::date)
           and (coalesce(status, '') <> 'closed' or verified_on > $1::date)`, [at]);
      return Number(r?.n ?? 0);
    },
  });
}
