// A tiny module for the reporting tests: three invented record types with a fixed data set, so the
// tests can run with no other module loaded (GRC_MODULES='reports') and with every module loaded.
import type { ModuleContext, ModuleDef } from '../../core/module.ts';

export const fixtureModule: ModuleDef = {
  key: 'rtest',
  async seedDefaults(ctx) {
    const std = `id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz`;
    await ctx.db.exec(`
      create table if not exists rt_sites (${std}, name text not null, region text);
      create table if not exists rt_boxes (${std}, name text not null, color text);
      create table if not exists rt_things (${std}, name text not null, status text, amount numeric, qty numeric,
        opened_on date, opened_at timestamptz, owner_id uuid, site_id uuid, box_id uuid, department text,
        active boolean, notes jsonb, restricted boolean not null default false);`);
    await ctx.lookups.ensure('rt_status', [
      { value: 'new', label: 'Brand new', color: 'blue', sort: 10 },
      { value: 'open', label: 'In hand', color: 'amber', sort: 20 },
      { value: 'done', label: 'Finished', color: 'green', sort: 30 },
    ], { module: 'tickets' });
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'rt_site', table: 'rt_sites', module: 'tickets', label: 'Test site', plural: 'Test sites',
      path: '/api/rt-sites', route: '/rt-sites', titleField: 'name',
      fields: { name: { label: 'Name', type: 'text', required: true }, region: { label: 'Region', type: 'text' } },
    });
    // A wholly restricted type under a module the Agent role cannot view.
    ctx.defineResource({
      type: 'rt_box', table: 'rt_boxes', module: 'risks', label: 'Test box', plural: 'Test boxes', restricted: true,
      path: '/api/rt-boxes', route: '/rt-boxes', titleField: 'name',
      fields: { name: { label: 'Name', type: 'text', required: true }, color: { label: 'Color', type: 'text' } },
    });
    ctx.defineResource({
      type: 'rt_thing', table: 'rt_things', module: 'tickets', label: 'Test thing', plural: 'Test things', restricted: 'flag',
      path: '/api/rt-things', route: '/rt-things', titleField: 'name',
      fields: {
        name: { label: 'Name', type: 'text', required: true },
        status: { label: 'Status', type: 'lookup', list: 'rt_status' },
        amount: { label: 'Amount', type: 'currency' },
        qty: { label: 'Quantity', type: 'number' },
        opened_on: { label: 'Opened on', type: 'date' },
        opened_at: { label: 'Opened at', type: 'datetime' },
        owner_id: { label: 'Owner', type: 'user' },
        site_id: { label: 'Site', type: 'ref', to: 'rt_site' },
        box_id: { label: 'Box', type: 'ref', to: 'rt_box' },
        department: { label: 'Department', type: 'text' },
        active: { label: 'Active', type: 'boolean' },
        notes: { label: 'Notes', type: 'json' },
        restricted: { label: 'Restricted', type: 'boolean' },
      },
    });
  },
};

/**
 * The fixed data set. Five ordinary things and one restricted thing ("R").
 * Thing "B" was opened at 03:00 UTC on 1 February, which is still 31 January in the test time zone.
 */
export async function loadFixture(ctx: ModuleContext, ownerId: string) {
  const s1 = await ctx.resources.create('rt_site', { name: 'North', region: 'Upland' });
  const s2 = await ctx.resources.create('rt_site', { name: 'South', region: 'Coast' });
  const box = await ctx.resources.create('rt_box', { name: 'Sealed box', color: 'red' });
  const rows: [string, string, number | null, number, string, string, string | null, string | null, boolean][] = [
    ['A', 'new', 100, 1, '2026-01-05', '2026-01-05T15:00:00Z', s1.id, 'Finance', false],
    ['B', 'open', 200, 2, '2026-01-20', '2026-02-01T03:00:00Z', s1.id, 'Finance', false],
    ['C', 'open', 300, 3, '2026-02-10', '2026-02-10T15:00:00Z', s2.id, 'Operations', false],
    ['D', 'done', 400, 4, '2026-04-02', '2026-04-02T15:00:00Z', s2.id, 'Operations', false],
    ['E', 'done', null, 5, '2026-04-03', '2026-04-03T15:00:00Z', null, null, false],
    ['R', 'open', 1000, 10, '2026-02-11', '2026-02-11T15:00:00Z', s1.id, 'Finance', true],
  ];
  for (const [name, status, amount, qty, opened_on, opened_at, site_id, department, restricted] of rows) {
    await ctx.resources.create('rt_thing', {
      name, status, amount, qty, opened_on, opened_at, site_id, department, restricted,
      owner_id: name === 'A' ? ownerId : null, box_id: name === 'R' ? box.id : null, active: name !== 'E',
    });
  }
  return { s1, s2, box };
}
