import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { flagged } from './shared.ts';

/**
 * The funding dashboard (E27-09): awards by status, reports due, open deficiencies and this year's
 * certification progress. Funding records are never restricted, so every figure is the same for
 * everyone who may view funding records.
 */
export function registerSummary(ctx: ModuleContext) {
  const { db } = ctx;

  ctx.app.get('/api/funding/summary', { preHandler: ctx.requirePerm('funding.view') }, async () => {
    const today = todayInZone();
    const soon = dayInZone(30);
    const year = Number(today.slice(0, 4));
    const closedAward = await flagged(ctx, 'funding_award_status', 'closed', ['closed_out']);
    const closedDef = await flagged(ctx, 'review_deficiency_status', 'closed', ['closed']);
    const closedReview = await flagged(ctx, 'compliance_review_status', 'closed', ['closed']);

    const statuses = await ctx.lookups.values('funding_award_status');
    const byStatus = await db.query<Row>(
      `select coalesce(status, '') as value, count(*)::int as count, coalesce(sum(amount), 0)::numeric as amount
       from funding_awards where deleted_at is null group by 1`);
    const awards = statuses.map((s) => {
      const r = byStatus.find((x) => x.value === s.value);
      return { value: s.value, label: s.label, color: s.color ?? 'gray', count: r?.count ?? 0, amount: Number(r?.amount ?? 0) };
    });
    const open = await db.one<Row>(
      `select count(*)::int as n, coalesce(sum(amount), 0)::numeric as amount, coalesce(sum(local_share), 0)::numeric as local_share
       from funding_awards where deleted_at is null and not (coalesce(status, '') = any($1::text[]))`, [closedAward]);

    const reports = await db.query<Row>(
      `select id, ref, title, funder_name, next_report_due::text as due_on, 'report' as kind from funding_awards
       where deleted_at is null and not (coalesce(status, '') = any($1::text[])) and next_report_due is not null and next_report_due <= $2::date
       union all
       select id, ref, title, funder_name, closeout_due::text as due_on, 'closeout' as kind from funding_awards
       where deleted_at is null and not (coalesce(status, '') = any($1::text[])) and closeout_due is not null and closeout_due <= $2::date
       order by due_on`, [closedAward, soon]);

    const deficiencies = await db.one<Row>(
      `select count(*)::int as open, count(*) filter (where due_on < $2::date)::int as overdue,
              count(*) filter (where cap_id is null)::int as without_plan
       from review_deficiencies where deleted_at is null and not (coalesce(status, '') = any($1::text[]))`, [closedDef, today]);

    const certifications = await db.query<Row>(
      `select c.id, c.ref, c.title, c.year, c.status, c.due_on::text as due_on,
              count(i.id) filter (where i.applies)::int as applicable,
              count(i.id) filter (where i.applies and i.confirmed_on is not null)::int as confirmed
       from funding_certifications c left join funding_certification_items i on i.certification_id = c.id
       where c.deleted_at is null and c.year in ($1, $2)
       group by c.id order by c.year desc, c.ref`, [year, year + 1]);

    const reviews = await db.query<Row>(
      `select r.id, r.ref, r.title, r.status, r.site_visit_on::text as site_visit_on,
              (select count(*)::int from compliance_review_areas a where a.review_id = r.id) as areas,
              (select count(*)::int from compliance_review_areas a where a.review_id = r.id and a.self_assessment <> 'not_assessed') as assessed,
              (select count(*)::int from compliance_review_areas a where a.review_id = r.id and a.self_assessment = 'deficient') as deficient,
              (select count(*)::int from review_deficiencies d where d.review_id = r.id and d.deleted_at is null and not (coalesce(d.status, '') = any($2::text[]))) as open_deficiencies
       from compliance_reviews r where r.deleted_at is null and not (coalesce(r.status, '') = any($1::text[]))
       order by r.site_visit_on nulls last, r.ref`, [closedReview, closedDef]);

    return {
      today,
      awards: { by_status: awards, open: open?.n ?? 0, open_amount: Number(open?.amount ?? 0), open_local_share: Number(open?.local_share ?? 0) },
      reports: { overdue: reports.filter((r) => r.due_on < today).length, due_soon: reports.filter((r) => r.due_on >= today).length, list: reports.slice(0, 20) },
      deficiencies: { open: deficiencies?.open ?? 0, overdue: deficiencies?.overdue ?? 0, without_plan: deficiencies?.without_plan ?? 0 },
      certifications,
      reviews,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funding/summary', tag: 'Funding', permission: 'funding.view',
    summary: 'The funding dashboard: awards by status, reports and close-outs due within 30 days, open deficiencies, certification progress and open reviews',
    response: '{ today, awards: { by_status, open, open_amount, open_local_share }, reports: { overdue, due_soon, list }, deficiencies: { open, overdue, without_plan }, certifications, reviews }',
  });
}
