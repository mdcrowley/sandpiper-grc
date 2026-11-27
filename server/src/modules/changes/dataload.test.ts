import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Data load mode (E18-70): a historical change takes its status and dates as given, and a loaded
// change can be corrected whatever its status. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('changes in data load mode', () => {
  it('refuses a standard change without a template when the mode is off', async () => {
    await loadMode(false);
    expect((await t.api.post('/api/changes', { title: 'Patch night', change_type: 'standard' })).status).toBe(400);
  });

  it('loads a closed change with its times and lets it be corrected', async () => {
    await loadMode(true);
    const r = await t.api.post('/api/changes', {
      title: 'Timetable server upgrade (2023)', change_type: 'standard', status: 'closed',
      actual_start: '2023-04-02T01:00:00Z', actual_end: '2023-04-02T03:00:00Z', submitted_at: '2023-03-20T09:00:00Z',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('closed');
    expect(new Date(r.body.submitted_at).toISOString()).toBe('2023-03-20T09:00:00.000Z');
    const u = await t.api.patch(`/api/changes/${r.body.id}`, { outcome_notes: 'Finished on time.' });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    await loadMode(false);
    expect((await t.api.patch(`/api/changes/${r.body.id}`, { outcome_notes: 'Changed again.' })).status).toBe(409);
  });
});
