import type { ModuleContext, Row } from '../../core/module.ts';
import { clock } from './clock.ts';

/**
 * Invented sample data for demonstrations, dev profile only (E18-69): clearly labeled "[Sample]"
 * tickets, problems, knowledge articles and catalog items. Nothing here describes a real person,
 * device or event.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Small repeatable random generator, so that every seeded database looks the same. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type T = [title: string, type: string, category: string, impact: string, urgency: string, department: string, group: string];
const TEMPLATES: T[] = [
  ['Front desk computers cannot reach the booking system', 'incident', 'network', 'organisation', 'high', 'Operations', 'infrastructure'],
  ['Front desk workstation 2 frozen on the booking screen', 'incident', 'software', 'individual', 'high', 'Operations', 'service_desk'],
  ['Supervisor tablets not updating from the booking system', 'incident', 'network', 'department', 'high', 'Operations', 'infrastructure'],
  ['Laptop will not start after an update', 'incident', 'hardware', 'individual', 'medium', 'Finance', 'service_desk'],
  ['Shared printer on the second floor is jamming', 'incident', 'printing', 'department', 'low', 'Customer Service', 'service_desk'],
  ['Password reset for the payroll application', 'request', 'access', 'individual', 'medium', 'Finance', 'service_desk'],
  ['New starter set-up for a customer service representative', 'request', 'access', 'individual', 'medium', 'Human Resources', 'service_desk'],
  ['Ticket machine at Riverside Depot is not accepting cards', 'incident', 'hardware', 'individual', 'medium', 'Maintenance', 'applications'],
  ['Hillcrest Depot office router offline', 'incident', 'network', 'individual', 'medium', 'Maintenance', 'infrastructure'],
  ['Desk phone has no dial tone', 'incident', 'telephony', 'individual', 'medium', 'Planning', 'infrastructure'],
  ['Request for a second monitor', 'request', 'hardware', 'individual', 'low', 'Planning', 'service_desk'],
  ['Cannot open the shared budget folder', 'incident', 'access', 'individual', 'medium', 'Finance', 'service_desk'],
  ['Email delivery delayed for the whole department', 'incident', 'email', 'department', 'medium', 'Customer Service', 'infrastructure'],
  ['Install mapping software for a planner', 'request', 'software', 'individual', 'low', 'Planning', 'applications'],
  ['Northgate Depot workshop Wi-Fi keeps dropping', 'incident', 'network', 'department', 'medium', 'Maintenance', 'infrastructure'],
  ['Leaver: remove access for a departing member of staff', 'request', 'access', 'individual', 'medium', 'Human Resources', 'service_desk'],
  ['Vendor needs remote access for a scheduled upgrade', 'request', 'access', 'department', 'medium', 'Operations', 'security'],
  ['Suspicious email reported by a member of staff', 'incident', 'security', 'individual', 'high', 'Customer Service', 'security'],
  ['Onboard fare validator on a sample bus is not syncing', 'incident', 'hardware', 'individual', 'medium', 'Operations', 'applications'],
  ['Question about using the meeting room display', 'request', 'other', 'individual', 'low', 'Planning', 'service_desk'],
];

// 40 tickets: a spread of live work and history.
const STATUSES = [
  'closed', 'closed', 'closed',
  'new', 'new', 'new', 'new', 'new',
  'assigned', 'assigned', 'assigned', 'assigned',
  'in_progress', 'in_progress', 'in_progress', 'in_progress', 'in_progress', 'in_progress',
  'waiting_requester', 'waiting_requester', 'waiting_requester',
  'waiting_vendor', 'waiting_vendor', 'waiting_vendor',
  'resolved', 'resolved', 'resolved', 'resolved', 'resolved',
  'closed', 'closed', 'closed', 'closed', 'closed', 'closed', 'closed', 'closed', 'closed',
  'cancelled', 'cancelled',
];

const PEOPLE = ['Avery Sample', 'Blake Example', 'Casey Placeholder', 'Devon Sample', 'Emery Example', 'Finley Placeholder', 'Harper Sample', 'Jordan Example'];
const CODES: Record<string, string> = { request: 'fulfilled', incident: 'fixed' };

export async function seedSamples(ctx: ModuleContext, sla: { sweep(now?: Date): Promise<number> }): Promise<string> {
  const { db } = ctx;
  if (await db.one(`select 1 from tickets where title like '[Sample]%' limit 1`)) return 'sample tickets already present, skipped';

  const rand = rng(20261118);
  const pick = <X>(xs: X[]) => xs[Math.floor(rand() * xs.length)];
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const now = clock.now();
  const users = (await db.query<{ id: string }>(
    `select id from users where status = 'active' and deleted_at is null order by created_at limit 6`)).map((u) => u.id);
  const someone = () => (users.length ? pick(users) : null);

  // ----- problems -----
  const problems: Row[] = [];
  for (const p of [
    { title: '[Sample] Branch office routers drop their connection after long idle periods', status: 'known_error', known_error: true,
      description: 'Several sample offices have reported routers going offline first thing in the morning.',
      root_cause: 'Invented for demonstration: a power-saving setting puts the modem to sleep.',
      workaround: 'Restart the router; it reconnects within two minutes.' },
    { title: '[Sample] Second-floor printer jams with heavy paper', status: 'investigating', known_error: false,
      description: 'Repeated jams reported by more than one department.', root_cause: null,
      workaround: 'Use tray 2 for anything heavier than standard paper.' },
  ]) problems.push(await ctx.resources.create('problem', { ...p, owner_id: someone() }));

  // ----- knowledge articles -----
  const reviewOn = new Date(now.getTime() + 180 * DAY).toISOString().slice(0, 10);
  for (const a of [
    { title: '[Sample] How to restart a branch office router', category: 'how_to', audience: 'staff',
      body: 'Use this when an office shows as offline.\n\n1. Ask someone on site to find the router in the comms cabinet.\n2. Hold the power button for five seconds, wait ten seconds, then press it once.\n3. The status light turns solid within two minutes.\n\nIf the light keeps flashing, log a ticket under Network and connectivity.' },
    { title: '[Sample] Resetting a password for a colleague', category: 'how_to', audience: 'agents',
      body: 'Confirm who you are speaking to before any reset.\n\n1. Call the person back on the number in the staff directory.\n2. Reset the password and require a change at next sign-in.\n3. Record the check you made in the ticket.' },
    { title: '[Sample] Printer jams: first checks', category: 'troubleshooting', audience: 'staff',
      body: 'Most jams clear with three checks.\n\n1. Open the side door and remove any paper you can see.\n2. Fan the paper in the tray and reload it.\n3. For heavy paper use tray 2.\n\nStill jamming? Log a ticket and say which tray you used.' },
    { title: '[Sample] Logging a ticket on behalf of a colleague', category: 'policy', audience: 'agents',
      body: 'In version 1 only IT staff sign in, so every ticket is logged for someone else.\n\nAlways record the requester name, department and a way to reach them. Choose impact and urgency honestly: the priority and the service-level targets follow from them.' },
  ]) await ctx.resources.create('knowledge_article', { ...a, status: 'published', owner_id: someone(), review_on: reviewOn });

  // ----- a catalog item with its own questions and fulfillment tasks -----
  if (!(await db.one(`select 1 from catalog_items where name like '[Sample]%' limit 1`))) {
    await ctx.resources.create('catalog_item', {
      name: '[Sample] Vehicle equipment fault', category: 'equipment', active: true,
      description: 'Report a fault with equipment fitted to a vehicle: fare validator, destination display, radio or onboard camera.',
      defaults: { type: 'incident', category: 'hardware', title: 'Vehicle equipment fault: ', impact: 'individual', urgency: 'high', assignment_group: 'applications' },
      questions: [
        { key: 'fleet_number', label: 'Vehicle fleet number', type: 'text', required: true, hint: 'As painted on the vehicle, for example 4127.' },
        { key: 'depot', label: 'Depot', type: 'choice', required: true, options: ['Northgate Depot', 'Riverside Depot', 'Hillcrest Depot'] },
        { key: 'equipment', label: 'Equipment', type: 'choice', required: true, options: ['Fare validator', 'Destination display', 'Radio', 'Onboard camera', 'Other'] },
        { key: 'in_service', label: 'Is the vehicle still in service?', type: 'yes_no' },
      ],
      tasks: ['Book the vehicle in with the depot workshop', 'Test or swap the unit', 'Confirm the equipment works before the next run'],
      portal: true,
    });
    // Two everyday requests, so the self-service portal has something to offer once it is switched on (E18-64).
    await ctx.resources.create('catalog_item', {
      name: '[Sample] New laptop or desktop', category: 'equipment', active: true, portal: true,
      description: 'Ask for a computer for a new starter, or to replace one that is old or broken.',
      defaults: { type: 'request', category: 'hardware', title: 'New computer: ', impact: 'individual', urgency: 'medium', assignment_group: 'service_desk' },
      questions: [
        { key: 'for_whom', label: 'Who is it for?', type: 'text', required: true },
        { key: 'kind', label: 'Kind of computer', type: 'choice', required: true, options: ['Laptop', 'Desktop'] },
        { key: 'needed_by', label: 'Needed by', type: 'date' },
      ],
      tasks: ['Prepare and set up the computer', 'Hand it over and collect the old one'],
    });
    await ctx.resources.create('catalog_item', {
      name: '[Sample] Access to a shared folder', category: 'access', active: true, portal: true,
      description: 'Ask for access to a shared drive or folder. The folder owner is asked to agree.',
      defaults: { type: 'request', category: 'access', title: 'Folder access: ', impact: 'individual', urgency: 'low', assignment_group: 'service_desk' },
      questions: [
        { key: 'folder', label: 'Folder or drive', type: 'text', required: true, hint: 'The path or name as you see it.' },
        { key: 'access', label: 'Access needed', type: 'choice', required: true, options: ['Read only', 'Read and change'] },
      ],
      tasks: ['Confirm with the folder owner', 'Grant the access'],
    });
    // The portal field is hidden while the portal is switched off (core/features.ts), and then a write
    // to it is ignored; the dev seed marks the sample items itself so they are ready when it is switched on.
    await db.query(`update catalog_items set portal = true where name like '[Sample]%' and deleted_at is null`);
  }

  // ----- tickets -----
  let made = 0;
  let major: Row | null = null;
  for (let i = 0; i < STATUSES.length; i++) {
    const status = STATUSES[i];
    const [title, type, category, impact, urgency, department, group] = TEMPLATES[i % TEMPLATES.length];
    const open = ['new', 'assigned', 'in_progress', 'waiting_requester', 'waiting_vendor'].includes(status);
    // Live work is recent (a few items are older, so some targets have been missed); history is spread over the month.
    const ageDays = status === 'new' ? between(0.01, i % 5 === 0 ? 2.5 : 0.4)
      : open ? between(0.2, i % 4 === 0 ? 12 : 4)
      : status === 'resolved' ? between(1.5, 7)
      : between(6, 29.5);
    const opened = new Date(now.getTime() - ageDays * DAY);
    const age = now.getTime() - opened.getTime();
    const clampBefore = (ms: number, latest: number) => new Date(opened.getTime() + Math.max(MIN, Math.min(ms, latest)));

    const data: Row = {
      title: `[Sample] ${title}`, type, category, impact, urgency,
      description: 'Invented sample ticket for demonstrations. Safe to delete.',
      requester_name: pick(PEOPLE), requester_department: department, assignment_group: group,
      channel: pick(['agent', 'phone', 'walk_up', 'agent']),
      status, opened_at: opened.toISOString(),
    };
    data.requester_email = `${String(data.requester_name).toLowerCase().replace(/\s+/g, '.')}@example.test`;

    if (status !== 'new') {
      data.assignee_id = someone();
      // Most first responses are quick; roughly one in six is slow.
      const respond = rand() < 0.17 ? between(5 * HOUR, 30 * HOUR) : between(4 * MIN, 50 * MIN);
      data.first_responded_at = clampBefore(respond, age * 0.5).toISOString();
    }
    if (status === 'waiting_requester' || status === 'waiting_vendor') {
      data.paused_at = clampBefore(between(1 * HOUR, 20 * HOUR), age * 0.8).toISOString();
    }
    if (status === 'waiting_vendor' || i === 30 || i === 33) {
      data.with_vendor = true;
      data.vendor_ref = `CASE-${10000 + Math.floor(rand() * 89999)}`;
      const raised = clampBefore(between(30 * MIN, 6 * HOUR), age * 0.6);
      data.vendor_raised_at = raised.toISOString();
      if (status !== 'waiting_vendor' || i % 2 === 0) {
        data.vendor_responded_at = new Date(Math.min(now.getTime() - MIN, raised.getTime() + between(1 * HOUR, 26 * HOUR))).toISOString();
      }
    }
    if (!open) {
      const slow = rand() < 0.2;
      const resolved = clampBefore(slow ? between(4 * DAY, 9 * DAY) : between(40 * MIN, 30 * HOUR), age - 10 * MIN);
      data.resolved_at = resolved.toISOString();
      if (new Date(data.first_responded_at) > resolved) data.first_responded_at = resolved.toISOString();
      if (status !== 'cancelled') {
        data.resolution_code = data.with_vendor ? 'vendor_fix' : CODES[type];
        data.resolution_notes = 'Sample resolution: checked with the requester that everything works again.';
      } else {
        data.resolution_notes = 'Sample: the requester no longer needed this.';
      }
      if (status !== 'resolved') data.closed_at = new Date(Math.min(now.getTime() - MIN, resolved.getTime() + between(2 * HOUR, 2 * DAY))).toISOString();
      if (status === 'closed' && rand() < 0.7) {
        data.satisfaction_score = pick([5, 5, 4, 4, 4, 3, 2]);
        if (data.satisfaction_score <= 3) data.satisfaction_comment = 'Sample comment: it took longer than I expected.';
      }
      if (slow) data.breach_reason = 'Sample reason: waiting for a replacement part.';
    }
    if (title.includes('router')) data.problem_id = problems[0].id;
    if (category === 'printing') data.problem_id = problems[1].id;

    if (i === 0) {
      data.major_incident = true;
      data.post_incident_review = {
        summary: 'Sample review: the front desk lost its connection to the booking system for about an hour.',
        root_cause: 'Invented for demonstration: a network switch restarted after a power dip.',
        went_well: 'The front desk moved to the paper fallback within ten minutes.',
        to_improve: 'The switch was not on protected power. Alerting did not reach the on-call phone.',
        actions: 'Move the switch to protected power. Test on-call alerting monthly.',
        completed_on: new Date(opened.getTime() + 3 * DAY).toISOString().slice(0, 10),
      };
    } else if ((i === 1 || i === 2) && major) {
      data.parent_ticket_id = major.id;
      // Children of the major incident were raised just after it.
      data.opened_at = new Date(new Date(major.opened_at).getTime() + i * 6 * MIN).toISOString();
      for (const k of ['first_responded_at', 'resolved_at', 'closed_at']) {
        if (data[k] && new Date(data[k]) < new Date(data.opened_at)) data[k] = new Date(new Date(data.opened_at).getTime() + 20 * MIN).toISOString();
      }
    }

    const row = await ctx.resources.create('ticket', data);
    if (i === 0) major = row;
    made += 1;
  }

  const breached = await sla.sweep(now);
  const total = (await db.one<{ n: number }>(
    `select count(*)::int as n from tickets where title like '[Sample]%' and (response_breached or resolve_breached)`))!.n;
  return `${made} sample tickets (${total} with a missed target, ${breached} flagged by the sweep), ${problems.length} problems, 4 knowledge articles, 1 catalog item`;
}
