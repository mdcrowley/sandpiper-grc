import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Data load mode (E18-70): historical risks, actions and corrective action plans take any status
// with the dates given, without the module's step rules. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('risks module in data load mode', () => {
  it('refuses an accepted risk without an acceptance when the mode is off', async () => {
    await loadMode(false);
    expect((await t.api.post('/api/risks', { title: 'Old supplier risk', status: 'accepted' })).status).toBe(400);
  });

  it('loads an accepted risk with its review date', async () => {
    await loadMode(true);
    const r = await t.api.post('/api/risks', { title: 'Legacy radio system end of support', status: 'accepted', last_reviewed_on: '2022-06-30' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('accepted');
    expect(String(r.body.last_reviewed_on).slice(0, 10)).toBe('2022-06-30');
    await loadMode(false);
  });

  it('keeps a done action done with its own completion date, and makes none up', async () => {
    await loadMode(true);
    const a = await t.api.post('/api/actions', { title: 'Replace depot switch', status: 'done', verification_required: true, completed_on: '2021-11-15' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.status).toBe('done');
    expect(String(a.body.completed_on).slice(0, 10)).toBe('2021-11-15');
    const b = await t.api.post('/api/actions', { title: 'Update the contact list', status: 'done' });
    expect(b.status).toBe(201);
    expect(b.body.completed_on).toBeNull();
    await loadMode(false);
  });

  it('loads a closed corrective action plan and keeps it closed when its actions load', async () => {
    await loadMode(true);
    const cap = await t.api.post('/api/caps', { title: 'Brake inspection gaps', problem_statement: 'Inspections were missed.', status: 'closed', closed_on: '2022-02-01' });
    expect(cap.status, JSON.stringify(cap.body)).toBe(201);
    expect(cap.body.status).toBe('closed');
    const act = await t.api.post('/api/actions', { title: 'Retrain inspectors', cap_id: cap.body.id, status: 'open' });
    expect(act.status).toBe(201);
    const now = await t.db.one<{ status: string; closed_on: string; actions_total: number }>('select status, closed_on::text, actions_total from caps where id = $1', [cap.body.id]);
    expect(now).toMatchObject({ status: 'closed', closed_on: '2022-02-01', actions_total: 1 });
    await loadMode(false);
  });
});
