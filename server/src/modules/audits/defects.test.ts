import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { addDays } from './dates.ts';

// Wave 26 (E46): defects raised from inspections of vehicles, sites and assets, their workflow and the
// vehicle's out-of-service state; missed inspections followed up (reason, reschedule, action); the
// figures needing attention and inspections in My work. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;
let pm: Client;
let today = dayInZone();
// Worked out again before each test, so a run that crosses midnight compares with the day the server uses.
beforeEach(() => { today = dayInZone(); });
let vehicleId = '';
let siteId = '';

beforeAll(async () => {
  process.env.GRC_MODULES = 'audits,inventory,fleet,risks,workflows,notifications,attachments,work,admin';
  t = await testApp();
  lead = await t.as('audit_lead');
  pm = await t.as('project_manager');
  siteId = (await t.api.post('/api/sites', { name: 'Invented Depot South' })).body.id;
  const v = await t.api.post('/api/vehicles', { fleet_number: 'X-4101', mode: 'bus', depot_id: siteId });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  vehicleId = v.body.id;
}, 60_000);
afterAll(async () => { delete process.env.GRC_MODULES; await t?.close(); });

async function template(items: { prompt: string; critical?: boolean }[], target: string) {
  const tpl = await t.api.post('/api/checklist-templates', { name: `Invented checklist ${Math.random().toString(36).slice(2, 7)}`, kind: 'inspection', target_type: target });
  expect(tpl.status).toBe(201);
  const put = await t.api.put(`/api/checklist-templates/${tpl.body.id}/items`, { items });
  return { id: tpl.body.id as string, items: put.body.items as { id: string; prompt: string }[] };
}

describe('defects from inspections', () => {
  it('raises a defect for each item not met, and a safety-critical one takes the vehicle out of service', async () => {
    const tpl = await template([{ prompt: 'Brakes hold on the test slope', critical: true }, { prompt: 'Interior lights work' }, { prompt: 'Destination sign readable' }], 'vehicle');
    const ins = await t.api.post('/api/inspections', { template_id: tpl.id, target_type: 'vehicle', target_id: vehicleId, due_on: today });
    expect(ins.status, JSON.stringify(ins.body)).toBe(201);
    await t.api.put(`/api/inspections/${ins.body.id}/responses`, { responses: [
      { item_id: tpl.items[0].id, answer: 'no', note: 'Rolled back on the slope.' },
      { item_id: tpl.items[1].id, answer: 'no' },
      { item_id: tpl.items[2].id, answer: 'yes' },
    ] });
    const done = await t.api.post(`/api/inspections/${ins.body.id}/complete`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const list = await t.api.get(`/api/defects?f.inspection_id=${ins.body.id}`);
    expect(list.body.total).toBe(2);
    const brakes = list.body.rows.find((d: Row) => d.title.startsWith('Brakes'));
    expect(brakes.severity).toBe('safety_critical');
    expect(brakes.out_of_service).toBe(true);
    expect(brakes.description).toBe('Rolled back on the slope.');
    expect(brakes.target_label).toContain('X-4101');
    expect((await t.api.get(`/api/vehicles/${vehicleId}`)).body.status).toBe('out_of_service');
    // Raising again finds nothing new.
    expect((await t.api.post(`/api/inspections/${ins.body.id}/defects`, {})).body.raised).toBe(0);
    const history = await t.api.get(`/api/inspection-history/vehicle/${vehicleId}`);
    expect(history.status).toBe(200);
    expect(history.body.out_of_service).toBe(true);
    expect(history.body.counts.open).toBe(2);
    expect(history.body.inspections.map((i: Row) => i.id)).toContain(ins.body.id);
    expect((await pm.get(`/api/inspection-history/vehicle/${vehicleId}`)).status).toBe(403);
  });

  it('follows the workflow: deferral needs a reason and is refused when out of service; another person verifies', async () => {
    const d = await t.api.post('/api/defects', { title: 'Invented cracked mirror housing', target_type: 'vehicle', target_id: vehicleId, severity: 'minor' });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body.status).toBe('open');
    expect(d.body.out_of_service).toBe(false);
    expect(d.body.found_on).toBe(today);
    const defer = await t.api.patch(`/api/defects/${d.body.id}`, { status: 'deferred' });
    expect(defer.status).toBe(400);
    expect(Object.keys(defer.body.error.fields).sort()).toEqual(['deferral_reason', 'deferred_until']);
    expect((await t.api.patch(`/api/defects/${d.body.id}`, { status: 'deferred', deferral_reason: 'Cosmetic; parts on order.', deferred_until: addDays(today, 30) })).status).toBe(200);
    expect((await t.api.patch(`/api/defects/${d.body.id}`, { status: 'verified' })).status).toBe(400);
    const repaired = await t.api.patch(`/api/defects/${d.body.id}`, { status: 'repaired', work_order_ref: 'WO-INV-7' });
    expect(repaired.status).toBe(200);
    expect(repaired.body.repaired_on).toBe(today);
    expect(repaired.body.repaired_by).toBeTruthy();
    // The person who repaired it cannot verify it.
    const self = await t.api.patch(`/api/defects/${d.body.id}`, { status: 'verified' });
    expect(self.status).toBe(400);
    expect(self.body.error.fields.status).toMatch(/Someone other/);
    const verified = await lead.patch(`/api/defects/${d.body.id}`, { status: 'verified' });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.verified_on).toBe(today);
    expect((await t.api.patch(`/api/defects/${d.body.id}`, { status: 'open' })).status).toBe(400);

    const critical = await t.api.post('/api/defects', { title: 'Invented fire suppression fault', target_type: 'site', target_id: siteId, severity: 'safety_critical' });
    expect(critical.body.out_of_service).toBe(true);
    const refused = await t.api.patch(`/api/defects/${critical.body.id}`, { status: 'deferred', deferral_reason: 'Later.', deferred_until: addDays(today, 5) });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.status).toMatch(/out of service/);
    expect((await t.api.post('/api/defects', { title: 'Invented', target_type: 'system', target_id: siteId })).status).toBe(400);
    expect((await t.api.post('/api/defects', { title: 'Invented', target_type: 'vehicle', target_id: siteId })).status).toBe(400);
  });

  it('shows open defects in My work for their owner', async () => {
    const me = (await lead.get('/api/auth/state')).body.user.id;
    await t.api.post('/api/defects', { title: 'Invented wiper blade torn', target_type: 'vehicle', target_id: vehicleId, owner_id: me });
    const work = await lead.get(`/api/work/mine`);
    expect(work.status).toBe(200);
    expect(JSON.stringify(work.body)).toContain('Invented wiper blade torn');
  });
});

describe('missed inspections', () => {
  it('records why, reschedules as a new inspection and raises a follow-up action', async () => {
    const tpl = await template([{ prompt: 'Platform edge markings visible' }], 'site');
    const ins = await t.api.post('/api/inspections', { template_id: tpl.id, target_type: 'site', target_id: siteId, due_on: addDays(today, -10) });
    expect(ins.status).toBe(201);
    const fresh = await t.api.post('/api/inspections', { template_id: tpl.id, target_type: 'site', target_id: siteId, due_on: addDays(today, 3) });
    expect((await t.api.post(`/api/inspections/${fresh.body.id}/missed-reason`, { reason: 'x' })).body.error.code).toBe('not_missed');
    expect((await t.api.post(`/api/inspections/${ins.body.id}/missed-reason`, {})).status).toBe(400);
    const attention = await t.api.get('/api/inspections/attention');
    expect(attention.status).toBe(200);
    expect(attention.body.inspections.overdue).toBeGreaterThanOrEqual(1);
    expect(attention.body.inspections.due_soon).toBeGreaterThanOrEqual(1);

    const reason = await lead.post(`/api/inspections/${ins.body.id}/missed-reason`, { reason: 'Inspector off sick; nobody covered.' });
    expect(reason.status, JSON.stringify(reason.body)).toBe(200);
    expect(reason.body.status).toBe('missed');
    expect(reason.body.missed_reason_on).toBe(today);
    expect(reason.body.missed_reason_by).toBeTruthy();

    expect((await t.api.post(`/api/inspections/${ins.body.id}/reschedule`, { due_on: addDays(today, -1) })).status).toBe(400);
    const again = await lead.post(`/api/inspections/${ins.body.id}/reschedule`, { due_on: addDays(today, 2) });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.status).toBe('scheduled');
    expect(again.body.rescheduled_from_id).toBe(ins.body.id);
    const old = (await t.api.get(`/api/inspections/${ins.body.id}`)).body;
    expect(old.rescheduled_to_id).toBe(again.body.id);
    expect(old.status).toBe('missed');
    expect((await t.api.post(`/api/inspections/${ins.body.id}/reschedule`, { due_on: addDays(today, 4) })).body.error.code).toBe('already_rescheduled');

    const action = await lead.post(`/api/inspections/${ins.body.id}/follow-up`, {});
    expect(action.status, JSON.stringify(action.body)).toBe(201);
    expect(action.body.source_type).toBe('inspection');
    expect(action.body.source_id).toBe(ins.body.id);
    expect(action.body.description).toContain('off sick');
    expect((await pm.post(`/api/inspections/${ins.body.id}/follow-up`, {})).status).toBe(403);
  });

  it('lists the inspector\'s missed inspections not yet followed up in My work', async () => {
    const me = (await lead.get('/api/auth/state')).body.user.id;
    const tpl = await template([{ prompt: 'Fire exits clear' }], 'site');
    const ins = await t.api.post('/api/inspections', { template_id: tpl.id, target_type: 'site', target_id: siteId, due_on: addDays(today, -20), inspector_id: me });
    await t.db.query(`update inspections set status = 'missed' where id = $1`, [ins.body.id]);
    const text = `Missed inspection, record why or reschedule: ${ins.body.ref}`;
    expect(JSON.stringify((await lead.get('/api/work/mine')).body)).toContain(text);
    await lead.post(`/api/inspections/${ins.body.id}/missed-reason`, { reason: 'Site closed for resurfacing.' });
    expect(JSON.stringify((await lead.get('/api/work/mine')).body)).not.toContain(text);
  });

  it('honors data load mode: the named person and the given date', async () => {
    const former = (await t.db.one<{ id: string }>(
      `insert into users (username, email, display_name, status) values ('pinspect', 'p.inspect@example.test', 'Pat Inspector', 'disabled') returning id`))!.id;
    const tpl = await template([{ prompt: 'Lighting adequate' }], 'site');
    const ins = await t.api.post('/api/inspections', { template_id: tpl.id, target_type: 'site', target_id: siteId, due_on: '2024-02-01' });
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    try {
      const res = await t.api.post(`/api/inspections/${ins.body.id}/missed-reason`, { reason: 'Depot closed for works.', missed_reason_on: '2024-02-09', on_behalf_of: 'pinspect' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.missed_reason_by).toBe(former);
      expect(res.body.missed_reason_on).toBe('2024-02-09');
      const d = await t.api.post('/api/defects', {
        title: 'Invented loaded defect', target_type: 'site', target_id: siteId, status: 'verified', found_on: '2024-01-10',
        repaired_on: '2024-01-20', verified_on: '2024-01-22', verified_by: former, on_behalf_of: 'pinspect',
      });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      expect(d.body.status).toBe('verified');
      expect(d.body.verified_on).toBe('2024-01-22');
      expect(d.body.verified_by).toBe(former);
    } finally {
      await t.api.post('/api/admin/data-load', { on: false });
    }
  });
});
