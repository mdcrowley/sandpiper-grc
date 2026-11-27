import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { EVIDENCE_TYPE } from './links.ts';

/**
 * Dev profile only, all invented: a handful of evidence records (one lapsed, one about to lapse, one
 * restricted) linked to sample controls and an obligation (by title) that exist by then. Modules seed in name
 * order, so obligations (risks module) do not exist yet on a first run; a second run links them. The
 * funding seed links the sample funder review's areas to these records.
 */

export const EVIDENCE_SAMPLE_NOTE = 'Invented sample evidence record.';

export const SAMPLE_EVIDENCE: Row[] = [
  { key: 'procurement', title: '[Sample] Procurement procedure with price analysis step', source: 'link', url: 'https://intranet.example.test/procedures/procurement',
    description: 'The written procurement procedure, including the price analysis step and the clause checklist for funded contracts.', collected: -40, valid: 325, links: [['control', 'Supplier security assessment before award']] },
  { key: 'inventory', title: '[Sample] Funded equipment inventory export', source: 'link', url: 'https://intranet.example.test/reports/funded-equipment',
    description: 'Export of the asset inventory with the funding share of each funded item.', collected: -330, valid: 20, links: [['control', 'Software license reconciliation']] },
  { key: 'audit', title: '[Sample] Independent financial audit report', source: 'file',
    description: 'The independent auditor\'s report and management letter for the last financial year.', collected: -380, valid: -15, links: [['obligation', 'Quarterly ridership and service data return']] },
  { key: 'access', title: '[Sample] Quarterly access review sign-off', source: 'file', restricted: true,
    description: 'Signed confirmation that system owners reviewed user access this quarter.', collected: -20, valid: 70, links: [['control', 'Quarterly user access review']] },
];

export async function seedEvidence(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample evidence is dev profile only)';
  const owner = (await ctx.db.one<Row>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  let created = 0;
  let linked = 0;
  for (const s of SAMPLE_EVIDENCE) {
    let row = await ctx.db.one<Row>('select * from evidence_records where title = $1 and deleted_at is null', [s.title]);
    if (!row) {
      row = await ctx.resources.create(EVIDENCE_TYPE, {
        title: s.title, description: s.description, source: s.source, url: s.url ?? null, owner_id: owner, restricted: s.restricted === true,
        collected_on: dayInZone(s.collected), valid_until: dayInZone(s.valid), period_start: dayInZone(s.collected - 365), period_end: dayInZone(s.collected),
        notes: EVIDENCE_SAMPLE_NOTE,
      });
      created++;
    }
    // Link to the sample records of that title that exist by now.
    for (const [type, title] of s.links as [string, string][]) {
      const def = ctx.resources.get(type);
      if (!def) continue;
      const target = await ctx.db.one<Row>(`select id from ${def.table} where deleted_at is null and ${def.titleField} = $1 order by created_at limit 1`, [title]);
      if (!target) continue;
      const added = await ctx.db.query(
        `insert into evidence_links (evidence_id, record_type, record_id, part, relation) values ($1,$2,$3,'','supports')
         on conflict (evidence_id, record_type, record_id, part) do nothing returning id`, [row.id, type, target.id]);
      linked += added.length;
    }
  }
  return `evidence records ${created}, links ${linked}`;
}
