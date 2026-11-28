import { approvalEngine } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { seedFleet } from '../fleet/seed.ts';
import { renameSamples, type SampleRename } from '../inventory/seed-rename.ts';
import { seedDevEstate } from '../inventory/seed-sample.ts';
import { seedPeople } from '../people/seed.ts';
import { PLAN_KIND } from './plans.ts';
import { mirrorLinks } from './processes.ts';
import { addMonths } from './shared.ts';

/**
 * Dev profile only, all invented and labeled "[Sample]": ten business processes of a bus and
 * light-rail operator with what they depend on (sample systems, services, sites, vendors and
 * positions), impact analyses for six of them, three plans (one approved, one in review, one
 * overdue for review) with call trees from the sample roster and checklists, two recovery gaps by
 * construction (fare collection and payroll), and one closed severe-weather activation with its
 * log, roles, checklist and an after-action corrective action plan.
 *
 * Modules seed in key order, so the inventory's sample estate, the sample fleet and the sample
 * roster are loaded here first (each is idempotent). Vendors and exercises seed after this module:
 * dependencies on them are added when the seed runs again.
 */

const MARK = '[Sample]';
const mark = (text: string) => `${MARK} ${text}`;

const SAMPLE_USERS = [
  { username: 'sample.bc.avery', name: '[Sample] Jordan Okafor-Reyes', role: 'continuity_manager' },
  { username: 'sample.bc.jordan', name: '[Sample] Jordan Mbatha', role: 'continuity_manager' },
];

type Dep = [kind: 'system' | 'service' | 'site' | 'vendor' | 'position', name: string, critical: boolean];

const PROCESSES: { name: string; department: string; criticality: string; mtd: number; rto: number; rpo: number | null; staff: number; peak: string; owner: 0 | 1; description: string; workaround: string; deps: Dep[] }[] = [
  {
    name: 'Rail operations control', department: 'Operations', criticality: 'vital', mtd: 4, rto: 4, rpo: 0.5, staff: 3, owner: 0, peak: 'Weekday peaks, event days',
    description: 'Controls light-rail service: train regulation, faults, incidents and passenger announcements.',
    workaround: 'Line supervisors regulate trains by radio from the platforms; timetable printed in the control room.',
    deps: [['system', 'Example Rail Signaling Interface', true], ['system', 'Example Operations System', true], ['system', 'Example Radio Dispatch System', true],
      ['site', 'Example Operations Control Center', true], ['service', 'LR-A', false], ['service', 'LR-B', false], ['position', '[Sample] Dispatcher', true]],
  },
  {
    name: 'Bus dispatch', department: 'Operations', criticality: 'vital', mtd: 4, rto: 2, rpo: 0.25, staff: 4, owner: 0, peak: 'Weekday peaks',
    description: 'Dispatches buses, handles breakdowns and detours, and keeps services on time.',
    workaround: 'Radio voice dispatch with paper running boards; depot supervisors cover missed trips.',
    deps: [['system', 'Example CAD/AVL System', true], ['system', 'Example Radio Dispatch System', true], ['site', 'Example Operations Control Center', true],
      ['service', '1', false], ['service', '7', false], ['vendor', 'Harbor Signal Systems', false], ['position', '[Sample] Dispatcher', true]],
  },
  {
    // A gap by construction: the fare back office needs eight hours to recover; fare collection tolerates four.
    name: 'Fare collection', department: 'Revenue', criticality: 'essential', mtd: 4, rto: 4, rpo: 1, staff: 2, owner: 1, peak: 'Month start (pass renewals)',
    description: 'Collects fares on vehicles and at the interchange, and settles card payments.',
    workaround: 'Free travel for up to four hours, then paper tickets and cash fares.',
    deps: [['system', 'Example Fare Collection System', true], ['system', 'Example Onboard Fare Equipment', false], ['site', 'Example Central Interchange', false],
      ['vendor', 'Linden Payment Services', true]],
  },
  {
    // Reaches its systems through the Dial-a-Ride service; its own recovery target is shorter than the scheduling system's.
    name: 'Paratransit scheduling', department: 'Operations', criticality: 'essential', mtd: 24, rto: 12, rpo: 4, staff: 2, owner: 1, peak: 'Weekday mornings',
    description: 'Books and schedules door-to-door trips for riders who cannot use the fixed routes.',
    workaround: 'Bookings taken by phone on paper forms; trips assigned by the dispatcher.',
    deps: [['service', 'DR', true], ['site', 'Example Depot South', false]],
  },
  {
    name: 'Passenger information', department: 'Communications', criticality: 'important', mtd: 8, rto: 4, rpo: null, staff: 1, owner: 1, peak: 'Disruptions',
    description: 'Predicted arrivals, disruption notices and the journey planner for riders.',
    workaround: 'Disruption notices posted at stops and the interchange; announcements by radio to drivers.',
    deps: [['system', 'Example Real-Time Information System', true], ['system', 'Example Public Website', true], ['system', 'Example Onboard Information Displays', false]],
  },
  {
    name: 'Vehicle maintenance planning', department: 'Maintenance', criticality: 'important', mtd: 72, rto: 24, rpo: 24, staff: 2, owner: 0, peak: 'Winter',
    description: 'Plans inspections and repairs so enough vehicles are available every morning.',
    workaround: 'Paper work cards and the printed inspection schedule.',
    deps: [['system', 'Example Fleet Maintenance System', true], ['site', 'Example Depot North', true], ['site', 'Example Depot South', true], ['position', '[Sample] Rolling stock maintainer', true]],
  },
  {
    // A gap by construction: the finance system needs a day to recover; payroll tolerates twelve hours on pay day.
    name: 'Payroll', department: 'Finance', criticality: 'essential', mtd: 12, rto: 12, rpo: 4, staff: 2, owner: 1, peak: 'Pay day (every second Thursday)',
    description: 'Pays staff on time, with overtime and leave from timekeeping.',
    workaround: 'Repeat the last pay run and correct it in the next one.',
    deps: [['system', 'Example Finance System', true], ['system', 'Example Timekeeping System', false], ['system', 'Example HR System', false], ['vendor', 'Northbank Software', true]],
  },
  {
    name: 'Customer service', department: 'Customer service', criticality: 'important', mtd: 24, rto: 8, rpo: 4, staff: 3, owner: 1, peak: 'Disruptions, fare changes',
    description: 'Answers riders by phone and online: travel cards, complaints, lost property.',
    workaround: 'Phones only; card accounts handled the next day.',
    deps: [['system', 'Example Customer Portal', true], ['system', 'Example Directory', true], ['site', 'Example Head Office', true], ['vendor', 'Castle Peak Telecom', true]],
  },
  {
    name: 'Procurement', department: 'Finance', criticality: 'deferrable', mtd: 168, rto: 72, rpo: 24, staff: 1, owner: 1, peak: 'Year end',
    description: 'Buys parts, services and equipment within the approved budget.',
    workaround: 'Emergency purchases by card with the paperwork completed afterward.',
    deps: [['system', 'Example Finance System', true], ['site', 'Example Head Office', false]],
  },
  {
    name: 'Radio communications', department: 'Operations', criticality: 'vital', mtd: 2, rto: 1, rpo: null, staff: 1, owner: 0, peak: 'Always',
    description: 'Voice and data radio between control, vehicles and depots.',
    workaround: 'Cell phones to depot supervisors and line supervisors.',
    deps: [['system', 'Example Radio Dispatch System', true], ['site', 'Example Operations Control Center', true], ['vendor', 'Castle Peak Telecom', false]],
  },
];

/** Impact analyses for six processes: rows of band and the five impact areas. */
const IMPACTS: Record<string, number[][]> = {
  'Rail operations control': [[3, 3, 2, 3, 2], [4, 4, 3, 4, 3], [5, 5, 4, 5, 4], [5, 5, 5, 5, 5], [5, 5, 5, 5, 5]],
  'Bus dispatch': [[3, 2, 2, 3, 1], [4, 3, 3, 4, 2], [5, 4, 4, 5, 3], [5, 4, 5, 5, 4], [5, 5, 5, 5, 4]],
  'Fare collection': [[2, 1, 3, 2, 1], [3, 1, 4, 3, 2], [3, 1, 5, 4, 3], [4, 1, 5, 4, 4], [4, 1, 5, 5, 4]],
  'Paratransit scheduling': [[2, 2, 1, 2, 2], [3, 3, 1, 3, 3], [4, 4, 2, 4, 4], [5, 4, 3, 5, 4], [5, 5, 3, 5, 5]],
  Payroll: [[1, 1, 1, 1, 1], [1, 1, 2, 2, 2], [2, 1, 4, 4, 4], [3, 1, 5, 5, 5], [3, 1, 5, 5, 5]],
  'Radio communications': [[4, 4, 2, 3, 3], [5, 5, 3, 4, 4], [5, 5, 4, 5, 5], [5, 5, 5, 5, 5], [5, 5, 5, 5, 5]],
};
const BANDS = ['1h', '4h', '1d', '3d', '1w'];
const AREAS = ['operational', 'safety', 'financial', 'reputational', 'legal_regulatory'];

const CHECKLIST: Record<string, [string, string, string][]> = {
  continuity: [
    ['activate', 'Confirm which processes are affected and for how long', 'Continuity lead'],
    ['activate', 'Start the call tree', 'Continuity lead'],
    ['respond', 'Switch affected processes to their manual workarounds', 'Process owners'],
    ['recover', 'Restore systems in order of process criticality', 'IT recovery lead'],
    ['stand_down', 'Confirm every process is back to normal and record the summary', 'Continuity lead'],
  ],
  emergency_operations: [
    ['activate', 'Open the emergency operations room and start the log', 'Emergency manager'],
    ['activate', 'Brief control and the depots on the forecast and the trigger level reached', 'Emergency manager'],
    ['respond', 'Move vehicles away from flood-prone stops and depots', 'Operations lead'],
    ['respond', 'Post disruption notices for riders', 'Communications lead'],
    ['recover', 'Inspect track, stops and shelters before service resumes', 'Infrastructure lead'],
    ['stand_down', 'Debrief within a week and record the after-action summary', 'Emergency manager'],
  ],
  it_disaster_recovery: [
    ['activate', 'Declare the disaster and tell the service desk', 'IT recovery lead'],
    ['respond', 'Restore the directory and network first', 'Infrastructure engineer'],
    ['recover', 'Restore tier 1 systems from the nightly copies, then tier 2', 'IT recovery lead'],
    ['stand_down', 'Check data with each system owner before handing back', 'IT recovery lead'],
  ],
};

const PLAN_TITLES = ['Business continuity plan', 'Emergency operations plan with severe weather annex', 'IT disaster recovery plan'];
const TYPED_NAMES = ['Operations lead', 'Duty dispatcher', 'Depot supervisor North', 'Depot supervisor South', 'Maintenance lead', 'Signal maintainer on call', 'Communications officer'].map(mark);

/** Names of an earlier version ("X (sample)"), renamed in place (E18-65). */
export const CONTINUITY_RENAMES: SampleRename[] = [
  { type: 'business_process', names: PROCESSES.map((p) => mark(p.name)) },
  { type: 'continuity_plan', column: 'title', names: PLAN_TITLES.map(mark) },
  { type: 'emergency_activation', column: 'title', names: [mark('Flooding after a severe storm')] },
  { type: 'cap', column: 'title', names: [mark('Keep the Depot South drains clear before storms')] },
  // People's names typed into records.
  { table: 'users', column: 'display_name', every: true, names: SAMPLE_USERS.map((u) => u.name) },
  { type: 'continuity_plan', column: 'approved_by_name', every: true, names: SAMPLE_USERS.map((u) => u.name) },
  { type: 'bia', column: 'signed_off_by_name', every: true, names: SAMPLE_USERS.map((u) => u.name) },
  { table: 'activation_log_entries', column: 'by_name', every: true, names: SAMPLE_USERS.map((u) => u.name) },
  { table: 'activation_checklist', column: 'done_by_name', every: true, names: SAMPLE_USERS.map((u) => u.name) },
  { table: 'call_tree_nodes', every: true, names: TYPED_NAMES },
  { table: 'activation_roles', every: true, names: TYPED_NAMES },
];

async function sampleUsers(ctx: ModuleContext): Promise<string[]> {
  const ids: string[] = [];
  for (const p of SAMPLE_USERS) {
    let row = await ctx.db.one<Row>('select id from users where lower(username) = lower($1)', [p.username]);
    if (!row) {
      // No password: nobody can sign in as a sample person.
      row = (await ctx.db.one<Row>(`insert into users (username, email, display_name, status) values ($1,$2,$3,'active') returning id`,
        [p.username, `${p.username}@example.test`, p.name]))!;
      const role = await ctx.db.one<Row>('select id from roles where key = $1', [p.role]);
      if (role) await ctx.db.query('insert into user_roles (user_id, role_id) values ($1,$2) on conflict do nothing', [row.id, role.id]);
      await ctx.audit(null, { action: 'user.create', recordType: 'user', recordId: row.id, summary: `Sample person added: ${p.name}` });
    }
    ids.push(row.id);
  }
  return ids;
}

/** The record a sample dependency names, when it exists now. */
async function depId(ctx: ModuleContext, kind: Dep[0], name: string): Promise<string | null> {
  const q = (sql: string) => ctx.db.one<{ id: string }>(sql, [name]).then((r) => r?.id ?? null);
  switch (kind) {
    case 'system': return q('select id from systems where lower(name) = lower($1) and deleted_at is null');
    case 'site': return q('select id from sites where lower(name) = lower($1) and deleted_at is null');
    case 'service': return ctx.resources.get('service') ? q('select id from services where lower(route_code) = lower($1) and deleted_at is null') : null;
    case 'vendor': return ctx.resources.get('vendor') ? q('select id from vendors where lower(name) = lower($1) and deleted_at is null') : null;
    case 'position': return ctx.resources.get('position') ? q('select id from positions where lower(name) = lower($1) and deleted_at is null') : null;
  }
}

/** Adds the sample dependencies whose records exist now (vendors and exercises seed after this module). */
async function linkDependencies(ctx: ModuleContext): Promise<number> {
  let added = 0;
  for (const p of PROCESSES) {
    const proc = await ctx.db.one<{ id: string }>('select id from business_processes where name = $1 and deleted_at is null', [mark(p.name)]);
    if (!proc) continue;
    for (const [i, [kind, name, critical]] of p.deps.entries()) {
      const id = await depId(ctx, kind, name);
      if (!id) continue;
      const row = await ctx.db.one(
        `insert into process_dependencies (process_id, dep_type, dep_id, critical, sort) values ($1,$2,$3,$4,$5) on conflict do nothing returning id`,
        [proc.id, kind, id, critical, (i + 1) * 10]);
      if (row) added++;
    }
    await mirrorLinks(ctx, proc.id, null);
  }
  return added;
}

/** Links the sample exercises about continuity to the sample plans, when both exist. */
async function linkExercises(ctx: ModuleContext): Promise<number> {
  if (!ctx.resources.get('exercise')) return 0;
  const exercises = await ctx.db.query<Row>(
    `select id, type from exercises where deleted_at is null and type in ('continuity_test', 'tabletop', 'restore_test') order by exercise_date desc limit 6`);
  const plans = await ctx.db.query<Row>('select id, plan_type from continuity_plans where deleted_at is null and title like $1', [`${MARK} %`]);
  let n = 0;
  for (const e of exercises) {
    const plan = plans.find((p) => (e.type === 'restore_test' ? p.plan_type === 'it_disaster_recovery' : p.plan_type !== 'it_disaster_recovery'));
    if (!plan) continue;
    const row = await ctx.db.one(
      `insert into record_links (from_type, from_id, to_type, to_id, relation) values ('continuity_plan', $1, 'exercise', $2, 'exercised_by') on conflict do nothing returning id`,
      [plan.id, e.id]);
    if (row) n++;
  }
  return n;
}

export async function seedContinuity(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample continuity records are dev profile only)';
  // Wave 26: no account is needed first. The sample people have no password, so setup stays open
  // (it waits for someone who can sign in, core/auth.ts) and a fresh dev database shows the samples.
  await renameSamples(ctx, CONTINUITY_RENAMES);
  if (await ctx.db.one('select 1 from business_processes where name like $1 limit 1', [`${MARK} %`])) {
    const deps = await linkDependencies(ctx);
    const ex = await linkExercises(ctx);
    return `sample continuity records already loaded${deps ? `; ${deps} more dependencies linked` : ''}${ex ? `; ${ex} exercises linked to plans` : ''}`;
  }
  // Modules seed in key order: load the sample estate, fleet and roster this module points at (each idempotent).
  if (ctx.resources.get('site') && !(await ctx.db.one(`select 1 from sites where name = 'Example Operations Control Center' and deleted_at is null`))) await seedDevEstate(ctx);
  if (ctx.resources.get('service') && !(await ctx.db.one(`select 1 from services where route_code = 'DR' and deleted_at is null`))) await seedFleet(ctx, opts);
  if (ctx.resources.get('person')) await seedPeople(ctx, opts);

  const [avery, jordan] = await sampleUsers(ctx);
  const owners = [avery, jordan];
  const today = dayInZone();
  const procIds = new Map<string, string>();
  for (const p of PROCESSES) {
    const row = await ctx.resources.create('business_process', {
      name: mark(p.name), department: p.department, owner_id: owners[p.owner], description: p.description, criticality: p.criticality,
      status: 'active', peak_periods: p.peak, mtd_hours: p.mtd, rto_target_hours: p.rto, rpo_target_hours: p.rpo, minimum_staff: p.staff,
      manual_workaround: p.workaround, next_bia_due: IMPACTS[p.name] ? null : addMonths(today, 1),
    });
    procIds.set(p.name, row.id);
  }
  const deps = await linkDependencies(ctx);

  // Impact analyses, signed off for five; one still a draft.
  let analyses = 0;
  for (const [i, [name, rows]] of Object.entries(IMPACTS).entries()) {
    const p = PROCESSES.find((x) => x.name === name)!;
    const draft = i === 5;
    const assessed = dayInZone(-30 - i * 20);
    await ctx.resources.create('bia', {
      process_id: procIds.get(name), year: Number(assessed.slice(0, 4)), assessed_on: assessed, assessor_id: owners[p.owner],
      impacts: rows.map((r, b) => ({ band: BANDS[b], ...Object.fromEntries(AREAS.map((a, k) => [a, r[k]])) })),
      mtd_hours: p.mtd, rto_target_hours: p.rto, rpo_target_hours: p.rpo,
      answers: { riders_notice: p.criticality === 'vital' ? 'yes' : 'no', deadline_reporting: name === 'Payroll' ? 'yes' : 'no', workaround_hours: Math.min(p.mtd * 2, 48), restore_needs: 'The system supplier and the IT recovery lead.' },
      notes: mark('Workshop with the process owner and the IT recovery lead.'),
      status: draft ? 'draft' : 'signed_off', ...(draft ? {} : { signed_off_by_name: SAMPLE_USERS[0].name, signed_off_on: assessed }),
    });
    if (!draft) {
      await ctx.resources.update('business_process', procIds.get(name)!, { last_bia_on: assessed, next_bia_due: addMonths(assessed, 12) });
    }
    analyses++;
  }

  // Plans: approved, in review, and approved but overdue for review.
  const plan = async (title: string, type: string, owner: string, data: Row, processNames: string[]) => {
    const row = await ctx.resources.create('continuity_plan', { title: mark(title), plan_type: type, owner_id: owner, review_months: 12, ...data });
    for (const n of processNames) {
      await ctx.db.query('insert into continuity_plan_processes (plan_id, process_id) values ($1,$2) on conflict do nothing', [row.id, procIds.get(n)]);
    }
    for (const [i, [phase, item, role]] of (CHECKLIST[type] ?? []).entries()) {
      await ctx.db.query('insert into continuity_checklist_items (plan_id, phase, item, role, sort) values ($1,$2,$3,$4,$5)', [row.id, phase, item, role, (i + 1) * 10]);
    }
    return row;
  };
  const bcp = await plan('Business continuity plan', 'continuity', avery, {
    status: 'approved', approved_on: dayInZone(-100), approved_by_name: SAMPLE_USERS[1].name, next_review_on: addMonths(dayInZone(-100), 12),
    scope: 'Every vital and essential business process at the head office, the operations control center and the depots.',
    activation_criteria: 'A vital process is down, or is expected to be down, for longer than half its tolerable downtime.',
    recovery_strategies: 'Manual workarounds first; systems restored in order of process criticality; staff moved to the other depot when a depot is lost.',
  }, ['Rail operations control', 'Bus dispatch', 'Fare collection', 'Paratransit scheduling', 'Payroll', 'Radio communications']);
  const eop = await plan('Emergency operations plan with severe weather annex', 'emergency_operations', avery, {
    scope: 'Emergencies that affect service or facilities: severe weather, power loss, loss of a facility. The severe weather annex covers storms, flooding, snow and extreme heat.',
    activation_criteria: 'A severe weather warning for the service area, a power loss at a depot or the operations control center, or the loss of a facility.',
    recovery_strategies: 'Reduced timetable announced in advance; vehicles moved away from flood-prone areas; service restored line by line after inspection.',
  }, ['Rail operations control', 'Bus dispatch', 'Passenger information', 'Radio communications']);
  const itdr = await plan('IT disaster recovery plan', 'it_disaster_recovery', jordan, {
    status: 'approved', approved_on: dayInZone(-400), approved_by_name: SAMPLE_USERS[0].name, next_review_on: dayInZone(-35),
    scope: 'Recovery of the systems the vital and essential processes depend on, from the nightly copies.',
    activation_criteria: 'Loss of the main server room, or of a tier 1 system for longer than its recovery time objective.',
    recovery_strategies: 'Directory and network first, then tier 1 systems, then tier 2, each checked with its owner.',
  }, ['Fare collection', 'Payroll', 'Customer service', 'Procurement']);

  // The emergency operations plan waits for approval, when a workflow can take it.
  const eng = approvalEngine(ctx.app);
  const started = eng ? await eng.start(PLAN_KIND, await ctx.resources.find('continuity_plan', eop.id, null) as Row, { requester: avery, req: null, note: mark('Annual update') }).catch(() => null) : null;
  if (started?.status === 'running') await ctx.resources.update('continuity_plan', eop.id, { status: 'in_review' });

  // Call trees from the sample roster (or typed names when there is no roster).
  let tree = 0;
  const roster = ctx.resources.get('person') ? await ctx.db.query<Row>(
    `select p.id, pos.name as position from people p left join positions pos on pos.id = p.position_id
     where p.deleted_at is null and p.full_name like '[Sample]%' and pos.name in ('[Sample] Supervisor', '[Sample] Dispatcher', '[Sample] Rolling stock maintainer', '[Sample] Signal maintainer')
     order by p.employee_number`) : [];
  const pick = (position: string, n: number) => roster.filter((r) => r.position === position).slice(n, n + 1)[0]?.id ?? null;
  const node = async (planId: string, parent: string | null, sort: number, role: string, personId: string | null, typed: string, phone: string) =>
    (await ctx.db.one<{ id: string }>(
      `insert into call_tree_nodes (plan_id, parent_id, sort, role, person_id, name, phone) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [planId, parent, sort, role, personId, personId ? null : typed, personId ? null : phone]))!.id;
  for (const p of [bcp, eop, itdr]) {
    const lead = await ctx.db.one<{ id: string }>(
      `insert into call_tree_nodes (plan_id, sort, role, user_id) values ($1, 10, $2, $3) returning id`, [p.id, 'Plan lead', p.owner_id]);
    const ops = await node(p.id, lead!.id, 10, 'Operations lead', pick('[Sample] Supervisor', 0), '[Sample] Operations lead', '555-0140');
    await node(p.id, ops, 10, 'Duty dispatcher', pick('[Sample] Dispatcher', 0), '[Sample] Duty dispatcher', '555-0141');
    await node(p.id, ops, 20, 'Depot supervisor, North', pick('[Sample] Supervisor', 1), '[Sample] Depot supervisor North', '555-0142');
    await node(p.id, ops, 30, 'Depot supervisor, South', pick('[Sample] Supervisor', 2), '[Sample] Depot supervisor South', '555-0143');
    const maint = await node(p.id, lead!.id, 20, 'Maintenance lead', pick('[Sample] Rolling stock maintainer', 0), '[Sample] Maintenance lead', '555-0144');
    await node(p.id, maint, 10, 'Signal maintainer on call', pick('[Sample] Signal maintainer', 0), '[Sample] Signal maintainer on call', '555-0145');
    await node(p.id, lead!.id, 30, 'Communications', null, '[Sample] Communications officer', '555-0146');
    tree += 8;
  }

  // One closed severe-weather activation under the emergency operations plan.
  const declared = new Date(Date.now() - 40 * 86_400_000);
  declared.setUTCHours(5, 30, 0, 0);
  const at = (hours: number) => new Date(declared.getTime() + hours * 3_600_000).toISOString();
  const sites = (await ctx.db.query<{ id: string }>(`select id from sites where name in ('Example Depot South', 'Example Rail Yard') and deleted_at is null`)).map((r) => r.id);
  const services = ctx.resources.get('service') ? (await ctx.db.query<{ id: string }>(`select id from services where route_code in ('7', '15', 'LR-B') and deleted_at is null`)).map((r) => r.id) : [];
  const act = await ctx.resources.create('emergency_activation', {
    title: mark('Flooding after a severe storm'), event_type: 'severe_weather', level: 'partial', declared_at: declared.toISOString(), declared_by: avery,
    plan_ids: [eop.id], sites_affected: sites, services_affected: services,
  });
  await ctx.db.query('update activation_log_entries set at = $2, by_id = $3, by_name = $4 where activation_id = $1', [act.id, declared.toISOString(), avery, SAMPLE_USERS[0].name]);
  const log = [
    [0.25, 'Storm warning upgraded overnight; partial activation declared. Emergency operations room open.'],
    [0.5, 'Depot South yard flooding at the north gate. Buses moved to the upper parking area.'],
    [1, 'Routes 7 and 15 diverted away from the river road. Disruption notices posted.'],
    [3, 'Light Rail Line B suspended between the interchange and the harbor: water over the track at the underpass.'],
    [9, 'Water receding. Track inspected and cleared; Line B resumes at reduced speed.'],
    [12, 'Normal service on all routes. Stand-down agreed with the operations lead.'],
  ] as const;
  for (const [h, entry] of log) {
    await ctx.db.query('insert into activation_log_entries (activation_id, at, entry, by_id, by_name) values ($1,$2,$3,$4,$5)', [act.id, at(h), mark(entry), avery, SAMPLE_USERS[0].name]);
  }
  await ctx.db.query('insert into activation_roles (activation_id, role, user_id, assigned_at) values ($1,$2,$3,$4)', [act.id, 'Emergency manager', avery, at(0.25)]);
  await ctx.db.query('insert into activation_roles (activation_id, role, person_id, name, assigned_at) values ($1,$2,$3,$4,$5)',
    [act.id, 'Operations lead', pick('[Sample] Supervisor', 0), pick('[Sample] Supervisor', 0) ? null : '[Sample] Operations lead', at(0.3)]);
  await ctx.db.query('insert into activation_roles (activation_id, role, name, assigned_at) values ($1,$2,$3,$4)', [act.id, 'Communications lead', '[Sample] Communications officer', at(0.5)]);
  await ctx.db.query(`update activation_checklist set done_by = $2, done_by_name = $3, done_at = $4 where activation_id = $1`, [act.id, avery, SAMPLE_USERS[0].name, at(6)]);
  await ctx.resources.update('emergency_activation', act.id, {
    status: 'closed', stood_down_at: at(12), closed_at: at(24 * 6),
    summary: mark('Service back to normal after twelve hours. No injuries; two buses with water damage.'),
    after_action_summary: mark('Went well: buses moved early, notices posted within the hour. To improve: the Depot South drains were blocked, and the underpass has no water-level alarm.'),
  });
  let caps = 0;
  if (ctx.resources.get('cap')) {
    await ctx.resources.create('cap', {
      title: mark('Keep the Depot South drains clear before storms'), source: 'continuity', source_type: 'emergency_activation', source_id: act.id,
      problem_statement: 'Blocked drains flooded the Depot South yard during the storm, so buses had to be moved at short notice.',
      root_cause: 'The drains are cleared once a year; leaves block them every autumn.', responsible_id: jordan, due_on: dayInZone(30),
    });
    caps++;
  }
  const ex = await linkExercises(ctx);
  return `${PROCESSES.length} sample business processes (${deps} dependencies), ${analyses} impact analyses, 3 plans (${tree} call tree entries), `
    + `1 closed activation${caps ? ' with an after-action plan' : ''}${ex ? `, ${ex} exercises linked` : ''}`;
}
