import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Options within areas (E18-28): features that suit some transit organizations but not all can be
// switched off or renamed. Off hides the fields everywhere and stops the rule; data is kept.
let t: Awaited<ReturnType<typeof testApp>>;
const setOptions = (options: Record<string, { on?: boolean; name?: string }>) => t.api.patch('/api/admin/features', { options });
const meta = async () => (await t.api.get('/api/meta')).body;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('options within areas', () => {
  it('start on, with their default names, so an upgrade changes nothing', async () => {
    const page = (await t.api.get('/api/admin/features')).body;
    expect(page.options.map((o: any) => [o.key, o.on, o.name])).toEqual([
      ['funder_interest', true, 'Funder interest'],
      ['contract_approval_number', true, 'Approval or resolution number'],
      ['ransom_approval', true, 'Governing body approval reference'],
    ]);
    expect(page.options[0]).toMatchObject({ area: null, group: 'Inventory', defaultOn: true, defaultName: 'Funder interest' });
    expect(page.options[1]).toMatchObject({ area: 'vendors', group: 'Vendors and contracts' });
    const m = await meta();
    expect(m.resources.asset.fields.funder_interest.label).toBe('Funder interest');
    expect(m.resources.asset.fields.funder_interest_pct.label).toBe('Funder interest (%)');
    expect(m.resources.contract.fields.resolution_number.label).toBe('Approval or resolution number');
    expect(m.resources.security_incident.fields.board_resolution_ref.label).toBe('Governing body approval reference');
  });

  it('refuses unknown options and unsafe names', async () => {
    expect((await setOptions({ teleporter: { on: false } })).status).toBe(400);
    expect((await setOptions({ funder_interest: { on: 'no' as any } })).status).toBe(400);
    expect((await setOptions({ funder_interest: { name: 'x'.repeat(61) } })).status).toBe(400);
    expect((await setOptions({ funder_interest: { name: '<b>Grant</b>' } })).status).toBe(400);
    expect((await t.api.patch('/api/admin/features', { options: ['funder_interest'] })).status).toBe(400);
  });

  it('renames fields everywhere: metadata, exports, imports and the API description', async () => {
    const res = await setOptions({ contract_approval_number: { name: '  Board   resolution ' }, funder_interest: { name: 'Grant interest' } });
    expect(res.status).toBe(200);
    expect(res.body.optionsChanged).toEqual(['funder_interest', 'contract_approval_number']);
    expect(res.body.options[1].name).toBe('Board resolution');
    const m = await meta();
    expect(m.resources.contract.fields.resolution_number.label).toBe('Board resolution');
    expect(m.resources.asset.fields.funder_interest_pct.label).toBe('Grant interest (%)');
    expect(m.resources.vehicle?.fields.funder_interest.label ?? 'Grant interest').toBe('Grant interest');

    const vendor = (await t.api.post('/api/vendors', { name: 'Invented Signals Ltd' })).body.id;
    await t.api.post('/api/contracts', { title: 'Invented radio support', vendor_id: vendor, resolution_number: 'R-0001' });
    const csv = (await t.api.get('/api/contracts?format=csv&columns=title,resolution_number')).text;
    expect(csv).toContain('Board resolution');
    expect(csv).toContain('R-0001');
    const fields = (await t.api.get('/api/import/contract/fields')).body;
    expect(JSON.stringify(fields)).toContain('Board resolution');
    const report = (await t.api.get('/api/inventory/reports/assets-by-site')).body;
    expect(report.columns.find((c: any) => c.key === 'funder_interest').label).toBe('With grant interest');

    const audit = await t.db.one<any>(`select summary from audit_events where action = 'features.option_change' order by id desc limit 1`);
    expect(audit.summary).toContain('renamed "Board resolution"');

    // An empty name goes back to the default.
    await setOptions({ contract_approval_number: { name: '' } });
    expect((await meta()).resources.contract.fields.resolution_number.label).toBe('Approval or resolution number');
  });

  it('switching the funder interest off hides its fields and stops its disposal rule; the values are kept', async () => {
    const asset = (await t.api.post('/api/assets', { name: 'Invented depot switch', funder_interest: true, funder_interest_pct: 80, status: 'retired' })).body;
    const approval = { disposal_approved_by: 'Pat Example', disposal_approved_on: '2026-11-01' };
    expect((await t.api.post(`/api/assets/${asset.id}/dispose`, approval)).body.error.code).toBe('funder_interest_block');

    expect((await setOptions({ funder_interest: { on: false } })).status).toBe(200);
    const m = await meta();
    expect(m.resources.asset.fields.funder_interest).toBeUndefined();
    expect(m.resources.asset.fields.funder_interest_pct).toBeUndefined();
    expect(m.resources.asset.fields.name).toBeTruthy();
    if (m.resources.vehicle) expect(m.resources.vehicle.fields.funder_interest).toBeUndefined();
    const importFields = JSON.stringify((await t.api.get('/api/import/asset/fields')).body);
    expect(importFields).not.toContain('funder_interest');
    const report = (await t.api.get('/api/inventory/reports/assets-by-site')).body;
    expect(report.columns.map((c: any) => c.key)).not.toContain('funder_interest');
    expect((await t.api.get('/api/inventory/reports/assets-by-site?format=csv')).text).not.toContain('interest');
    const schemas = (await t.api.get('/api/openapi.json')).body.components.schemas;
    expect(Object.keys(schemas.Asset.properties)).not.toContain('funder_interest_pct');
    expect(Object.keys(schemas.Asset.properties)).toContain('name');

    // A value written while off is ignored; the disposal goes ahead without a funder reference.
    const other = (await t.api.post('/api/assets', { name: 'Invented spare', funder_interest: true })).body;
    expect((await t.db.one<any>('select funder_interest from assets where id = $1', [other.id])).funder_interest).toBe(false);
    const done = await t.api.post(`/api/assets/${asset.id}/dispose`, approval);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('disposed');

    // Switched back on: the stored value is there again, and the rule applies to the next asset.
    await setOptions({ funder_interest: { on: true } });
    expect((await t.api.get(`/api/assets/${asset.id}`)).body.funder_interest).toBe(true);
    expect((await meta()).resources.asset.fields.funder_interest.label).toBe('Grant interest');
    const third = (await t.api.post('/api/assets', { name: 'Invented router', funder_interest: true, status: 'retired' })).body;
    expect((await t.api.post(`/api/assets/${third.id}/dispose`, approval)).body.error.code).toBe('funder_interest_block');
  });

  it('switching the ransom approval off lets a payment be marked approved without a reference', async () => {
    const made = await t.api.post('/api/security-incidents', { title: 'Test incident: invented ransom note' });
    expect(made.status).toBe(201);
    const blocked = await t.api.patch(`/api/security-incidents/${made.body.id}`, { ransom_payment_status: 'approved' });
    expect(blocked.status).toBe(400);
    await setOptions({ ransom_approval: { name: 'Owner approval reference' } });
    const renamed = await t.api.patch(`/api/security-incidents/${made.body.id}`, { ransom_payment_status: 'approved' });
    expect(renamed.body.error.fields.board_resolution_ref).toBe('Enter the owner approval reference before marking the ransom payment approved.');

    await setOptions({ ransom_approval: { on: false } });
    expect((await meta()).resources.security_incident.fields.board_resolution_ref).toBeUndefined();
    const ok = await t.api.patch(`/api/security-incidents/${made.body.id}`, { ransom_payment_status: 'approved' });
    expect(ok.status).toBe(200);
    expect(ok.body.ransom_payment_status).toBe('approved');
    await setOptions({ ransom_approval: { on: true, name: '' } });
  });

  it('an option of a switched-off area counts as off', async () => {
    await t.api.patch('/api/admin/features', { features: { vendors: false } });
    const page = (await t.api.get('/api/admin/features')).body;
    expect(page.options.find((o: any) => o.key === 'contract_approval_number').on).toBe(true);
    expect((await meta()).resources.contract).toBeUndefined();
    await t.api.patch('/api/admin/features', { features: { vendors: true } });
    expect((await meta()).resources.contract.fields.resolution_number).toBeTruthy();
  });
});
