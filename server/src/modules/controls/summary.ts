import type { ModuleContext, Row } from '../../core/module.ts';
import { defineMetric } from '../../core/metrics.ts';
import { dayInZone } from '../../core/timezone.ts';
import { controlState } from './coverage.ts';
import { meanings } from './lists.ts';
import { addMonths, COVERS, coverDefs, REVIEW_FIELDS } from './shared.ts';

/**
 * The controls dashboard's figures and the module's metrics (E26-09, contract C3). Figures are the
 * same for everyone (docs/security.md): they count every record, restricted ones included, and name
 * none. Coverage figures are given only for the record types the caller may view.
 */

/** The last day of the month that starts on `monthStart`. */
function lastDay(monthStart: string): string {
  const d = new Date(`${addMonths(monthStart, 1)}T00:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** The day a monthly figure is taken on: the month's last day, or today for the month still running. */
function cutoffOf(monthStart: string): string {
  const today = dayInZone();
  const end = lastDay(monthStart);
  return end < today ? end : today;
}

interface Tested { control_id: string; test_type: string; result: string; tested_on: string; reviewed_on: string }

async function reviewedTests(ctx: ModuleContext, cutoff: string): Promise<Tested[]> {
  const { final } = await meanings(ctx);
  return ctx.db.query<Tested>(
    `select control_id, test_type, result, coalesce(performed_on, reviewed_on)::text as tested_on, reviewed_on::text as reviewed_on
     from control_tests where deleted_at is null and status = any($1::text[]) and result is not null
       and reviewed_on is not null and reviewed_on <= $2::date
     order by coalesce(performed_on, reviewed_on) desc, reviewed_on desc, created_at desc`,
    [final, cutoff],
  );
}

async function liveControls(ctx: ModuleContext, cutoff: string): Promise<Row[]> {
  const { retired } = await meanings(ctx);
  return ctx.db.query<Row>(
    `select id, test_every_months, last_tested_on::text as last_tested_on, next_test_due::text as next_test_due from controls
     where deleted_at is null and not (coalesce(status, '') = any($1::text[])) and created_at::date <= $2::date`,
    [retired, cutoff],
  );
}

/** Controls whose test was overdue on the month's cutoff day, worked out from the tests reviewed by then. */
export async function testsOverdue(ctx: ModuleContext, monthStart: string): Promise<number> {
  const cutoff = cutoffOf(monthStart);
  const tests = await reviewedTests(ctx, cutoff);
  let n = 0;
  for (const c of await liveControls(ctx, cutoff)) {
    const last = tests.find((t) => t.control_id === c.id);
    const due = last ? (c.test_every_months ? addMonths(last.tested_on, Number(c.test_every_months)) : null)
      : (c.last_tested_on ? null : c.next_test_due);
    if (due && due < cutoff) n += 1;
  }
  return n;
}

/** Controls whose newest reviewed design or operating test on the cutoff day was ineffective. */
export async function ineffectiveControls(ctx: ModuleContext, monthStart: string): Promise<number> {
  const cutoff = cutoffOf(monthStart);
  const { failed } = await meanings(ctx);
  const tests = await reviewedTests(ctx, cutoff);
  let n = 0;
  for (const c of await liveControls(ctx, cutoff)) {
    const mine = tests.filter((t) => t.control_id === c.id);
    const design = mine.find((t) => t.test_type === 'design');
    const operating = mine.find((t) => t.test_type !== 'design');
    if ((design && failed.includes(design.result)) || (operating && failed.includes(operating.result))) n += 1;
  }
  return n;
}

export function registerSummary(ctx: ModuleContext) {
  const { app, db } = ctx;

  defineMetric(app, {
    key: 'controls.tests_overdue', label: 'Control tests overdue', unit: 'count', recordType: 'control',
    description: 'Controls in use whose next test was overdue at the end of the month (or today, for the month still running), counting from the tests reviewed by then.',
    compute: (c, month) => testsOverdue(c, month),
  });
  defineMetric(app, {
    key: 'controls.ineffective', label: 'Ineffective controls', unit: 'count', recordType: 'control',
    description: 'Controls in use whose newest reviewed design or operating test by the end of the month was rated ineffective.',
    compute: (c, month) => ineffectiveControls(c, month),
  });

  app.get('/api/controls/summary', { preHandler: ctx.requirePerm('controls.view') }, async (req) => {
    const m = await meanings(ctx);
    const today = dayInZone();
    const soon = dayInZone(30);
    const controls = await db.query<Row>(
      `select id, ref, title, status, key_control, domain, design_rating, operating_rating, next_test_due::text as next_test_due
       from controls where deleted_at is null`,
    );
    const live = controls.filter((c) => !m.retired.includes(c.status));
    const states = live.map((c) => controlState(c, today, m));
    const t = (await db.one<Row>(
      `select count(*) filter (where not (coalesce(status, '') = any($1::text[])))::int as open,
              count(*) filter (where status = any($1::text[]) and not (status = any($2::text[])))::int as awaiting_review,
              count(*) filter (where status = any($2::text[]) and reviewed_on > $3::date)::int as reviewed_12m,
              count(*) filter (where status = any($2::text[]) and reviewed_on > $3::date and result = any($4::text[]))::int as failed_12m
       from control_tests where deleted_at is null`,
      [m.done, m.final, dayInZone(-365), m.failed],
    ))!;
    const results = await ctx.lookups.values('control_test_result');
    const domains = await ctx.lookups.values('control_domain');
    const by_rating = [
      ...results.map((r) => ({ value: r.value, label: r.label, color: r.color ?? 'gray', count: live.filter((c) => c.operating_rating === r.value).length })),
      { value: '', label: 'Not tested yet', color: 'gray', count: live.filter((c) => !c.operating_rating).length },
    ];
    const by_domain = domains.map((d) => ({ value: d.value, label: d.label, color: d.color ?? 'gray', count: live.filter((c) => c.domain === d.value).length }));

    // Reviewed tests in each of the last twelve months, by result.
    const first = addMonths(`${today.slice(0, 7)}-01`, -11);
    const monthly = await db.query<Row>(
      `select to_char(coalesce(performed_on, reviewed_on), 'YYYY-MM') as period, result, count(*)::int as n
       from control_tests where deleted_at is null and status = any($1::text[]) and coalesce(performed_on, reviewed_on) >= $2::date
       group by 1, 2`, [m.final, first],
    );
    const periods = Array.from({ length: 12 }, (_, i) => addMonths(first, i).slice(0, 7));
    const by_month = periods.map((p) => ({
      period: p,
      ...Object.fromEntries(results.map((r) => [r.value, monthly.filter((x) => x.period === p && x.result === r.value).reduce((s, x) => s + x.n, 0)])),
    }));

    // Coverage figures for the record types the caller may view: every record counts, restricted or not.
    const failedIds = live.filter((c) => m.failed.includes(c.operating_rating) || m.failed.includes(c.design_rating)).map((c) => c.id);
    const coverage = [];
    for (const def of coverDefs(ctx, req)) {
      const r = (await db.one<Row>(
        `select count(distinct l.to_id)::int as covered,
                count(distinct l.to_id) filter (where l.from_id = any($3::uuid[]))::int as relying_on_failed
         from record_links l join ${def.table} t on t.id = l.to_id and t.deleted_at is null
         join controls c on c.id = l.from_id and c.deleted_at is null
         where l.from_type = 'control' and l.relation = $1 and l.to_type = $2`,
        [COVERS, def.type, failedIds],
      ))!;
      coverage.push({ type: def.type, label: def.label, plural: def.plural, flagged: def.type in REVIEW_FIELDS, ...r });
    }

    const due = live.filter((c) => c.next_test_due && c.next_test_due <= soon)
      .sort((a, b) => a.next_test_due.localeCompare(b.next_test_due)).slice(0, 10)
      .map((c) => ({ id: c.id, ref: c.ref, title: c.title, next_test_due: c.next_test_due, overdue: c.next_test_due < today }));

    return {
      today,
      totals: {
        controls: live.length,
        active: live.filter((c) => c.status === 'active').length,
        key: live.filter((c) => c.key_control).length,
        retired: controls.length - live.length,
        // Each figure on its own (a control may be both ineffective and overdue); the coverage view
        // instead files each control under its worst state.
        ineffective: failedIds.length,
        overdue: live.filter((c) => c.next_test_due && c.next_test_due < today).length,
        untested: live.filter((c) => !c.operating_rating).length,
        partly_effective: states.filter((x) => x === 'partly_effective').length,
        effective: states.filter((x) => x === 'effective').length,
        due_soon: live.filter((c) => c.next_test_due && c.next_test_due >= today && c.next_test_due <= soon).length,
        tests_open: t.open, awaiting_review: t.awaiting_review, reviewed_12m: t.reviewed_12m, failed_12m: t.failed_12m,
      },
      by_rating, by_domain, by_month, results: results.map((r) => ({ value: r.value, label: r.label, color: r.color ?? 'gray' })),
      coverage, due,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/controls/summary', permission: 'controls.view',
    summary: 'Figures for the controls dashboard: ratings, tests due and overdue, recent results and coverage',
    description: 'Counts every record, the same for everyone; coverage figures are given for the record types the caller may view and name no record.',
    response: '{ today, totals, by_rating, by_domain, by_month, results, coverage: [{ type, label, plural, covered, relying_on_failed }], due }',
  });
}
