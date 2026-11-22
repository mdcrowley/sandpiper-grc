// Sample records requests and privacy data (dev profile only; everything invented and labeled
// "(sample)"): six requests (three for records, three about personal data: one overdue, one extended,
// one closed with exemptions), personal-data flags on the sample data categories, and three privacy
// impact assessments (one approved, one in review, one due for review).
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { seedDevEstate } from '../inventory/seed-sample.ts';
import { REQUEST_TYPE } from './requests.ts';
import { PIA_TYPE } from './privacy.ts';

const PERSONAL: [string, string[]][] = [
  ['Customer account details', ['contact', 'account_payment']],
  ['Fare card transactions', ['account_payment', 'travel_location']],
  ['Onboard and station video', ['video_images']],
  ['Driver and operator records', ['employment', 'health_eligibility']],
  ['Staff payroll details', ['employment', 'account_payment']],
];
const ELIGIBILITY = 'Paratransit eligibility records (sample)';

async function idOf(ctx: ModuleContext, table: string, name: string): Promise<string | null> {
  return (await ctx.db.one<{ id: string }>(`select id from ${table} where name = $1 and deleted_at is null`, [name]))?.id ?? null;
}

async function seedCategories(ctx: ModuleContext): Promise<number> {
  if (!ctx.resources.get('data_category') || !ctx.resources.get('system')) return 0;
  await seedDevEstate(ctx);
  let flagged = 0;
  for (const [name, kinds] of PERSONAL) {
    const id = await idOf(ctx, 'data_categories', name);
    if (!id) continue;
    await ctx.resources.update('data_category', id, { personal_data: true, personal_data_kinds: kinds });
    flagged += 1;
  }
  let elig = await idOf(ctx, 'data_categories', ELIGIBILITY);
  if (!elig) {
    elig = (await ctx.resources.create('data_category', {
      name: ELIGIBILITY, contains: 'Invented sample: applications, eligibility decisions and trip needs of paratransit riders',
      custodian: 'Paratransit manager (sample)', retention_period: '3 years after eligibility ends', sensitivity_level: 'restricted',
      personal_data: true, personal_data_kinds: ['contact', 'health_eligibility'],
    })).id;
  }
  flagged += 1;
  const scheduling = await idOf(ctx, 'systems', 'Example Scheduling System');
  if (scheduling) await ctx.db.query('insert into system_data_categories (system_id, data_category_id) values ($1,$2) on conflict do nothing', [scheduling, elig]);
  return flagged;
}

async function seedAssessments(ctx: ModuleContext): Promise<number> {
  if (!ctx.resources.get('system') || await ctx.db.one(`select 1 from privacy_assessments where title like '%(sample)' limit 1`)) return 0;
  const sys = async (name: string) => idOf(ctx, 'systems', name);
  const cats = async (system: string | null) => (system ? (await ctx.db.query<{ id: string }>('select data_category_id::text as id from system_data_categories where system_id = $1 order by 1', [system])).map((r) => r.id) : []);
  const base = (system: string | null, title: string, extra: Row): Row => ({
    title, system_id: system, purpose: 'Invented sample: running the service the system supports.',
    legal_basis: 'As recorded by the organization (sample).', necessity: 'Only the details needed to provide the service are kept (sample).',
    retention: 'As in the retention schedule for the categories (sample).', sharing: 'Not shared outside the organization except the system supplier (sample).',
    risks: 'Unauthorized access to personal details; keeping details longer than needed (sample).',
    mitigations: 'Role-based access, second factor for administrators, retention review (sample).', residual_risk: 'low',
    answers: { new_technology: 'no', large_scale: 'yes', monitoring: 'no', sensitive: 'no', shared_outside: 'The system supplier, for support only (sample).' },
    ...extra,
  });
  const fare = await sys('Example Fare Collection System');
  const approved = await ctx.resources.create(PIA_TYPE, base(fare, 'Fare accounts and card journeys (sample)', { review_months: 24 }));
  await ctx.resources.update(PIA_TYPE, approved.id, { status: 'approved', approved_on: dayInZone(-120), approved_by_name: 'Sample Privacy Approver', next_review_on: dayInZone(610) });
  await ctx.db.query('update privacy_assessments set approved_category_ids = $2::jsonb where id = $1', [approved.id, JSON.stringify(await cats(fare))]);

  const video = await sys('Example Onboard Video System');
  const review = await ctx.resources.create(PIA_TYPE, base(video, 'Onboard and station video (sample)', {
    residual_risk: 'medium', answers: { new_technology: 'no', large_scale: 'yes', monitoring: 'yes', sensitive: 'no' },
  }));
  await ctx.resources.update(PIA_TYPE, review.id, { status: 'in_review' });

  const hr = await sys('Example HR System');
  const due = await ctx.resources.create(PIA_TYPE, base(hr, 'Staff and operator records (sample)', { review_months: 24 }));
  await ctx.resources.update(PIA_TYPE, due.id, { status: 'approved', approved_on: dayInZone(-715), approved_by_name: 'Sample Privacy Approver', next_review_on: dayInZone(15) });
  await ctx.db.query('update privacy_assessments set approved_category_ids = $2::jsonb where id = $1', [due.id, JSON.stringify(await cats(hr))]);
  return 3;
}

async function seedRequests(ctx: ModuleContext): Promise<number> {
  if (await ctx.db.one(`select 1 from records_requests where subject like '%(sample)' limit 1`)) return 0;
  const make = (data: Row) => ctx.resources.create(REQUEST_TYPE, data);
  // Overdue: received 40 days ago with the default 20 days to answer.
  await make({ subject: 'Bus stop maintenance logs for one route (sample)', kind: 'records', status: 'searching', received_on: dayInZone(-40),
    requester_name: 'Sample Requester One', requester_contact: 'requester.one@example.test', description: 'Maintenance logs for the stops on one route over the last year (sample).' });
  // Extended: received 30 days ago, extended by 20 days with a reason.
  const extended = await make({ subject: 'Contract for shelter advertising (sample)', kind: 'records', status: 'reviewing', received_on: dayInZone(-30),
    requester_name: 'Sample Requester Two', requester_contact: 'requester.two@example.test', description: 'The current advertising contract and its amendments (sample).' });
  await ctx.resources.update(REQUEST_TYPE, extended.id, { extended_due_on: dayInZone(10), extension_reason: 'The contract holder must be consulted before release (sample).' });
  // Closed with exemptions on its responsive records.
  const closed = await make({ subject: 'Dispatch system documentation (sample)', kind: 'records', status: 'received', received_on: dayInZone(-60),
    requester_name: 'Sample Requester Three', requester_contact: 'requester.three@example.test', description: 'Documentation of the dispatch and scheduling systems (sample).' });
  for (const [name, exemption, disclosed] of [['Example CAD/AVL System', 'security_sensitive', 'partial'], ['Example Scheduling System', null, 'full']] as const) {
    const id = ctx.resources.get('system') ? await idOf(ctx, 'systems', name) : null;
    if (!id) continue;
    await ctx.db.query(
      `insert into records_request_items (request_id, record_type, record_id, exemption, disclosed, note) values ($1, 'system', $2, $3, $4, $5) on conflict do nothing`,
      [closed.id, id, exemption, disclosed, exemption ? 'Network addresses and access details withheld (sample).' : null]);
    await ctx.db.query(`insert into record_links (from_type, from_id, to_type, to_id, relation) values ('system', $1, $2, $3, 'responsive_to') on conflict do nothing`, [id, REQUEST_TYPE, closed.id]);
  }
  await ctx.resources.update(REQUEST_TYPE, closed.id, { status: 'responded', responded_on: dayInZone(-42), response_summary: 'Documentation released, with network details withheld as security-sensitive (sample).' });
  // Personal-data requests.
  await make({ subject: 'Copy of my fare account history (sample)', kind: 'personal_access', received_on: dayInZone(-5),
    requester_name: 'Sample Rider Four', requester_contact: 'rider.four@example.test' });
  await make({ subject: 'Correct the address on my paratransit file (sample)', kind: 'personal_correction', status: 'reviewing', received_on: dayInZone(-12), identity_verified: true,
    requester_name: 'Sample Rider Five', requester_contact: 'rider.five@example.test' });
  const deletion = await make({ subject: 'Delete my customer account (sample)', kind: 'personal_deletion', received_on: dayInZone(-25), identity_verified: true,
    requester_name: 'Sample Rider Six', requester_contact: 'rider.six@example.test' });
  await ctx.resources.update(REQUEST_TYPE, deletion.id, { status: 'closed', responded_on: dayInZone(-8), response_summary: 'Account closed and its details deleted; fare records kept as the retention schedule requires (sample).' });
  return 6;
}

export async function seedRecords(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample requests and assessments are dev profile only)';
  const categories = await seedCategories(ctx);
  const assessments = await seedAssessments(ctx);
  const requests = await seedRequests(ctx);
  return `data categories flagged personal ${categories}, privacy assessments ${assessments}, requests ${requests}`;
}
