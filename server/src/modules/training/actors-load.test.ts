import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: training completions loaded in data load mode are recorded by the person the load names
// (for example the trainer who kept the sign-in sheet); outside a load, by the signed-in person.

let t: Awaited<ReturnType<typeof testApp>>;
let former = '';
let adminId = '';

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled') returning id`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('training records', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const course = (await t.api.post('/api/courses', { title: 'Invented track safety briefing' })).body.id;
    const rec = (email: string, extra: Row = {}) => t.api.post('/api/training/records', { course_id: course, completed_on: '2024-03-04', people: [{ name: 'Invented Person', email }], ...extra });
    expect((await rec('first@example.test')).status).toBe(201);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await rec('second@example.test', { on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await t.db.query<Row>('select person_email, created_by from training_records where course_id = $1 order by person_email', [course]);
    expect(rows.map((r) => [r.person_email, r.created_by])).toEqual([['first@example.test', adminId], ['second@example.test', former]]);
  });
});
