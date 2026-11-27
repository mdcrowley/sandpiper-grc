import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: a records destruction submitted in data load mode is requested by the person the load
// names (on the record and as the approval's requester); outside a load, by the signed-in person.

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

describe('records destructions', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const series = (await t.api.post('/api/record-series', { title: 'Invented shift logs', medium: 'paper', retention_value: 1, retention_unit: 'years', trigger_event: 'closed' })).body;
    const make = async () => (await t.api.post('/api/records-destructions', { title: 'Invented boxes', series_id: series.id, trigger_date: '2019-01-01' })).body;
    const who = async (id: string) => [
      (await t.db.one<Row>('select requested_by from records_destructions where id = $1', [id]))!.requested_by,
      (await t.db.one<Row>('select requested_by from workflow_instances where record_id = $1', [id]))?.requested_by,
    ];
    const first = await make();
    expect((await t.api.post(`/api/records-destructions/${first.id}/submit`, {})).status).toBe(202);
    expect(await who(first.id)).toEqual([adminId, adminId]);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const second = await make();
    const res = await t.api.post(`/api/records-destructions/${second.id}/submit`, { on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(await who(second.id)).toEqual([former, former]);
  });
});
