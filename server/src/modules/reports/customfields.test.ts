// E18-45: custom fields on saved reports, dashboards, report schedules and report packs. An
// administrator adds them under Administration > Custom fields; the reporting routes save and
// validate them like any other record type's, and a required one is asked for.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { seedStandard } from './seed.ts';
import { fixtureModule, loadFixture } from './testing.ts';

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtureModule] });
  const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await loadFixture(t.ctx, admin);
});
afterAll(async () => { await t.close(); });

const field = async (record_type: string, label: string, key: string, required = true) => {
  const r = await t.api.post('/api/admin/custom-fields', { record_type, label, key, type: 'text', required });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

describe('custom fields on reporting records (E18-45)', () => {
  it('offers the four reporting record types under Administration > Custom fields', async () => {
    const r = await t.api.get('/api/admin/custom-fields');
    const types = r.body.recordTypes.map((x: { type: string; label: string }) => `${x.type}:${x.label}`);
    expect(types).toEqual(expect.arrayContaining([
      'report_definition:Report', 'dashboard:Dashboard', 'report_schedule:Report schedule', 'report_pack:Report pack',
    ]));
  });

  it('refuses a report, dashboard, schedule or pack without a required custom field, beside the field, and saves the value', async () => {
    await field('report_definition', 'Audience', 'audience');
    await field('dashboard', 'Screen location', 'screen');
    await field('report_schedule', 'Cost center', 'cost_center');
    await field('report_pack', 'Meeting', 'meeting');

    const spec = { type: 'rt_thing', groupBy: [{ field: 'status' }] };
    const noReport = await t.api.post('/api/reports', { name: 'Things by status', spec });
    expect(noReport.status).toBe(400);
    expect(noReport.body.error.fields).toEqual({ cf_audience: 'Audience is required.' });
    const report = await t.api.post('/api/reports', { name: 'Things by status', spec, cf_audience: 'Depot managers' });
    expect(report.status, JSON.stringify(report.body)).toBe(201);
    expect((await t.api.get(`/api/reports/${report.body.id}`)).body.cf_audience).toBe('Depot managers');
    // Changing something else does not ask again; emptying the field is refused.
    expect((await t.api.patch(`/api/reports/${report.body.id}`, { name: 'Things, by status' })).status).toBe(200);
    expect((await t.api.patch(`/api/reports/${report.body.id}`, { cf_audience: '' })).body.error.fields).toEqual({ cf_audience: 'Audience is required.' });

    const dash = { name: 'Garage screen', widgets: [], filters: [] };
    expect((await t.api.post('/api/dashboards', dash)).body.error.fields).toEqual({ cf_screen: 'Screen location is required.' });
    const d = await t.api.post('/api/dashboards', { ...dash, cf_screen: 'North garage' });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect((await t.api.get(`/api/dashboards/${d.body.id}`)).body.cf_screen).toBe('North garage');

    const me = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    const schedule = { name: 'Weekly', target_type: 'report', target_id: report.body.id, cadence: 'weekly', weekday: 1, hour: 7, format: 'html', recipient_users: [me] };
    expect((await t.api.post('/api/report-schedules', schedule)).body.error.fields).toEqual({ cf_cost_center: 'Cost center is required.' });
    const s = await t.api.post('/api/report-schedules', { ...schedule, cf_cost_center: 'Operations' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(s.body.cf_cost_center).toBe('Operations');

    const pack = { name: 'Monthly pack', sections: [{ kind: 'report', reportId: report.body.id }] };
    expect((await t.api.post('/api/report-packs', pack)).body.error.fields).toEqual({ cf_meeting: 'Meeting is required.' });
    const p = await t.api.post('/api/report-packs', { ...pack, cf_meeting: 'Safety committee' });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect((await t.api.get(`/api/report-packs/${p.body.id}`)).body.cf_meeting).toBe('Safety committee');

    // The values are part of each record's history.
    const history = await t.api.get(`/api/history?record_type=report_definition&record_id=${report.body.id}`);
    expect(JSON.stringify(history.body)).toContain('Depot managers');
  });

  it('still seeds the standard items: "required" applies to people, not to system work', async () => {
    expect(await seedStandard(t.ctx)).toMatch(/^7 dashboards, \d+ reports, 1 packs added$/);
    // A person changing a standard item without the value is asked for it only if they empty it.
    const std = (await t.api.get('/api/dashboards?pageSize=100')).body.rows.find((d: any) => d.key);
    expect((await t.api.patch(`/api/dashboards/${std.id}`, { name: 'Renamed' })).status).toBe(200);
  });
});
