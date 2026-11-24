import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Behavior tests for GET /api/policies/:id/audience [policies.view] and
// POST /api/policies/plan-reviews/run [policies.administer] (E40-05). Invented policies only.

let t: Awaited<ReturnType<typeof testApp>>;
const MISSING = '00000000-0000-4000-8000-000000000801';

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('GET /api/policies/:id/audience', () => {
  it('counts the active people who would be asked to acknowledge, and the days they have', async () => {
    await t.as('training_coordinator');
    await t.as('training_coordinator');
    const off = await t.as('training_coordinator');
    await t.db.query(`update users set status = 'disabled' where id = $1`, [off.userId]);
    const policy = (await t.api.post('/api/policies', { title: 'Invented fatigue policy', audience_roles: ['training_coordinator'], ack_days: 21 })).body;
    expect(policy.id).toBeTruthy();

    const res = await (await t.as('agent')).get(`/api/policies/${policy.id}/audience`); // policies.view
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2, ack_days: 21 });

    // Everyone: every active account.
    await t.api.patch(`/api/policies/${policy.id}`, { audience_everyone: true });
    const active = (await t.db.one<{ n: number }>(`select count(*)::int as n from users where deleted_at is null and status = 'active'`))!.n;
    expect((await t.api.get(`/api/policies/${policy.id}/audience`)).body.count).toBe(active);

    // Nobody named: nobody is asked.
    const none = (await t.api.post('/api/policies', { title: 'Invented memo with no audience' })).body;
    expect((await t.api.get(`/api/policies/${none.id}/audience`)).body.count).toBe(0);
  });

  it('answers 404 for a policy that does not exist, and needs policies.view', async () => {
    const policy = (await t.api.post('/api/policies', { title: 'Invented radio policy' })).body;
    expect((await t.api.get(`/api/policies/${MISSING}/audience`)).status).toBe(404);
    expect((await (await t.as('project_manager')).get(`/api/policies/${policy.id}/audience`)).status).toBe(403);
    expect((await t.anon.get(`/api/policies/${policy.id}/audience`)).status).toBe(401);
  });
});

describe('POST /api/policies/plan-reviews/run', () => {
  it('needs policies.administer, runs, and reminds the plan owner once', async () => {
    expect((await (await t.as('agent')).post('/api/policies/plan-reviews/run')).status).toBe(403); // policies.view
    expect((await (await t.as('training_coordinator')).post('/api/policies/plan-reviews/run')).status).toBe(403);

    const lead = await t.as('security_lead'); // policies.*
    const plan = (await t.api.post('/api/policies', { title: 'Invented safety plan', document_type: 'plan', owner_id: lead.userId, review_date: dayInZone(10) })).body;
    const notPlan = (await t.api.post('/api/policies', { title: 'Invented procedure', document_type: 'procedure', owner_id: lead.userId, review_date: dayInZone(10) })).body;
    const res = await lead.post('/api/policies/plan-reviews/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, soon: expect.any(Number), due: expect.any(Number), notified: expect.any(Number) });
    expect(res.body.soon).toBeGreaterThanOrEqual(1);
    const sent = async (id: string) => (await t.db.query(`select 1 from notifications where record_type = 'policy' and record_id = $1 and user_id = $2`, [id, lead.userId])).length;
    expect(await sent(plan.id)).toBe(1);
    expect(await sent(notPlan.id)).toBe(0);
    await lead.post('/api/policies/plan-reviews/run');
    expect(await sent(plan.id)).toBe(1);
  });
});
