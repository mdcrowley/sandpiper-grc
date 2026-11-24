import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdsOn } from '../../core/holds.ts';
import { testApp } from '../../test/helpers.ts';

// Behavior tests for hand-written legal hold routes no other test named (E40-05):
// POST /api/legal-holds/queries/run and DELETE /api/legal-holds/:id/queries/:qid.

let t: Awaited<ReturnType<typeof testApp>>;
const MISSING = '00000000-0000-4000-8000-0000000000aa';

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

const hold = async (matter: string) => (await t.api.post('/api/legal-holds', { matter })).body;
const system = async (name: string) => (await t.api.post('/api/systems', { name })).body;
const audits = (action: string, id: string) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2', [action, id]);

describe('POST /api/legal-holds/queries/run', () => {
  it('runs every saved query of every active hold, holds records created since, and skips released holds', async () => {
    const h = await hold('Invented matter: signal cabinet records');
    const q = await t.api.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'system', q: 'Zephyr cabinet' });
    expect(q.status).toBe(201);
    expect(q.body.matched).toBe(0);

    // A record created after the query was saved is held only once the queries run again.
    const sys = await system('Zephyr cabinet controller');
    expect(await holdsOn(t.db, 'system', sys.id)).toEqual([]);

    // A released hold's query must not add anything.
    const released = await hold('Invented matter: already released');
    await t.api.post(`/api/legal-holds/${released.id}/queries`, { record_type: 'system', q: 'Quillon panel' });
    // Released through the approval in real use; set directly here.
    await t.db.query(`update legal_holds set status = 'released' where id = $1`, [released.id]);
    expect((await t.db.one<any>('select status from legal_holds where id = $1', [released.id])).status).toBe('released');
    const other = await system('Quillon panel');

    const res = await t.api.post('/api/legal-holds/queries/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queries: expect.any(Number), added: expect.any(Number) });
    expect(res.body.queries).toBeGreaterThanOrEqual(1);
    expect(res.body.added).toBeGreaterThanOrEqual(1);

    expect((await holdsOn(t.db, 'system', sys.id)).map((x) => x.holdId)).toEqual([h.id]);
    expect(await holdsOn(t.db, 'system', other.id)).toEqual([]);
    const listed = (await t.api.get(`/api/legal-holds/${h.id}/records`)).body;
    expect(listed.rows.find((r: any) => r.record_id === sys.id)).toMatchObject({ via: 'query' });
    expect(await audits('legal_hold.query_run', h.id)).toHaveLength(1);

    // Running again adds nothing new.
    const again = await t.api.post('/api/legal-holds/queries/run');
    expect(again.body.added).toBe(0);
  });

  it('needs legal.administer', async () => {
    const viewer = await t.as('compliance_officer'); // legal.view only
    expect((await viewer.post('/api/legal-holds/queries/run')).status).toBe(403);
    const agent = await t.as('agent');
    expect((await agent.post('/api/legal-holds/queries/run')).status).toBe(403);
    expect((await t.anon.post('/api/legal-holds/queries/run')).status).toBe(401);
    const officer = await t.as('records_privacy_officer'); // legal.*
    expect((await officer.post('/api/legal-holds/queries/run')).status).toBe(200);
  });
});

describe('DELETE /api/legal-holds/:id/queries/:qid', () => {
  it('removes the saved query, keeps the records it added on hold, and audits', async () => {
    const h = await hold('Invented matter: fare gate logs');
    const sys = await system('Orbitwell fare gate');
    const q = (await t.api.post(`/api/legal-holds/${h.id}/queries`, { record_type: 'system', q: 'Orbitwell' })).body;
    expect(q.added).toBe(1);

    const res = await t.api.del(`/api/legal-holds/${h.id}/queries/${q.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await t.api.get(`/api/legal-holds/${h.id}/queries`)).body).toEqual([]);
    expect((await holdsOn(t.db, 'system', sys.id)).map((x) => x.holdId)).toEqual([h.id]);
    const ev = await audits('legal_hold.query_remove', h.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toContain(h.ref);

    // A second delete answers not found.
    expect((await t.api.del(`/api/legal-holds/${h.id}/queries/${q.id}`)).status).toBe(404);
  });

  it('refuses a query of another hold, an invalid id, and someone without legal.edit', async () => {
    const a = await hold('Invented matter: A');
    const b = await hold('Invented matter: B');
    const q = (await t.api.post(`/api/legal-holds/${a.id}/queries`, { record_type: 'system', q: 'nothing-matches-this' })).body;
    expect((await t.api.del(`/api/legal-holds/${b.id}/queries/${q.id}`)).status).toBe(404);
    expect((await t.api.del(`/api/legal-holds/${a.id}/queries/not-a-uuid`)).status).toBe(404);
    expect((await t.api.del(`/api/legal-holds/${MISSING}/queries/${q.id}`)).status).toBe(404);

    const viewer = await t.as('compliance_officer'); // legal.view
    expect((await viewer.del(`/api/legal-holds/${a.id}/queries/${q.id}`)).status).toBe(403);
    expect((await t.db.one<any>('select count(*)::int as n from legal_hold_queries where id = $1', [q.id])).n).toBe(1);
  });
});
