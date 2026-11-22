import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// The lookup log and "Last seen" (E37-10): written when tags.log_lookups is on, shown to people who
// may edit the record, kept retention.tag_lookups_days, removed when the record is anonymized.

type Client = Awaited<ReturnType<Awaited<ReturnType<typeof testApp>>['as']>>;
let t: Awaited<ReturnType<typeof testApp>>;
let agent: Client;
let reader: Client;
let site = '';
let asset = '';
let count = '';

async function withGrants(key: string, grants: string[]): Promise<Client> {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}
const setLogging = (on: boolean) => t.db.query(
  `insert into settings (key, value) values ('tags.log_lookups', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(on)]);

beforeAll(async () => {
  process.env.GRC_MODULES ??= 'tags,inventory,fleet,tickets,risks,notifications,workflows,admin,attachments';
  t = await testApp();
  agent = await t.as('agent');
  reader = await withGrants('seen_reader_test', ['tags.view', 'tags.count', 'assets.view', 'sites.view']);
  site = (await t.api.post('/api/sites', { name: 'East shop (test)' })).body.id;
  asset = (await t.api.post('/api/assets', { name: 'Ticket vending machine 3', status: 'in_use', site_id: site, tag: 'TA-552210' })).body.id;
  count = (await agent.post('/api/inventory-counts/start', { site_id: site })).body.id;
});
afterAll(async () => { await t.close(); });

describe('last seen', () => {
  it('is null before anything is logged, and needs a record the person may see', async () => {
    expect((await agent.get(`/api/asset-tags/last-seen?type=asset&id=${asset}`)).body).toEqual({ lastSeen: null });
    expect((await agent.get(`/api/asset-tags/last-seen?type=ticket&id=${asset}`)).status).toBe(404);
    expect((await agent.get('/api/asset-tags/last-seen?type=asset&id=00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('shows when, by whom and how to people who may edit the record; never a place', async () => {
    expect((await agent.post(`/api/inventory-counts/${count}/found`, { value: 'TA-552210' })).body.outcome).toBe('found');
    const seen = (await agent.get(`/api/asset-tags/last-seen?type=asset&id=${asset}`)).body.lastSeen;
    expect(seen).toEqual({ at: expect.any(String), byName: expect.stringContaining('Test agent'), source: 'web' });
    // May see the asset but not edit it: no "last seen".
    expect((await reader.get(`/api/asset-tags/last-seen?type=asset&id=${asset}`)).body).toEqual({ lastSeen: null });
    const cols = (await t.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'tag_lookups'`)).map((c) => c.column_name);
    expect(cols.some((c) => /lat|lon|geo|place|location/.test(c))).toBe(false);
  });

  it('logs nothing while lookup logging is off', async () => {
    const before = (await t.db.one<{ n: number }>('select count(*)::int n from tag_lookups'))!.n;
    await setLogging(false);
    try {
      await agent.post(`/api/inventory-counts/${count}/found`, { value: 'TA-552210' });
      await agent.post(`/api/inventory-counts/${count}/found`, { value: 'QX-000001' });
      expect((await t.db.one<{ n: number }>('select count(*)::int n from tag_lookups'))!.n).toBe(before);
    } finally { await setLogging(true); }
  });
});

describe('retention', () => {
  it('removes log rows older than retention.tag_lookups_days', async () => {
    await t.db.query(`insert into tag_lookups (value_key, source, outcome, at) values ('OLD1', 'web', 'nothing', now() - interval '91 days'), ('NEW1', 'web', 'nothing', now() - interval '89 days')`);
    await t.app.jobs.enqueue('tags.lookup_housekeeping');
    await t.app.jobs.runDue();
    const keys = (await t.db.query<{ value_key: string }>(`select value_key from tag_lookups where value_key in ('OLD1', 'NEW1')`)).map((r) => r.value_key);
    expect(keys).toEqual(['NEW1']);
  });

  it('removes who looked up and who verified a record when it is anonymized', async () => {
    const adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query(`update assets set updated_at = now() - interval '40 months', created_at = now() - interval '40 months' where id = $1`, [asset]);
    expect((await t.api.put('/api/admin/retention/asset', { periodMonths: 24, disposal: 'anonymize' })).status).toBe(200);
    await t.core.retention.sweep();
    const review = (await t.api.get('/api/admin/retention/reviews?record_type=asset')).body.rows.find((r: any) => r.record_id === asset);
    expect(review).toBeTruthy();
    expect((await t.db.one<{ n: number }>(`select count(*)::int n from tag_lookups where record_id = $1`, [asset]))!.n).toBeGreaterThan(0);
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [adminId]);
    const done = await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'End of the schedule (test).', confirm: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await t.db.one<{ n: number }>(`select count(*)::int n from tag_lookups where record_id = $1`, [asset]))!.n).toBe(0);
    expect((await t.db.one<any>(`select verified_by from tag_verifications where record_id = $1`, [asset]))).toEqual({ verified_by: null });
  });
});
