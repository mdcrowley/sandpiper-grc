import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Data load mode (E18-70): a historical security incident keeps its own times, takes any status
// without the review step rules, and gets no notification tasks, roster or checklist.
// Invented data only. Runs alone (GRC_MODULES=secincidents) and with every module.

let t: Awaited<ReturnType<typeof testApp>>;
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('security incidents in data load mode', () => {
  it('refuses a completed review without findings when the mode is off', async () => {
    await loadMode(false);
    const r = await t.api.post('/api/security-incidents', { title: 'Old phishing wave', review_status: 'completed' });
    expect(r.status).toBe(400);
  });

  it('keeps the original times and works out the missing ones from them', async () => {
    await loadMode(true);
    const r = await t.api.post('/api/security-incidents', {
      title: 'Depot workstation malware (2023)', status: 'closed', review_status: 'completed',
      discovered_at: '2023-03-01T08:00:00Z', closed_at: '2023-03-10T17:00:00Z',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const row = r.body;
    expect(new Date(row.discovered_at).toISOString()).toBe('2023-03-01T08:00:00.000Z');
    expect(new Date(row.declared_at).toISOString()).toBe('2023-03-01T08:00:00.000Z');
    expect(new Date(row.contained_at).toISOString()).toBe('2023-03-01T08:00:00.000Z');
    expect(new Date(row.closed_at).toISOString()).toBe('2023-03-10T17:00:00.000Z');
    expect(new Date(row.review_completed_at).toISOString()).toBe('2023-03-10T17:00:00.000Z');
    const tasks = await t.db.query('select id from notification_tasks where incident_id = $1', [row.id]);
    expect(tasks).toHaveLength(0);
    const log = await t.db.query<{ entry: string }>('select entry from incident_log_entries where incident_id = $1', [row.id]);
    expect(log.map((l) => l.entry).join(' ')).toMatch(/data load mode/);
    await loadMode(false);
  });

  it('records a historical notification without who and how', async () => {
    await loadMode(true);
    const inc = await t.api.post('/api/security-incidents', { title: 'Fare system outage (2022)', discovered_at: '2022-05-01T10:00:00Z' });
    expect(inc.status).toBe(201);
    const task = await t.api.post('/api/notification-tasks', {
      incident_id: inc.body.id, party: 'Insurer', status: 'done', notified_at: '2022-05-02T09:00:00Z',
    });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    expect(new Date(task.body.completed_at).toISOString()).toBe('2022-05-02T09:00:00.000Z');
    await loadMode(false);
  });
});
