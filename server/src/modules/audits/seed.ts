// Sample data (E24-12), dev profile only and all invented: an audit universe of eight areas, three
// checklist templates, three audits (one closed with findings and corrective action plans, one in
// fieldwork with evidence requests, one planned), monthly inspection schedules for the sample
// interchange and depots, and six months of inspections (two failed, with findings; one missed).
// Loaded once: a second run changes nothing.
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { seedDevEstate } from '../inventory/seed-sample.ts';
import { scoreOf, type ChecklistItem } from './checklists.ts';
import { addDays, addMonths } from './dates.ts';

const MARK = '[Sample] Station walk-down';

const AREAS: Row[] = [
  { name: 'Safety management policy and objectives', category: 'safety_plan_element', cycle_months: 36, risk_level: 'medium', back: 20 },
  { name: 'Safety risk management (hazard process)', category: 'safety_plan_element', cycle_months: 24, risk_level: 'high', back: null },
  { name: 'Safety assurance and performance monitoring', category: 'safety_plan_element', cycle_months: 24, risk_level: 'high', back: 27 },
  { name: 'Safety promotion and training', category: 'safety_plan_element', cycle_months: 36, risk_level: 'medium', back: 14 },
  { name: 'Procurement and purchasing', category: 'process', cycle_months: 24, risk_level: 'medium', back: 30 },
  { name: 'Change management', category: 'process', cycle_months: 24, risk_level: 'medium', back: 8 },
  { name: 'Bus maintenance', category: 'department', cycle_months: 12, risk_level: 'high', back: 13 },
  { name: 'Fare collection system access control', category: 'system', cycle_months: 12, risk_level: 'high', back: null },
];

const WALK_DOWN: [string, string, boolean, boolean][] = [
  ['Platforms and access', 'Platform edge markings visible and undamaged', true, false],
  ['Platforms and access', 'Tactile paving intact along the platform edge', false, false],
  ['Platforms and access', 'Stairs and ramps free of trip hazards', false, false],
  ['Platforms and access', 'Elevators and escalators working, or out-of-service notices posted', false, false],
  ['Platforms and access', 'Handrails secure', false, false],
  ['Fire and emergency', 'Fire extinguishers present, in date and unobstructed', true, false],
  ['Fire and emergency', 'Emergency exits clear and signed', true, true],
  ['Fire and emergency', 'Emergency help points working', false, false],
  ['Fire and emergency', 'First aid kit stocked', false, false],
  ['Information and lighting', 'Lighting working in all public areas', false, false],
  ['Information and lighting', 'Timetables and safety notices current', false, false],
  ['Information and lighting', 'Public address audible across the platforms', false, false],
  ['Cleanliness and security', 'Floors dry and free of spills', false, false],
  ['Cleanliness and security', 'Cameras in place and undamaged', false, true],
  ['Cleanliness and security', 'No unattended items, and graffiti reported', false, false],
];

const YARD: [string, string, boolean, boolean][] = [
  ['Yard', 'Walkways marked and clear', false, false],
  ['Yard', 'Speed limit signs in place', false, false],
  ['Yard', 'Spill kit present at the fueling area', true, false],
  ['Yard', 'Lighting working across the yard', false, false],
  ['Yard', 'Gates and fences secure', false, false],
  ['On board (a sample of three)', 'Tires and wheels without visible damage', true, false],
  ['On board (a sample of three)', 'Lights and indicators working', false, false],
  ['On board (a sample of three)', 'Mirrors and cameras clean and aligned', false, false],
  ['On board (a sample of three)', 'Wheelchair ramp deploys and stows', false, true],
  ['On board (a sample of three)', 'Fire extinguisher on board and in date', true, false],
  ['On board (a sample of three)', 'Emergency exits open freely', false, false],
  ['On board (a sample of three)', "Daily defect sheets completed", false, false],
];

const PROCESS: [string, string, boolean, boolean][] = [
  ['Design', 'The process is documented and the document is current', false, false],
  ['Design', 'Roles and responsibilities are assigned', false, false],
  ['Operation', 'Records are kept as the procedure requires', true, false],
  ['Operation', 'Approvals are given by people with the authority to give them', true, false],
  ['Operation', 'Exceptions are recorded and approved', false, false],
  ['Operation', 'Staff doing the work have been trained in it', false, false],
  ['Monitoring', 'Performance is measured and reported', false, false],
  ['Monitoring', 'Earlier findings have been acted on', false, false],
];

async function template(ctx: ModuleContext, data: Row, items: [string, string, boolean, boolean][]): Promise<{ id: string; items: ChecklistItem[] }> {
  const t = await ctx.resources.create('checklist_template', data);
  for (const [i, [section, prompt, critical, photo]] of items.entries()) {
    await ctx.db.query(
      `insert into checklist_template_items (template_id, section, prompt, sort, critical, photo_required, guidance) values ($1,$2,$3,$4,$5,$6,$7)`,
      [t.id, section, prompt, (i + 1) * 10, critical, photo, critical && data.kind === 'inspection' ? 'A critical item: not met means the inspection fails.' : null]);
  }
  const rows = await ctx.db.query<Row>('select id, section, prompt, guidance, sort, critical, photo_required, false as removed from checklist_template_items where template_id = $1 order by sort', [t.id]);
  return { id: t.id, items: rows as ChecklistItem[] };
}

async function answer(ctx: ModuleContext, type: string, id: string, items: ChecklistItem[], no: Map<number, string>, by: string | null, at: string) {
  for (const [i, item] of items.entries()) {
    const ans = no.has(i) ? 'no' : item.photo_required ? 'na' : 'yes';
    await ctx.db.query(
      `insert into checklist_responses (parent_type, parent_id, item_id, answer, note, answered_by, answered_at) values ($1,$2,$3,$4,$5,$6,$7::date + time '10:00')
       on conflict do nothing`, [type, id, item.id, ans, no.get(i) ?? null, by, at]);
  }
}

export async function seedAudits(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample audits are dev profile only)';
  if (await ctx.db.one('select 1 from checklist_templates where name = $1 and deleted_at is null', [MARK])) return 'sample audits already loaded';
  const today = dayInZone();
  const year = Number(today.slice(0, 4));
  const user = (await ctx.db.one<Row>(`select id from users where status = 'active' order by created_at limit 1`))?.id ?? null;

  // The sample estate (sites) comes from the inventory module's generator, as fleet's sample does.
  if (ctx.resources.get('site')) await seedDevEstate(ctx);
  const sites = ctx.resources.get('site') ? await ctx.db.query<Row>('select id, name from sites where deleted_at is null') : [];
  const site = (name: string) => sites.find((s) => s.name === name)?.id ?? null;

  // The audit universe.
  const areaIds = new Map<string, string>();
  for (const a of AREAS) {
    const last = a.back === null ? null : addMonths(today, -a.back);
    const row = await ctx.resources.create('audit_area', {
      name: a.name, category: a.category, cycle_months: a.cycle_months, risk_level: a.risk_level, owner_id: user,
      description: 'Invented sample area.', last_audited_on: last,
      next_due_on: last ? addMonths(last, a.cycle_months) : addDays(today, 45),
    });
    areaIds.set(a.name, row.id);
  }

  // Checklists.
  const walk = await template(ctx, { name: MARK, kind: 'inspection', target_type: 'site', description: 'Invented sample checklist for a monthly walk around a station or interchange.' }, WALK_DOWN);
  const yard = await template(ctx, { name: '[Sample] Yard and vehicle check', kind: 'inspection', target_type: 'site', description: 'Invented sample checklist for a monthly check of a depot yard and a sample of its vehicles.' }, YARD);
  const proc = await template(ctx, { name: '[Sample] Process audit: core checks', kind: 'audit', description: 'Invented sample checklist for auditing any documented process.' }, PROCESS);

  // Audits: one closed with findings, one in fieldwork with evidence requests, one planned.
  const closed = await ctx.resources.create('audit_engagement', {
    title: 'Hazard management process review', audit_type: 'safety_review', area_id: areaIds.get('Safety risk management (hazard process)'),
    plan_year: year, template_id: proc.id, lead_auditor_id: user, auditee_id: user, team_ids: user ? [user] : [],
    scope: 'How hazards are identified, scored, mitigated and reviewed across bus and light-rail operations.',
    criteria: 'The organization\'s own safety plan and hazard management procedure.',
    planned_start: addDays(today, -110), planned_end: addDays(today, -80), fieldwork_start: addDays(today, -105), fieldwork_end: addDays(today, -85),
    status: 'planned',
  });
  await answer(ctx, 'audit_engagement', closed.id, proc.items, new Map([[2, 'Review dates missed on 4 of 20 sampled hazards.'], [4, 'Two staff reports took over a month to reach the log.'], [7, 'One earlier action still open.']]), user, addDays(today, -95));
  const FINDINGS: Row[] = [
    { title: 'Hazard reviews are not held on schedule', rating: 'minor_nonconformity', item: 2, criteria: 'Each hazard is reviewed by its review date.', condition: 'Four of twenty sampled hazards were past their review date.', cause: 'Owners are not reminded and reviews are not on the committee agenda.', effect: 'Ratings may not reflect current controls.', recommendation: 'Remind owners ahead of the review date and report overdue reviews monthly.', management_response: 'Agreed. Reminders are switched on and overdue reviews go to the monthly safety meeting.', cap: true },
    { title: 'Staff reports reach the hazard log late', rating: 'major_nonconformity', item: 4, criteria: 'Staff reports are assessed within ten working days.', condition: 'Two of eight sampled reports took more than a month.', cause: 'No single owner for triaging reports.', effect: 'Hazards stay uncontrolled for longer than needed.', recommendation: 'Name a triage owner and track the time to assess.', management_response: 'Agreed. The safety officer triages reports weekly.', cap: true },
    { title: 'Evidence of controls is thin for closed hazards', rating: 'observation', item: null, criteria: 'Closing a hazard records the evidence of its controls.', condition: 'Three closed hazards had no evidence attached.', recommendation: 'Attach evidence before closing.', management_response: 'Noted; the closing checklist now asks for evidence.', cap: false },
  ];
  let caps = 0;
  for (const f of FINDINGS) {
    const row = await ctx.resources.create('audit_finding', {
      title: f.title, source_type: 'audit_engagement', source_id: closed.id, rating: f.rating, criteria: f.criteria, condition: f.condition,
      cause: f.cause ?? null, effect: f.effect ?? null, recommendation: f.recommendation, management_response: f.management_response,
      response_owner_id: user, response_due: addDays(today, -70), responded_on: addDays(today, -80),
    });
    if (f.item !== null) await ctx.db.query('update audit_findings set item_id = $2 where id = $1', [row.id, proc.items[f.item].id]);
    const cap = ctx.resources.get('cap');
    if (f.cap && cap) {
      const data = Object.fromEntries(Object.entries({
        title: f.title, source: 'audit', source_type: 'audit_finding', source_id: row.id, problem_statement: f.condition,
        root_cause: f.cause ?? null, responsible_id: user, due_on: addDays(today, 30),
      }).filter(([k, v]) => k in cap.fields && v !== null));
      const plan = await ctx.resources.create('cap', data);
      await ctx.resources.update('audit_finding', row.id, { cap_id: plan.id, status: 'cap_raised' }, null);
      await ctx.db.query(`insert into record_links (from_type, from_id, to_type, to_id, relation) values ('audit_finding', $1, 'cap', $2, 'raised') on conflict do nothing`, [row.id, plan.id]);
      caps += 1;
    }
  }
  await ctx.resources.update('audit_engagement', closed.id, {
    status: 'closed', opinion: 'needs_improvement',
    report_summary: 'The hazard process is in place and understood. Reviews and the time to assess staff reports need tightening; two corrective action plans were raised.',
    report_approved_on: addDays(today, -75), report_approved_by_name: 'Sample Approver',
  }, null);

  const fieldwork = await ctx.resources.create('audit_engagement', {
    title: 'Procurement controls audit', audit_type: 'internal_audit', area_id: areaIds.get('Procurement and purchasing'),
    plan_year: year, template_id: proc.id, lead_auditor_id: user, auditee_id: user, team_ids: user ? [user] : [],
    scope: 'Purchases over the quotation threshold in the last twelve months: quotations, approvals and contract records.',
    criteria: 'The organization\'s procurement procedure and delegation of authority.',
    planned_start: addDays(today, -14), planned_end: addDays(today, 21), status: 'planned',
  });
  await ctx.resources.update('audit_engagement', fieldwork.id, { status: 'fieldwork', fieldwork_start: addDays(today, -10) }, null);
  await answer(ctx, 'audit_engagement', fieldwork.id, proc.items.slice(0, 4), new Map(), user, addDays(today, -5));
  const REQUESTS: [string, number, string, string | null][] = [
    ['A list of every purchase over the quotation threshold in the last twelve months.', -6, 'accepted', 'Exported from the finance system; saved in the audit folder.'],
    ['The quotations received for the five purchases sampled by the auditor.', -2, 'provided', 'Four of five attached in the folder; the fifth is with the depot.'],
    ['The delegation of authority in force during the period.', 3, 'requested', null],
    ['Approval records for purchases between the two approval limits.', 5, 'requested', null],
    ['Evidence that the buyers completed procurement training.', -1, 'returned', 'Training list sent.'],
  ];
  for (const [request, due, status, note] of REQUESTS) {
    await ctx.resources.create('audit_request', {
      audit_id: fieldwork.id, request, owner_id: user, due_on: addDays(today, due), status, response_note: note,
      ...(status !== 'requested' ? { provided_at: new Date(Date.parse(`${addDays(today, due - 1)}T15:00:00Z`)).toISOString() } : {}),
    });
  }

  await ctx.resources.create('audit_engagement', {
    title: 'Fare system access control audit', audit_type: 'cyber_control_audit', area_id: areaIds.get('Fare collection system access control'),
    plan_year: year + (Number(today.slice(5, 7)) > 9 ? 1 : 0), lead_auditor_id: user,
    scope: 'Who can reach the fare collection back office, how access is granted and removed, and privileged access reviews.',
    planned_start: addDays(today, 60), planned_end: addDays(today, 75), status: 'planned', restricted: false,
  });

  // Inspection schedules and six months of inspections.
  const PLACES: [string, { id: string; items: ChecklistItem[] }][] = [
    ['Example Central Interchange', walk], ['Example Operations Control Center', walk],
    ['Example Depot North', yard], ['Example Depot South', yard], ['Example Rail Yard', yard],
  ];
  const thisMonth = `${today.slice(0, 7)}-01`;
  let inspections = 0;
  let findings = FINDINGS.length;
  for (const [p, [name, tpl]] of PLACES.entries()) {
    const id = site(name);
    // The next inspection is this month's when it is still to come, otherwise next month's.
    const thisOne = addDays(thisMonth, 9 + p);
    const schedule = await ctx.resources.create('inspection_schedule', {
      template_id: tpl.id, target_type: id ? 'site' : 'none', target_id: id, frequency: 'monthly',
      next_due_on: thisOne >= today ? thisOne : addMonths(thisOne, 1), assignee_id: user,
    });
    for (let k = 6; k >= 0; k--) {
      const due = addDays(addMonths(thisMonth, -k), 9 + p);
      if (due >= today) break;
      const failed = (name === 'Example Depot North' && k === 4) || (name === 'Example Central Interchange' && k === 2);
      const missed = name === 'Example Rail Yard' && k === 1;
      const late = name === 'Example Depot South' && k === 3;
      const row = await ctx.resources.create('inspection', {
        template_id: tpl.id, schedule_id: schedule.id, target_type: id ? 'site' : 'none', target_id: id, inspector_id: user, due_on: due,
        status: 'scheduled', notes: 'Invented sample inspection.',
      });
      inspections += 1;
      if (missed) { await ctx.resources.update('inspection', row.id, { status: 'missed' }, null); continue; }
      const performed = late ? addDays(due, 4) : addDays(due, -1);
      const no = failed
        ? (tpl === walk ? new Map([[6, 'Emergency exit at the east stairs blocked by stored cleaning carts.'], [12, 'Water pooling by the ticket machines.']])
          : new Map([[2, 'Spill kit missing from the fueling area.'], [7, 'Nearside mirror cracked on one bus.']]))
        : k === 5 ? new Map([[tpl === walk ? 9 : 3, 'Two lights out; reported to facilities.']]) : new Map<number, string>();
      await answer(ctx, 'inspection', row.id, tpl.items, no, user, performed);
      const answers = new Map((await ctx.db.query<Row>(`select item_id, answer from checklist_responses where parent_type = 'inspection' and parent_id = $1`, [row.id])).map((r) => [r.item_id, r]));
      const s = scoreOf(tpl.items, answers);
      await ctx.resources.update('inspection', row.id, { status: 'complete', result: s.result, score_pct: s.score_pct, performed_on: performed }, null);
      for (const i of s.failed) {
        const f = await ctx.resources.create('audit_finding', {
          title: i.prompt, source_type: 'inspection', source_id: row.id, rating: i.critical ? 'major_nonconformity' : 'minor_nonconformity',
          criteria: i.prompt, condition: no.get(tpl.items.indexOf(i)) ?? 'Not met.', response_owner_id: user, response_due: addDays(performed, 30),
          ...(k > 3 ? { management_response: 'Put right the same week.', status: 'closed', responded_on: addDays(performed, 3) } : {}),
        });
        await ctx.db.query('update audit_findings set item_id = $2 where id = $1', [f.id, i.id]);
        findings += 1;
      }
    }
  }
  return `audit areas ${AREAS.length}, checklist templates 3, audits 3, evidence requests ${REQUESTS.length}, inspection schedules ${PLACES.length}, inspections ${inspections}, findings ${findings}, corrective action plans ${caps}`;
}
