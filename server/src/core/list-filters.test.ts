import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from './module.ts';
import { testApp } from '../test/helpers.ts';

// E18-49: the list API refuses a filter on a field the record type does not have, the same way for
// the list, its counts and its exports, and for a field hidden by a switched-off option.
const fixtures: ModuleDef = {
  key: 'testlistfilters',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_gadgets (
      id uuid primary key default gen_random_uuid(), name text not null, status text,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'gadget', table: 'test_gadgets', module: 'tickets', label: 'Gadget', plural: 'Gadgets',
      path: '/api/test-gadgets', route: '/test-gadgets', titleField: 'name',
      fields: { name: { label: 'Name', type: 'text', required: true }, status: { label: 'Status', type: 'text' } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  await t.api.post('/api/test-gadgets', { name: 'Platform display', status: 'open' });
});
afterAll(async () => { await t.close(); });

describe('list filters on fields the type does not have (E18-49)', () => {
  it('answers 400 bad_filter for the list, its counts and its export', async () => {
    for (const url of ['/api/test-gadgets?f.colour=red', '/api/test-gadgets/stats?group=status&f.colour=red', '/api/test-gadgets?format=csv&f.colour.null=true']) {
      const res = await t.api.get(url);
      expect(res.status, url).toBe(400);
      expect(res.body.error.code, url).toBe('bad_filter');
    }
    expect((await t.api.get('/api/test-gadgets?f.status=open')).body.total).toBe(1);
    expect((await t.api.get('/api/test-gadgets?f.created_at.gt=2000-01-01')).body.total).toBe(1);
  });

  it('treats a field hidden by a switched-off option as one the type does not have', async () => {
    if (!t.ctx.resources.get('asset')) return; // the inventory module is not loaded
    expect((await t.api.get('/api/assets?f.funder_interest=true')).status).toBe(200);
    expect((await t.api.patch('/api/admin/features', { options: { funder_interest: { on: false } } })).status).toBe(200);
    const res = await t.api.get('/api/assets?f.funder_interest=true');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_filter');
    await t.api.patch('/api/admin/features', { options: { funder_interest: { on: true } } });
    expect((await t.api.get('/api/assets?f.funder_interest=true')).status).toBe(200);
  });
});
