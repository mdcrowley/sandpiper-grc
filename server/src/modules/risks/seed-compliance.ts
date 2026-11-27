import { metricsAvailable } from '../../core/metrics.ts';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { makeEnterprise, runKriCheck } from './enterprise.ts';
import { addMonths, frequencyMonths, periodEndingOn } from './obligations.ts';
import { AFFECTS } from './regulatory-change.ts';
import { makeScales } from './scales.ts';

// Sample obligation periods, regulatory changes, appetite, KRIs and parent risks (E30-09). Dev profile
// only: in a pilot the obligations, the appetite and the indicators are the organization's own. All of it
// is invented and marked "invented example" or "[Sample]". Idempotent: each item is matched by its title.

const day = (offset: number): string => dayInZone(offset);
const firstUser = async (ctx: ModuleContext): Promise<string | null> =>
  (await ctx.db.one<{ id: string }>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;

/** Eight more invented obligations; with the four of seed.ts the register has twelve with a type and a frequency. */
const obligations = (): Row[] => [
  { title: 'Quarterly ridership and service data return', source: 'Funding agreement (invented example)', type: 'funding_condition', frequency: 'quarterly', next_due_on: day(25), applies_to: ['Bus operations', 'Light rail'], requirement: 'Report boardings, revenue hours and miles each quarter', history: ['met', 'met', 'partly_met', 'met'] },
  { title: 'Monthly safety event summary to the oversight body', source: 'Safety oversight program (invented example)', type: 'law', frequency: 'monthly', next_due_on: day(9), applies_to: ['Light rail'], requirement: 'Summarize reportable safety events each month', history: ['met', 'met', 'not_met', 'met'] },
  { title: 'Half-yearly drug and alcohol program statistics', source: 'Testing program rules (invented example)', type: 'law', frequency: 'half_yearly', next_due_on: day(70), applies_to: ['Bus operations'], requirement: 'Report testing statistics for safety-sensitive staff', history: ['met', 'met'] },
  { title: 'Annual fire inspection certificate for each depot', source: 'Local fire code (invented example)', type: 'permit', frequency: 'yearly', next_due_on: day(140), applies_to: ['North depot', 'South depot'], requirement: 'Hold a current inspection certificate for every depot' },
  { title: 'Accessibility complaints log review', source: 'Accessibility policy (invented example)', type: 'internal', frequency: 'quarterly', next_due_on: day(-12), applies_to: ['Paratransit'], requirement: 'Review complaints about accessible service every quarter', history: ['met', 'partly_met', 'met', 'met'] },
  { title: 'Every-two-years privacy impact review of the fare system', source: 'Privacy standard (invented example)', type: 'standard', frequency: 'every_2_years', next_due_on: day(300), applies_to: ['Fare collection'] },
  { title: 'Three-yearly asset management plan update', source: 'Funding agreement (invented example)', type: 'funding_condition', frequency: 'every_3_years', next_due_on: day(500) },
  { title: 'One-off cutover safety certification for the new signal system', source: 'Project agreement (invented example)', type: 'contract', frequency: 'once', next_due_on: day(45), applies_to: ['Light rail'] },
];

async function seedObligations(ctx: ModuleContext, owner: string | null): Promise<{ added: number; periods: number }> {
  let added = 0;
  let periods = 0;
  for (const { history, ...o } of obligations()) {
    if (await ctx.db.one('select 1 from obligations where title = $1', [o.title])) continue;
    const latest = (history as string[] | undefined)?.at(-1);
    const made = await ctx.resources.create('obligation', { ...o, owner_id: owner, status: latest ?? 'not_assessed' });
    added += 1;
    // Earlier periods, attested: the newest ends just before the next due date's period starts.
    const months = await frequencyMonths(ctx, o.frequency);
    if (!history || !months) continue;
    let due = addMonths(o.next_due_on, -months);
    const rows: Row[] = [];
    for (const status of [...history].reverse()) {
      const p = periodEndingOn(due, months);
      rows.push({ ...p, status, attested_on: due > day(0) ? day(0) : due });
      due = addMonths(due, -months);
    }
    for (const p of rows) {
      await ctx.db.query(
        `insert into obligation_periods (obligation_id, period_start, period_end, due_on, status, attested_by, attested_on, note, evidence, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$6) on conflict (obligation_id, period_start) do nothing`,
        [made.id, p.period_start, p.period_end, p.due_on, p.status, owner, p.attested_on,
          p.status === 'met' ? null : 'Invented example: one figure was late and sent the following week.',
          p.status === 'met' ? 'Invented example: submission receipt on file' : null]);
      periods += 1;
    }
    await ctx.db.query('update obligations set last_attested_on = $2 where id = $1', [made.id, rows[0]?.attested_on ?? null]);
  }
  return { added, periods };
}

async function seedChanges(ctx: ModuleContext, owner: string | null): Promise<number> {
  const changes: (Row & { obligation?: string; action?: string })[] = [
    {
      title: '[Sample] Shorter deadline for reporting passenger injuries', issuer: 'Invented oversight body', citation: 'Invented rule 4.2',
      published_on: day(-40), effective_on: day(50), impact_level: 'high', status: 'implementing',
      summary: 'Invented example: injuries needing medical treatment away from the scene must be reported within 7 days instead of 30.',
      impact_assessment: 'The event reporting procedure and the monthly summary both change. Supervisors need a short briefing.',
      obligation: 'Monthly safety event summary to the oversight body', action: 'Brief supervisors on the 7-day injury reporting deadline',
    },
    {
      title: '[Sample] New cybersecurity incident reporting expectation for operators', issuer: 'Invented national agency', citation: 'Invented directive 2026-03',
      published_on: day(-15), effective_on: day(120), impact_level: 'medium', status: 'assessing',
      summary: 'Invented example: significant cyber incidents affecting operations are to be reported within 24 hours.',
    },
    {
      title: '[Sample] Updated accessibility signage standard', issuer: 'Invented standards body', citation: 'Invented standard AS-9, edition 3',
      published_on: day(-200), effective_on: day(-30), impact_level: 'low', status: 'not_applicable',
      summary: 'Invented example: new signage contrast requirements for stations.',
      impact_assessment: 'Our stations were re-signed last year to a stricter local requirement; nothing to change.',
    },
  ];
  let added = 0;
  for (const { obligation, action, ...c } of changes) {
    if (await ctx.db.one('select 1 from regulatory_changes where title = $1', [c.title])) continue;
    const made = await ctx.resources.create('regulatory_change', { ...c, owner_id: owner });
    added += 1;
    const target = obligation ? await ctx.db.one<{ id: string }>('select id from obligations where title = $1 and deleted_at is null', [obligation]) : undefined;
    if (target) {
      await ctx.db.query(
        `insert into record_links (from_type, from_id, to_type, to_id, relation) values ('regulatory_change', $1, 'obligation', $2, $3)
         on conflict (from_type, from_id, to_type, to_id, relation) do nothing`, [made.id, target.id, AFFECTS]);
    }
    if (action && ctx.resources.get('action')) {
      await ctx.resources.create('action', {
        title: action, source: 'regulatory_change', source_type: 'regulatory_change', source_id: made.id,
        priority: 'high', due_on: day(30), owner_id: owner, department: 'Operations',
      });
    }
  }
  return added;
}

async function seedAppetite(ctx: ModuleContext): Promise<number> {
  if ((await ctx.db.one<{ c: number }>('select count(*)::int as c from risk_appetite'))!.c > 0) return 0;
  const rows: [string, string, string][] = [
    ['cyber', 'Invented example: low appetite for cyber risks that could stop service or expose rider data.', 'medium'],
    ['enterprise', 'Invented example: moderate appetite for enterprise risks taken on to improve service.', 'high'],
    ['third_party', 'Invented example: low appetite for dependence on a single supplier without an exit plan.', 'medium'],
    ['compliance', 'Invented example: no appetite for knowingly missing a legal or funding requirement.', 'low'],
    ['safety', 'Invented example: no appetite for harm to passengers or staff above "serious" without immediate controls.', 'medium'],
  ];
  const categories = new Set((await ctx.lookups.values('risk_category')).map((v) => v.value));
  let added = 0;
  for (const [category, statement, max] of rows) {
    if (!categories.has(category)) continue;
    // E45-04: each category's appetite is version 1, approved by an invented board.
    await ctx.db.query(
      `insert into risk_appetite (category, statement, max_rating, approved_on, approved_by_name, approval_body, reference, version, reason) values ($1,$2,$3,$4,$5,$6,$7,1,$8)
       on conflict (category) do nothing`, [category, statement, max, day(-90), 'Sample Chair', 'Sample Board of Directors', 'SAMPLE-RES-014', 'Sample: first appetite statement']);
    await ctx.db.query(
      `insert into risk_appetite_versions (category, version, statement, max_rating, approved_on, approved_by_name, approval_body, reference, reason)
       values ($1,1,$2,$3,$4,$5,$6,$7,$8) on conflict (category, version) do nothing`,
      [category, statement, max, day(-90), 'Sample Chair', 'Sample Board of Directors', 'SAMPLE-RES-014', 'Sample: first appetite statement']);
    added += 1;
  }
  return added;
}

async function seedParents(ctx: ModuleContext, owner: string | null): Promise<number> {
  const parents: [Row, string[]][] = [
    [{ title: '[Sample] Major disruption to scheduled service', category: 'enterprise', description: 'Invented example of an enterprise risk that department risks roll up under.', inherent_likelihood: 3, inherent_impact: 5, residual_likelihood: 3, residual_impact: 4, treatment: 'mitigate', status: 'in_treatment', review_on: day(60) },
      ['[Sample] CAD/AVL outage during peak service', '[Sample] Ransomware on the fare collection system', '[Sample] Total loss of the operations control center data room']],
    [{ title: '[Sample] Serious harm to passengers or staff', category: 'enterprise', description: 'Invented example of an enterprise risk over the safety risks.', inherent_likelihood: 2, inherent_impact: 5, residual_likelihood: 2, residual_impact: 4, treatment: 'mitigate', status: 'open', review_on: day(45) },
      ['[Sample] Signal priority fault at a busy junction goes unnoticed', '[Sample] Depot door access fails locked during an evacuation']],
  ];
  let added = 0;
  for (const [p, children] of parents) {
    let parent = await ctx.db.one<{ id: string }>('select id from risks where title = $1', [p.title]);
    if (!parent) {
      parent = await ctx.resources.create('risk', { ...p, owner_id: owner }) as { id: string };
      added += 1;
    }
    for (const title of children) {
      const child = await ctx.db.one<{ id: string }>('select id from risks where title = $1 and parent_id is null and deleted_at is null', [title]);
      if (child) await ctx.resources.update('risk', child.id, { parent_id: parent.id });
    }
  }
  return added;
}

async function seedKris(ctx: ModuleContext, owner: string | null): Promise<number> {
  const riskId = async (title: string) => (await ctx.db.one<{ id: string }>('select id from risks where title = $1 and deleted_at is null', [title]))?.id ?? null;
  const manual: (Row & { values: number[] })[] = [
    { name: '[Sample] Staff who clicked the monthly phishing test (%)', unit: 'percent', direction: 'higher_is_worse', amber: 8, red: 15, risk: '[Sample] Ransomware on the fare collection system', values: [12, 10, 9, 7, 11, 16] },
    { name: '[Sample] Dispatch system unplanned downtime (minutes)', unit: 'number', direction: 'higher_is_worse', amber: 60, red: 180, risk: '[Sample] CAD/AVL outage during peak service', values: [20, 45, 0, 75, 30, 10] },
    { name: '[Sample] Depot door access tests passed (%)', unit: 'percent', direction: 'lower_is_worse', amber: 95, red: 90, risk: '[Sample] Depot door access fails locked during an evacuation', values: [100, 98, 97, 94, 96, 99] },
  ];
  const preferred = ['actions.overdue', 'actions.awaiting_verification', 'actions.caps_overdue', 'training.compliance_pct', 'controls.tests_overdue', 'audits.findings_overdue'];
  const available = new Map(metricsAvailable(ctx.app, ctx.resources).map((m) => [m.key, m]));
  const computed = preferred.filter((k) => available.has(k)).slice(0, 3).map((k) => {
    const m = available.get(k)!;
    const lowerWorse = m.unit === 'percent';
    return { name: `[Sample] ${m.label}`, metric_key: k, unit: m.unit, direction: lowerWorse ? 'lower_is_worse' : 'higher_is_worse', amber: lowerWorse ? 90 : 5, red: lowerWorse ? 80 : 10, risk: '[Sample] Major disruption to scheduled service' };
  });
  let added = 0;
  for (const { values, risk, ...k } of [...manual, ...computed] as (Row & { values?: number[] })[]) {
    if (await ctx.db.one('select 1 from key_risk_indicators where name = $1', [k.name])) continue;
    const made = await ctx.resources.create('kri', { ...k, risk_id: await riskId(risk), owner_id: owner, frequency: 'monthly', description: 'Invented example.' });
    added += 1;
    for (const [i, v] of (values ?? []).entries()) {
      const month = `${addMonths(`${day(0).slice(0, 7)}-01`, -(values!.length - 1 - i))}`;
      await ctx.db.query(`insert into kri_values (kri_id, period, value) values ($1,$2,$3) on conflict (kri_id, period) do nothing`, [made.id, month, v]);
    }
  }
  if (added) await runKriCheck(ctx);
  return added;
}

/**
 * Seeds the compliance samples. Called from seed.ts `seedRisksModule` after the obligations and
 * the CAP samples; returns a short summary for the seed log, or null when it added nothing.
 */
export async function seedCompliance(ctx: ModuleContext, opts: SeedOptions): Promise<string | null> {
  if (opts.profile !== 'dev') return null;
  const owner = await firstUser(ctx);
  const o = await seedObligations(ctx, owner);
  const changes = await seedChanges(ctx, owner);
  const appetite = await seedAppetite(ctx);
  const parents = await seedParents(ctx, owner);
  const kris = await seedKris(ctx, owner);
  // The sample risks were saved before the appetite existed.
  if (appetite) await makeEnterprise(ctx, makeScales(ctx)).refreshBreaches();
  if (!o.added && !o.periods && !changes && !appetite && !parents && !kris) return null;
  return `${o.added} recurring obligations added with ${o.periods} attested periods, ${changes} regulatory changes, appetite for ${appetite} categories, ${parents} parent risks, ${kris} key risk indicators`;
}
