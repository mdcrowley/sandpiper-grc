import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// Data load mode (E18-70, E18-71): past complaints arrive with their own dates, statuses and named
// people; the time limits are worked out from the dates given; steps, letters and report submissions
// record the person the load names; nothing is sent. Invented people and complaints only.
let t: Awaited<ReturnType<typeof testApp>>;
let former = '';

beforeAll(async () => {
  t = await testApp();
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('crofficer', 'cr.officer@example.test', 'Casey Officer', 'disabled') returning id`))!.id;
  await t.db.query('update sessions set confirmed_at = now()');
  // The administrator loading the history is a named complaint handler, as the person loading complaints would be.
  await t.db.query(`insert into civil_rights_complaint_viewers (user_id) select id from users where username = 'admin'`);
  expect((await t.api.patch('/api/admin/features', { features: { civilrights: true } })).status).toBe(200);
  expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('loading past complaints', () => {
  it('keeps the dates, status and people given and works out the limits from them', async () => {
    const res = await t.api.post('/api/civil-rights/complaints', {
      subject: 'Invented past complaint', received_on: '2022-03-01', status: 'closed', acknowledged_on: '2022-03-04',
      findings: 'Invented findings.', findings_on: '2022-05-20', closed_on: '2022-06-01', investigator_id: former,
      created_at: '2022-03-01T10:00:00Z', ref: 'CRC-LEGACY-7', on_behalf_of: 'crofficer',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = res.body;
    // Closed without an outcome is accepted in a load (its own status rules are skipped).
    expect(c.status).toBe('closed');
    expect(c.ref).toBe('CRC-LEGACY-7');
    expect(String(c.created_at)).toContain('2022-03-01');
    expect(String(c.ack_due_on).slice(0, 10)).toBe('2022-03-11');
    expect(String(c.closed_on).slice(0, 10)).toBe('2022-06-01');
    expect(c.next_due_on).toBeNull();
    // The person named entered it, so they are one of the people who may see it.
    expect(c.created_by).toBe(former);

    const step = await t.api.post(`/api/civil-rights/complaints/${c.id}/steps`, { kind: 'letter', title: 'Findings letter', done_on: '2022-05-21', on_behalf_of: 'crofficer' });
    expect(step.status, JSON.stringify(step.body)).toBe(201);
    const row = await t.db.one<Row>('select done_by, done_by_name, done_on::text as done_on from civil_rights_complaint_steps where id = $1', [step.body.id]);
    expect(row).toMatchObject({ done_by: former, done_by_name: 'Casey Officer', done_on: '2022-05-21' });
    // Nothing was sent while loading.
    const n = await t.db.one<{ n: number }>(`select count(*)::int n from notifications where record_id = $1`, [c.id]);
    expect(n!.n).toBe(0);
  });

  it('records report submissions as the person named', async () => {
    const r = (await t.api.post('/api/civil-rights/reports', { title: 'Invented past report', due_on: '2023-01-31' })).body;
    const res = await t.api.post(`/api/civil-rights/reports/${r.id}/submit`, { submitted_on: '2023-01-30', on_behalf_of: 'crofficer' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const log = (await t.api.get(`/api/civil-rights/reports/${r.id}/submissions`)).body;
    expect(log[0]).toMatchObject({ submitted_on: '2023-01-30', submitted_by_name: 'Casey Officer' });
  });
});
