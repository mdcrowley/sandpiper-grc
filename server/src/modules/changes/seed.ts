import type { ModuleContext, Row } from '../../core/module.ts';
import type { ChangeService } from './service.ts';

// Invented sample changes, blackout periods and templates: dev profile only (E18-69). Nothing here
// comes from the seed folder.

/** A moment `offset` days from today at `hour` o'clock. */
const at = (offset: number, hour: number): string => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
};
/** A start that has already happened: the time given, or an hour ago when that is still to come (a seed run before 06:00). */
const started = (offset: number, hour: number): string => {
  const t = at(offset, hour);
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  return t < hourAgo ? t : hourAgo;
};

const LOW = { people_affected: 'few', downtime: 'none', back_out: 'quick', experience: 'routine', testing: 'full' };
const MEDIUM = { people_affected: 'team', downtime: 'out_of_hours', back_out: 'slow', experience: 'some', testing: 'partial' };
const HIGH = { people_affected: 'most', downtime: 'working_hours', back_out: 'slow', experience: 'never', testing: 'partial' };

const PLANS = {
  implementation_plan: 'Sample plan: 1. Tell the people affected. 2. Take a backup. 3. Make the change. 4. Check the service.',
  test_plan: 'Sample test: sign in, carry out one everyday task, and check the monitoring page.',
  backout_plan: 'Sample back-out: restore the backup taken in step 2 and confirm the service is as it was.',
};

type Step =
  | { approve: string; role?: string }
  | { reject: string; notes: string }
  | { to: string; body?: Row }
  | { review: Row };

interface Sample {
  change: Row;
  /** Day offset and start hour of the planned window, and its length in hours. */
  when: [number, number, number];
  steps: Step[];
}

const done = (when: [number, number, number], outcome: string, notes?: string): Step[] => [
  { to: 'scheduled' },
  { to: 'in_progress', body: { actual_start: at(when[0], when[1]) } },
  { to: 'completed', body: { outcome, outcome_notes: notes, actual_end: at(when[0], when[1] + when[2]) } },
];

const SAMPLES: Sample[] = [
  {
    when: [14, 9, 2], steps: [],
    change: { title: '[Sample] Replace the depot reception printer', change_type: 'normal', risk_answers: LOW,
      description: 'Swap the depot reception printer for the new model and move its print queue.', reason: 'The old printer is out of support.' },
  },
  {
    when: [5, 18, 3], steps: [{ to: 'submitted' }],
    change: { title: '[Sample] Upgrade the finance system to the supported release', change_type: 'normal', risk_answers: MEDIUM,
      description: 'Install the supplier\'s current release on the finance system.', reason: 'The installed release leaves support next quarter.' },
  },
  {
    when: [7, 19, 4], steps: [{ to: 'submitted' }, { approve: 'Sample approver: change manager', role: 'Change manager' }],
    change: { title: '[Sample] Move the timetable file server to new storage', change_type: 'normal', risk_answers: HIGH,
      description: 'Copy all shared folders to the new storage and repoint the shares.', reason: 'The current storage is full and out of warranty.' },
  },
  {
    // Planned inside the sample blackout period: this is the sample conflict.
    when: [10, 20, 2], steps: [{ to: 'submitted' }, { approve: 'Sample approver: change manager', role: 'Change manager' }],
    change: { title: '[Sample] Firewall rule clean-up', change_type: 'normal', risk_answers: MEDIUM,
      description: 'Remove firewall rules that no longer match a system in the inventory.', reason: 'Unused rules were found in the last review.' },
  },
  {
    when: [2, 7, 1], steps: [{ to: 'submitted' }, { approve: 'Sample approver: change manager', role: 'Change manager' }, { to: 'scheduled' }],
    change: { title: '[Sample] Renew the journey planner web certificate', change_type: 'normal', risk_answers: LOW,
      description: 'Install the renewed certificate on the public journey planner.', reason: 'The certificate expires next week.' },
  },
  {
    when: [0, 6, 16],
    steps: [{ to: 'submitted' }, { approve: 'Sample approver: change manager', role: 'Change manager' }, { to: 'scheduled' }, { to: 'in_progress', body: { actual_start: started(0, 6) } }],
    change: { title: '[Sample] Patch the email gateway', change_type: 'normal', risk_answers: MEDIUM,
      description: 'Apply this month\'s security updates to the email gateway.', reason: 'Routine security patching.' },
  },
  {
    when: [-6, 18, 2],
    steps: [{ to: 'submitted' }, { approve: 'Sample approver: change manager', role: 'Change manager' }, ...done([-6, 18, 2], 'successful'), { to: 'closed' }],
    change: { title: '[Sample] Add memory to the ridership reporting server', change_type: 'normal', risk_answers: LOW,
      description: 'Fit two more memory modules in the ridership reporting server.', reason: 'Month-end reports run out of memory.' },
  },
  {
    when: [-3, 19, 3],
    steps: [{ to: 'submitted' }, { approve: 'Sample approver: change manager', role: 'Change manager' },
      ...done([-3, 19, 3], 'failed', 'Sample entry: the new release would not start; the service was down for forty minutes.')],
    change: { title: '[Sample] Upgrade the door access controller', change_type: 'normal', risk_answers: MEDIUM,
      description: 'Install the new controller software for the door access system.', reason: 'The supplier has ended support for the installed version.' },
  },
  {
    when: [-12, 18, 4],
    steps: [{ to: 'submitted' }, { approve: 'Sample approver: change manager', role: 'Change manager' },
      { approve: 'Sample approver: service owner', role: 'Service owner' },
      ...done([-12, 18, 4], 'backed_out', 'Sample entry: the copy ran slower than planned, so the change was backed out before the morning.'),
      { review: { what_happened: 'Sample entry: the data copy was at 60% when the agreed window ended, so the old database was put back.',
        cause: 'Sample entry: the copy speed was estimated from a much smaller test set.',
        follow_up: 'Sample entry: repeat the timing test with a full copy before trying again.' } }],
    change: { title: '[Sample] Move the fare card database to the new server', change_type: 'normal', risk_answers: HIGH,
      description: 'Copy the fare card database to the new server and switch the applications over.', reason: 'The old server is at the end of its life.' },
  },
  {
    when: [-18, 11, 2],
    steps: [{ to: 'submitted' }, { approve: 'Sample approver: duty manager', role: 'Duty manager' },
      { to: 'in_progress', body: { actual_start: at(-18, 11) } },
      { to: 'completed', body: { outcome: 'successful_with_issues', outcome_notes: 'Sample entry: service restored; two reports had to be re-run.', actual_end: at(-18, 13) } },
      { review: { what_happened: 'Sample entry: the disk filled, the service stopped, and old log files were removed to restore it.',
        cause: 'Sample entry: log clean-up had been switched off during an earlier upgrade.',
        follow_up: 'Sample entry: switch log clean-up back on and add a disk space alert.' } },
      { to: 'closed' }],
    change: { title: '[Sample] Free disk space on the crew rostering server', change_type: 'emergency', risk_answers: MEDIUM,
      description: 'Remove old log files so the crew rostering service can start again.', reason: 'Crew rostering stopped because the disk was full, the night before the duty sheets were due.' },
  },
  {
    when: [1, 12, 1], steps: [{ to: 'submitted' }],
    change: { title: '[Sample] Block a malicious sender at the email gateway', change_type: 'emergency', risk_answers: LOW,
      description: 'Add the sending domain to the gateway block list.', reason: 'Staff are receiving convincing fake invoices from this sender.' },
  },
  {
    when: [16, 18, 3], steps: [{ to: 'submitted' }, { reject: 'Sample approver: change manager', notes: 'Sample entry: no test plan for the telephone queues; please add one and resubmit.' }],
    change: { title: '[Sample] Change the customer information line call routing', change_type: 'normal', risk_answers: MEDIUM,
      description: 'Re-order the call queues for the customer information line.', reason: 'Requested by the customer information team before the new bus network launch.' },
  },
];

const TEMPLATES: Row[] = [
  {
    name: '[Sample] Monthly server patching', summary: 'Routine operating system updates on a server that has a tested restore.',
    title: '[Sample] Monthly patching', description: 'Apply this month\'s operating system updates and restart.',
    reason: 'Routine patching keeps systems supported and secure.', risk_level: 'low', duration_minutes: 120, ...PLANS,
  },
  {
    name: '[Sample] Add a network printer', summary: 'A new printer on the office network, using the standard driver.',
    title: '[Sample] Add a network printer', description: 'Connect the printer, give it a reserved address and publish its queue.',
    reason: 'Requested through the service desk.', risk_level: 'low', duration_minutes: 60, ...PLANS,
  },
];

const BLACKOUTS: Row[] = [
  { name: '[Sample] Timetable switch-over weekend', starts_at: at(9, 0), ends_at: at(12, 0), reason: 'The winter timetable goes live: passenger information, scheduling and fare systems stay as they are.' },
  { name: '[Sample] Service change: new bus network launch', starts_at: at(-16, 0), ends_at: at(-14, 0), reason: 'All passenger-facing services stay as they are while the new routes start.' },
  { name: '[Sample] Month-end fare reconciliation', starts_at: at(22, 1), ends_at: at(22, 5), repeat: 'monthly', reason: 'Fare data is being closed off for the month.' },
];

async function walk(svc: ChangeService, change: Row, steps: Step[]): Promise<Row> {
  let row = change;
  for (const s of steps) {
    if ('approve' in s) {
      row = (await svc.recordApproval(null, row, { decision: 'approved', approver_name: s.approve, approver_role: s.role, reference: 'Sample data' })).change;
    } else if ('reject' in s) {
      row = (await svc.recordApproval(null, row, { decision: 'rejected', approver_name: s.reject, notes: s.notes, reference: 'Sample data' })).change;
    } else if ('review' in s) {
      row = (await svc.saveReview(null, row, s.review)).change;
    } else {
      row = await svc.transition(null, row, { to: s.to, ...(s.body ?? {}) });
    }
  }
  return row;
}

/**
 * The system each sample change is about, by part of its title and the sample system's name (E18-82:
 * never a system picked in turn, which put a call-routing change on the rail signaling interface).
 * A change about something with no sample system (a printer, the firewall, a door controller, the
 * telephone queues) has none.
 */
const SYSTEM_OF: [string, string][] = [
  ['finance system', 'Example Finance System'],
  ['timetable file server', 'Example Scheduling System'],
  ['journey planner web certificate', 'Example Public Website'],
  ['email gateway', 'Example Directory'],
  ['ridership reporting server', 'Example Fare Collection System'],
  ['fare card database', 'Example Fare Collection System'],
  ['crew rostering server', 'Example Crew Rostering System'],
];

/** Later runs attach systems and related records once the modules that own them have been seeded. */
async function attachRelated(ctx: ModuleContext): Promise<string> {
  const notes: string[] = [];
  const samples = await ctx.db.query<Row>(`select id, title, system_id from changes where title like '[Sample]%' and deleted_at is null order by ref`);
  const systemDef = ctx.resources.get('system');
  if (systemDef && samples.length && samples.every((s) => !s.system_id)) {
    const systems = await ctx.db.query<{ id: string; name: string }>(`select id, name from ${systemDef.table} where deleted_at is null`);
    let attached = 0;
    // Sample windows never overlap, so sharing a system cannot create a second conflict.
    for (const s of samples) {
      const name = SYSTEM_OF.find(([part]) => String(s.title).includes(part))?.[1];
      const system = name ? systems.find((x) => x.name === name) : undefined;
      if (system) { await ctx.resources.update('change', s.id, { system_id: system.id }, null); attached += 1; }
    }
    if (attached) notes.push('systems attached');
  }
  const link = async (titlePart: string, type: string, relation: string) => {
    const def = ctx.resources.get(type);
    const change = samples.find((s) => String(s.title).includes(titlePart));
    if (!def || !change) return;
    if (await ctx.db.one(`select 1 from record_links where from_type = 'change' and from_id = $1 and to_type = $2`, [change.id, type])) return;
    const target = await ctx.db.one<{ id: string }>(`select id from ${def.table} where deleted_at is null order by created_at, id limit 1`);
    if (!target) return;
    await ctx.db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation) values ('change', $1, $2, $3, $4) on conflict do nothing`,
      [change.id, type, target.id, relation]);
    notes.push(`${type} linked`);
  };
  await link('door access controller', 'ticket', 'caused');
  await link('finance system', 'project', 'delivers');
  return notes.join(', ');
}

export async function seedSampleChanges(ctx: ModuleContext, svc: ChangeService): Promise<string> {
  const notes: string[] = [];

  if (!(await ctx.db.one(`select 1 from change_blackouts where name like '[Sample]%' limit 1`))) {
    for (const b of BLACKOUTS) await svc.addBlackout(null, b);
    notes.push(`${BLACKOUTS.length} sample blackout periods created`);
  }
  if (!(await ctx.db.one(`select 1 from change_templates where name like '[Sample]%' limit 1`))) {
    for (const t of TEMPLATES) await svc.addTemplate(null, t);
    notes.push(`${TEMPLATES.length} sample templates created`);
  }

  if (await ctx.db.one(`select 1 from changes where title like '[Sample]%' limit 1`)) {
    notes.push('sample changes already present');
  } else {
    for (const s of SAMPLES) {
      const [day, hour, hours] = s.when;
      const change = await ctx.resources.create('change', {
        ...PLANS, ...s.change, planned_start: at(day, hour), planned_end: at(day, hour + hours),
      });
      await walk(svc, change, s.steps);
    }
    const templates = await ctx.db.query<Row>(`select id, name from change_templates where name like '[Sample]%' and deleted_at is null order by name`);
    if (templates.length >= 2) {
      const upcoming = await svc.createFromTemplate(null, templates[1].id, { planned_start: at(3, 18) });
      await walk(svc, upcoming, [{ to: 'scheduled' }]);
      const past = await svc.createFromTemplate(null, templates[0].id, { planned_start: at(-9, 10) });
      await walk(svc, past, [...done([-9, 10, 1], 'successful'), { to: 'closed' }]);
    }
    notes.push(`${SAMPLES.length + (templates.length >= 2 ? 2 : 0)} sample changes created`);
  }

  const related = await attachRelated(ctx);
  if (related) notes.push(related);
  return notes.join('; ');
}
