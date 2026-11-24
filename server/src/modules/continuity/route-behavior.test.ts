import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Behavior tests for hand-written continuity routes no other test named (E40-05):
// GET /api/continuity/dashboard, DELETE /api/emergency-activations/:id/roles/:roleId and
// POST /api/continuity/reminders/run. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let manager: Client; // continuity.*, no security.view or privacy.view
const MISSING = '00000000-0000-4000-8000-000000000101';

beforeAll(async () => {
  t = await testApp();
  manager = await t.as('continuity_manager');
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('GET /api/continuity/dashboard', () => {
  it('lists plan reviews and impact analyses due within 60 days and activations not closed, the same for every viewer', async () => {
    const plan = async (title: string, status: string, review: string | null) => {
      const id = (await manager.post('/api/continuity-plans', { title })).body.id;
      await t.db.query('update continuity_plans set status = $2, next_review_on = $3 where id = $1', [id, status, review]);
      return id;
    };
    const soon = await plan('Invented flood plan', 'approved', dayInZone(30));
    const late = await plan('Invented power plan', 'in_review', dayInZone(-3));
    const far = await plan('Invented snow plan', 'approved', dayInZone(90));
    const retired = await plan('Invented retired plan', 'retired', dayInZone(5));
    const proc = async (name: string, due: string, status = 'active') =>
      (await manager.post('/api/business-processes', { name, status, criticality: 'vital', next_bia_due: due })).body.id;
    const dueProc = await proc('Invented dispatch', dayInZone(10));
    const farProc = await proc('Invented payroll', dayInZone(120));
    const inactiveProc = await proc('Invented archive', dayInZone(10), 'retired');

    const act = async (title: string) => (await manager.post('/api/emergency-activations', { title, event_type: 'other' })).body.id;
    const active = await act('Invented storm response');
    const stood = await act('Invented outage response');
    expect((await manager.post(`/api/emergency-activations/${stood}/stand-down`, { summary: 'Invented: power back' })).status).toBe(200);
    const closed = await act('Invented closed response');
    await manager.post(`/api/emergency-activations/${closed}/stand-down`, { summary: 'Invented: all clear' });
    expect((await manager.post(`/api/emergency-activations/${closed}/close`, { after_action_summary: 'Invented lessons' })).status).toBe(200);

    const res = await manager.get('/api/continuity/dashboard');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['activations', 'bia_due', 'plans_due', 'today']);
    expect(res.body.today).toBe(dayInZone());
    expect(res.body.plans_due.map((p: any) => p.id)).toEqual([late, soon]); // soonest first
    expect(res.body.plans_due[0]).toMatchObject({ title: 'Invented power plan', status: 'in_review', next_review_on: dayInZone(-3), ref: expect.any(String) });
    for (const id of [far, retired]) expect(res.body.plans_due.some((p: any) => p.id === id)).toBe(false);
    expect(res.body.bia_due.map((p: any) => p.id)).toEqual([dueProc]);
    for (const id of [farProc, inactiveProc]) expect(res.body.bia_due.some((p: any) => p.id === id)).toBe(false);
    expect(res.body.activations.map((a: any) => a.id).sort()).toEqual([active, stood].sort());
    expect(res.body.activations.find((a: any) => a.id === stood).status).toBe('stood_down');

    // A deleted plan leaves the list.
    await t.api.del(`/api/continuity-plans/${soon}`);
    expect((await manager.get('/api/continuity/dashboard')).body.plans_due.map((p: any) => p.id)).toEqual([late]);

    // The same answer for viewers with and without security.view and privacy.view.
    const mine = (await manager.get('/api/continuity/dashboard')).body;
    for (const role of ['security_lead', 'safety_manager', 'compliance_officer', 'executive_viewer']) {
      expect((await (await t.as(role)).get('/api/continuity/dashboard')).body).toEqual(mine);
    }
    expect((await t.api.get('/api/continuity/dashboard')).body).toEqual(mine);
  });

  it('needs continuity.view', async () => {
    expect((await (await t.as('agent')).get('/api/continuity/dashboard')).status).toBe(403);
    expect((await (await t.as('training_coordinator')).get('/api/continuity/dashboard')).status).toBe(403);
    expect((await t.anon.get('/api/continuity/dashboard')).status).toBe(401);
  });
});

describe('DELETE /api/emergency-activations/:id/roles/:roleId', () => {
  it('ends a role, logs the handover and audits it; refused once the activation is closed', async () => {
    const a = (await manager.post('/api/emergency-activations', { title: 'Invented rail disruption', event_type: 'other' })).body.id;
    const role = (await manager.post(`/api/emergency-activations/${a}/roles`, { role: 'Invented incident commander', name: 'Robin Example' })).body;
    const other = (await manager.post(`/api/emergency-activations/${a}/roles`, { role: 'Scribe', user_id: manager.userId })).body;

    const viewer = await t.as('safety_manager'); // continuity.view
    expect((await viewer.del(`/api/emergency-activations/${a}/roles/${role.id}`)).status).toBe(403);

    const res = await manager.del(`/api/emergency-activations/${a}/roles/${role.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await manager.get(`/api/emergency-activations/${a}/roles`)).body.map((r: any) => r.id)).toEqual([other.id]);
    const log = (await manager.get(`/api/emergency-activations/${a}/log`)).body;
    expect(log.some((l: any) => l.entry === 'Robin Example handed over the role Invented incident commander.')).toBe(true);
    const ev = await t.db.query<any>(`select summary from audit_events where action = 'emergency_activation.role_removed' and record_id = $1`, [a]);
    expect(ev).toEqual([{ summary: 'Role ended: Invented incident commander' }]);

    expect((await manager.del(`/api/emergency-activations/${a}/roles/${role.id}`)).status).toBe(404);
    expect((await manager.del(`/api/emergency-activations/${a}/roles/not-a-uuid`)).status).toBe(404);
    // A role of another activation is not found here.
    const b = (await manager.post('/api/emergency-activations', { title: 'Invented second event', event_type: 'other' })).body.id;
    expect((await manager.del(`/api/emergency-activations/${b}/roles/${other.id}`)).status).toBe(404);
    expect((await manager.del(`/api/emergency-activations/${MISSING}/roles/${other.id}`)).status).toBe(404);

    await manager.post(`/api/emergency-activations/${a}/stand-down`, { summary: 'Invented: service restored' });
    await manager.post(`/api/emergency-activations/${a}/close`, { after_action_summary: 'Invented review' });
    const closed = await manager.del(`/api/emergency-activations/${a}/roles/${other.id}`);
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('closed');
    expect((await manager.get(`/api/emergency-activations/${a}/roles`)).body).toHaveLength(1);
  });
});

describe('POST /api/continuity/reminders/run', () => {
  it('needs continuity.administer, runs, and answers its counts', async () => {
    expect((await (await t.as('safety_manager')).post('/api/continuity/reminders/run')).status).toBe(403);
    expect((await (await t.as('executive_viewer')).post('/api/continuity/reminders/run')).status).toBe(403);

    const plan = (await manager.post('/api/continuity-plans', { title: 'Invented reminder plan', owner_id: manager.userId })).body.id;
    await t.db.query(`update continuity_plans set status = 'approved', next_review_on = $2 where id = $1`, [plan, dayInZone(7)]);
    const res = await manager.post('/api/continuity/reminders/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, plans: expect.any(Number), overdue: expect.any(Number), analyses: expect.any(Number), notified: expect.any(Number) });
    expect(res.body.plans).toBeGreaterThanOrEqual(1);
    expect(await t.db.query(`select 1 from notifications where record_id = $1 and kind = 'continuity'`, [plan])).toHaveLength(1);
    // Each occasion is announced once.
    await manager.post('/api/continuity/reminders/run');
    expect(await t.db.query(`select 1 from notifications where record_id = $1 and kind = 'continuity'`, [plan])).toHaveLength(1);
  });
});
