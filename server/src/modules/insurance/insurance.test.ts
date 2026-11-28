import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runInsuranceReminders } from './reminders.ts';
import { seedInsurance } from './seed.ts';

// Insurance (wave 26): policies with conditions, covered records and renewals; certificates of insurance
// checked against contract requirements; restricted claims; figures, the renewal calendar, metrics, My
// work, reminders, data load mode and the area switch. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => { t = await testApp(); }, 120_000);
afterAll(async () => { await t?.close(); });

let vendorId = '';
let contractId = '';
let policyId = '';

describe('policies', () => {
  it('checks terms, limits and dates, and makes the person filing it the owner', async () => {
    const bad = await t.api.post('/api/insurance/policies', {
      title: 'Cyber liability', line: 'cyber', effective_on: '2026-07-01', expires_on: '2026-06-30', limit_per_occurrence: 2000000, limit_aggregate: 1000000, premium: -5,
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['expires_on', 'limit_aggregate', 'premium']);
    const ok = await t.api.post('/api/insurance/policies', {
      title: 'Cyber liability', line: 'cyber', insurer_name: 'Invented Mutual', policy_number: 'CY-1', effective_on: dayInZone(-300), expires_on: dayInZone(60),
      premium: 40000, limit_per_occurrence: 2000000, limit_aggregate: 2000000, deductible: 25000, renewal_application_due: dayInZone(20),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ ref: 'IPL-00001', status: 'active', renewal_status: 'not_started' });
    expect(ok.body.owner_id).toBeTruthy();
    policyId = ok.body.id;
  });

  it('tracks conditions by controls and shows what the control says', async () => {
    const control = await t.api.post('/api/controls', { title: 'Second factor on remote access', next_test_due: dayInZone(-3) });
    expect(control.status, JSON.stringify(control.body)).toBe(201);
    const c = await t.api.post('/api/insurance/conditions', { policy_id: policyId, title: 'Second factor on all remote access', control_id: control.body.id });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.status).toBe('not_assessed');
    await t.api.post('/api/insurance/conditions', { policy_id: policyId, title: 'Offline backups', status: 'not_met' });
    const list = await t.api.get(`/api/insurance/policies/${policyId}/conditions`);
    expect(list.status).toBe(200);
    const tracked = list.body.rows.find((r: Row) => r.title.startsWith('Second'));
    expect(tracked.control).toMatchObject({ title: 'Second factor on remote access', state: 'test_overdue' });
    expect(list.body.rows.find((r: Row) => r.title === 'Offline backups').control).toBeNull();
  });

  it('covers assets, vehicles, sites and systems, and lists the policies covering a record', async () => {
    const site = await t.api.post('/api/sites', { name: 'Invented North Depot' });
    expect(site.status, JSON.stringify(site.body)).toBe(201);
    expect((await t.api.post(`/api/insurance/policies/${policyId}/covered`, { record_type: 'ticket', record_id: site.body.id })).status).toBe(400);
    const add = await t.api.post(`/api/insurance/policies/${policyId}/covered`, { record_type: 'site', record_id: site.body.id, note: 'Buildings and contents' });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect((await t.api.post(`/api/insurance/policies/${policyId}/covered`, { record_type: 'site', record_id: site.body.id })).status).toBe(409);
    const covered = await t.api.get(`/api/insurance/policies/${policyId}/covered`);
    expect(covered.body.rows).toEqual([expect.objectContaining({ record_type: 'site', label: 'Invented North Depot', note: 'Buildings and contents' })]);
    const covering = await t.api.get(`/api/insurance/covering?record_type=site&record_id=${site.body.id}`);
    expect(covering.body.rows.map((r: Row) => r.ref)).toEqual(['IPL-00001']);
    const history = await t.api.get(`/api/history?record_type=insurance_policy&record_id=${policyId}`);
    expect(JSON.stringify(history.body)).toMatch(/Invented North Depot/);
  });

  it('renews into the next term, and closes the old term when the new one is in force', async () => {
    const r = await t.api.post(`/api/insurance/policies/${policyId}/renew`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'draft', replaces_id: policyId, effective_on: dayInZone(61), line: 'cyber' });
    expect((await t.api.get(`/api/insurance/policies/${r.body.id}/conditions`)).body.rows).toHaveLength(2);
    expect((await t.api.get(`/api/insurance/policies/${r.body.id}/covered`)).body.rows).toHaveLength(1);
    expect((await t.api.get(`/api/insurance/policies/${policyId}`)).body.renewal_status).toBe('gathering');
    expect((await t.api.post(`/api/insurance/policies/${policyId}/renew`, {})).status).toBe(409);
    expect((await t.api.patch(`/api/insurance/policies/${r.body.id}`, { status: 'active' })).status).toBe(200);
    expect((await t.api.get(`/api/insurance/policies/${policyId}`)).body).toMatchObject({ status: 'replaced', renewal_status: 'bound' });
  });
});

describe('certificates of insurance against contract requirements', () => {
  beforeAll(async () => {
    vendorId = (await t.api.post('/api/vendors', { name: 'Invented Paving Contractors' })).body.id;
    const k = await t.api.post('/api/contracts', { title: 'Depot resurfacing', vendor_id: vendorId });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    contractId = k.body.id;
  });

  it('flags a missing certificate, then a shortfall, then a certificate that meets the contract', async () => {
    const req = await t.api.post('/api/insurance/requirements', {
      contract_id: contractId, line: 'general_liability', min_per_occurrence: 2000000, min_aggregate: 4000000, additional_insured: true,
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.title).toMatch(/^General liability for /);
    const state = async () => (await t.api.get(`/api/insurance/requirements/${req.body.id}`)).body;
    expect((await state()).state).toBe('missing');

    const short = await t.api.post('/api/insurance/certificates', {
      contract_id: contractId, line: 'general_liability', expires_on: dayInZone(200), limit_per_occurrence: 1000000, limit_aggregate: 4000000,
    });
    expect(short.status, JSON.stringify(short.body)).toBe(201);
    expect(short.body.vendor_id).toBe(vendorId);
    expect(short.body.title).toBe('Invented Paving Contractors: General liability');
    const c1 = (await t.api.get(`/api/insurance/certificates/${short.body.id}`)).body;
    expect(c1.check_result).toBe('short');
    expect(c1.check_notes).toMatch(/limit per occurrence 1,000,000 is below the required 2,000,000; the organization is not named as additional insured/i);
    expect((await state()).state).toBe('short');
    const check = await t.api.get(`/api/insurance/contracts/${contractId}/check`);
    expect(check.body.requirements[0].state).toBe('short');
    expect(check.body.certificates).toHaveLength(1);

    const good = await t.api.post('/api/insurance/certificates', {
      vendor_id: vendorId, contract_id: contractId, line: 'general_liability', expires_on: dayInZone(365), limit_per_occurrence: 2000000, limit_aggregate: 4000000, additional_insured: true,
    });
    expect(good.status).toBe(201);
    expect((await t.api.get(`/api/insurance/certificates/${good.body.id}`)).body.check_result).toBe('meets');
    // The older certificate for the same line is superseded by the newer one.
    expect((await t.api.get(`/api/insurance/certificates/${short.body.id}`)).body.status).toBe('superseded');
    expect((await state()).state).toBe('met');

    // Deleting the certificate that met it brings the shortfall back.
    expect((await t.api.del(`/api/insurance/certificates/${good.body.id}`)).status).toBe(200);
    expect((await state()).state).toBe('missing');
  });

  it('flags an expired certificate, and one with no requirement', async () => {
    const old = await t.api.post('/api/insurance/certificates', {
      contract_id: contractId, line: 'general_liability', effective_on: dayInZone(-400), expires_on: dayInZone(-10), limit_per_occurrence: 5000000, limit_aggregate: 5000000, additional_insured: true,
    });
    expect(old.status).toBe(201);
    expect((await t.api.get(`/api/insurance/certificates/${old.body.id}`)).body.check_result).toBe('expired');
    const other = await t.api.post('/api/insurance/certificates', { vendor_id: vendorId, line: 'pollution', expires_on: dayInZone(100) });
    expect((await t.api.get(`/api/insurance/certificates/${other.body.id}`)).body.check_result).toBe('none');
    expect((await t.api.post('/api/insurance/certificates', { line: 'cyber' })).body.error.fields.vendor_id).toBeTruthy();
  });
});

describe('claims', () => {
  it('starts claims of personal kinds restricted, and only people with restricted access may lift it', async () => {
    const coord = await t.as('insurance_coordinator');
    const injury = await coord.post('/api/insurance/claims', { title: 'Passenger fall', claim_kind: 'bodily_injury', incident_on: dayInZone(-20), reserve: 50000, claimant_name: 'Invented Person' });
    expect(injury.status, JSON.stringify(injury.body)).toBe(201);
    expect(injury.body.restricted).toBe(true);
    expect((await coord.post('/api/insurance/claims', { title: 'Another fall', claim_kind: 'bodily_injury', incident_on: dayInZone(-2), restricted: false })).body.error.fields.restricted).toBeTruthy();
    // The coordinator does not see the restricted claim, but counts it.
    expect((await coord.get(`/api/insurance/claims/${injury.body.id}`)).status).toBe(404);
    const dent = await coord.post('/api/insurance/claims', { title: 'Bus mirror struck', claim_kind: 'vehicle', incident_on: dayInZone(-5), reserve: 3000, paid: 500 });
    expect(dent.body.restricted).toBe(false);
    expect(dent.body.reported_on).toBe(dayInZone(0));
    const theirs = (await coord.get('/api/insurance/summary')).body;
    const mine = (await t.api.get('/api/insurance/summary')).body;
    expect(theirs.claims).toEqual(mine.claims);
    expect(mine.claims).toMatchObject({ open: 2, open_reserves: 53000 });
    // Closing a claim records the day.
    const closed = await coord.patch(`/api/insurance/claims/${dent.body.id}`, { status: 'closed' });
    expect(closed.body.closed_on).toBe(dayInZone(0));
    expect((await t.api.get('/api/insurance/summary')).body.claims.open).toBe(1);
    // An administrator (who sees restricted records) may lift it.
    expect((await t.api.patch(`/api/insurance/claims/${injury.body.id}`, { restricted: false })).body.restricted).toBe(false);
  });
});

describe('figures, calendar, metrics and My work', () => {
  beforeAll(async () => {
    const p = await t.api.post('/api/insurance/policies', { title: 'Auto liability', line: 'auto_liability', effective_on: dayInZone(-340), expires_on: dayInZone(25), renewal_application_due: dayInZone(-2) });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect((await t.api.post('/api/insurance/conditions', { policy_id: p.body.id, title: 'Driver record checks', status: 'not_met', due_on: dayInZone(5) })).status).toBe(201);
  });

  it('gives the summary, the renewal calendar and the metrics', async () => {
    const s = (await t.api.get('/api/insurance/summary')).body;
    expect(s.policies.expiring).toBeGreaterThanOrEqual(1);
    expect(s.conditions.not_met).toBeGreaterThanOrEqual(1);
    const cal = (await t.api.get('/api/insurance/renewals')).body;
    expect(cal.items.map((i: Row) => i.kind)).toEqual(expect.arrayContaining(['policy_expires', 'certificate_expires']));
    const month = dayInZone(0).slice(0, 7);
    const metrics = (await t.api.get(`/api/metrics?month=${month}`)).body;
    const list = Array.isArray(metrics) ? metrics : metrics.metrics;
    const keys = list.map((m: Row) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['insurance.policies_expiring', 'insurance.certificates_expired', 'insurance.open_claims', 'insurance.open_reserves']));
    expect(list.find((m: Row) => m.key === 'insurance.open_claims').value).toBe(1);
  });

  it('puts renewals in the owner\'s My work', async () => {
    const work = (await t.api.get('/api/work/mine?days=120&limit=50')).body;
    const kinds = work.sections.map((s: Row) => s.key ?? s.kind);
    expect(JSON.stringify(kinds)).toMatch(/insurance\.renewals/);
  });

  it('reminds owners once per step', async () => {
    const a = await runInsuranceReminders({ app: t.app, db: t.db, resources: t.ctx.resources, settings: t.ctx.settings } as never);
    expect(a.sent).toBeGreaterThan(0);
    const b = await runInsuranceReminders({ app: t.app, db: t.db, resources: t.ctx.resources, settings: t.ctx.settings } as never);
    expect(b.sent).toBe(0);
  });

  it('changes the reminder steps', async () => {
    expect((await t.api.put('/api/insurance/settings', { renewal: [400] })).status).toBe(400);
    expect((await t.api.put('/api/insurance/settings', { renewal: [120, 30, 30] })).status).toBe(400);
    expect((await t.api.put('/api/insurance/settings', { renewal: [30, 120] })).status).toBe(200);
    expect((await t.api.get('/api/insurance/settings')).body.renewal.value).toEqual([120, 30]);
  });
});

describe('data load mode', () => {
  it('loads past policies and closed claims with their own dates and statuses', async () => {
    await loadMode(true);
    const p = await t.api.post('/api/insurance/policies', {
      title: 'Property 2019', line: 'property', status: 'expired', renewal_status: 'bound', effective_on: '2019-07-01', expires_on: '2020-06-30', created_at: '2019-06-20T10:00:00Z',
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body).toMatchObject({ status: 'expired', renewal_status: 'bound' });
    const c = await t.api.post('/api/insurance/claims', {
      title: 'Hail damage 2019', claim_kind: 'property_damage', policy_id: p.body.id, status: 'closed', incident_on: '2019-08-02', closed_on: '2020-01-15', paid: 12000,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body).toMatchObject({ status: 'closed', closed_on: '2020-01-15', reported_on: null });
    const cert = await t.api.post('/api/insurance/certificates', { vendor_id: vendorId, line: 'auto_liability', expires_on: '2020-01-01', status: 'accepted' });
    expect(cert.body.received_on).toBeNull();
    await loadMode(false);
  });
});

describe('the area switch and the sample data', () => {
  it('answers switched off while the area is off', async () => {
    expect((await t.api.patch('/api/admin/features', { features: { insurance: false } })).status).toBe(200);
    const off = await t.api.get('/api/insurance/summary');
    expect([off.status, off.body.error.code]).toEqual([404, 'switched_off']);
    expect((await t.api.get('/api/meta')).body.resources.insurance_policy).toBeUndefined();
    expect((await t.api.patch('/api/admin/features', { features: { insurance: true } })).status).toBe(200);
    // System work after a switch is applied once a request has read the new state (core/features.ts applyOptions).
    expect((await t.api.get('/api/meta')).body.resources.insurance_condition.fields.policy_id).toBeTruthy();
    const again = await t.api.post('/api/insurance/conditions', { policy_id: policyId, title: 'After the switch' });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.policy_id).toBe(policyId);
  });

  it('loads sample records in the dev profile only', async () => {
    const ctx = t.ctx as never;
    expect(await seedInsurance(ctx, { profile: 'pilot', seedDir: '', organization: {} } as never)).toMatch(/nothing/);
    const msg = await seedInsurance(ctx, { profile: 'dev', seedDir: '', organization: {} } as never);
    expect(msg).toMatch(/insurance policies 5/);
    expect(await seedInsurance(ctx, { profile: 'dev', seedDir: '', organization: {} } as never)).toMatch(/insurance policies 0, claims 0/);
  });
});
