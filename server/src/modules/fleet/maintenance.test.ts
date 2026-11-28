import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { addDays } from '../../../../shared/dates.ts';
import { computeDue } from './maintenance.ts';

// Planned maintenance (E46-71): intervals by miles, hours or days per vehicle model or asset class,
// odometer and hour readings (mileage history) that never go backwards, services, when each vehicle
// is next due, and the due work in My work and the calendar; readings and services in data load mode.
// Invented vehicles only.

let t: Awaited<ReturnType<typeof testApp>>;
let today: string;
let adminId = '';
let former = '';
const ids: Record<string, string> = {};

beforeAll(async () => {
  process.env.GRC_MODULES = 'admin,inventory,fleet,models,condition,work,notifications';
  t = await testApp();
  today = dayInZone();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('fclerk', 'f.clerk@example.test', 'Fran Clerk', 'disabled') returning id`))!.id;
  ids.model = (await t.api.post('/api/vehicle-models', { name: 'Invented midibus', mode: 'bus' })).body.id;
  ids.other = (await t.api.post('/api/vehicle-models', { name: 'Invented tram', mode: 'light_rail' })).body.id;
  const bus = await t.api.post('/api/vehicles', { fleet_number: '8101', mode: 'bus', model_id: ids.model, in_service_date: addDays(today, -400) });
  expect(bus.status, JSON.stringify(bus.body)).toBe(201);
  ids.bus = bus.body.id;
  ids.bus2 = (await t.api.post('/api/vehicles', { fleet_number: '8102', mode: 'bus', model_id: ids.model, in_service_date: addDays(today, -30) })).body.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('maintenance intervals', () => {
  it('need a model or an asset class (not both) and miles, hours or days', async () => {
    const none = await t.api.post('/api/maintenance-intervals', { name: 'Invented check', every_miles: 6000 });
    expect(none.status).toBe(400);
    expect(none.body.error.fields.model_id).toBeTruthy();
    const nothing = await t.api.post('/api/maintenance-intervals', { name: 'Invented check', model_id: ids.model });
    expect(nothing.body.error.fields.every_miles).toBeTruthy();
    const bad = await t.api.post('/api/maintenance-intervals', { name: 'Invented check', model_id: ids.model, every_days: 1.5 });
    expect(bad.body.error.fields.every_days).toBeTruthy();
    const cls = (await t.api.post('/api/asset-classes', { name: 'Invented bus class', applies_to: 'vehicle', useful_life_years: 12 })).body;
    if (cls?.id) {
      const both = await t.api.post('/api/maintenance-intervals', { name: 'Invented check', model_id: ids.model, asset_class_id: cls.id, every_days: 30 });
      expect(both.body.error.fields.asset_class_id).toBeTruthy();
    }
    const ok = await t.api.post('/api/maintenance-intervals', { name: 'Invented A inspection', model_id: ids.model, every_miles: 6000, every_days: 45, owner_id: adminId });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.ref).toMatch(/^PMI-/);
    ids.interval = ok.body.id;
  });
});

describe('readings (mileage history)', () => {
  it('never go backwards, and the vehicle\'s odometer is the latest one', async () => {
    const r1 = await t.api.post('/api/vehicle-readings', { vehicle_id: ids.bus, read_on: addDays(today, -100), odometer_miles: 4000 });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.recorded_by).toBe(adminId);
    const r2 = await t.api.post('/api/vehicle-readings', { vehicle_id: ids.bus, read_on: addDays(today, -20), odometer_miles: 13000 });
    expect(r2.status).toBe(201);
    const synced = (await t.api.get(`/api/vehicles/${ids.bus}`)).body;
    expect(synced.odometer_miles).toBe(13000);
    expect(synced.odometer_read_on).toBe(addDays(today, -20)); // the reading's day, not today
    // Lower than an earlier reading, or higher than a later one: refused.
    const low = await t.api.post('/api/vehicle-readings', { vehicle_id: ids.bus, read_on: addDays(today, -10), odometer_miles: 12000 });
    expect(low.status).toBe(400);
    expect(low.body.error.fields.odometer_miles).toMatch(/lower than an earlier reading \(13,000 miles\)/);
    const high = await t.api.post('/api/vehicle-readings', { vehicle_id: ids.bus, read_on: addDays(today, -50), odometer_miles: 14000 });
    expect(high.body.error.fields.odometer_miles).toMatch(/higher than a later reading/);
    expect((await t.api.post('/api/vehicle-readings', { vehicle_id: ids.bus, read_on: addDays(today, 1), odometer_miles: 20000 })).body.error.fields.read_on).toBeTruthy();
    expect((await t.api.post('/api/vehicle-readings', { vehicle_id: ids.bus, read_on: today })).body.error.fields.odometer_miles).toBeTruthy();
    // A later reading, then removed: the odometer goes back to the latest one left.
    const r3 = await t.api.post('/api/vehicle-readings', { vehicle_id: ids.bus, read_on: today, odometer_miles: 15500, engine_hours: 900 });
    expect((await t.api.get(`/api/vehicles/${ids.bus}`)).body.odometer_miles).toBe(15500);
    expect((await t.api.del(`/api/vehicle-readings/${r3.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/vehicles/${ids.bus}`)).body.odometer_miles).toBe(13000);
    await t.api.post('/api/vehicle-readings', { vehicle_id: ids.bus, read_on: today, odometer_miles: 15500, engine_hours: 900 });
  });

  it('are added when a person changes the odometer on the vehicle, which cannot go backwards either', async () => {
    const up = await t.api.patch(`/api/vehicles/${ids.bus2}`, { odometer_miles: 2100 });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const rows = (await t.api.get(`/api/vehicle-readings?f.vehicle_id=${ids.bus2}`)).body.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ odometer_miles: 2100, source: 'vehicle_record', read_on: today });
    const down = await t.api.patch(`/api/vehicles/${ids.bus2}`, { odometer_miles: 50 });
    expect(down.status).toBe(400);
    expect((await t.api.get(`/api/vehicles/${ids.bus2}`)).body.odometer_miles).toBe(2100);
  });
});

describe('when each vehicle is next due', () => {
  it('counts from zero and the day it entered service until a service is recorded', async () => {
    const due = (await t.api.get(`/api/fleet/maintenance/due?vehicle=${ids.bus}`)).body;
    const row = due.rows.find((r: Row) => r.interval_id === ids.interval);
    expect(row).toMatchObject({ basis: 'start', next_miles: 6000, current_miles: 15500, miles_left: -9500, state: 'overdue', next_date: addDays(today, -355) });
    expect(due.counts.overdue).toBeGreaterThanOrEqual(1);
  });

  it('counts from the latest service, which also makes a reading', async () => {
    const svc = await t.api.post('/api/maintenance-records', { vehicle_id: ids.bus, interval_id: ids.interval, done_on: addDays(today, -10), odometer_miles: 10000 });
    // 10,000 miles ten days ago is lower than the reading of 13,000 twenty days ago: refused with the reading's rule.
    expect(svc.status).toBe(400);
    expect(svc.body.error.fields.odometer_miles).toMatch(/lower than an earlier reading/);
    const fine = await t.api.post('/api/maintenance-records', { vehicle_id: ids.bus, interval_id: ids.interval, done_on: addDays(today, -5), odometer_miles: 15000 });
    expect(fine.status, JSON.stringify(fine.body)).toBe(201);
    expect(fine.body.ref).toMatch(/^PMR-/);
    expect(fine.body.recorded_by).toBe(adminId);
    const readings = (await t.api.get(`/api/vehicle-readings?f.vehicle_id=${ids.bus}&f.source=maintenance`)).body.rows;
    expect(readings.map((r: Row) => r.odometer_miles)).toContain(15000);
    const row = (await t.api.get(`/api/vehicles/${ids.bus}/maintenance`)).body.due.find((r: Row) => r.interval_id === ids.interval);
    // 15,000 + 6,000 = 21,000, with 15,500 now: 5,500 left; 45 days from five days ago: 40 days left.
    expect(row).toMatchObject({ basis: 'service', last_done_on: addDays(today, -5), next_miles: 21000, miles_left: 5500, days_left: 40, state: 'ok' });
    expect(row.miles_per_day).toBeGreaterThan(0);
  });

  it('refuses a service of an interval that is not for the vehicle\'s model', async () => {
    const tram = (await t.api.post('/api/vehicles', { fleet_number: 'T81', mode: 'light_rail', model_id: ids.other })).body.id;
    const bad = await t.api.post('/api/maintenance-records', { vehicle_id: tram, interval_id: ids.interval, done_on: today });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.interval_id).toBeTruthy();
  });

  it('works out due soon and overdue by miles, hours, days and the rate the vehicle runs at', () => {
    const base = { vehicle_id: 'v', fleet_number: '1', interval_id: 'i', interval: 'Check', last_record_id: 'r', started_on: '2026-01-01' };
    const ok = computeDue({ ...base, every_miles: 6000, last_done_on: '2026-11-01', last_miles: 10000, cur_miles: 12000, miles_read_on: '2026-11-27', rm_first: 8000, rm_first_on: '2026-10-28' }, '2026-11-27');
    // 4,000 miles over 30 days: 4,000 left is 30 days from the last reading.
    expect(ok).toMatchObject({ next_miles: 16000, miles_left: 4000, miles_per_day: 133.3, state: 'ok' });
    expect(ok.due_on).toBe('2026-12-27');
    const soon = computeDue({ ...base, every_hours: 500, last_done_on: '2026-10-01', last_hours: 1000, cur_hours: 1460, hours_read_on: '2026-11-27' }, '2026-11-27');
    expect(soon).toMatchObject({ hours_left: 40, state: 'due_soon' });
    const late = computeDue({ ...base, every_days: 30, warn_days: 3, last_done_on: '2026-10-01' }, '2026-11-27');
    expect(late).toMatchObject({ next_date: '2026-10-31', days_left: -27, state: 'overdue', due_on: '2026-10-31' });
    const unknown = computeDue({ ...base, every_miles: 6000, last_done_on: '2026-10-01' }, '2026-11-27');
    expect(unknown).toMatchObject({ next_miles: null, state: 'ok', due_on: null });
  });
});

describe('due work in My work and the calendar', () => {
  it('lists overdue and due-soon services for the interval\'s planner, and anyone\'s on the calendar', async () => {
    const mine = (await t.api.get('/api/work/mine?limit=50')).body;
    const section = mine.sections.find((s: Row) => s.key === 'fleet.maintenance');
    expect(section, JSON.stringify(mine)).toBeTruthy();
    // Bus 8102 has never been serviced: 45 days from entering service 30 days ago falls within the next 30 days. Bus 8101 is not due yet.
    expect(section.items.map((i: Row) => i.recordId)).toEqual([ids.bus2]);
    const item = section.items[0];
    expect(item).toMatchObject({ recordType: 'vehicle', url: expect.stringContaining('?tab=maintenance') });
    const cal = (await t.api.get(`/api/work/calendar?from=${addDays(today, -300)}&to=${addDays(today, 60)}&person=all&kind=fleet.maintenance`)).body;
    expect(cal.items.length).toBeGreaterThanOrEqual(1);
    // Someone without fleet permissions sees none of it.
    await t.db.query(`insert into roles (key, name, description, enabled, requires_mfa) values ('no_fleet', 'No fleet', 'Test', true, false)`);
    const agent = await t.as('no_fleet');
    expect((await agent.get('/api/work/mine')).body.sections.find((s: Row) => s.key === 'fleet.maintenance')).toBeUndefined();
    expect((await agent.get('/api/fleet/maintenance/due')).status).toBe(403);
  });
});

describe('data load mode', () => {
  it('loads historical readings and services, by the person named', async () => {
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const r = await t.api.post('/api/vehicle-readings', {
      vehicle_id: ids.bus2, read_on: '2025-01-15', odometer_miles: 10, created_at: '2025-01-15T09:00:00Z', on_behalf_of: 'fclerk',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.recorded_by).toBe(former);
    expect(String(r.body.created_at)).toMatch(/^2025-01-15/);
    const s = await t.api.post('/api/maintenance-records', {
      vehicle_id: ids.bus2, interval_id: ids.interval, done_on: '2025-01-15', odometer_miles: 10, on_behalf_of: 'fclerk',
    });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(s.body.recorded_by).toBe(former);
    expect((await t.api.post('/api/admin/data-load', { on: false })).status).toBe(200);
    // The vehicle's odometer is still its latest reading, not the loaded one.
    expect((await t.api.get(`/api/vehicles/${ids.bus2}`)).body.odometer_miles).toBe(2100);
  });
});
