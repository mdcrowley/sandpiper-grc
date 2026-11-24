import type { ToolContext, ToolResult, ToolSpec } from './toolkit.ts';

// Summary tools for the program areas added in waves 10 and 11 (E21-24): audits, controls,
// corrective action plans, funding, committees, qualifications, business continuity, asset
// condition, OT security, records requests and the vendor lifecycle.
//
// Each tool reads its area's summary route (wave 11 contract C5) in-process with the caller's own
// token (`t.api`), so the permission, restricted-record and switched-off rules are exactly those of
// the web application. The routes answer figures only, the same for everyone; the tools pass on
// figures only too, never the lists of titles, names or requester details a dashboard route may
// also carry. Each tool is available only to a caller who may view its area's main record type
// (`a.sees`: the permission, and the type installed and switched on), so a switched-off area's tools
// disappear from every list (`installedTools`). A route that does not answer (not built in this
// version, or a permission the token lacks) gives a "not available" answer instead of an error.

type Json = Record<string, any>;
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (v: unknown): string => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 'n/a' : `${Math.round(Number(v) * 10) / 10}%`);
/** "Open 3, Closed 2" from [{ label, count }], leaving out zeros. */
const counts = (list: unknown, key = 'count'): string =>
  (Array.isArray(list) ? list : []).filter((x: Json) => num(x[key])).map((x: Json) => `${x.label ?? x.value ?? 'None'} ${num(x[key])}`).join(', ') || 'none';
/** [{ value, label, count }] without colors or anything else. */
const tally = (list: unknown, key = 'count') =>
  (Array.isArray(list) ? list : []).map((x: Json) => ({ value: x.value ?? null, label: x.label ?? x.value ?? null, count: num(x[key]) }));

function notAvailable(what: string): ToolResult {
  return {
    text: `${what} are not available here: that part of the application is not installed, or your access does not include it.`,
    data: { available: false },
  };
}

/** Reads one summary route as the caller; undefined when it does not answer for them. */
async function read(t: ToolContext, url: string): Promise<Json | undefined> {
  return t.api.tryGet<Json>(url);
}

const auditSummary: ToolSpec = {
  name: 'audit_summary', title: 'Audit summary', group: 'Work and insight', idempotent: true,
  description: 'Audit program figures: audits by status, the audit universe due and overdue, open and overdue findings by rating, '
    + 'inspections due, overdue, missed and failed, and evidence requests outstanding. Figures only.',
  available: (a) => a.sees('audit_engagement'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/audits/summary');
    if (!s) return notAvailable('Audit figures');
    const i = s.inspections ?? {};
    return {
      text: [
        `Audits: ${num(s.audits?.planned_this_year)} planned this year, ${num(s.audits?.open)} in progress, ${num(s.audits?.closed_this_year)} closed this year (${counts(s.audits?.by_status)}).`,
        `Audit universe: ${num(s.areas?.total)} areas, ${num(s.areas?.overdue)} overdue, ${num(s.areas?.due_soon)} due soon, ${num(s.areas?.never)} never audited.`,
        `Findings: ${num(s.findings?.open)} open, ${num(s.findings?.overdue)} with a late response (${counts(s.findings?.by_rating)}).`,
        `Inspections: ${num(i.due_next_30)} due in 30 days, ${num(i.overdue)} overdue; last 90 days ${num(i.last_90?.complete)} complete, ${num(i.last_90?.missed)} missed, ${num(i.last_90?.failed)} failed, on time ${pct(i.last_90?.on_time_pct)}.`,
        `Evidence requests: ${num(s.requests?.open)} open, ${num(s.requests?.overdue)} overdue.`,
      ].join('\n'),
      data: {
        today: s.today, audits: { ...s.audits, by_status: tally(s.audits?.by_status) }, areas: s.areas,
        findings: { ...s.findings, by_rating: tally(s.findings?.by_rating) },
        inspections: { due_next_30: i.due_next_30, overdue: i.overdue, last_90: i.last_90, by_month: i.by_month },
        requests: s.requests, url: t.link('/audits'),
      },
    };
  },
};

const controlsSummary: ToolSpec = {
  name: 'controls_summary', title: 'Controls summary', group: 'Work and insight', idempotent: true,
  description: 'Control library figures: controls in use, key controls, effective, partly effective, ineffective and untested, tests due and overdue, '
    + 'tests waiting for review, results over the last twelve months, and how many records of each kind the controls cover. Figures only.',
  available: (a) => a.sees('control'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/controls/summary');
    if (!s) return notAvailable('Control figures');
    const x = s.totals ?? {};
    const coverage = (Array.isArray(s.coverage) ? s.coverage : []).map((c: Json) => ({ type: c.type, plural: c.plural, covered: num(c.covered), relying_on_failed: num(c.relying_on_failed) }));
    return {
      text: [
        `Controls in use: ${num(x.controls)} (${num(x.key)} key controls, ${num(x.retired)} retired).`,
        `Effective ${num(x.effective)}, partly effective ${num(x.partly_effective)}, ineffective ${num(x.ineffective)}, untested ${num(x.untested)}.`,
        `Tests: ${num(x.overdue)} overdue, ${num(x.due_soon)} due within 30 days, ${num(x.tests_open)} in progress, ${num(x.awaiting_review)} waiting for review; ${num(x.reviewed_12m)} reviewed in 12 months, ${num(x.failed_12m)} failed.`,
        coverage.length ? `Coverage: ${coverage.map((c: Json) => `${c.plural} ${c.covered}${c.relying_on_failed ? ` (${c.relying_on_failed} relying on a failed control)` : ''}`).join(', ')}.` : '',
      ].filter(Boolean).join('\n'),
      data: { today: s.today, totals: x, by_rating: tally(s.by_rating), by_domain: tally(s.by_domain), coverage, url: t.link('/controls') },
    };
  },
};

const capSummary: ToolSpec = {
  name: 'cap_summary', title: 'Corrective action plan summary', group: 'Work and insight', idempotent: true,
  description: 'Corrective action plan figures across every source: open, overdue, waiting for approval and being verified, '
    + 'actions waiting for verification, by status and by source. Restricted plans count too. Figures only.',
  available: (a) => a.can('actions.view') && a.sees('cap'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/caps/summary');
    if (!s) return notAvailable('Corrective action plan figures');
    return {
      text: [
        `Corrective action plans: ${num(s.open)} open, ${num(s.overdue)} overdue, ${num(s.awaiting_approval)} waiting for approval, ${num(s.verifying)} being verified.`,
        `Actions waiting for verification: ${num(s.actions_awaiting_verification)} (${num(s.verification_overdue)} overdue).`,
        `Open by source: ${counts(s.by_source)}.`,
      ].join('\n'),
      data: {
        open: num(s.open), overdue: num(s.overdue), awaiting_approval: num(s.awaiting_approval), verifying: num(s.verifying),
        actions_awaiting_verification: num(s.actions_awaiting_verification), verification_overdue: num(s.verification_overdue),
        by_status: tally(s.by_status), by_source: tally(s.by_source), url: t.link('/caps'),
      },
    };
  },
};

const fundingSummary: ToolSpec = {
  name: 'funding_summary', title: 'Funding summary', group: 'Work and insight', idempotent: true,
  description: 'Funding and grant compliance figures: awards by status and their open amounts, reports and close-outs overdue or due within 30 days, '
    + 'open review deficiencies, and this year\'s certification progress. Figures only.',
  available: (a) => a.sees('funding_award'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/funding/summary');
    if (!s) return notAvailable('Funding figures');
    const certifications = (Array.isArray(s.certifications) ? s.certifications : []).map((c: Json) => ({ year: c.year, status: c.status, applicable: num(c.applicable), confirmed: num(c.confirmed) }));
    return {
      text: [
        `Awards: ${num(s.awards?.open)} open, amount ${num(s.awards?.open_amount)}, local share ${num(s.awards?.open_local_share)} (${counts(s.awards?.by_status)}).`,
        `Reports and close-outs: ${num(s.reports?.overdue)} overdue, ${num(s.reports?.due_soon)} due within 30 days.`,
        `Review deficiencies: ${num(s.deficiencies?.open)} open, ${num(s.deficiencies?.overdue)} overdue, ${num(s.deficiencies?.without_plan)} without a corrective action plan.`,
        certifications.length ? `Certifications: ${certifications.map((c: Json) => `${c.year} ${c.confirmed} of ${c.applicable} confirmed`).join('; ')}.` : '',
        `Open compliance reviews: ${Array.isArray(s.reviews) ? s.reviews.length : 0}.`,
      ].filter(Boolean).join('\n'),
      data: {
        today: s.today,
        awards: { open: num(s.awards?.open), open_amount: num(s.awards?.open_amount), open_local_share: num(s.awards?.open_local_share), by_status: tally(s.awards?.by_status) },
        reports: { overdue: num(s.reports?.overdue), due_soon: num(s.reports?.due_soon) },
        deficiencies: s.deficiencies, certifications, open_reviews: Array.isArray(s.reviews) ? s.reviews.length : 0, url: t.link('/funding'),
      },
    };
  },
};

const governanceSummary: ToolSpec = {
  name: 'governance_summary', title: 'Committees and meetings summary', group: 'Work and insight', idempotent: true,
  description: 'Committee figures: active committees, meetings coming up (and those without a frozen pack), meetings held in the last year and their quorum, '
    + 'minutes waiting to be written up or approved, and decisions by outcome. Figures only.',
  available: (a) => a.sees('meeting'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/governance/summary');
    if (!s) return notAvailable('Committee figures');
    const m = s.meetings ?? {};
    return {
      text: [
        `Committees: ${num(s.committees?.active)} active.`,
        `Meetings: ${num(m.upcoming_30_days)} in the next 30 days (${num(m.upcoming_30_days_without_pack)} without a frozen pack), ${num(m.upcoming_90_days)} in the next 90; ${num(m.held_last_12_months)} held in the last 12 months (quorum met ${num(m.quorum_met_last_12_months)}, not met ${num(m.quorum_not_met_last_12_months)}).`,
        `Minutes: ${num(s.minutes?.to_write)} to write up (${num(s.minutes?.late)} late), ${num(s.minutes?.awaiting_approval)} waiting for the chair's approval.`,
        `Decisions: ${num(s.decisions?.total)} in all, ${num(s.decisions?.last_12_months)} in the last 12 months (${counts(s.decisions?.by_outcome)}); ${num(s.decisions?.applied_to_approvals)} completed an approval.`,
      ].join('\n'),
      data: {
        today: s.today, committees: s.committees, meetings: m, minutes: s.minutes,
        decisions: { ...s.decisions, by_outcome: tally(s.decisions?.by_outcome) }, url: t.link('/governance/meetings'),
      },
    };
  },
};

const qualificationsSummary: ToolSpec = {
  name: 'qualifications_summary', title: 'Qualifications summary', group: 'Work and insight', idempotent: true,
  description: 'Workforce qualification figures: the roster by status and how many have an account, and, where that part of the application is in use, '
    + 'how many required qualifications are complete, due and overdue (by requirement and by department, with the overdue trend). Figures only: no one is named.',
  available: (a) => a.sees('person') || a.sees('course'),
  input: {},
  async run(_args, t) {
    const people = t.can('people.view') ? await read(t, '/api/people/summary') : undefined;
    const training = t.can('training.view') ? await read(t, '/api/training/summary') : undefined;
    if (!people && !training) return notAvailable('Roster and training figures');
    const lines: string[] = [];
    const data: Json = {};
    if (people) {
      const byStatus = (Array.isArray(people.byStatus) ? people.byStatus : []).map((x: Json) => ({ status: x.status, count: num(x.n) }));
      const onRoster = byStatus.filter((x: Json) => x.status !== 'left').reduce((s: number, x: Json) => s + x.count, 0);
      lines.push(`Roster: ${onRoster} people (${byStatus.map((x: Json) => `${x.status} ${x.count}`).join(', ') || 'none'}); ${num(people.withAccount)} with an account.`);
      data.roster = {
        by_status: byStatus, with_account: num(people.withAccount),
        by_position: (Array.isArray(people.byPosition) ? people.byPosition : []).map((x: Json) => ({ position: x.name ?? 'No position', count: num(x.n) })),
        url: t.link('/people'),
      };
    }
    if (training) {
      const x = training.totals ?? {};
      const strip = (r: Json) => ({ total: num(r.total), complete: num(r.complete), due: num(r.due), overdue: num(r.overdue), rate: r.rate ?? null });
      lines.push(`Training: ${num(x.people)} people across ${num(x.courses)} active courses; ${num(x.complete)} complete, ${num(x.due)} due, ${num(x.overdue)} overdue (completion ${x.rate ?? 'n/a'}%).`);
      const worst = (Array.isArray(training.by_course) ? training.by_course : []).filter((c: Json) => num(c.overdue)).sort((a: Json, b: Json) => num(b.overdue) - num(a.overdue)).slice(0, 5);
      if (worst.length) lines.push(`Most overdue courses: ${worst.map((c: Json) => `${c.title} ${num(c.overdue)}`).join(', ')}.`);
      data.training = {
        totals: strip(x), people: num(x.people), courses: num(x.courses),
        by_course: (Array.isArray(training.by_course) ? training.by_course : []).map((c: Json) => ({ ref: c.ref, title: c.title, mandatory: !!c.mandatory, ...strip(c) })),
        by_department: (Array.isArray(training.by_department) ? training.by_department : []).map((d: Json) => ({ department: d.label, ...strip(d) })),
        trend: (Array.isArray(training.trend) ? training.trend : []).map((p: Json) => ({ month: p.month, overdue: num(p.overdue) })),
        url: t.link('/training'),
      };
    }
    return { text: lines.join('\n'), data };
  },
};

const continuitySummary: ToolSpec = {
  name: 'continuity_summary', title: 'Business continuity summary', group: 'Work and insight', idempotent: true,
  description: 'Business continuity figures: business processes and how many have a recovery gap (a system that takes longer to recover than the process can be down), '
    + 'continuity plans in all, overdue for review and not approved, and emergency activations under way. Figures only.',
  available: (a) => a.sees('business_process'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/continuity/summary');
    if (!s) return notAvailable('Business continuity figures');
    const data = {
      processes: num(s.processes), with_gap: num(s.with_gap),
      plans: { total: num(s.plans?.total), review_overdue: num(s.plans?.review_overdue), unapproved: num(s.plans?.unapproved) },
      activations: { active: num(s.activations?.active) },
      url: t.link('/continuity'),
    };
    return {
      text: [
        `Business processes: ${data.processes}, ${data.with_gap} with a recovery gap.`,
        `Plans: ${data.plans.total}, ${data.plans.review_overdue} overdue for review, ${data.plans.unapproved} not approved.`,
        `Emergency activations under way: ${data.activations.active}.`,
      ].join('\n'),
      data,
    };
  },
};

const assetConditionSummary: ToolSpec = {
  name: 'asset_condition_summary', title: 'Asset condition summary', group: 'Work and insight', idempotent: true,
  description: 'State of good repair: for each asset class, how many of its members are past their useful life against the yearly target, '
    + 'and the share in poor condition. Figures only.',
  available: (a) => a.sees('asset_class'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/condition/summary');
    if (!s) return notAvailable('Asset condition figures');
    const classes = (Array.isArray(s.classes) ? s.classes : []).map((c: Json) => ({
      name: c.name, total: num(c.total), past_ulb: num(c.past_ulb), past_ulb_pct: c.past_ulb_pct ?? null, target_pct: c.target_pct ?? null,
      over_target: c.target_pct !== null && c.target_pct !== undefined && c.past_ulb_pct !== null && c.past_ulb_pct !== undefined && Number(c.past_ulb_pct) > Number(c.target_pct),
    }));
    const over = classes.filter((c: Json) => c.over_target);
    return {
      text: [
        `Asset classes: ${classes.length}; ${over.length} past their target for useful life. In poor condition: ${pct(s.poor_pct)}.`,
        ...classes.map((c: Json) => `- ${c.name}: ${c.past_ulb} of ${c.total} past useful life (${pct(c.past_ulb_pct)}${c.target_pct !== null ? `, target at most ${pct(c.target_pct)}` : ', no target'})`),
      ].join('\n'),
      data: { classes, poor_pct: s.poor_pct ?? null, url: t.link('/condition') },
    };
  },
};

const otSummary: ToolSpec = {
  name: 'ot_summary', title: 'OT security summary', group: 'Work and insight', idempotent: true,
  description: 'Operational technology security figures: OT systems, security zones and how many fall short of their target level, conduits with remote access, '
    + 'and OT systems that cannot be patched. Figures only.',
  available: (a) => a.sees('ot_zone'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/ot/summary');
    if (!s) return notAvailable('OT security figures');
    const data = {
      ot_systems: num(s.ot_systems), zones: num(s.zones), zones_below_target: num(s.zones_below_target),
      conduits_with_remote_access: num(s.conduits_with_remote_access), unpatchable: num(s.unpatchable), url: t.link('/ot'),
    };
    return {
      text: `OT systems: ${data.ot_systems} (${data.unpatchable} cannot be patched). Zones: ${data.zones}, ${data.zones_below_target} below their target level or not assessed. `
        + `Conduits with remote access: ${data.conduits_with_remote_access}.`,
      data,
    };
  },
};

const recordsRequestsSummary: ToolSpec = {
  name: 'records_requests_summary', title: 'Records requests summary', group: 'Work and insight', idempotent: true,
  description: 'Requests for records and personal data: open, due soon and overdue, by kind, and (for people who may see legal holds) active holds. '
    + 'Counts only: never who asked or what they asked for.',
  available: (a) => a.sees('records_request'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/records/summary');
    if (!s) return notAvailable('Records request figures');
    const r = s.requests ?? {};
    const byKind = Array.isArray(r.by_kind)
      ? tally(r.by_kind)
      : Object.entries(r.by_kind ?? {}).map(([value, count]) => ({ value, label: value, count: num(count) }));
    const data: Json = { requests: { open: num(r.open), due_soon: num(r.due_soon), overdue: num(r.overdue), by_kind: byKind }, url: t.link('/records-requests') };
    if (s.holds_active !== undefined && s.holds_active !== null) data.holds_active = num(s.holds_active);
    return {
      text: [
        `Requests: ${data.requests.open} open, ${data.requests.due_soon} due soon, ${data.requests.overdue} overdue.`,
        `Open by kind: ${counts(byKind)}.`,
        data.holds_active !== undefined ? `Active legal holds: ${data.holds_active}.` : '',
      ].filter(Boolean).join('\n'),
      data,
    };
  },
};

const vendorLifecycleSummary: ToolSpec = {
  name: 'vendor_lifecycle_summary', title: 'Vendor lifecycle summary', group: 'Work and insight', idempotent: true,
  description: 'Vendor risk lifecycle figures: reassessments and exclusion-list checks overdue, open vendor issues, offboardings under way and vendors with required checks outstanding. Figures only.',
  available: (a) => a.sees('vendor'),
  input: {},
  async run(_args, t) {
    const s = await read(t, '/api/vendors/lifecycle-summary');
    if (!s) return notAvailable('Vendor lifecycle figures');
    const data = {
      reassessments_overdue: num(s.reassessments_overdue), exclusion_checks_overdue: num(s.exclusion_checks_overdue),
      open_issues: num(s.open_issues), offboardings_open: num(s.offboardings_open), checks_outstanding: num(s.checks_outstanding), url: t.link('/vendors'),
    };
    return {
      text: `Vendors: ${data.reassessments_overdue} reassessments overdue, ${data.exclusion_checks_overdue} exclusion checks overdue, `
        + `${data.open_issues} open issues, ${data.offboardings_open} offboardings under way, ${data.checks_outstanding} vendors with required checks outstanding.`,
      data,
    };
  },
};

export const PROGRAM_TOOLS: ToolSpec[] = [
  auditSummary, controlsSummary, capSummary, fundingSummary, governanceSummary, qualificationsSummary,
  continuitySummary, assetConditionSummary, otSummary, recordsRequestsSummary, vendorLifecycleSummary,
];
