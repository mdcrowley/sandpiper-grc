// E03-20: the service desk's queue presets offered to every agent as shared views of the ticket
// list (core shared views, E01-24), so they sit in everyone's View menu on every computer.
// Added once; administrators own them afterwards (they can rename or remove them, and removed
// ones do not come back). Each person's own saved views are kept on the server by core too.

import type { ModuleContext } from '../../core/module.ts';

const OPEN = { 'resolved_at.null': ['true'] };

/** The same presets as the queue chips above the ticket list (web/src/modules/tickets/TicketList.tsx). */
export const STARTER_QUEUES: { name: string; filters: Record<string, string[]> }[] = [
  { name: 'My open', filters: { assignee_id: ['me'], ...OPEN } },
  { name: 'Unassigned', filters: { 'assignee_id.null': ['true'], ...OPEN } },
  { name: 'At risk', filters: { resolve_warned: ['true'], resolve_breached: ['false'], ...OPEN } },
  { name: 'Breaching', filters: { resolve_breached: ['true'], ...OPEN } },
  { name: 'With vendor', filters: { with_vendor: ['true'], ...OPEN } },
  { name: 'Awaiting approval', filters: { approval_status: ['pending'], ...OPEN } },
  { name: 'Major incidents', filters: { major_incident: ['true'], ...OPEN } },
  { name: 'All open', filters: { ...OPEN } },
];


export async function seedSharedQueues(ctx: ModuleContext): Promise<number> {
  if (await ctx.settings.get('tickets.shared_queues_seeded', false)) return 0;
  const table = (await ctx.db.one<{ t: string | null }>(`select to_regclass('public.shared_views')::text as t`))?.t;
  if (!table) return 0; // the core has no shared views here: the chips above the list still work
  let added = 0;
  for (const q of STARTER_QUEUES) {
    const made = await ctx.db.one(
      `insert into shared_views (record_type, name, view) values ('ticket', $1, $2::jsonb)
       on conflict (record_type, lower(name)) do nothing returning id`,
      [q.name, JSON.stringify({ q: '', sort: '', dir: 'asc', filters: q.filters })]);
    if (made) added += 1;
  }
  await ctx.settings.set('tickets.shared_queues_seeded', true);
  return added;
}
