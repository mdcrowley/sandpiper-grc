import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calendarSources } from '../../core/calendar.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runReminders } from './reminders.ts';
import { addMonths, usefulLifeEnd } from './service.ts';

// E32 asset condition and state of good repair. Everything here is invented.
// GRC_MODULES=condition,inventory,fleet,projects,risks,notifications,workflows (or all).

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
const ids: Record<string, string> = {};
let today = dayInZone();
let year = Number(today.slice(0, 4));
// Worked out again before each test, so a run that crosses midnight compares with the day the server uses.
beforeEach(() => { today = dayInZone(); year = Number(today.slice(0, 4)); });

async function withGrants(key: string, grants: string[]): Promise<Client> {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}

let assetsOnly: Client;  // assets.* without fleet or sites
let manager: Client;     // the Asset manager role

beforeAll(async () => {
  process.env.GRC_MODULES ??= 'condition,inventory,fleet,projects,risks,notifications,workflows';
  t = await testApp();
  assetsOnly = await withGrants('assets_only_test', ['assets.*']);
  manager = await t.as('asset_manager');
  ids.depot = (await t.api.post('/api/sites', { name: 'Test Depot West' })).body.id;
});
afterAll(async () => { await t.close(); });

describe('useful life', () => {
  it('adds the years, or the date the miles are reached, whichever is earlier', () => {
    expect(usefulLifeEnd('2014-03-31', { useful_life_years: 12 })).toBe('2026-03-31');
    expect(usefulLifeEnd('2014-02-28', { useful_life_years: 0.5 })).toBe('2014-08-28');
    expect(usefulLifeEnd(null, { useful_life_years: 12 })).toBeNull();
    expect(usefulLifeEnd('2020-01-01', { useful_life_years: null })).toBeNull();
    // 100,000 miles in two years: 500,000 miles are reached after ten years, before the twelve.
    expect(usefulLifeEnd('2020-01-01', { useful_life_years: 12, useful_life_miles: 500000 }, 100000, '2022-01-01')).toBe('2030-01-03');
    // Few miles: the years win.
    expect(usefulLifeEnd('2020-01-01', { useful_life_years: 12, useful_life_miles: 500000 }, 10000, '2022-01-01')).toBe('2032-01-01');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });
});

describe('asset classes', () => {
  it('creates classes and checks their benchmarks', async () => {
    const bad = await manager.post('/api/asset-classes', { name: 'Broken class', applies_to: 'vehicle', useful_life_years: -3, poor_rating_at: 9, matches: { paint: ['x'] } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['matches', 'poor_rating_at', 'useful_life_years']);
    const bus = await manager.post('/api/asset-classes', {
      name: 'Test 40-foot bus', applies_to: 'vehicle', category: 'rolling_stock', useful_life_years: 12, useful_life_miles: 500000,
      matches: { vehicle_mode: ['bus'] }, owner_id: manager.userId,
    });
    expect(bus.status).toBe(201);
    expect(bus.body.ref).toMatch(/^ACL-/);
    ids.busClass = bus.body.id;
    ids.stationClass = (await manager.post('/api/asset-classes', { name: 'Test station', applies_to: 'site', useful_life_years: 50, matches: { site_kind: ['passenger_station'] } })).body.id;
    ids.fareboxClass = (await manager.post('/api/asset-classes', { name: 'Test farebox', applies_to: 'asset', useful_life_years: 10 })).body.id;
  });

  it('suggests the class that matches a vehicle mode first', async () => {
    const res = await manager.get('/api/asset-classes/suggest?type=vehicle&value=bus');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: ids.busClass, suggested: true });
    expect((await manager.get('/api/asset-classes/suggest?type=site&value=bus')).body.map((c: any) => c.id)).toEqual([ids.stationClass]);
  });
});

describe('records in a class', () => {
  it('works out a vehicle\'s end of useful life from its class, dates and odometer', async () => {
    const bus = await manager.post('/api/vehicles', { fleet_number: 'T-901', mode: 'bus', in_service_date: '2015-06-01', depot_id: ids.depot, asset_class_id: ids.busClass });
    expect(bus.status).toBe(201);
    expect(bus.body.useful_life_end).toBe('2027-06-01');
    ids.bus = bus.body.id;
    // A site class does not rate vehicles.
    const wrong = await manager.patch(`/api/vehicles/${ids.bus}`, { asset_class_id: ids.stationClass });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.asset_class_id).toMatch(/rates sites/);
    // A high odometer brings the end forward, to before today.
    const odo = await manager.patch(`/api/vehicles/${ids.bus}`, { odometer_miles: 600000 });
    expect(odo.body.odometer_read_on).toBe(today);
    expect(odo.body.useful_life_end < today).toBe(true);
    // Read-only fields cannot be typed in.
    await manager.patch(`/api/vehicles/${ids.bus}`, { useful_life_end: '2099-01-01', condition_rating: '5' });
    const row = (await manager.get(`/api/vehicles/${ids.bus}`)).body;
    expect(row.useful_life_end < today).toBe(true);
    expect(row.condition_rating).toBeNull();
  });

  it('counts an asset from its in-service date, else its purchase date, and a site from the year built', async () => {
    const box = await manager.post('/api/assets', { name: 'Test farebox 1', asset_type: 'farebox', status: 'in_use', purchase_date: '2012-01-15', asset_class_id: ids.fareboxClass });
    expect(box.body.useful_life_end).toBe('2022-01-15');
    ids.box = box.body.id;
    const moved = await manager.patch(`/api/assets/${ids.box}`, { in_service_date: '2020-05-01' });
    expect(moved.body.useful_life_end).toBe('2030-05-01');
    expect((await manager.post('/api/sites', { name: 'Test station A', built_year: 'nineteen' })).status).toBe(400);
    const st = await manager.post('/api/sites', { name: 'Test station A', site_kind: 'passenger_station', built_year: '1970', asset_class_id: ids.stationClass });
    expect(st.status).toBe(201);
    expect(st.body.useful_life_end).toBe('2020-01-01');
    ids.station = st.body.id;
    ids.station2 = (await manager.post('/api/sites', { name: 'Test station B', built_year: '2010', asset_class_id: ids.stationClass })).body.id;
  });

  it('recomputes the members when the class benchmark changes', async () => {
    await manager.patch(`/api/asset-classes/${ids.fareboxClass}`, { useful_life_years: 5 });
    expect((await manager.get(`/api/assets/${ids.box}`)).body.useful_life_end).toBe('2025-05-01');
    await manager.patch(`/api/asset-classes/${ids.fareboxClass}`, { useful_life_years: 10 });
    expect((await manager.get(`/api/assets/${ids.box}`)).body.useful_life_end).toBe('2030-05-01');
    await t.db.query('update assets set useful_life_end = null where id = $1', [ids.box]);
    const res = await manager.post(`/api/asset-classes/${ids.fareboxClass}/recompute`);
    expect(res.body.changed).toBe(1);
    // A class cannot change what it rates while records belong to it.
    expect((await manager.patch(`/api/asset-classes/${ids.fareboxClass}`, { applies_to: 'site' })).status).toBe(409);
  });

  it('mirrors the replacement project as a "replaced_by" link', async () => {
    const project = await t.api.post('/api/projects', { name: 'Test station A rebuild' });
    expect(project.status).toBe(201);
    await manager.patch(`/api/sites/${ids.station}`, { replacement_project_id: project.body.id });
    const links = (await t.api.get(`/api/links?record_type=site&record_id=${ids.station}`)).body;
    expect(JSON.stringify(links)).toContain('replaced_by');
    await manager.patch(`/api/sites/${ids.station}`, { replacement_project_id: null });
    expect(await t.db.one(`select 1 from record_links where from_id = $1 and relation = 'replaced_by'`, [ids.station])).toBeUndefined();
    await manager.patch(`/api/sites/${ids.station}`, { replacement_project_id: project.body.id });
  });
});

describe('condition assessments', () => {
  it('puts the newest assessment on the record it rates', async () => {
    const first = await manager.post('/api/condition-assessments', { target_type: 'vehicle', target_id: ids.bus, assessed_on: dayInZone(-100), rating: '2', method: 'visual' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ target_label: 'T-901', class_id: ids.busClass, assessor_id: manager.userId });
    expect(first.body.ref).toMatch(/^CND-/);
    let bus = (await manager.get(`/api/vehicles/${ids.bus}`)).body;
    expect(bus).toMatchObject({ condition_rating: '2', condition_assessed_on: dayInZone(-100) });
    // An older one does not replace it.
    const older = await manager.post('/api/condition-assessments', { target_type: 'vehicle', target_id: ids.bus, assessed_on: dayInZone(-400), rating: '4' });
    expect((await manager.get(`/api/vehicles/${ids.bus}`)).body.condition_rating).toBe('2');
    // Deleting the newest falls back to the one before.
    expect((await manager.del(`/api/condition-assessments/${first.body.id}`)).status).toBe(200);
    bus = (await manager.get(`/api/vehicles/${ids.bus}`)).body;
    expect(bus).toMatchObject({ condition_rating: '4', condition_assessed_on: dayInZone(-400) });
    ids.busAssessment = older.body.id;
    await manager.post('/api/condition-assessments', { target_type: 'site', target_id: ids.station, assessed_on: dayInZone(-30), rating: '1' });
    await manager.post('/api/condition-assessments', { target_type: 'asset', target_id: ids.box, assessed_on: dayInZone(-30), rating: '5' });
  });

  it('refuses a future date, an unknown record and moving an assessment to another record', async () => {
    expect((await manager.post('/api/condition-assessments', { target_type: 'vehicle', target_id: ids.bus, assessed_on: dayInZone(5), rating: '3' })).status).toBe(400);
    expect((await manager.post('/api/condition-assessments', { target_type: 'vehicle', target_id: '00000000-0000-4000-8000-000000000009', assessed_on: today, rating: '3' })).status).toBe(400);
    expect((await manager.post('/api/condition-assessments', { target_type: 'system', target_id: ids.bus, assessed_on: today, rating: '3' })).status).toBe(400);
    expect((await manager.patch(`/api/condition-assessments/${ids.busAssessment}`, { target_id: ids.station })).status).toBe(400);
  });

  it('hides a vehicle or site assessment from someone who may not see vehicles or sites, and still counts it', async () => {
    const list = (await assetsOnly.get('/api/condition-assessments')).body;
    expect(list.rows.every((r: any) => r.target_type === 'asset')).toBe(true);
    expect((await assetsOnly.get(`/api/condition-assessments/${ids.busAssessment}`)).status).toBe(404);
    expect((await assetsOnly.post('/api/condition-assessments', { target_type: 'vehicle', target_id: ids.bus, assessed_on: today, rating: '3' })).status).toBe(400);
    const stats = (await assetsOnly.get('/api/condition-assessments/stats?group=rating')).body;
    const all = (await manager.get('/api/condition-assessments/stats?group=rating')).body;
    expect(stats.total).toBe(all.total);
    // The aging list keeps visibility: only assets for this person.
    const aging = (await assetsOnly.get('/api/condition/aging')).body;
    expect(aging.rows.length).toBeGreaterThan(0);
    expect(aging.rows.every((r: any) => r.type === 'asset')).toBe(true);
  });

  it('raises a corrective action filed under "Asset condition"', async () => {
    if (!t.ctx.resources.get('action')) return;
    const res = await manager.post(`/api/condition-assessments/${ids.busAssessment}/action`, { title: 'Repair the floor of T-901' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ source: 'condition', source_type: 'condition_assessment', source_id: ids.busAssessment });
  });

  it('clears the assessor\'s name and notes when anonymized at the end of retention', async () => {
    const a = (await manager.post('/api/condition-assessments', { target_type: 'asset', target_id: ids.box, assessed_on: dayInZone(-50), rating: '4', assessor_name: 'Pat Inspector', notes: 'Pat says fine.' })).body;
    await t.db.query(`update condition_assessments set created_at = now() - interval '5 years', updated_at = now() - interval '5 years' where id = $1`, [a.id]);
    expect((await t.api.put('/api/admin/retention/condition_assessment', { periodMonths: 24, disposal: 'anonymize' })).status).toBe(200);
    await t.core.retention.sweep();
    const review = (await t.api.get('/api/admin/retention/reviews?record_type=condition_assessment')).body.rows.find((r: any) => r.record_id === a.id);
    expect(review).toBeTruthy();
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
    const done = await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'End of the schedule (test).', confirm: true });
    expect(done.status).toBe(200);
    const row = await t.db.one<any>('select assessor_name, notes, rating from condition_assessments where id = $1', [a.id]);
    expect(row.assessor_name).not.toContain('Pat');
    expect(row.notes).not.toContain('Pat');
    expect(row.rating).toBe('4');
  });
});

describe('targets and figures', () => {
  it('sets a yearly target, approves it, and asks again when the percentage changes', async () => {
    const url = `/api/asset-classes/${ids.busClass}/targets/${year}`;
    expect((await manager.put(url, { target_pct: 140 })).status).toBe(400);
    const set = await manager.put(url, { target_pct: 10, note: 'Draft for the capital plan (test)' });
    expect(set.body).toMatchObject({ target_pct: 10, status: 'draft' });
    expect((await assetsOnly.post(`${url}/approve`, {})).status).toBe(200); // assets.* includes approve
    const again = await manager.put(url, { target_pct: 10, decision_ref: 'Meeting decision 7 (test)' });
    expect(again.body.status).toBe('approved');
    const changed = await manager.put(url, { target_pct: 12 });
    expect(changed.body).toMatchObject({ status: 'draft', approved_on: null });
    const viewer = await withGrants('assets_view_test', ['assets.view']);
    expect((await viewer.post(`${url}/approve`, {})).status).toBe(403);
    expect((await viewer.put(url, { target_pct: 1 })).status).toBe(403);
    await manager.post(`${url}/approve`, { decision_ref: 'Board decision 12 (test)' });
    expect((await manager.get(`/api/asset-classes/${ids.busClass}/targets`)).body[0]).toMatchObject({ year, status: 'approved', decision_ref: 'Board decision 12 (test)' });
  });

  it('approves a target through the "Asset condition targets" approval workflow', async () => {
    if (!t.app.hasDecorator('workflows')) return;
    const defs = (await t.api.get('/api/workflows/definitions?record_type=asset_class')).body.rows.filter((d: any) => d.kind === 'condition_targets');
    expect(defs).toHaveLength(1);
    const url = `/api/asset-classes/${ids.stationClass}/targets/${year + 1}`;
    await manager.put(url, { target_pct: 20 });
    const res = await manager.post(`${url}/approval`, { note: 'Next year (test)' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.target.status).toBe('pending_approval');
    expect((await manager.post(`${url}/approval`, {})).status).toBe(409);
    const item = ((await assetsOnly.get('/api/workflows/approvals')).body.rows as any[]).find((a) => a.record_id === ids.stationClass);
    expect(item).toMatchObject({ kind: 'condition_targets' });
    expect((await assetsOnly.post(`/api/workflows/steps/${item.step_id}/decision`, { decision: 'approved' })).status).toBe(200);
    expect((await manager.get(url)).body).toMatchObject({ status: 'approved', approved_on: today });
  });

  it('gives the share past useful life by class against the target, leaving retired vehicles out', async () => {
    let d = (await manager.get(`/api/condition/dashboard?year=${year}`)).body;
    let bus = d.classes.find((c: any) => c.id === ids.busClass);
    expect(bus).toMatchObject({ total: 1, past_ulb: 1, past_ulb_pct: 100, target_pct: 12, over_target: true, rated: 1, poor: 0 });
    const station = d.classes.find((c: any) => c.id === ids.stationClass);
    expect(station).toMatchObject({ total: 2, past_ulb: 1, past_ulb_pct: 50, poor: 1, poor_pct: 100, with_replacement: 1 });
    expect(d.trend).toHaveLength(10);
    // A second, newer bus; then the old one retires and leaves the figures.
    const newBus = (await manager.post('/api/vehicles', { fleet_number: 'T-902', mode: 'bus', in_service_date: dayInZone(-200), asset_class_id: ids.busClass })).body;
    d = (await manager.get('/api/condition/dashboard')).body;
    expect(d.classes.find((c: any) => c.id === ids.busClass)).toMatchObject({ total: 2, past_ulb: 1, past_ulb_pct: 50 });
    // Retiring needs an approval (wave 26): give it here, as the approval workflow would.
    await t.db.query(`update vehicles set retirement_request_status = 'approved' where id = $1`, [ids.bus]);
    await manager.patch(`/api/vehicles/${ids.bus}`, { status: 'retired' });
    d = (await manager.get('/api/condition/dashboard')).body;
    bus = d.classes.find((c: any) => c.id === ids.busClass);
    expect(bus).toMatchObject({ total: 1, past_ulb: 0 });
    await manager.patch(`/api/vehicles/${ids.bus}`, { status: 'in_service' });
    ids.newBus = newBus.id;
    // Figures are the same for someone who may not see vehicles.
    expect((await assetsOnly.get('/api/condition/dashboard')).body.totals).toEqual((await manager.get('/api/condition/dashboard')).body.totals);
  });

  it('answers the summary for AI assistants with figures only', async () => {
    const s = (await manager.get('/api/condition/summary')).body;
    expect(Object.keys(s).sort()).toEqual(['classes', 'poor_pct']);
    expect(Object.keys(s.classes[0]).sort()).toEqual(['id', 'name', 'past_ulb', 'past_ulb_pct', 'target_pct', 'total']);
    expect(JSON.stringify(s)).not.toContain('T-901');
  });

  it('offers the two metrics', async () => {
    const keys = metricsAvailable(t.app, t.ctx.resources).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['condition.past_useful_life_pct', 'condition.poor_condition_pct']));
    const res = await manager.get(`/api/metrics?month=${today.slice(0, 7)}`);
    const past = res.body.metrics.find((m: any) => m.key === 'condition.past_useful_life_pct');
    expect(typeof past.value).toBe('number');
  });

  it('lists the records due for assessment in the class owner\'s calendar', async () => {
    const user = (await t.db.one<any>('select id, username, display_name from users where id = $1', [manager.userId]))!;
    const session = { id: user.id, username: user.username, displayName: user.display_name, email: '', roles: ['asset_manager'], permissions: ['assets.*', 'fleet.*', 'sites.*'] };
    const src = calendarSources(t.app, t.ctx.resources, session).find((s) => s.key === 'condition.assessments_due');
    expect(src).toBeTruthy();
    const events = await src!.events(t.ctx, session, dayInZone(-900), dayInZone(900));
    expect(events.some((e) => e.recordId === ids.bus && e.url === `/vehicles/${ids.bus}`)).toBe(true);
    expect(events.some((e) => e.recordId === ids.station)).toBe(false); // the station class has no owner
  });
});

describe('reminders', () => {
  it('reminds once per record and due date, however many runs overlap', async () => {
    // The bus was last assessed 400 days ago; due every 12 months, so it is overdue.
    await t.api.patch(`/api/asset-classes/${ids.busClass}`, { assessment_every_months: 12 });
    const [a, b] = await Promise.all([runReminders(t.ctx), runReminders(t.ctx)]);
    expect(a.claimed + b.claimed).toBe(1);
    const sent = await t.db.query(`select title from notifications where user_id = $1 and title like '%condition assessment%'`, [manager.userId]);
    expect(sent).toHaveLength(1);
    expect((await runReminders(t.ctx)).claimed).toBe(0);
  });
});

describe('switched off', () => {
  it('hides the routes, the record types and the fields on vehicles, assets and sites', async () => {
    await t.ctx.settings.set('features', { condition: false });
    try {
      expect((await t.api.get('/api/condition/dashboard')).body.error.code).toBe('switched_off');
      expect((await t.api.get('/api/asset-classes')).body.error.code).toBe('switched_off');
      expect((await t.api.get('/api/condition-assessments')).body.error.code).toBe('switched_off');
      const meta = (await t.api.get('/api/meta')).body;
      expect(meta.resources.asset_class).toBeUndefined();
      for (const type of ['vehicle', 'asset', 'site']) {
        expect(meta.resources[type].fields.asset_class_id, type).toBeUndefined();
        expect(meta.resources[type].fields.useful_life_end, type).toBeUndefined();
      }
      expect(meta.resources.site.fields.site_kind).toBeUndefined();
      const user = { id: manager.userId, username: 'x', displayName: 'x', email: '', roles: [], permissions: ['*'] };
      expect(calendarSources(t.app, t.ctx.resources, user).map((s) => s.key)).not.toContain('condition.assessments_due');
      // Saving a vehicle still works and leaves the stored condition alone.
      const kept = (await t.db.one<any>('select useful_life_end::text as e from vehicles where id = $1', [ids.newBus]))!.e;
      expect((await t.api.patch(`/api/vehicles/${ids.newBus}`, { notes: 'Checked (test)' })).status).toBe(200);
      expect((await t.db.one<any>('select useful_life_end::text as e from vehicles where id = $1', [ids.newBus]))!.e).toBe(kept);
    } finally {
      await t.ctx.settings.set('features', { condition: true });
    }
    expect((await t.api.get('/api/condition/dashboard')).status).toBe(200);
  });
});
