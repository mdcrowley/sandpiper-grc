import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: key risk indicator values, obligation period attestations and risk acceptances loaded in
// data load mode carry the person the load names; outside a load, the signed-in person.

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

describe('risk actor columns', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const kri = (await t.api.post('/api/kris', { name: 'Invented missed inspections', amber: 5, red: 10, unit: 'count' })).body;
    const month = dayInZone(0).slice(0, 7);
    expect((await t.api.put(`/api/kris/${kri.id}/values/${month}`, { value: 1 })).status).toBe(200);
    const o = (await t.api.post('/api/obligations', { title: 'Invented monthly return', frequency: 'monthly', next_due_on: dayInZone(-5) })).body;
    const p1 = (await t.api.post(`/api/obligations/${o.id}/periods`, {})).body;
    expect((await t.api.post(`/api/obligations/${o.id}/periods/${p1.id}/attest`, { status: 'met' })).status).toBe(200);
    expect((await t.db.one<Row>('select entered_by from kri_values where kri_id = $1', [kri.id]))!.entered_by).toBe(adminId);
    expect((await t.db.one<Row>('select attested_by from obligation_periods where id = $1', [p1.id]))!.attested_by).toBe(adminId);

    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    expect((await t.api.put(`/api/kris/${kri.id}/values/2024-01`, { value: 3, on_behalf_of: 'rclerk' })).status).toBe(200);
    expect((await t.db.one<Row>(`select entered_by from kri_values where kri_id = $1 and period = '2024-01-01'`, [kri.id]))!.entered_by).toBe(former);
    const p2 = (await t.api.post(`/api/obligations/${o.id}/periods`, {})).body;
    const att = await t.api.post(`/api/obligations/${o.id}/periods/${p2.id}/attest`, { status: 'met', attested_on: '2024-02-03', on_behalf_of: 'rclerk' });
    expect(att.status, JSON.stringify(att.body)).toBe(200);
    expect(att.body.period).toMatchObject({ attested_by: former, attested_by_name: 'Robin Clerk', attested_on: '2024-02-03' });
  });
});
