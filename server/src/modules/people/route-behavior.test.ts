import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior test for GET /api/people/summary [people.view] (E40-05): head counts by status and position
// and the people with an account; a figure, so every person counts and every viewer gets the same
// answer, whatever else they may see. Invented people only.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

const sortBy = (rows: any[], k: string) => [...rows].sort((a, b) => String(a[k]).localeCompare(String(b[k])));

describe('GET /api/people/summary', () => {
  it('counts people by status and by position (leavers left out), and those with an account', async () => {
    const before = (await t.api.get('/api/people/summary')).body;
    const driver = (await t.api.post('/api/positions', { name: 'Invented coach operator' })).body;
    const mech = (await t.api.post('/api/positions', { name: 'Invented bus mechanic' })).body;
    const userId = (await t.as('agent')).userId;
    const add = async (data: Record<string, unknown>) => {
      const r = await t.api.post('/api/people', data);
      expect(r.status).toBe(201);
      return r.body;
    };
    await add({ full_name: 'Avery Example', position_id: driver.id });
    await add({ full_name: 'Blair Example', position_id: driver.id, status: 'on_leave', user_id: userId });
    await add({ full_name: 'Casey Example', position_id: mech.id, status: 'left' });
    await add({ full_name: 'Devon Example' });
    const gone = await add({ full_name: 'Emery Example', position_id: mech.id });
    expect((await t.api.del(`/api/people/${gone.id}`)).status).toBe(200);

    const res = await t.api.get('/api/people/summary');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['byPosition', 'byStatus', 'withAccount']);
    const status = (s: string) => (res.body.byStatus.find((r: any) => r.status === s)?.n ?? 0) - (before.byStatus.find((r: any) => r.status === s)?.n ?? 0);
    expect([status('active'), status('on_leave'), status('left')]).toEqual([2, 1, 1]);
    expect(res.body.byPosition.find((r: any) => r.position_id === driver.id)).toEqual({ position_id: driver.id, name: 'Invented coach operator', n: 2 });
    // The mechanic left and the other was deleted: no row for that position.
    expect(res.body.byPosition.find((r: any) => r.position_id === mech.id)).toBeUndefined();
    const none = (b: any) => b.byPosition.find((r: any) => r.position_id === null)?.n ?? 0;
    expect(none(res.body) - none(before)).toBe(1);
    expect(res.body.withAccount - before.withAccount).toBe(1);
  });

  it('gives every viewer the same figures, and needs people.view', async () => {
    const admin = (await t.api.get('/api/people/summary')).body;
    const coordinator = await t.as('training_coordinator'); // people.*, no security.view or privacy.view
    const security = await t.as('security_lead'); // people.view, security.view and privacy.view
    const continuity = await t.as('continuity_manager'); // people.view
    for (const c of [coordinator, security, continuity]) {
      const body = (await c.get('/api/people/summary')).body;
      expect(sortBy(body.byStatus, 'status')).toEqual(sortBy(admin.byStatus, 'status'));
      expect(body.byPosition).toEqual(admin.byPosition);
      expect(body.withAccount).toBe(admin.withAccount);
    }
    expect((await (await t.as('agent')).get('/api/people/summary')).status).toBe(403);
    expect((await (await t.as('project_manager')).get('/api/people/summary')).status).toBe(403);
    expect((await t.anon.get('/api/people/summary')).status).toBe(401);
  });
});
