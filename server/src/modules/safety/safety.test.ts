import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { monthsBack } from './indicators.ts';

// All data here is invented. Needs safety, risks (the hazard matrix and actions) and notifications;
// fleet and inventory are used for the mode filter when loaded.
// GRC_MODULES=safety,risks,notifications,fleet,inventory (or all).

let t: Awaited<ReturnType<typeof testApp>>;
const ids: Record<string, string> = {};
const hasFleet = () => !!t.ctx.resources.get('vehicle');

async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}
const thisMonth = () => dayInZone().slice(0, 7);
const earlier = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let viewer: Awaited<ReturnType<typeof withGrants>>;
/** Someone outside the safety team (no safety permission). */
let outsider: Awaited<ReturnType<typeof t.as>>;

beforeAll(async () => {
  t = await testApp();
  viewer = await withGrants('safety_viewer', ['safety.view', 'actions.view']);
  outsider = await withGrants('no_safety', ['tickets.view']);
});
afterAll(async () => { await t.close(); });

describe('hazard log', () => {
  it('reads the hazard matrix from the risks module', async () => {
    const scale = (await t.api.get('/api/safety/scale')).body;
    expect(scale.key).toBe('hazard_4x5');
    expect(scale.impact_label).toBe('Severity');
    expect((await viewer.get('/api/safety/scale')).status).toBe(200);
  });

  it('scores a hazard on the matrix and refuses levels the matrix does not have', async () => {
    const res = await t.api.post('/api/hazards', { title: 'Test pedestrians at the interchange', likelihood: 3, severity: 3 });
    expect(res.status).toBe(201);
    expect(res.body.ref).toMatch(/^HAZ-/);
    expect(res.body.rating).toBe('serious'); // Occasional by Critical
    ids.hazard = res.body.id;
    const res2 = await t.api.patch(`/api/hazards/${ids.hazard}`, { residual_likelihood: 1, residual_severity: 1 });
    expect(res2.body.residual_rating).toBe('low');
    expect(res2.body.rating).toBe('serious');
    expect((await t.api.post('/api/hazards', { title: 'x', likelihood: 9, severity: 1 })).body.error.fields.likelihood).toBeDefined();
    expect((await t.api.post('/api/hazards', { title: 'x', likelihood: 2 })).body.error.fields.severity).toMatch(/both/);
    // An administrator's change to the matrix applies to new scores.
    const scale = (await t.api.get('/api/risks/scales/hazard_4x5')).body;
    await t.api.patch('/api/risks/scales/hazard_4x5', { matrix: { ...scale.matrix, 3: { ...scale.matrix['3'], 3: 'high' } } });
    expect((await t.api.patch(`/api/hazards/${ids.hazard}`, { likelihood: 3, severity: 3 })).body.rating).toBe('high');
    await t.api.patch('/api/risks/scales/hazard_4x5', { matrix: scale.matrix });
  });
});

describe('safety events', () => {
  it('records an event, refuses one in the future, and restricts types that hold personal information', async () => {
    expect((await t.api.post('/api/safety-events', { title: 'x', occurred_at: new Date(Date.now() + 86_400_000).toISOString(), event_type: 'collision', severity: 'minor' })).body.error.fields.occurred_at).toMatch(/future/);
    const res = await t.api.post('/api/safety-events', { title: 'Test mirror strike', occurred_at: earlier(2), event_type: 'collision', severity: 'minor' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'reported', restricted: false });
    ids.event = res.body.id;
    const injury = await t.api.post('/api/safety-events', { title: 'Test passenger fall', occurred_at: earlier(3), event_type: 'passenger_injury', severity: 'minor' });
    expect(injury.body.restricted).toBe(true);
    ids.restricted = injury.body.id;
    const notRestricted = await t.api.post('/api/safety-events', { title: 'Test fall, no names', occurred_at: earlier(3), event_type: 'passenger_injury', severity: 'minor', restricted: false });
    expect(notRestricted.body.restricted).toBe(false);
  });

  it('hides restricted events from people without security.view, everywhere', async () => {
    const list = (await viewer.get('/api/safety-events')).body;
    expect(list.rows.some((r: any) => r.id === ids.restricted)).toBe(false);
    expect((await viewer.get(`/api/safety-events/${ids.restricted}`)).status).toBe(404);
    expect((await viewer.get(`/api/safety-events/${ids.restricted}/hazards`)).status).toBe(404);
    await t.api.post(`/api/safety-events/${ids.restricted}/hazards`, { hazard_id: ids.hazard });
    expect((await viewer.get(`/api/hazards/${ids.hazard}/events`)).body.some((e: any) => e.id === ids.restricted)).toBe(false);
    expect((await t.api.get(`/api/hazards/${ids.hazard}/events`)).body.some((e: any) => e.id === ids.restricted)).toBe(true);
    const all = (await t.api.get('/api/safety/summary')).body.totals.events;
    // Figures are the same for every reader; only the event's details are hidden.
    expect((await viewer.get('/api/safety/summary')).body.totals.events).toBe(all);
    // A corrective action on a restricted event is restricted too.
    const action = (await t.api.post('/api/actions', { title: 'Test talk to the witness', source: 'safety', source_type: 'safety_event', source_id: ids.restricted })).body;
    expect(action.restricted).toBe(true);
    expect((await viewer.get(`/api/actions/${action.id}`)).status).toBe(404);
    await t.api.patch(`/api/actions/${action.id}`, { status: 'cancelled' });
  });

  it('links hazards to events', async () => {
    const add = await t.api.post(`/api/safety-events/${ids.event}/hazards`, { hazard_id: ids.hazard });
    expect(add.status).toBe(201);
    expect((await t.api.post(`/api/safety-events/${ids.event}/hazards`, { hazard_id: ids.hazard })).status).toBe(409);
    expect((await viewer.post(`/api/safety-events/${ids.event}/hazards`, { hazard_id: ids.hazard })).status).toBe(403);
    expect((await t.api.del(`/api/safety-events/${ids.event}/hazards/${ids.hazard}`)).status).toBe(200);
    expect((await t.api.del(`/api/safety-events/${ids.event}/hazards/${ids.hazard}`)).status).toBe(404);
  });

  it('will not close an event without a root cause or with open corrective actions', async () => {
    const noCause = await t.api.patch(`/api/safety-events/${ids.event}`, { status: 'closed' });
    expect(noCause.body.error.fields.root_cause).toBeDefined();
    const action = (await t.api.post('/api/actions', { title: 'Test refresher training', source: 'safety', source_type: 'safety_event', source_id: ids.event, due_on: dayInZone(-2) })).body;
    expect(action.source).toBe('safety');
    const open = await t.api.patch(`/api/safety-events/${ids.event}`, { status: 'closed', root_cause: 'Mirror not folded at the stop.' });
    expect(open.status).toBe(409);
    expect(open.body.error.code).toBe('actions_open');
    ids.action = action.id;
  });

  it('reminds the safety team about overdue corrective actions once a day', async () => {
    const first = (await t.api.post('/api/safety/reminders/run')).body;
    expect(first.overdue).toBeGreaterThanOrEqual(1);
    expect(first.sent).toBeGreaterThan(0);
    const again = (await t.api.post('/api/safety/reminders/run')).body;
    expect(again.sent).toBe(0);
    const mine = (await t.api.get('/api/notifications')).body.rows;
    expect(mine.some((n: any) => /Corrective action overdue: .*Test refresher training/.test(n.title))).toBe(true);
    expect((await viewer.post('/api/safety/reminders/run')).status).toBe(403);
  });

  it('closes once the action is done, setting the closed date; reopening clears it', async () => {
    await t.api.patch(`/api/actions/${ids.action}`, { status: 'done' });
    const closed = await t.api.patch(`/api/safety-events/${ids.event}`, { status: 'closed', root_cause: 'Mirror not folded at the stop.' });
    expect(closed.status).toBe(200);
    expect(closed.body.closed_on).toBe(dayInZone());
    expect((await t.api.patch(`/api/safety-events/${ids.event}`, { status: 'investigating' })).body.closed_on).toBeNull();
  });

  it('tells the safety team about a serious event, and about one raised to serious', async () => {
    const before = (await outsider.get('/api/notifications')).body.total;
    const serious = await t.api.post('/api/safety-events', { title: 'Test bus left the road', occurred_at: earlier(1), event_type: 'collision', severity: 'serious' });
    expect(serious.status).toBe(201);
    // Someone without safety.view is not told; the administrator holds '*'.
    expect((await outsider.get('/api/notifications')).body.total).toBe(before);
    const admin = (await t.api.get('/api/notifications')).body.rows;
    expect(admin.some((n: any) => n.title.startsWith('Serious safety event: SE-') && n.title.includes('Test bus left the road'))).toBe(true);
    const minor = (await t.api.post('/api/safety-events', { title: 'Test fire alarm', occurred_at: earlier(1), event_type: 'fire', severity: 'minor' })).body;
    expect((await t.api.get('/api/notifications')).body.rows.some((n: any) => n.title.includes('Test fire alarm'))).toBe(false);
    await t.api.patch(`/api/safety-events/${minor.id}`, { severity: 'major' });
    expect((await t.api.get('/api/notifications')).body.rows.some((n: any) => n.title.includes('Test fire alarm'))).toBe(true);
  });
});

describe('indicators and exposure', () => {
  it('checks exposure and indicator definitions', async () => {
    expect((await t.api.put('/api/safety/exposure', { period: '2026-13' })).body.error.fields.period).toBeDefined();
    expect((await t.api.put('/api/safety/exposure', { period: '2999-01' })).body.error.fields.period).toMatch(/future/);
    expect((await t.api.put('/api/safety/exposure', { period: thisMonth(), vehicle_miles: -4 })).body.error.fields.vehicle_miles).toBeDefined();
    expect((await viewer.put('/api/safety/exposure', { period: thisMonth(), vehicle_miles: 4 })).status).toBe(403);
    expect((await t.api.post('/api/safety-indicators', { name: 'x', measure: 'rate' })).body.error.fields).toMatchObject({ exposure: expect.any(String), per_units: expect.any(String) });
    expect((await t.api.post('/api/safety-indicators', { name: 'x', event_types: ['meteor'] })).body.error.fields.event_types).toMatch(/meteor/);
  });

  it('works out a rate per 100,000 vehicle-miles month by month, against the target', async () => {
    const ok = await t.api.put('/api/safety/exposure', { period: thisMonth(), vehicle_miles: 50000 });
    expect(ok.status).toBe(200);
    const ind = (await t.api.post('/api/safety-indicators', {
      name: 'Test collisions per 100,000 vehicle-miles', event_types: ['collision'], measure: 'rate', exposure: 'vehicle_miles', per_units: 100000, target: 3,
    })).body;
    const trend = (await t.api.get(`/api/safety-indicators/${ind.id}/trend?months=3`)).body;
    expect(trend.points.map((p: any) => p.period)).toEqual(monthsBack(3));
    const now = trend.points[2];
    // Collisions this month: the mirror strike and the bus that left the road.
    expect(now.events).toBe(2);
    expect(now.value).toBe(4); // 2 / 50,000 * 100,000
    expect(now.met).toBe(false);
    expect(trend.points[0].value).toBeNull(); // no exposure entered
    const count = (await t.api.post('/api/safety-indicators', { name: 'Test passenger injuries', event_types: ['passenger_injury'], target: 5 })).body;
    const all = (await t.api.get(`/api/safety-indicators/${count.id}/trend?months=2`)).body.points[1];
    const seen = (await viewer.get(`/api/safety-indicators/${count.id}/trend?months=2`)).body.points[1];
    expect(all.value).toBe(2);
    expect(seen.value).toBe(2); // every reader sees the same figure, restricted events included
    expect(all.met).toBe(true);
  });

  it('builds the dashboard summary', async () => {
    const s = (await t.api.get('/api/safety/summary')).body;
    expect(s.periods.length).toBe(12);
    expect(s.totals.serious).toBe(2);
    expect(s.totals.hazards_open).toBeGreaterThanOrEqual(1);
    expect(s.matrix.cells.length).toBe(20);
    expect(s.by_month[11].total).toBe(s.totals.events);
    expect(s.indicators.length).toBeGreaterThanOrEqual(2);
  });

  it('filters an indicator by mode through the vehicle or service', async () => {
    if (!hasFleet()) return;
    const tram = (await t.api.post('/api/vehicles', { fleet_number: 'T77', mode: 'light_rail' })).body;
    await t.api.post('/api/safety-events', { title: 'Test tram near miss', occurred_at: earlier(1), event_type: 'near_miss', severity: 'no_harm', vehicle_id: tram.id });
    await t.api.post('/api/safety-events', { title: 'Test bus near miss', occurred_at: earlier(1), event_type: 'near_miss', severity: 'no_harm' });
    const ind = (await t.api.post('/api/safety-indicators', { name: 'Test rail near misses', event_types: ['near_miss'], modes: ['light_rail'] })).body;
    expect((await t.api.get(`/api/safety-indicators/${ind.id}/trend?months=2`)).body.points[1].events).toBe(1);
  });
});

describe('permissions', () => {
  it('gives the default roles their safety grants', async () => {
    const manager = await t.as('safety_manager');
    expect((await manager.get('/api/safety/summary')).status).toBe(200);
    expect((await manager.post('/api/hazards', { title: 'Test platform edge gap' })).status).toBe(201);
    const lead = await t.as('security_lead');
    expect((await lead.get('/api/hazards')).status).toBe(200);
    expect((await lead.post('/api/hazards', { title: 'x' })).status).toBe(403);
  });

  it('needs safety permissions', async () => {
    const agent = await t.as('agent');
    for (const url of ['/api/safety-events', '/api/hazards', '/api/safety/summary', '/api/safety/scale', '/api/safety/exposure']) {
      expect((await agent.get(url)).status).toBe(403);
    }
    expect((await viewer.post('/api/hazards', { title: 'x' })).status).toBe(403);
    expect((await viewer.post('/api/safety-events', { title: 'x', occurred_at: earlier(1), event_type: 'collision', severity: 'minor' })).status).toBe(403);
  });
});
