import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { FUNDED_BY } from './awards.ts';
import { applyAreaSet, loadAreas, readSampleAreas, validateAreaSet } from './reviews.ts';
import { seedSubrecipients } from './subrecipients.ts';

/**
 * Dev profile only, all invented: four funding awards with invented funders, this year's
 * certification with 20 items, and one compliance review built from the invented sample file of
 * review areas, with requests and two deficiencies (one with a corrective action plan when that
 * record type is there). Modules seed in name order, so assets, vehicles, projects and contracts
 * do not exist yet on a first run: the sample awards are linked to whichever of them exist, and a
 * second run of the seed links the rest.
 */

export const SAMPLE_NOTE = 'Invented sample record.';

const AWARDS: Row[] = [
  { title: 'Bus replacement (sample)', funder_name: 'Example Regional Transport Fund', program_name: 'Sample capital program', award_number: 'SAMPLE-CAP-0101', status: 'active', amount: 6400000, local_share: 1600000, reporting_frequency: 'quarterly', start: -400, end: 700, report: 20, closeout: 790, funds: ['vehicle', 'project'] },
  { title: 'Station accessibility upgrade (sample)', funder_name: 'Example Accessibility Grant Fund', program_name: 'Sample access program', award_number: 'SAMPLE-ACC-0207', status: 'awarded', amount: 1850000, local_share: 370000, reporting_frequency: 'half_yearly', start: -60, end: 900, report: 120, closeout: 990, funds: ['contract'] },
  { title: 'Operating assistance (sample)', funder_name: 'Example Regional Transport Fund', program_name: 'Sample operating program', award_number: 'SAMPLE-OPS-0330', status: 'active', amount: 2200000, local_share: 2200000, reporting_frequency: 'yearly', start: -300, end: 65, report: -5, closeout: 155, funds: [] },
  { title: 'Cybersecurity improvement (sample)', funder_name: 'Example Resilience Foundation', program_name: 'Sample resilience grants', award_number: 'SAMPLE-RES-0412', status: 'applied', amount: 480000, local_share: 120000, reporting_frequency: 'quarterly', start: 30, end: 760, report: null, closeout: null, funds: ['asset'] },
];

/** [category, statement] */
const ITEMS: [string, string][] = [
  ['general', 'The organization has the legal authority to apply for and accept the awards it holds.'],
  ['general', 'The authorized official is empowered by the governing body to sign on its behalf.'],
  ['general', 'Information in applications and reports is complete and accurate to the best of our knowledge.'],
  ['financial', 'Award funds are accounted for separately and used only for approved purposes.'],
  ['financial', 'An independent financial audit was completed for the last financial year.'],
  ['financial', 'Local share funds are available and committed.'],
  ['procurement', 'Purchases with award funds follow the written procurement procedures.'],
  ['procurement', 'Funded contracts carry the clauses the funder requires.'],
  ['procurement', 'No contractor paid with award funds is excluded from publicly funded work.'],
  ['assets', 'Funded vehicles, equipment and facilities are recorded in the asset inventory.'],
  ['assets', 'Funded property is maintained under a written maintenance plan.'],
  ['assets', 'Funded property is not disposed of without the funder\'s approval where it keeps an interest.'],
  ['operations', 'A safety plan is in place and was reviewed in the last twelve months.'],
  ['operations', 'Safety-sensitive staff are trained for their duties.'],
  ['accessibility', 'Vehicles and facilities bought with award funds are accessible.'],
  ['accessibility', 'Accessibility features are kept in working order.'],
  ['workforce', 'Staff and applicants are treated fairly without discrimination.'],
  ['workforce', 'Arrangements protecting employees affected by funded projects are in place where the award requires them.'],
  ['environment', 'Funded projects were assessed for environmental effects before work started.'],
  ['other', 'The organization has no unresolved findings from a previous funder review.'],
];

const REQUESTS: [string, string, number, string][] = [
  ['FM', 'Most recent independent financial audit report and management letter', -10, 'provided'],
  ['PR', 'Procurement files for the three largest funded contracts of the period', 14, 'open'],
  ['AM', 'Inventory of funded equipment with funding shares', 21, 'open'],
];

export async function seedFunding(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample funding data is dev profile only)';
  const owner = (await ctx.db.one<Row>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  const loaded = await ctx.db.one('select 1 from funding_awards where notes = $1 limit 1', [SAMPLE_NOTE]);
  const parts: string[] = [];

  if (!loaded) {
    // Awards (their reporting obligations follow when the obligations register is there).
    for (const a of AWARDS) {
      await ctx.resources.create('funding_award', {
        title: a.title, funder_name: a.funder_name, program_name: a.program_name, award_number: a.award_number, status: a.status,
        amount: a.amount, local_share: a.local_share, reporting_frequency: a.reporting_frequency,
        period_start: dayInZone(a.start), period_end: dayInZone(a.end),
        next_report_due: a.report === null ? null : dayInZone(a.report), closeout_due: a.closeout === null ? null : dayInZone(a.closeout),
        manager_id: owner, notes: SAMPLE_NOTE,
      });
    }
    parts.push(`awards ${AWARDS.length}`);

    // This year's certification, most items confirmed.
    const year = Number(todayInZone().slice(0, 4));
    const cert = await ctx.resources.create('funding_certification', {
      year, title: 'Yearly certifications and assurances (sample)', funder_name: 'Example Regional Transport Fund',
      due_on: dayInZone(40), signer_id: owner, status: 'draft', notes: SAMPLE_NOTE,
    });
    for (const [i, [category, statement]] of ITEMS.entries()) {
      const applies = i !== 17;
      const confirmed = applies && i % 4 !== 3;
      await ctx.db.query(
        `insert into funding_certification_items (certification_id, category, statement, applies, responsible_id, confirmed_by, confirmed_on, sort)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cert.id, category, statement, applies, owner, confirmed ? owner : null, confirmed ? dayInZone(-(i % 9) - 1) : null, (i + 1) * 10]);
    }
    parts.push(`certification ${cert.ref} with ${ITEMS.length} items`);

    // A review from the invented sample file of review areas.
    const { set } = validateAreaSet(readSampleAreas());
    const imported = await applyAreaSet(ctx, set!, null, { sourceFile: 'review-areas.sample.json' });
    const review = await ctx.resources.create('compliance_review', {
      title: 'Funder compliance review (sample)', funder_name: 'Example Regional Transport Fund', period: 'Last three financial years',
      site_visit_on: dayInZone(45), lead_id: owner, status: 'self_assessment', notes: SAMPLE_NOTE,
    });
    await loadAreas(ctx, review, imported.set_id!, null);
    const assessed: Record<string, string> = { FM: 'compliant', TC: 'compliant', PR: 'deficient', AM: 'deficient', MA: 'compliant', SA: 'compliant', AC: 'not_applicable' };
    for (const [code, value] of Object.entries(assessed)) {
      await ctx.db.query('update compliance_review_areas set self_assessment = $3, owner_id = $4 where review_id = $1 and area_code = $2', [review.id, code, value, owner]);
    }
    for (const [area, request, due, status] of REQUESTS) {
      await ctx.db.query(
        'insert into compliance_review_requests (review_id, area_code, request, owner_id, due_on, status) values ($1,$2,$3,$4,$5,$6)',
        [review.id, area, request, owner, dayInZone(due), status]);
    }
    const defs = [
      { title: 'Procurement files do not record the price analysis', area_code: 'PR', description: 'Two of five sampled procurement files had no record of how the price was judged reasonable.', required_action: 'Add a price analysis step to the procurement checklist and train buyers.', due_on: dayInZone(60) },
      { title: 'Funded equipment missing from the asset inventory', area_code: 'AM', description: 'Four funded items were not in the inventory with their funding share.', required_action: 'Reconcile funded purchases with the inventory and record the funding share.', due_on: dayInZone(-5) },
    ];
    let plans = 0;
    for (const [i, d] of defs.entries()) {
      const row = await ctx.resources.create('review_deficiency', { ...d, review_id: review.id, owner_id: owner, status: 'open' });
      const capDef = ctx.resources.get('cap');
      if (i === 0 && capDef) {
        const data: Row = { title: `Correct ${row.ref}: ${row.title}`, source: 'funding', source_type: 'review_deficiency', source_id: row.id, problem_statement: d.description, responsible_id: owner, due_on: d.due_on };
        for (const k of Object.keys(data)) if (!(k in capDef.fields)) delete data[k];
        try {
          await ctx.resources.create('cap', data); // linking the plan and moving the deficiency on is the record-change listener's work
          plans++;
        } catch (err) {
          parts.push(`no corrective action plan (${(err as Error).message})`);
        }
      }
    }
    parts.push(`review ${review.ref} with ${set!.areas.length} areas, ${REQUESTS.length} requests, ${defs.length} deficiencies, ${plans} plan${plans === 1 ? '' : 's'}`);
  }

  // Funded items: link the sample awards to records of the other modules that exist by now.
  let linked = 0;
  const awards = await ctx.db.query<Row>('select id, title from funding_awards where notes = $1 and deleted_at is null', [SAMPLE_NOTE]);
  const tables: Record<string, string> = { asset: 'assets', vehicle: 'vehicles', project: 'projects', contract: 'contracts' };
  for (const a of AWARDS) {
    const award = awards.find((x) => x.title === a.title);
    if (!award) continue;
    for (const type of a.funds as string[]) {
      if (!ctx.resources.get(type)) continue;
      if (await ctx.db.one(`select 1 from record_links where from_type = $1 and to_type = 'funding_award' and to_id = $2 and relation = $3`, [type, award.id, FUNDED_BY])) continue;
      const rows = await ctx.db.query<Row>(`select id from ${tables[type]} where deleted_at is null order by created_at limit ${type === 'vehicle' ? 3 : 1}`);
      for (const r of rows) {
        await ctx.db.query(
          `insert into record_links (from_type, from_id, to_type, to_id, relation) values ($1,$2,'funding_award',$3,$4) on conflict do nothing`,
          [type, r.id, award.id, FUNDED_BY]);
        linked++;
      }
    }
  }
  const total = Number((await ctx.db.one<Row>(
    `select count(*)::int as n from record_links where to_type = 'funding_award' and relation = $1 and to_id = any($2::uuid[])`,
    [FUNDED_BY, awards.map((a) => a.id)]))?.n ?? 0);
  parts.push(total
    ? `funded items linked ${linked} (${total} in all)`
    : 'funded items: none yet (assets, vehicles, projects and contracts seed after funding; run the seed again to link them)');
  const subrecipients = await seedSubrecipients(ctx, opts);
  if (subrecipients) parts.push(subrecipients);
  return parts.join(', ');
}
