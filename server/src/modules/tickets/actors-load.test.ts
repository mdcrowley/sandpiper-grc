import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E18-94: fulfillment tasks ticked in data load mode were done by the person the load names;
// outside a load, by the signed-in person. Invented tickets only.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  t = await testApp();
  await t.db.query(`insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled')`);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('fulfillment tasks', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const tasks = (a: boolean, b: boolean) => [{ title: 'Issue the card', done: a }, { title: 'Record the number', done: b }];
    const made = await t.api.post('/api/tickets', { title: 'Invented door card', type: 'request', fulfilment_tasks: tasks(false, false) });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const first = await t.api.patch(`/api/tickets/${made.body.id}`, { fulfilment_tasks: tasks(true, false) });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.fulfilment_tasks[0].done_by_name).toBe('Test Admin');
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const second = await t.api.patch(`/api/tickets/${made.body.id}`, { fulfilment_tasks: tasks(true, true), on_behalf_of: 'rclerk' });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.fulfilment_tasks.map((x: { done_by_name: string }) => x.done_by_name)).toEqual(['Test Admin', 'Robin Clerk']);
  });
});
