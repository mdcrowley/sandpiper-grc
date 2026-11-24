// Invented samples of vendor intake (E41-10) and contractor performance (E41-11), dev profile only:
// three completed intakes that set risk tiers, their required checks (one waived, one still to do),
// and performance measures with six months of scores on two sample contracts. It links only to sample
// vendors and contracts that already exist and can be run again.
import type { ModuleContext, Row } from '../../core/module.ts';
import { addMonths } from '../../../../shared/dates.ts';
import { addDays, localDate } from './dates.ts';
import { DEFAULT_INTAKE, intakeConfig, tierFor } from './intake.ts';
import { periodOf, periodRange, type Frequency } from './performance.ts';

const SAMPLE = '[Sample]';

/** [vendor, answers, notes] */
const INTAKES: [string, Record<string, string>, string][] = [
  ['Linden Payment Services', { data: 'payment', access: 'remote', service: 'major', spend: 'large' }, 'Runs fare collection and card acceptance.'],
  ['Castle Peak Telecom', { data: 'internal', access: 'none', service: 'some', spend: 'large' }, 'Calls fail over to mobile phones if the service is down.'],
  ['Quillfeather Mapping', { data: 'none', access: 'none', service: 'none', spend: 'small' }, 'Planning tool; no rider data.'],
];

/** [vendor, check, days ago, outcome, reference or reason, expires in days] */
const CHECKS: [string, string, number, 'done' | 'waived', string, number | null][] = [
  ['Linden Payment Services', 'exclusion_list', 60, 'done', 'SAMPLE-SEARCH-1160', null],
  ['Linden Payment Services', 'insurance', 90, 'done', 'SAMPLE-CERT-2231', 275],
  ['Linden Payment Services', 'security_assessment', 100, 'done', 'Assessment of the sample year', 265],
  ['Linden Payment Services', 'data_agreement', 120, 'done', 'Schedule 4 of the agreement', null],
  ['Linden Payment Services', 'financial_review', 30, 'waived', 'Publicly listed group; the finance office accepted its published accounts instead.', 335],
  ['Castle Peak Telecom', 'exclusion_list', 12, 'done', 'SAMPLE-SEARCH-1201', null],
  ['Castle Peak Telecom', 'insurance', 40, 'done', 'SAMPLE-CERT-2240', 325],
  ['Quillfeather Mapping', 'exclusion_list', 90, 'done', 'SAMPLE-SEARCH-1144', null],
];

/** [vendor, measure, unit, target, direction, frequency, scores oldest first (one per month or quarter), comments by index] */
const MEASURES: [string, string, string, number, 'higher' | 'lower', Frequency, number[], Record<number, string>][] = [
  ['Castle Peak Telecom', 'Service availability', '%', 99.9, 'higher', 'monthly', [99.95, 99.92, 99.7, 99.85, 99.93, 99.96], { 2: 'Main line outage during the morning peak; credit agreed.', 5: 'No outages.' }],
  ['Castle Peak Telecom', 'Hours to fix a fault', 'hours', 4, 'lower', 'monthly', [3.5, 5, 6.5, 4.5, 3, 2.5], { 2: 'Spare parts held at one depot only.', 4: 'Second spares store opened.' }],
  ['Linden Payment Services', 'Card payments approved', '%', 99.5, 'higher', 'monthly', [99.7, 99.6, 99.4, 99.2, 99.3, 99.1], { 3: 'Reader update delayed; raised at the monthly review.', 5: 'Falling for three months: corrective plan requested.' }],
  ['Linden Payment Services', 'Rider complaints about fares', 'count', 10, 'lower', 'quarterly', [14, 9], { 0: 'Mostly double charges after the price change.' }],
];

export async function seedIntake(ctx: ModuleContext): Promise<string[]> {
  const { db } = ctx;
  const today = localDate();
  const tiers = (await ctx.lookups.values('vendor_risk_tier')).map((t) => t.value);
  const config = await intakeConfig(ctx);
  const vendorId = async (name: string) => (await db.one<Row>('select id from vendors where name = $1 and deleted_at is null', [name]))?.id as string | undefined;
  let intakes = 0;
  let checks = 0;
  let measures = 0;
  let scores = 0;

  for (const [name, answers, notes] of INTAKES) {
    const id = await vendorId(name);
    if (!id || await db.one('select 1 from vendor_intakes where vendor_id = $1', [id])) continue;
    // The sample answers fit the starter questionnaire; an installation that changed it gets no sample intakes.
    if (!DEFAULT_INTAKE.questions.every((q) => config.questions.some((c) => c.key === q.key))) break;
    const { tier, reasons } = tierFor(config, answers, tiers);
    const on = addDays(today, -130);
    await db.query(
      `insert into vendor_intakes (vendor_id, questions, answers, tier, reasons, notes, completed_on) values ($1,$2::jsonb,$3::jsonb,$4,$5::jsonb,$6,$7)`,
      [id, JSON.stringify(config.questions), JSON.stringify(answers), tier, JSON.stringify(reasons), `${SAMPLE} ${notes}`, on]);
    await ctx.resources.update('vendor', id, { risk_tier: tier, risk_tier_on: on });
    intakes += 1;
  }
  for (const [name, key, ago, outcome, text, expires] of CHECKS) {
    const id = await vendorId(name);
    if (!id || await db.one('select 1 from vendor_checks where vendor_id = $1 and check_key = $2', [id, key])) continue;
    await db.query(
      `insert into vendor_checks (vendor_id, check_key, outcome, done_on, expires_on, reference, note) values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, key, outcome, addDays(today, -ago), expires === null ? null : addDays(today, expires),
        outcome === 'done' ? text : null, outcome === 'waived' ? `${SAMPLE} ${text}` : null]);
    checks += 1;
  }
  for (const [name, measure, unit, target, direction, frequency, values, comments] of MEASURES) {
    const id = await vendorId(name);
    const contract = id ? await db.one<Row>(`select id from contracts where vendor_id = $1 and import_key = 'dev-sample' and deleted_at is null`, [id]) : undefined;
    if (!contract || await db.one('select 1 from contract_measures where contract_id = $1 and name = $2', [contract.id, measure])) continue;
    const m = (await db.one<Row>(
      `insert into contract_measures (contract_id, name, unit, target, direction, frequency, sort, created_at) values ($1,$2,$3,$4,$5,$6,$7, now() - interval '400 days') returning id`,
      [contract.id, measure, unit, target, direction, frequency, (measures + 1) * 10]))!;
    measures += 1;
    const step = frequency === 'quarterly' ? 3 : 1;
    for (const [i, value] of values.entries()) {
      // The latest score is for the last period that has ended; the others before it.
      const back = (values.length - i) * step;
      const period = periodOf(addMonths(`${today.slice(0, 7)}-01`, -back), frequency);
      const end = periodRange(period, frequency)!.end;
      await db.query(
        `insert into contract_scores (measure_id, contract_id, period, period_end, value, comment) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
        [m.id, contract.id, period, end, value, comments[i] ? `${SAMPLE} ${comments[i]}` : null]);
      scores += 1;
    }
  }
  const out: string[] = [];
  if (intakes) out.push(`${intakes} vendor intakes`);
  if (checks) out.push(`${checks} vendor checks`);
  if (measures) out.push(`${measures} contract measures with ${scores} scores`);
  return out;
}
