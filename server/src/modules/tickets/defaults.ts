import type { LookupValue, ModuleContext } from '../../core/module.ts';
import { TIME_ZONE } from '../../core/timezone.ts';
import { DEFAULT_MATRIX } from './sla.ts';

/** All of these are starting values only: administrators edit them under Administration. */
export const LOOKUPS: Record<string, LookupValue[]> = {
  ticket_type: [
    { value: 'incident', label: 'Incident', color: 'red' },
    { value: 'request', label: 'Service request', color: 'blue' },
  ],
  ticket_status: [
    { value: 'new', label: 'New', color: 'blue', meta: { category: 'open' } },
    { value: 'assigned', label: 'Assigned', color: 'teal', meta: { category: 'open' } },
    { value: 'in_progress', label: 'In progress', color: 'purple', meta: { category: 'open' } },
    { value: 'waiting_requester', label: 'Waiting on requester', color: 'amber', meta: { category: 'paused' } },
    { value: 'waiting_vendor', label: 'Waiting on vendor', color: 'orange', meta: { category: 'paused' } },
    { value: 'resolved', label: 'Resolved', color: 'green', meta: { category: 'resolved' } },
    { value: 'closed', label: 'Closed', color: 'gray', meta: { category: 'closed' } },
    { value: 'cancelled', label: 'Cancelled', color: 'gray', meta: { category: 'closed' } },
  ],
  ticket_impact: [
    { value: 'organisation', label: 'Whole organisation or safety', color: 'red' },
    { value: 'department', label: 'A department or site', color: 'amber' },
    { value: 'individual', label: 'One person', color: 'gray' },
  ],
  ticket_urgency: [
    { value: 'high', label: 'High - work has stopped', color: 'red' },
    { value: 'medium', label: 'Medium - work is slowed', color: 'amber' },
    { value: 'low', label: 'Low - can wait', color: 'gray' },
  ],
  ticket_priority: [
    { value: 'p1', label: 'P1 Critical', color: 'red' },
    { value: 'p2', label: 'P2 High', color: 'orange' },
    { value: 'p3', label: 'P3 Normal', color: 'blue' },
    { value: 'p4', label: 'P4 Low', color: 'gray' },
  ],
  ticket_category: [
    { value: 'hardware', label: 'Hardware' },
    { value: 'software', label: 'Software' },
    { value: 'network', label: 'Network and connectivity' },
    { value: 'access', label: 'Accounts and access' },
    { value: 'email', label: 'Email and collaboration' },
    { value: 'telephony', label: 'Phones and telephony' },
    { value: 'printing', label: 'Printing' },
    { value: 'security', label: 'Security' },
    { value: 'other', label: 'Other' },
  ],
  assignment_group: [
    { value: 'service_desk', label: 'Service desk' },
    { value: 'infrastructure', label: 'Infrastructure' },
    { value: 'applications', label: 'Applications' },
    { value: 'security', label: 'Security' },
    { value: 'managed_provider', label: 'Managed provider (recorded by staff)' },
  ],
  resolution_code: [
    { value: 'fixed', label: 'Fixed' },
    { value: 'workaround', label: 'Workaround provided' },
    { value: 'fulfilled', label: 'Request fulfilled' },
    { value: 'advice', label: 'Advice or training given' },
    { value: 'vendor_fix', label: 'Fixed by vendor' },
    { value: 'duplicate', label: 'Duplicate' },
    { value: 'no_fault', label: 'No fault found' },
    { value: 'not_resolved', label: 'Could not be resolved' },
  ],
  ticket_channel: [
    { value: 'agent', label: 'Logged by IT' },
    { value: 'phone', label: 'Phone' },
    { value: 'walk_up', label: 'In person' },
    { value: 'email', label: 'Email' },
    { value: 'portal', label: 'Portal' },
  ],
  problem_status: [
    { value: 'open', label: 'Open', color: 'blue' },
    { value: 'investigating', label: 'Investigating', color: 'purple' },
    { value: 'known_error', label: 'Known error', color: 'amber' },
    { value: 'resolved', label: 'Resolved', color: 'green' },
    { value: 'closed', label: 'Closed', color: 'gray' },
  ],
  kb_status: [
    { value: 'draft', label: 'Draft', color: 'amber' },
    { value: 'published', label: 'Published', color: 'green' },
    { value: 'retired', label: 'Retired', color: 'gray' },
  ],
  kb_audience: [
    { value: 'staff', label: 'All staff', color: 'blue' },
    { value: 'agents', label: 'IT agents only', color: 'purple' },
  ],
  kb_category: [
    { value: 'how_to', label: 'How to' },
    { value: 'troubleshooting', label: 'Troubleshooting' },
    { value: 'known_error', label: 'Known error' },
    { value: 'policy', label: 'Policy and procedure' },
    { value: 'reference', label: 'Reference' },
  ],
  catalog_category: [
    { value: 'people', label: 'Joiners, movers and leavers' },
    { value: 'access', label: 'Access' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'software', label: 'Software' },
    { value: 'vendors', label: 'Vendors' },
  ],
};

const WEEKDAY: [string, string] = ['08:00', '17:00'];
const BUSINESS_HOURS = { mon: WEEKDAY, tue: WEEKDAY, wed: WEEKDAY, thu: WEEKDAY, fri: WEEKDAY, sat: null, sun: null };
const DAY = 9 * 60; // one business day of the default calendar

/** Starting respond / resolve targets per priority. */
const POLICIES = [
  { priority: 'p1', respond: 15, resolve: 4 * 60, calendar: 'always' },
  { priority: 'p2', respond: 60, resolve: DAY, calendar: 'business' },
  { priority: 'p3', respond: 4 * 60, resolve: 3 * DAY, calendar: 'business' },
  { priority: 'p4', respond: DAY, resolve: 5 * DAY, calendar: 'business' },
];

/** Starting catalogue entries. `defaults` pre-fill the request each one creates. */
export const CATALOGUE = [
  { name: 'New starter', category: 'people', description: 'Set up accounts, equipment and access for someone joining the organisation.',
    defaults: { type: 'request', category: 'access', title: 'New starter: ', impact: 'individual', urgency: 'medium',
      description: 'Name:\nJob title:\nDepartment and manager:\nStart date:\nEquipment needed:\nSystems and access needed:' } },
  { name: 'Leaver', category: 'people', description: 'Remove access and recover equipment when someone leaves.',
    defaults: { type: 'request', category: 'access', title: 'Leaver: ', impact: 'individual', urgency: 'medium',
      description: 'Name:\nLast working day:\nManager:\nEquipment to return:\nMailbox and files to hand over to:' } },
  { name: 'Access request', category: 'access', description: 'Ask for access to a system, shared folder or mailbox.',
    defaults: { type: 'request', category: 'access', title: 'Access request: ', impact: 'individual', urgency: 'low',
      description: 'Who needs access:\nSystem or folder:\nLevel of access:\nBusiness reason:\nApproved by:' } },
  { name: 'Hardware', category: 'equipment', description: 'Request a computer, monitor, phone or other equipment.',
    defaults: { type: 'request', category: 'hardware', title: 'Hardware request: ', impact: 'individual', urgency: 'low',
      description: 'What is needed:\nFor whom:\nLocation:\nFunding source or budget code:' } },
  { name: 'Software', category: 'software', description: 'Request software to be installed or a licence to be assigned.',
    defaults: { type: 'request', category: 'software', title: 'Software request: ', impact: 'individual', urgency: 'low',
      description: 'Software and version:\nFor whom:\nBusiness reason:\nLicence held or to be bought:' } },
  { name: 'Vendor access', category: 'vendors', description: 'Arrange supervised or time-limited access for a vendor.',
    defaults: { type: 'request', category: 'access', title: 'Vendor access: ', impact: 'department', urgency: 'medium',
      description: 'Vendor and contact:\nSystem:\nReason for access:\nStart and end time:\nInternal sponsor:' } },
  { name: 'Equipment fault', category: 'equipment', description: 'Report a fault with a computer, phone, printer or other equipment.',
    defaults: { type: 'incident', category: 'hardware', title: 'Equipment fault: ', impact: 'individual', urgency: 'medium',
      description: 'Equipment and asset tag:\nLocation:\nWhat is wrong:\nWhen it started:\nCan work continue:' } },
];

export async function seedDefaults(ctx: ModuleContext): Promise<void> {
  // The owning permission module lets hand-written pages read the list (see core lookups).
  for (const [list, values] of Object.entries(LOOKUPS)) {
    await ctx.lookups.ensure(list, values, { module: list.startsWith('kb_') ? 'knowledge' : 'tickets' });
  }

  await ctx.db.query(
    `insert into calendars (key, name, timezone, always_open, hours) values
       ('always', '24 hours, 7 days', $2, true, '{}'::jsonb),
       ('business', 'Business hours (Monday to Friday, 08:00 to 17:00)', $2, false, $1::jsonb)
     on conflict (key) do nothing`,
    [JSON.stringify(BUSINESS_HOURS), TIME_ZONE],
  );
  for (const p of POLICIES) {
    await ctx.db.query(
      `insert into sla_policies (priority, respond_minutes, resolve_minutes, calendar_id)
       select $1, $2, $3, id from calendars where key = $4
       on conflict (priority) do nothing`,
      [p.priority, p.respond, p.resolve, p.calendar],
    );
  }
  if ((await ctx.settings.get<unknown>('tickets.priority_matrix', null)) === null) {
    await ctx.settings.set('tickets.priority_matrix', DEFAULT_MATRIX);
  }
}
