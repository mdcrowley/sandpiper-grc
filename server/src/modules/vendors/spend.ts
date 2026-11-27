// E45-43: what the organization spends each year, on contract and vendor lists.
//
// A contract's annual value is worked out, never typed: this year's line of "Value by year" when
// there is one; otherwise the average of the lines given; otherwise the total value spread over
// the term (start to end date, at least one year). A vendor's annual spend is the sum of the annual
// values of its active contracts. Both are stored (so lists sort and filter by them), worked out
// again whenever a contract is saved, and refreshed at start and every few hours (a new year moves
// "this year's line", and a deleted contract drops out).
//
// The totals are figures: they count every contract and vendor, whoever asks (docs/security.md,
// "Figures are the same for everyone").
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { daysBetween } from '../../../../shared/dates.ts';

const round = (n: number) => Math.round(n * 100) / 100;
const ymd = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

/** The contract's value for one year (see the file comment), or null when it cannot be worked out. */
export function annualValueOf(c: Row, year: string = todayInZone().slice(0, 4)): number | null {
  const byYear = c.value_by_year && typeof c.value_by_year === 'object' && !Array.isArray(c.value_by_year)
    ? Object.entries(c.value_by_year as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    : [];
  const thisYear = byYear.find(([y]) => y === year);
  if (thisYear) return round(Number(thisYear[1]));
  if (byYear.length) return round(byYear.reduce((n, [, v]) => n + Number(v), 0) / byYear.length);
  if (c.total_value === null || c.total_value === undefined || c.total_value === '') return null;
  const total = Number(c.total_value);
  if (!Number.isFinite(total)) return null;
  const start = ymd(c.start_date);
  const end = ymd(c.end_date);
  if (!start || !end || end < start) return round(total);
  // The term in whole months, so a three-year term counts as exactly three years.
  const years = Math.max(1, Math.round(((daysBetween(start, end) + 1) / 365.25) * 12) / 12);
  return round(total / years);
}

/** Works the vendors' annual spend out again (all vendors, or the ones named). */
export async function refreshVendorSpend(ctx: ModuleContext, vendorIds?: (string | null | undefined)[]): Promise<void> {
  const ids = vendorIds?.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (ids && !ids.length) return;
  await ctx.db.query(
    `update vendors v set annual_spend = s.total
     from (select v2.id, (select sum(c.annual_value) from contracts c
                          where c.vendor_id = v2.id and c.deleted_at is null and c.status = 'active') as total
           from vendors v2 ${ids ? 'where v2.id = any($1::uuid[])' : ''}) s
     where v.id = s.id and v.annual_spend is distinct from s.total`,
    ids ? [ids] : [],
  );
}

/** Works every contract's annual value out again, then every vendor's spend. */
export async function refreshAllSpend(ctx: ModuleContext): Promise<{ contracts: number }> {
  const rows = await ctx.db.query<Row>(
    'select id, value_by_year, total_value, start_date::text as start_date, end_date::text as end_date, annual_value from contracts where deleted_at is null');
  let changed = 0;
  for (const r of rows) {
    const value = annualValueOf(r);
    const before = r.annual_value === null || r.annual_value === undefined ? null : Number(r.annual_value);
    if (value === before) continue;
    await ctx.db.query('update contracts set annual_value = $2 where id = $1', [r.id, value]);
    changed += 1;
  }
  await refreshVendorSpend(ctx);
  return { contracts: changed };
}

export function registerSpend(ctx: ModuleContext): void {
  const { db } = ctx;

  // A contract saved or deleted changes its vendor's spend.
  ctx.resources.onChange?.(async (c) => {
    if (c.def.type !== 'contract') return;
    await refreshVendorSpend(ctx, [c.row.vendor_id]);
  });

  ctx.app.get('/api/contracts/spend-summary', { preHandler: ctx.requirePerm('contracts.view') }, async () => {
    const r = await db.one<Row>(
      `select count(*)::int as active, count(annual_value)::int as with_value, coalesce(sum(annual_value), 0)::float as annual_value
       from contracts where deleted_at is null and status = 'active'`);
    return { year: todayInZone().slice(0, 4), active: r?.active ?? 0, withValue: r?.with_value ?? 0, annualValue: round(Number(r?.annual_value ?? 0)) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/contracts/spend-summary', permission: 'contracts.view',
    summary: 'Total annual value of the active contracts',
    description: 'A figure: counts every active contract, whoever asks. `withValue` is how many have an annual value that could be worked out.',
    response: { type: 'object', properties: { year: { type: 'string' }, active: { type: 'integer' }, withValue: { type: 'integer' }, annualValue: { type: 'number' } } },
  });

  ctx.app.get('/api/vendors/spend-summary', { preHandler: ctx.requirePerm('vendors.view') }, async () => {
    const r = await db.one<Row>(
      `select count(*) filter (where annual_spend is not null)::int as with_spend, coalesce(sum(annual_spend), 0)::float as annual_spend
       from vendors where deleted_at is null`);
    return { year: todayInZone().slice(0, 4), withSpend: r?.with_spend ?? 0, annualSpend: round(Number(r?.annual_spend ?? 0)) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/spend-summary', permission: 'vendors.view',
    summary: 'Total annual spend with vendors (their active contracts)',
    description: 'A figure: counts every vendor and contract, whoever asks.',
    response: { type: 'object', properties: { year: { type: 'string' }, withSpend: { type: 'integer' }, annualSpend: { type: 'number' } } },
  });
}
