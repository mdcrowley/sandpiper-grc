import type { ModuleContext, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addMonths } from '../../../../shared/dates.ts';

/**
 * Invented samples (dev profile only, E41-15): a short retention schedule of paper and electronic
 * series, and one proposed destruction of records past their period. The periods are examples only:
 * no law of any one place is a default, so each organization enters its own schedule and authority.
 * Idempotent: series are found by title.
 */
const SERIES = [
  {
    title: '[Sample] Vehicle maintenance work orders', code: 'MNT-01', category: 'maintenance', medium: 'both',
    retention_value: 4, retention_unit: 'years', trigger_event: 'asset_disposed', disposition: 'destroy',
    location: 'Depot file room and the maintenance system', authority: '[Sample] Organization records policy',
    description: 'Work orders, inspection sheets and parts records for each bus and rail car.',
  },
  {
    title: '[Sample] Accounts payable files', code: 'FIN-04', category: 'finance', medium: 'paper',
    retention_value: 7, retention_unit: 'years', trigger_event: 'fiscal_year_end', disposition: 'destroy',
    location: 'Off-site records store, boxes by fiscal year', authority: '[Sample] Organization records policy',
    description: 'Invoices, payment approvals and vendor statements.',
  },
  {
    title: '[Sample] Safety event investigation files', code: 'SAF-02', category: 'safety', medium: 'electronic',
    retention_value: 10, retention_unit: 'years', trigger_event: 'closed', disposition: 'review',
    location: 'Safety management system', authority: '[Sample] Organization records policy', personal_data: true, vital: true,
    description: 'Investigation reports, statements and corrective action evidence.',
  },
  {
    title: '[Sample] Board meeting minutes', code: 'GOV-01', category: 'legal', medium: 'both', permanent: true,
    retention_unit: 'years', trigger_event: 'created', disposition: 'transfer', vital: true,
    location: 'Clerk of the board', authority: '[Sample] Organization records policy',
    description: 'Approved minutes and resolutions of the governing board.',
  },
];

export async function seedRetention(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'samples only in the dev profile';
  if (!ctx.resources.get('record_series')) return 'switched off';
  let n = 0;
  const ids: Record<string, string> = {};
  for (const s of SERIES) {
    const found = await ctx.db.one<{ id: string }>('select id from record_series where title = $1 and deleted_at is null', [s.title]);
    if (found) { ids[s.code] = found.id; continue; }
    ids[s.code] = (await ctx.resources.create('record_series', { ...s, review_on: addMonths(dayInZone(), 6) })).id;
    n++;
  }
  const title = '[Sample] Accounts payable boxes, oldest fiscal year';
  if (!(await ctx.db.one('select 1 from records_destructions where title = $1 and deleted_at is null', [title]))) {
    const fiscalEnd = addMonths(dayInZone(), -8 * 12);
    await ctx.resources.create('records_destruction', {
      title, series_id: ids['FIN-04'], description: 'Twelve boxes of invoices and payment approvals.',
      records_from: addMonths(fiscalEnd, -12), records_to: fiscalEnd, trigger_date: fiscalEnd,
      quantity: '12 boxes', location: 'Off-site records store, shelf B', method: 'shredding',
    });
    n++;
  }
  return `${n} sample retention records`;
}
