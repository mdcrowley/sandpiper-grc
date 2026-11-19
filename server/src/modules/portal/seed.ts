// Invented sample data for the portal (dev profile only): catalogue items offered to staff and
// a few knowledge articles written for everyone. Added once each, by name.
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';

export const SAMPLE_ITEMS: Row[] = [
  {
    name: 'Driver tablet not working', category: 'equipment',
    description: 'The tablet in a driver\'s cab will not start, freezes, or will not log in.',
    defaults: { type: 'incident', category: 'hardware', title: 'Driver tablet fault: ', impact: 'individual', urgency: 'high', assignment_group: 'service_desk' },
    questions: [
      { key: 'vehicle', label: 'Vehicle or fleet number', type: 'text', required: true, hint: 'The number on the side of the bus or tram, for example 4127.' },
      { key: 'depot', label: 'Depot', type: 'text' },
      { key: 'symptom', label: 'What happens', type: 'choice', required: true, options: ['Will not switch on', 'Frozen or very slow', 'Cannot log in', 'Something else'] },
      { key: 'in_service', label: 'Is the vehicle in service now?', type: 'yes_no' },
    ],
  },
  {
    name: 'Request access to the scheduling system', category: 'access',
    description: 'Ask for an account, or more access, in the system used to plan runs, duties and rosters.',
    defaults: { type: 'request', category: 'access', title: 'Scheduling system access: ', impact: 'individual', urgency: 'low', assignment_group: 'applications' },
    requires_approval: true,
    questions: [
      { key: 'who', label: 'Who needs access', type: 'text', required: true },
      { key: 'level', label: 'What do they need to do', type: 'choice', required: true, options: ['Look at schedules only', 'Edit duties and rosters', 'Publish schedules'] },
      { key: 'manager', label: 'Their manager', type: 'text', required: true, hint: 'The manager will be asked to approve.' },
      { key: 'reason', label: 'Why it is needed', type: 'longtext' },
    ],
    tasks: ['Confirm the manager approved', 'Create or change the account', 'Tell the person how to sign in'],
  },
  {
    name: 'Report a faulty farebox or validator', category: 'equipment',
    description: 'A farebox, card validator or ticket machine is not taking payments or is showing an error.',
    defaults: { type: 'incident', category: 'hardware', title: 'Fare equipment fault: ', impact: 'department', urgency: 'high', assignment_group: 'infrastructure' },
    questions: [
      { key: 'where', label: 'Vehicle number or station', type: 'text', required: true },
      { key: 'device', label: 'Which device', type: 'choice', required: true, options: ['Farebox', 'Card validator', 'Ticket machine', 'Not sure'] },
      { key: 'error', label: 'Error shown on the screen, if any', type: 'text' },
      { key: 'taking_fares', label: 'Can passengers still pay?', type: 'yes_no' },
    ],
  },
  {
    name: 'New starter at the depot', category: 'people',
    description: 'Set up a sign-in, a locker tablet profile and system access for someone joining a depot.',
    defaults: { type: 'request', category: 'access', title: 'New starter at the depot: ', impact: 'individual', urgency: 'medium', assignment_group: 'service_desk' },
    questions: [
      { key: 'name', label: 'Name of the new starter', type: 'text', required: true },
      { key: 'role', label: 'Job', type: 'choice', required: true, options: ['Bus operator', 'Depot supervisor', 'Maintenance', 'Office'] },
      { key: 'depot', label: 'Depot', type: 'text', required: true },
      { key: 'start_date', label: 'Start date', type: 'date', required: true },
    ],
    tasks: ['Create the account', 'Set up the tablet profile', 'Add to the depot distribution list'],
  },
];

const SAMPLE_ARTICLES: Row[] = [
  {
    title: 'Restart a driver tablet', category: 'how_to',
    body: 'If the tablet in the cab freezes or will not log in:\n\n1. Hold the power button for ten seconds until the screen goes dark.\n2. Wait a few seconds, then press the power button once.\n3. Log in with your staff number when the start screen appears.\n\nIf it still does not work, report it from the portal with the vehicle number so the depot can swap the tablet.',
  },
  {
    title: 'Reset your password', category: 'how_to',
    body: 'You can change your password from the menu under your name, then "Change password".\n\nIf you cannot sign in at all, ask your supervisor to contact the service desk, or report a problem from a colleague\'s sign-in.',
  },
  {
    title: 'What to do when a card validator shows an error', category: 'troubleshooting',
    body: 'Note the error on the screen and the vehicle or station. Let passengers travel as your local fare policy says, and report the fault from the portal with "Report a faulty farebox or validator". Do not switch the validator off and on during service.',
  },
];

export async function seedPortal(ctx: ModuleContext, opts: SeedOptions): Promise<string | void> {
  if (opts.profile !== 'dev') return;
  let items = 0;
  let articles = 0;
  const categories = new Set((await ctx.lookups.values('catalog_category')).map((c) => c.value));
  for (const item of SAMPLE_ITEMS) {
    if (await ctx.db.one('select 1 from catalog_items where name = $1 and deleted_at is null', [item.name])) continue;
    await ctx.resources.create('catalog_item', { ...item, category: categories.has(item.category) ? item.category : null, active: true, portal: true });
    items += 1;
  }
  if (ctx.resources.get('knowledge_article')) {
    for (const a of SAMPLE_ARTICLES) {
      if (await ctx.db.one('select 1 from knowledge_articles where title = $1 and deleted_at is null', [a.title])) continue;
      await ctx.resources.create('knowledge_article', { ...a, audience: 'staff', status: 'published' });
      articles += 1;
    }
  }
  return `${items} portal catalogue items, ${articles} staff articles`;
}
