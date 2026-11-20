import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { registerPortalIntake } from './portal-intake.ts';

// E20-13: staff report a safety event from the self-service portal. Invented people and events only.
// The safety module registers the routes; this stand-in does so only when it has not (so the test
// works before and after that line is added).
const intake: ModuleDef = {
  key: 'test_safety_intake',
  async register(ctx) {
    if (!ctx.app.hasRoute({ method: 'POST', url: '/api/portal/safety-reports' })) registerPortalIntake(ctx);
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let staff: Awaited<ReturnType<typeof t.as>>;
let safety: Awaited<ReturnType<typeof t.as>>;

const good = {
  title: 'Passenger slipped on the platform steps', description: 'Wet steps after cleaning; no warning sign out.',
  event_type: 'slip_trip_fall', harm: 'minor', occurred_at: '2026-11-18T13:30:00Z', where: 'Central station, east stairs',
  immediate_actions: 'Put a sign out and dried the steps.', injuries: 1,
};

beforeAll(async () => {
  t = await testApp({ extraModules: [intake] });
  staff = await t.as('requester');
  safety = await t.as('safety_manager');
});
afterAll(async () => { await t.close(); });

describe('reporting a safety event from the portal', () => {
  it('is closed while the portal is off, and needs portal permissions', async () => {
    expect((await staff.post('/api/portal/safety-reports', good)).status).toBe(404);
    await t.api.patch('/api/admin/features', { features: { portal: true } });
    const viewer = await t.as('executive_viewer');
    expect((await viewer.post('/api/portal/safety-reports', good)).status).toBe(403);
    expect((await staff.get('/api/portal/config')).body.has.safety).toBe(true);
  });

  it('checks the report and creates a "Reported" event for the safety team', async () => {
    const bad = await staff.post('/api/portal/safety-reports', { title: '', event_type: 'x', harm: 'awful', occurred_at: '2099-01-01T00:00:00Z' });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['description', 'event_type', 'harm', 'occurred_at', 'title']);
    const options = (await staff.get('/api/portal/safety/options')).body;
    expect(options.types.map((o: any) => o.value)).toContain('slip_trip_fall');
    expect(options.harm.map((o: any) => o.value)).toEqual(['none', 'minor', 'treated', 'serious']);

    const made = await staff.post('/api/portal/safety-reports', { ...good, severity: 'major', status: 'closed', investigator_id: staff.userId });
    expect(made.status).toBe(201);
    expect(made.body.ref).toMatch(/^SE-/);
    // The reporter cannot open the safety screens; the safety team sees the event.
    expect((await staff.get(`/api/safety-events/${made.body.id}`)).status).toBe(403);
    const event = (await safety.get(`/api/safety-events/${made.body.id}`)).body;
    expect(event).toMatchObject({
      title: good.title, status: 'reported', severity: 'minor', event_type: 'slip_trip_fall', reported_by_id: staff.userId,
      investigator_id: null, location_detail: good.where, injuries: 1, restricted: false,
    });
    expect(event.notes).toContain('self-service portal');
    const history = (await t.api.get(`/api/history?record_type=safety_event&record_id=${made.body.id}`)).body;
    expect(history.find((h: any) => h.action === 'safety_event.create').actor_name).toContain('requester');
  });

  it('restricts a report about personal details, and lists my reports in plain words', async () => {
    const made = await staff.post('/api/portal/safety-reports', { ...good, title: 'Operator assaulted at the terminus', event_type: 'other', harm: 'treated', personal: true });
    expect(made.status).toBe(201);
    const event = (await t.api.get(`/api/safety-events/${made.body.id}`)).body;
    expect(event).toMatchObject({ restricted: true, severity: 'moderate' });
    const mine = (await staff.get('/api/portal/safety-reports')).body.rows;
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ ref: event.ref, title: `Safety report ${event.ref}`, status: { key: 'received', label: 'Received' } });
    expect(mine[1].title).toBe(good.title);
    // Someone else's reports are not mine.
    const other = await t.as('requester');
    expect((await other.get('/api/portal/safety-reports')).body.rows).toEqual([]);
  });

  it('can be switched off in the portal settings', async () => {
    expect((await t.api.put('/api/portal/settings', { safety_reports: 'no' })).status).toBe(400);
    await t.api.put('/api/portal/settings', { safety_reports: false });
    expect((await staff.get('/api/portal/config')).body.has.safety).toBe(false);
    expect((await staff.post('/api/portal/safety-reports', good)).status).toBe(404);
    await t.api.put('/api/portal/settings', { safety_reports: true });
  });
});
