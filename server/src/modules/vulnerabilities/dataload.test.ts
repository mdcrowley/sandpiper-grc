import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Data load mode (E18-70): historical findings take any status without the acceptance and
// false-positive step rules; a fixed finding without a fix date is fixed on its last-seen date.
// Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('vulnerabilities in data load mode', () => {
  it('refuses risk accepted without an exception or justification when the mode is off', async () => {
    await loadMode(false);
    expect((await t.api.post('/api/vulnerabilities', { title: 'Old TLS', severity: 'high', status: 'risk_accepted' })).status).toBe(400);
  });

  it('loads accepted and fixed findings with their own dates', async () => {
    await loadMode(true);
    const a = await t.api.post('/api/vulnerabilities', { title: 'Old TLS on kiosk', severity: 'high', status: 'risk_accepted', first_seen: '2022-01-10' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const f = await t.api.post('/api/vulnerabilities', {
      title: 'Outdated web server', severity: 'medium', status: 'fixed', first_seen: '2022-01-10', last_seen: '2022-03-05',
    });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    expect(String(f.body.fixed_on).slice(0, 10)).toBe('2022-03-05');
    expect(String(f.body.first_seen).slice(0, 10)).toBe('2022-01-10');
    await loadMode(false);
  });
});
