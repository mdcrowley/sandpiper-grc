import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: access review decisions and sign-offs loaded in data load mode are the named reviewer's
// (decided_by, decided_at, signed_off_by), under the same rules; outside a load, the signed-in
// reviewer's. Invented systems and accounts only.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('access review decisions', () => {
  it('follow the named reviewer in a load and the caller outside one', async () => {
    const reviewer = await t.as('training_coordinator');
    const name = (await t.db.one<{ username: string }>('select username from users where id = $1', [reviewer.userId]))!.username;
    const system = (await t.api.post('/api/systems', { name: 'Invented depot rostering', business_owner_id: reviewer.userId })).body.id;
    for (const account_name of ['jdoe', 'kroe']) expect((await t.api.post('/api/system-accounts', { system_id: system, account_name })).status).toBe(201);
    const review = (await t.api.post('/api/access-reviews', { title: 'Invented yearly review', due_on: '2099-01-31' })).body.id;
    await t.api.post(`/api/access-reviews/${review}/systems`, { system_ids: [system] });
    expect((await t.api.post(`/api/access-reviews/${review}/launch`)).status).toBe(200);
    const items = (await reviewer.get(`/api/access-reviews/${review}/systems/${system}/items`)).body.items as Row[];
    const id = (n: string) => items.find((i) => i.account_name === n)!.id;
    const row = (n: string) => t.db.one<Row>('select decided_by, decided_at from access_review_items where id = $1', [id(n)]);

    expect((await reviewer.post(`/api/access-reviews/${review}/decisions`, { items: [id('jdoe')], decision: 'keep' })).body.saved).toBe(1);
    expect((await row('jdoe'))!.decided_by).toBe(reviewer.userId);

    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    // The administrator is not the reviewer: without naming them, the rules refuse.
    expect((await t.api.post(`/api/access-reviews/${review}/decisions`, { items: [id('kroe')], decision: 'keep' })).status).toBe(403);
    const loaded = await t.api.post(`/api/access-reviews/${review}/decisions`, { items: [id('kroe')], decision: 'keep', decided_at: '2024-06-03T10:00:00Z', on_behalf_of: name });
    expect(loaded.body.saved, JSON.stringify(loaded.body)).toBe(1);
    const k = (await row('kroe'))!;
    expect([k.decided_by, new Date(k.decided_at).toISOString()]).toEqual([reviewer.userId, '2024-06-03T10:00:00.000Z']);
    const signed = await t.api.post(`/api/access-reviews/${review}/systems/${system}/sign-off`, { on_behalf_of: name });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect((await t.db.one<Row>('select signed_off_by from access_review_systems where review_id = $1', [review]))!.signed_off_by).toBe(reviewer.userId);
  });
});
