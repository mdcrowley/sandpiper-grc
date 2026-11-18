import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import type { ProjectService } from './service.ts';

// Invented sample projects, the same in both seed profiles. Nothing here comes from the seed folder.

const day = (offset: number): string => {
  const d = new Date(Date.now() + offset * 86400000);
  return todayInZone(d);
};

interface Sample {
  project: Row;
  /** Stage to walk the project to through its gates. */
  stage: string;
  /** How many items of the current gate to tick once there. */
  ticks?: number;
  /** [overall, schedule, budget, risk] per report, oldest first. */
  reports: [string, string, string, string][];
  milestones: { name: string; due: number; done?: number }[];
  items?: Row[];
}

const STAGES = ['idea', 'initiate', 'plan', 'procure', 'deliver', 'close'];

const SAMPLES: Sample[] = [
  {
    stage: 'idea', ticks: 1,
    project: {
      name: '[Sample] Meeting room booking displays', description: 'Small screens outside shared meeting rooms showing the day\'s bookings.',
      expected_benefits: 'Fewer double bookings and interrupted meetings.', sponsor: 'Sample sponsor: Facilities', department: 'Facilities',
      budget: 18000, funding_source: 'operating', target_on: day(240),
      scoring: { strategic_alignment: 2, risk_reduction: 1, customer_benefit: 2, financial_return: 1, readiness: 4 },
    },
    reports: [],
    milestones: [{ name: 'Request reviewed', due: 21 }],
  },
  {
    stage: 'initiate', ticks: 2,
    project: {
      name: '[Sample] Service desk knowledge base refresh', description: 'Rewrite and reorganise the how-to articles used by staff and the service desk.',
      expected_benefits: 'Fewer repeat tickets; quicker answers.', sponsor: 'Sample sponsor: Information Technology', department: 'Information Technology',
      budget: 62000, spend_to_date: 4000, funding_source: 'operating', start_on: day(-40), target_on: day(200),
      scoring: { strategic_alignment: 3, risk_reduction: 2, customer_benefit: 4, financial_return: 2, readiness: 4 },
    },
    reports: [['green', 'green', 'green', 'green'], ['green', 'amber', 'green', 'green'], ['green', 'green', 'green', 'green']],
    milestones: [{ name: 'Charter agreed', due: 14 }, { name: 'Article audit complete', due: 75 }, { name: 'New articles published', due: 180 }],
    items: [{ kind: 'decision', title: 'Keep or retire articles older than three years', status: 'open', due_on: day(30) }],
  },
  {
    stage: 'plan', ticks: 2,
    project: {
      name: '[Sample] Employee records digitisation', description: 'Scan and index paper personnel files and retire the filing room.',
      expected_benefits: 'Faster retrieval, controlled access and a record of who viewed what.', sponsor: 'Sample sponsor: Human Resources', department: 'Human Resources',
      budget: 85000, spend_to_date: 9500, funding_source: 'capital', start_on: day(-90), target_on: day(270),
      touches_personal_data: true, data_impact: 'Holds personnel records, including some health information.',
      scoring: { strategic_alignment: 3, risk_reduction: 4, customer_benefit: 3, financial_return: 2, readiness: 3 },
    },
    reports: [['green', 'green', 'green', 'amber'], ['amber', 'amber', 'green', 'amber'], ['amber', 'amber', 'green', 'red'], ['amber', 'green', 'green', 'amber']],
    milestones: [{ name: 'Requirements agreed', due: -20, done: -18 }, { name: 'Retention schedule confirmed', due: 20 }, { name: 'Scanning complete', due: 200 }],
    items: [
      { kind: 'risk', title: 'Paper files hold records past their retention period', detail: 'Scanning them would extend how long they are kept.', status: 'open', likelihood: 4, impact: 3, due_on: day(25) },
      { kind: 'issue', title: 'Filing room index is incomplete', status: 'in_progress' },
    ],
  },
  {
    stage: 'procure', ticks: 1,
    project: {
      name: '[Sample] Payment system replacement', description: 'Replace the ageing card payment equipment and back office.',
      expected_benefits: 'Contactless payment, fewer cash handling costs, better sales data.', sponsor: 'Sample sponsor: Finance', department: 'Finance',
      budget: 480000, spend_to_date: 36000, funding_source: 'grant', start_on: day(-200), target_on: day(420),
      touches_payment: true, touches_personal_data: true, touches_operational_systems: true,
      security_impact: 'Handles card payments; card data rules apply.', data_impact: 'Customer account and payment details.',
      scoring: { strategic_alignment: 5, risk_reduction: 4, customer_benefit: 5, financial_return: 3, readiness: 3 },
    },
    reports: [['green', 'green', 'green', 'amber'], ['green', 'amber', 'green', 'amber'], ['amber', 'red', 'green', 'amber'], ['red', 'red', 'amber', 'red']],
    milestones: [{ name: 'Request for proposals issued', due: -60, done: -52 }, { name: 'Proposals evaluated', due: -5 }, { name: 'Contract awarded', due: 45 }, { name: 'Pilot at two sites', due: 260 }, { name: 'Full service', due: 400 }],
    items: [
      { kind: 'risk', title: 'Only one compliant proposal received', detail: 'Weak competition may raise the price or delay the award.', status: 'open', likelihood: 3, impact: 4 },
      { kind: 'change_request', title: 'Add mobile payments to the scope', detail: 'Requested after the request for proposals was issued.', status: 'open', due_on: day(15) },
      { kind: 'decision', title: 'Governing body date for the award', status: 'open', due_on: day(30) },
    ],
  },
  {
    stage: 'deliver', ticks: 4,
    project: {
      name: '[Sample] Control room console upgrade', description: 'Replace the control room consoles and move to the supported software release.',
      expected_benefits: 'Supported software, quicker shift hand-over, fewer outages.', sponsor: 'Sample sponsor: Operations', department: 'Operations',
      budget: 240000, spend_to_date: 205000, funding_source: 'capital', start_on: day(-300), target_on: day(20),
      touches_operational_systems: true, security_impact: 'Used to run daily service; an outage affects every site.',
      scoring: { strategic_alignment: 4, risk_reduction: 5, customer_benefit: 4, financial_return: 2, readiness: 5 },
    },
    reports: [['amber', 'amber', 'green', 'amber'], ['amber', 'amber', 'green', 'green'], ['green', 'green', 'green', 'green'], ['green', 'green', 'amber', 'green']],
    milestones: [{ name: 'Consoles installed', due: -70, done: -66 }, { name: 'Staff training', due: -20, done: -15 }, { name: 'Acceptance testing', due: -3, done: -2 }, { name: 'Go-live', due: 20 }],
    items: [
      { kind: 'risk', title: 'Old consoles must stay available for two weeks after cut-over', status: 'open', likelihood: 2, impact: 4 },
      { kind: 'issue', title: 'Restore test not yet scheduled', status: 'open', due_on: day(7) },
    ],
  },
  {
    stage: 'deliver', ticks: 0,
    project: {
      name: '[Sample] Office wireless network refresh', description: 'Replace access points in the administration building and workshops.',
      expected_benefits: 'Reliable coverage and supported equipment.', sponsor: 'Sample sponsor: Information Technology', department: 'Information Technology',
      budget: 95000, spend_to_date: 101500, funding_source: 'capital', start_on: day(-150), target_on: day(60),
      scoring: { strategic_alignment: 3, risk_reduction: 4, customer_benefit: 3, financial_return: 2, readiness: 4 },
    },
    reports: [['green', 'green', 'green', 'green'], ['green', 'green', 'amber', 'green'], ['amber', 'green', 'red', 'green']],
    milestones: [{ name: 'Site survey', due: -110, done: -112 }, { name: 'Administration building complete', due: -30, done: -12 }, { name: 'Workshops complete', due: 45 }],
    items: [{ kind: 'change_request', title: 'Twelve extra access points for the main workshop', detail: 'Survey under-counted; adds cost.', status: 'approved' }],
  },
  {
    stage: 'close', ticks: 0,
    project: {
      name: '[Sample] Staff laptop replacement', description: 'Replace laptops that are out of warranty.',
      expected_benefits: 'Supported, encrypted devices for all office staff.', sponsor: 'Sample sponsor: Information Technology', department: 'Information Technology',
      budget: 48000, spend_to_date: 46200, funding_source: 'operating', start_on: day(-260), target_on: day(-10),
      scoring: { strategic_alignment: 2, risk_reduction: 4, customer_benefit: 3, financial_return: 1, readiness: 5 },
    },
    reports: [['green', 'amber', 'green', 'green'], ['green', 'green', 'green', 'green'], ['green', 'green', 'green', 'green']],
    milestones: [{ name: 'Devices ordered', due: -200, done: -201 }, { name: 'Roll-out complete', due: -30, done: -24 }, { name: 'Old devices disposed of', due: 15 }],
  },
];

export async function seedSampleProjects(ctx: ModuleContext, svc: ProjectService): Promise<string> {
  const existing = await ctx.db.one(`select 1 from projects where name like '[Sample]%' limit 1`);
  if (existing) return 'sample projects already present; skipped';

  for (const s of SAMPLES) {
    let project = await ctx.resources.create('project', s.project);

    // Walk the project through its gates so each one has a ticked checklist and a recorded decision.
    const steps = STAGES.indexOf(s.stage);
    for (let i = 0; i < steps; i++) {
      const gate = (await svc.gatesFor(project)).gates.find((g) => g.is_current);
      if (!gate) break;
      await ctx.db.query(
        `update gate_checklist_items set checked = true, checked_by_name = 'Sample data', checked_at = now() where project_gate_id = $1`,
        [gate.id]);
      const result = await svc.decideGate(null, project, gate.id, {
        decision: 'approved', approver_name: 'Sample approver', approver_role: 'Chief Information Officer',
        decided_on: day(-(steps - i) * 30), reference: 'Sample data', notes: 'Approval recorded from email (sample).',
      });
      project = result.project;
    }

    if (s.ticks) {
      const gate = (await svc.gatesFor(project)).gates.find((g) => g.is_current);
      for (const item of (gate?.items ?? []).slice(0, s.ticks) as Row[]) {
        await svc.setChecklistItem(null, project, gate!.id, item.id, { checked: true, note: 'Sample data' });
      }
    }

    for (const m of s.milestones) {
      await svc.addMilestone(null, project, { name: m.name, due_on: day(m.due), done_on: m.done === undefined ? null : day(m.done) });
    }
    for (const [i, r] of s.reports.entries()) {
      await svc.addReport(null, project, {
        period_end: day(-(s.reports.length - 1 - i) * 30 - 3),
        overall: r[0], schedule: r[1], budget: r[2], risk: r[3],
        accomplishments: 'Sample entry: work completed in the period.',
        next_steps: 'Sample entry: work planned for the next period.',
        decisions_needed: r[0] === 'red' ? 'Sample entry: a decision is needed from the sponsor.' : null,
        author_name: 'Sample data',
      });
    }
    for (const item of s.items ?? []) await svc.addItem(null, project, item);
  }
  return `${SAMPLES.length} sample projects created`;
}
