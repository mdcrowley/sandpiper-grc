// E45-44: change success rate. Of the changes finished in a period (an outcome recorded, canceled ones
// left out), the share that succeeded. An outcome flagged for a post-implementation review
// (`meta.pir` on the change_outcome list: failed and backed out by default) counts as not successful;
// "successful with issues" counts as successful. The day a change finished is its actual end, or the
// day its outcome was saved when no actual end was recorded.
//
// E45-66: a change linked to an incident it caused (a link from the change with the relation "caused"
// to a ticket, security incident or safety event, or from one of those to the change with "caused by")
// counts as not successful, whatever its outcome says.
//
// A figure (docs/security.md): it counts every change, whoever asks, and never names one.
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { addDays, addMonths } from '../../../../shared/dates.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Outcomes that mean the change did not happen at all: neither a success nor a failure. */
const NOT_DONE = ['cancelled', 'canceled'];
/** Record types that are incidents a change can cause (E45-66); a type that is not loaded is skipped. */
export const INCIDENT_TYPES = ['ticket', 'security_incident', 'safety_event'];
/** The link relation from a change to an incident it caused, and the reverse one. */
export const CAUSED = 'caused';
export const CAUSED_BY = ['caused by', 'caused_by'];

/** SQL true when change `c` caused an incident that is not deleted (no parameters). */
export function causedIncidentSql(ctx: ModuleContext, alias = 'c'): string {
  const parts: string[] = [];
  for (const type of INCIDENT_TYPES) {
    const def = ctx.resources.get(type);
    if (!def) continue;
    parts.push(`exists (select 1 from record_links l join ${def.table} x on x.id = l.to_id and x.deleted_at is null
      where l.from_type = 'change' and l.from_id = ${alias}.id and l.to_type = '${type}' and l.relation = '${CAUSED}')`);
    parts.push(`exists (select 1 from record_links l join ${def.table} x on x.id = l.from_id and x.deleted_at is null
      where l.to_type = 'change' and l.to_id = ${alias}.id and l.from_type = '${type}' and l.relation in (${CAUSED_BY.map((r) => `'${r}'`).join(', ')}))`);
  }
  return parts.length ? `(${parts.join(' or ')})` : 'false';
}
/** Days the success rate covers when no range is given. */
export const DEFAULT_DAYS = 90;

export interface SuccessRate {
  from: string; to: string; finished: number; successful: number; unsuccessful: number; success_pct: number | null;
  /** Changes whose outcome was a success but that caused an incident (counted as not successful). */
  caused_incident: number;
  by_outcome: { value: string; label: string; color: string; count: number; successful: boolean }[];
}

export async function successRate(ctx: ModuleContext, from: string, to: string): Promise<SuccessRate> {
  const outcomes = await ctx.lookups.values('change_outcome');
  const failing = new Set(outcomes.filter((o) => o.meta?.pir === true).map((o) => o.value));
  const rows = await ctx.db.query<{ outcome: string; count: number; caused: number }>(
    `select outcome, count(*)::int as count, count(*) filter (where ${causedIncidentSql(ctx, 'c')})::int as caused from changes c
     where deleted_at is null and outcome is not null and not (outcome = any($3::text[]))
       and coalesce(actual_end, updated_at) >= $1::date and coalesce(actual_end, updated_at) < ($2::date + 1)
     group by outcome`, [from, to, NOT_DONE]);
  let successful = 0;
  let unsuccessful = 0;
  let causedIncident = 0;
  const byOutcome = rows.map((r) => {
    const ok = !failing.has(r.outcome);
    if (ok) {
      successful += r.count - r.caused;
      unsuccessful += r.caused;
      causedIncident += r.caused;
    } else unsuccessful += r.count;
    const lv = outcomes.find((o) => o.value === r.outcome);
    return { value: r.outcome, label: lv?.label ?? r.outcome, color: lv?.color ?? 'gray', count: r.count, successful: ok };
  });
  const order = (v: string) => { const i = outcomes.findIndex((o) => o.value === v); return i < 0 ? 1e9 : i; };
  byOutcome.sort((a, b) => order(a.value) - order(b.value));
  const finished = successful + unsuccessful;
  return {
    from, to, finished, successful, unsuccessful, caused_incident: causedIncident,
    success_pct: finished ? Math.round((successful / finished) * 1000) / 10 : null,
    by_outcome: byOutcome,
  };
}

export function registerSuccessRate(ctx: ModuleContext): void {
  ctx.app.get('/api/changes/success-rate', { preHandler: ctx.requirePerm('changes.view') }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    for (const name of ['from', 'to'] as const) {
      if (q[name] && !DATE.test(q[name]!)) ctx.fail(400, 'validation', `"${name}" must be a date (YYYY-MM-DD).`, { [name]: 'Not a valid date.' });
    }
    const to = q.to || todayInZone();
    const from = q.from || addDays(to, -(DEFAULT_DAYS - 1));
    if (from > to) ctx.fail(400, 'validation', '"from" must not be after "to".', { from: 'Must not be after "to".' });
    return successRate(ctx, from, to);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/changes/success-rate', permission: 'changes.view',
    summary: 'Change success rate: of the changes finished in a period, the share that succeeded',
    description: `A figure: counts every change, whoever asks. Canceled changes are left out; outcomes flagged for a review (failed, backed out) count as not successful, and so does a change linked to an incident it caused (relation \"caused\" from the change to a ticket, security incident or safety event, or \"caused by\" back). Default: the last ${DEFAULT_DAYS} days.`,
    query: { from: 'First day (YYYY-MM-DD)', to: 'Last day (YYYY-MM-DD), default today' },
    response: '{ from, to, finished, successful, unsuccessful, caused_incident, success_pct (null when nothing finished), by_outcome: [{ value, label, color, count, successful }] }',
  });

  defineMetric(ctx.app, {
    key: 'changes.success_pct', label: 'Change success rate', unit: 'percent', recordType: 'change',
    description: 'Of the changes finished in the month (canceled ones left out), the share not failed or backed out and not linked to an incident they caused.',
    async compute(c, monthStart) {
      if (monthStart > dayInZone()) return null;
      const last = addDays(addMonths(monthStart, 1), -1);
      return (await successRate(c, monthStart, last)).success_pct;
    },
  });
}
