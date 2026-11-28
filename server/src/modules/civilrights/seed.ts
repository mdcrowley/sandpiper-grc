// Sample civil rights data (dev profile only; everything invented and labeled "[Sample]"): a program
// template, four programs (one made from the template), monitoring reports (one overdue, one submitted),
// four complaints (one past its acknowledgment limit, one under investigation with steps and a letter,
// one closed, one not confidential), and a participation goal with two awards and their firms.
// The first administrator is named a complaint handler so the sample complaints can be opened.
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { COMPLAINT } from './complaints.ts';
import { AWARD, GOAL } from './participation.ts';
import { PROGRAM, REPORT, TEMPLATE } from './programs.ts';

const TEMPLATE_NAME = '[Sample] Nondiscrimination program template';
const PROGRAMS: { name: string; type: string; template?: boolean; cycle: number; adoptedDaysAgo: number }[] = [
  { name: '[Sample] Nondiscrimination program', type: 'nondiscrimination', template: true, cycle: 36, adoptedDaysAgo: 400 },
  { name: '[Sample] Accessible service program', type: 'accessible_service', cycle: 36, adoptedDaysAgo: 1120 },
  { name: '[Sample] Small and disadvantaged business participation', type: 'business_participation', cycle: 36, adoptedDaysAgo: 700 },
  { name: '[Sample] Equal employment opportunity program', type: 'equal_employment', cycle: 48, adoptedDaysAgo: 200 },
];

async function one(ctx: ModuleContext, sql: string, params: unknown[]): Promise<Row | undefined> {
  return ctx.db.one<Row>(sql, params);
}

export async function seedCivilRights(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'civil rights: nothing to load for this profile';
  if (!ctx.resources.get(PROGRAM)) return 'civil rights: switched off';
  const admin = (await one(ctx, `select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
    where r.key = 'administrator' and u.status = 'active' order by u.created_at limit 1`, []))?.id ?? null;

  // Template and programs.
  let template = (await one(ctx, 'select id from civil_rights_templates where name = $1 and deleted_at is null', [TEMPLATE_NAME]))?.id;
  if (!template) {
    template = (await ctx.resources.create(TEMPLATE, {
      name: TEMPLATE_NAME, program_type: 'nondiscrimination', update_cycle_months: 36,
      description: 'Invented sample: the parts the organization expects in every nondiscrimination program.',
      elements: ['Policy statement signed by the chief executive', 'Notice to the public of rights and how to complain', 'Complaint procedure and form',
        'List of complaints, investigations and lawsuits', 'Public participation plan', 'Language assistance plan', 'Service standards and policies',
        'Board approval of the program'].join('\n'),
      reports: ['Program update | 36', 'Service monitoring results | 12'].join('\n'),
    }, null)).id;
  }
  const programIds: Record<string, string> = {};
  for (const p of PROGRAMS) {
    let id = (await one(ctx, 'select id from civil_rights_programs where name = $1 and deleted_at is null', [p.name]))?.id;
    if (!id) {
      id = (await ctx.resources.create(PROGRAM, {
        name: p.name, program_type: p.type, status: 'adopted', owner_id: admin, adopted_on: dayInZone(-p.adoptedDaysAgo), update_cycle_months: p.cycle,
        description: 'Invented sample program.', ...(p.template ? { template_id: template } : {}),
      }, null)).id;
      if (!p.template) {
        const items: [string, string, Row][] = [
          ['element', 'Policy statement', { status: 'in_place', checked_on: dayInZone(-60) }],
          ['element', 'Annual self-review', { status: 'needs_attention', due_on: dayInZone(20) }],
        ];
        let sort = 0;
        for (const [kind, title, more] of items) {
          sort += 10;
          await ctx.db.query(
            `insert into civil_rights_program_items (program_id, kind, title, status, checked_on, due_on, sort) values ($1,$2,$3,$4,$5,$6,$7)`,
            [id, kind, title, more.status ?? 'open', more.checked_on ?? null, more.due_on ?? null, sort]);
        }
      } else {
        // Notices and language items of the first program, and some elements already in place.
        const extra: [string, string, string | null, string | null][] = [
          ['notice', '[Sample] Notice of rights at the main customer center', null, null],
          ['notice', '[Sample] Notice of rights on every bus', null, null],
          ['notice', '[Sample] Notice of rights on the website', null, null],
          ['language', 'Translated notice of rights', 'Spanish', 'in_place'],
          ['language', 'Telephone interpreting at the customer center', 'Any language on request', 'in_place'],
          ['language', 'Translated complaint form', 'Vietnamese', 'in_progress'],
        ];
        let sort = 100;
        for (const [kind, title, language, status] of extra) {
          sort += 10;
          await ctx.db.query(
            `insert into civil_rights_program_items (program_id, kind, title, language, status, checked_on, sort) values ($1,$2,$3,$4,$5,$6,$7)`,
            [id, kind, title, language, status ?? 'in_place', kind === 'notice' ? dayInZone(-30) : null, sort]);
        }
        await ctx.db.query(
          `update civil_rights_program_items set status = 'in_place', checked_on = $2 where program_id = $1 and kind = 'element' and sort <= 30`, [id, dayInZone(-45)]);
      }
    }
    programIds[p.name] = id;
  }
  const first = programIds[PROGRAMS[0].name];
  // An overdue workforce report on the employment program, and a submitted one.
  const reports: [string, string, number, boolean][] = [
    ['[Sample] Workforce analysis', programIds[PROGRAMS[3].name], -12, false],
    ['[Sample] Participation report, first half', programIds[PROGRAMS[2].name], -40, true],
  ];
  for (const [title, program, due, submitted] of reports) {
    if (await one(ctx, 'select 1 from civil_rights_reports where title = $1 and deleted_at is null', [title])) continue;
    const r = await ctx.resources.create(REPORT, { title, program_id: program, report_type: submitted ? 'participation' : 'workforce', due_on: dayInZone(due), owner_id: admin, every_months: 6, recipient: '[Sample] Funding body' }, null);
    if (submitted) {
      await ctx.db.query(`insert into civil_rights_report_submissions (report_id, submitted_on, submitted_by, submitted_by_name, recipient, reference) values ($1,$2,$3,'Sample data','[Sample] Funding body','SUB-0001')`,
        [r.id, dayInZone(due - 2), admin]);
      await ctx.resources.update(REPORT, r.id, { status: 'submitted', submitted_on: dayInZone(due - 2) }, null);
    }
  }

  // Complaints.
  if (admin && !(await one(ctx, 'select 1 from civil_rights_complaint_viewers limit 1', []))) {
    await ctx.db.query('insert into civil_rights_complaint_viewers (user_id) values ($1) on conflict do nothing', [admin]);
  }
  const service = ctx.resources.get('service') ? (await one(ctx, `select id from services where deleted_at is null order by name limit 1`, []))?.id ?? null : null;
  const complaints: Row[] = [
    { subject: '[Sample] Driver did not deploy the ramp', received_on: dayInZone(-14), channel: 'phone', basis: 'disability', complainant_name: 'Jordan Example', complainant_contact: 'jordan@example.test', service_id: service, occurred_on: dayInZone(-16), description: 'Invented sample: the rider says the ramp was not deployed at a stop.' },
    { subject: '[Sample] No interpreter offered at the customer center', received_on: dayInZone(-40), channel: 'in_person', basis: 'national_origin', language_needed: 'Spanish', complainant_name: 'Alex Sample', status: 'investigating', acknowledged_on: dayInZone(-35), investigator_id: admin, description: 'Invented sample complaint.' },
    { subject: '[Sample] Fare inspector remarks', received_on: dayInZone(-150), channel: 'web_form', basis: 'race_color', anonymous: true, status: 'closed', acknowledged_on: dayInZone(-145), findings: 'Invented sample findings: not substantiated after interviews and video review.', findings_on: dayInZone(-80), outcome: 'not_substantiated', closed_on: dayInZone(-75), investigator_id: admin },
    { subject: '[Sample] Route change reduced weekend service', received_on: dayInZone(-5), channel: 'email', basis: 'income', anonymous: true, confidential: false, description: 'Invented sample: a general complaint about a service change, not confidential.' },
  ];
  for (const c of complaints) {
    if (await one(ctx, 'select 1 from civil_rights_complaints where subject = $1 and deleted_at is null', [c.subject])) continue;
    const row = await ctx.resources.create(COMPLAINT, { ...c, program_id: first }, null);
    if (c.status === 'investigating') {
      const steps: [string, string, string | null, string | null][] = [
        ['letter', 'Acknowledgment letter', null, dayInZone(-35)],
        ['step', 'Interview the complainant', dayInZone(-20), dayInZone(-22)],
        ['step', 'Interview the customer center staff', dayInZone(-3), null],
        ['step', 'Review the language assistance log', dayInZone(10), null],
      ];
      let sort = 0;
      for (const [kind, title, due, done] of steps) {
        sort += 10;
        await ctx.db.query(`insert into civil_rights_complaint_steps (complaint_id, kind, title, due_on, done_on, done_by_name, sort) values ($1,$2,$3,$4,$5,$6,$7)`,
          [row.id, kind, title, due, done, done ? 'Sample data' : null, sort]);
      }
    }
  }

  // Participation goal, awards and firms.
  const goalTitle = '[Sample] Participation goal, current period';
  let goal = (await one(ctx, 'select id from civil_rights_goals where title = $1 and deleted_at is null', [goalTitle]))?.id;
  if (!goal) {
    goal = (await ctx.resources.create(GOAL, {
      title: goalTitle, program_id: programIds[PROGRAMS[2].name], period_label: 'Current period', period_start: dayInZone(-200), period_end: dayInZone(165),
      goal_pct: 12, status: 'set', owner_id: admin, method_notes: 'Invented sample: based on the share of ready, willing and able certified firms in the market area.',
    }, null)).id;
  }
  const awards: [string, number, [string, boolean, string, number][]][] = [
    ['[Sample] Shelter cleaning, two years', 400000, [['[Sample] Clean Stops Co.', true, 'Prime', 400000]]],
    ['[Sample] Depot roof replacement', 1200000, [['[Sample] Roofing Builders Inc.', false, 'Prime', 1050000], ['[Sample] Small Electric LLC', true, 'Subcontractor', 90000]]],
  ];
  for (const [title, amount, firms] of awards) {
    if (await one(ctx, 'select 1 from civil_rights_awards where title = $1 and deleted_at is null', [title])) continue;
    const a = await ctx.resources.create(AWARD, { title, goal_id: goal, awarded_on: dayInZone(-90), award_amount: amount }, null);
    let sort = 0;
    for (const [name, certified, role, amt] of firms) {
      sort += 10;
      await ctx.db.query('insert into civil_rights_award_firms (award_id, firm_name, certified, role, amount, sort) values ($1,$2,$3,$4,$5,$6)', [a.id, name, certified, role, amt, sort]);
    }
  }
  return 'civil rights: sample programs, complaints and a participation goal';
}
