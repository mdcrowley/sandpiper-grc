import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// BS-7: two runs of the risk checks at once (the scheduled job and "run now") send each reminder
// once: the reminder is claimed before it is sent. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const day = async (offset: number) => (await t.db.one<{ d: string }>('select (current_date + $1::int)::text as d', [offset]))!.d;
const count = async (userId: string, prefix: string) =>
  (await t.db.one<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and title like $2`, [userId, `${prefix}%`]))!.n;

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('risk reminders when two runs overlap (BS-7)', () => {
  it('sends the expiry and review reminders once', async () => {
    if (!t.app.hasDecorator('notify')) return;
    // A slow mail or notification step makes the runs overlap for certain.
    const app = t.app as unknown as { notify: (i: unknown) => Promise<unknown> };
    const original = app.notify.bind(t.app);
    app.notify = async (i) => { await new Promise((r) => setTimeout(r, 30)); return original(i); };
    const owner = await t.as('security_lead');
    const expiring = (await t.api.post('/api/risks', { title: 'Overlap expiry probe', owner_id: owner.userId, inherent_likelihood: 2, inherent_impact: 2 })).body;
    const acc = await t.api.post(`/api/risks/${expiring.id}/acceptances`, { expires_on: await day(5), rationale: 'Invented', approver_name: 'Pat Example' });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    const review = (await t.api.post('/api/risks', { title: 'Overlap review probe', owner_id: owner.userId })).body;
    await t.db.query('update risks set review_on = current_date - 1 where id = $1', [review.id]);

    const runs = await Promise.all([t.api.post('/api/risks/checks/run'), t.api.post('/api/risks/checks/run'), t.api.post('/api/risks/checks/run')]);
    for (const r of runs) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await count(owner.userId, 'Acceptance expires in')).toBe(1);
    expect(await count(owner.userId, 'Risk review due')).toBe(1);
    expect(runs.reduce((n, r) => n + r.body.expiring, 0)).toBe(1);
    expect(runs.reduce((n, r) => n + r.body.reviews, 0)).toBe(1);
    // And a later run sends nothing new.
    await t.api.post('/api/risks/checks/run');
    expect(await count(owner.userId, 'Risk review due')).toBe(1);
  });
});
