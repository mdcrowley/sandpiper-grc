import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Data load mode (E18-70): a historical policy exception keeps its status and dates, an expired
// one included, and no approval date is made up from today. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('policy exceptions in data load mode', () => {
  it('refuses an expired exception when the mode is off', async () => {
    await loadMode(false);
    expect((await t.api.post('/api/exceptions', { title: 'Shared kiosk login', status: 'expired', expires_on: '2022-12-31' })).status).toBe(400);
  });

  it('loads expired and approved exceptions with their own dates', async () => {
    await loadMode(true);
    const e = await t.api.post('/api/exceptions', { title: 'Shared kiosk login', status: 'expired', approved_on: '2022-01-01', expires_on: '2022-12-31' });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    expect(e.body.status).toBe('expired');
    const a = await t.api.post('/api/exceptions', { title: 'Legacy fare terminal', status: 'approved', expires_on: '2023-06-30' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.approved_on).toBeNull();
    await loadMode(false);
  });
});
