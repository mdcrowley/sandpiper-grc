import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { TEMPLATES } from './templates.ts';

// Register templates (wave 26): labor agreements and real property, created in one click by an
// administrator, never by themselves; invented and jurisdiction-neutral.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => { t = await testApp(); }, 120_000);
afterAll(async () => { await t?.close(); });

describe('register templates', () => {
  it('creates nothing until asked, and lists the templates for administrators only', async () => {
    expect((await t.api.get('/api/admin/registers')).body.registers).toEqual([]);
    const list = await t.api.get('/api/admin/registers/templates');
    expect(list.status).toBe(200);
    expect(list.body.templates.map((x: any) => x.key)).toEqual(['labor_agreements', 'real_property']);
    expect(list.body.templates[0]).toMatchObject({ plural: 'Labor agreements', prefix: 'LA-', made: false });
    const agent = await t.as('agent');
    expect((await agent.get('/api/admin/registers/templates')).status).toBe(403);
    expect((await agent.post('/api/admin/registers/templates/labor_agreements', {})).status).toBe(403);
    expect((await t.api.post('/api/admin/registers/templates/nothing', {})).status).toBe(400);
  });

  it('makes a labor agreements register with its statuses and fields, linking positions and documents', async () => {
    const made = await t.api.post('/api/admin/registers/templates/labor_agreements', {});
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ key: 'labor_agreements', prefix: 'LA-', nav_group: 'People and training', state: 'ready' });
    const meta = (await t.api.get('/api/meta')).body;
    const def = meta.resources.reg_labor_agreements;
    expect(def.fields.title.label).toBe('Agreement');
    expect(def.fields.cf_covered_position).toMatchObject({ type: 'ref', to: 'position' });
    expect(def.fields.cf_grievance_document).toMatchObject({ type: 'ref', to: 'policy' });
    expect(def.fields.cf_term_end.type).toBe('date');
    expect(meta.lookups.register_labor_agreements_status.map((v: any) => v.value)).toEqual(['negotiating', 'in_effect', 'expired', 'superseded']);
    // Records take the template's fields and its first status.
    const pos = await t.api.post('/api/positions', { name: 'Bus operator' });
    expect(pos.status, JSON.stringify(pos.body)).toBe(201);
    const rec = await t.api.post('/api/registers/labor_agreements', {
      title: 'Operators agreement', cf_bargaining_unit: 'Invented Workers Local 1', cf_term_start: '2026-07-01', cf_term_end: '2029-06-30', cf_covered_position: pos.body.id,
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(rec.body).toMatchObject({ ref: 'LA-00001', status: 'negotiating', cf_term_end: '2029-06-30' });
    expect((await t.api.get(`/api/registers/labor_agreements/${rec.body.id}`)).body._display.cf_covered_position).toBe('Bus operator');
    // The fields were added as the administrator, each with its audit entry.
    const audit = await t.db.query<{ summary: string }>(`select summary from audit_events where action in ('custom_field.create', 'register.template')`);
    expect(audit.some((a) => /Register "Labor agreements" made from the template/.test(a.summary))).toBe(true);
    expect(audit.filter((a) => /added to labor agreements/i.test(a.summary)).length).toBe(TEMPLATES[0].fields.length);
  });

  it('makes a real property register with choices, amounts and a linked site', async () => {
    const made = await t.api.post('/api/admin/registers/templates/real_property', {});
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(['parcel_ref', 'acquisition_method', 'appraised_value', 'disposed_on']));
    const site = await t.api.post('/api/sites', { name: 'Invented East Yard' });
    const rec = await t.api.post('/api/registers/real_property', {
      title: 'East yard', site_id: site.body.id, cf_acquisition_method: 'purchase', cf_appraised_value: 2500000, cf_condition: 'good', status: 'surplus',
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(rec.body).toMatchObject({ ref: 'RP-00001', status: 'surplus', cf_acquisition_method: 'purchase' });
    expect((await t.api.post('/api/registers/real_property', { title: 'X', cf_condition: 'ruined' })).status).toBe(400);
  });

  it('refuses a second one under the same names, and makes one under others', async () => {
    const again = await t.api.post('/api/admin/registers/templates/real_property', {});
    expect(again.status).toBe(400);
    expect(Object.keys(again.body.error.fields)).toEqual(expect.arrayContaining(['key', 'prefix']));
    const second = await t.api.post('/api/admin/registers/templates/real_property', { key: 'leased_property', plural: 'Leased property', label: 'Leased property', prefix: 'LP2' });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect((await t.api.get('/api/admin/registers/templates')).body.templates.find((x: any) => x.key === 'real_property').made).toBe(true);
    // "templates" is not a register key: its address is taken by the templates.
    expect((await t.api.post('/api/admin/registers', { key: 'templates', label: 'T', plural: 'T', prefix: 'TT' })).body.error.fields.key).toMatch(/used by the application/);
  });
});
