import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// BS-7: two runs of the asset date reminders at once (the daily job and "run now") send each
// reminder once: the reminder is claimed before it is sent. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const day = async (offset: number) => (await t.db.one<{ d: string }>('select (current_date + $1::int)::text as d', [offset]))!.d;

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('asset reminders when two runs overlap (BS-7)', () => {
  it('sends a warranty reminder once', async () => {
    if (!t.app.hasDecorator('notify')) return;
    // A slow mail or notification step makes the runs overlap for certain.
    const app = t.app as unknown as { notify: (i: unknown) => Promise<unknown> };
    const original = app.notify.bind(t.app);
    app.notify = async (i) => { await new Promise((r) => setTimeout(r, 30)); return original(i); };
    const owner = await t.as('agent');
    const asset = (await t.api.post('/api/assets', { name: 'Overlap probe tablet', owner_id: owner.userId, warranty_end: await day(5) })).body;
    const runs = await Promise.all([t.api.post('/api/inventory/reminders/run'), t.api.post('/api/inventory/reminders/run'), t.api.post('/api/inventory/reminders/run')]);
    for (const r of runs) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(runs.reduce((n, r) => n + r.body.warranty, 0)).toBe(1);
    const sent = await t.db.one<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and title like $2`, [owner.userId, `Warranty for ${asset.tag}%`]);
    expect(sent!.n).toBe(1);
  });
});
