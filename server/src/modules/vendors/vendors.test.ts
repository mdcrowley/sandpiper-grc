import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { classifyClauseText, worstStatus } from './clauses.ts';
import { addDays, localDate, noticeDate } from './dates.ts';
import { runContractReminders, type FiredReminder } from './reminders.ts';

// Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const today = localDate();

describe('vendors', () => {
  let vendorId: string;

  it('creates, updates and audits a vendor', async () => {
    const made = await t.api.post('/api/vendors', { name: 'Alder Works Ltd', services: 'Widget hosting', criticality: 'high' });
    expect(made.status).toBe(201);
    expect(made.body.ref).toBe('VND-00001');
    expect(made.body.status).toBe('active');
    expect(made.body._display.criticality).toBe('High');
    vendorId = made.body.id;

    const dup = await t.api.post('/api/vendors', { name: 'alder works ltd' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.fields.name).toMatch(/already exists/);

    const upd = await t.api.patch(`/api/vendors/${vendorId}`, { criticality: 'critical' });
    expect(upd.body.criticality).toBe('critical');
    const history = await t.api.get(`/api/history?record_type=vendor&record_id=${vendorId}`);
    expect(history.body.map((h: any) => h.action)).toEqual(['vendor.update', 'vendor.create']);
    expect(history.body[0].after).toEqual({ criticality: 'critical' });
  });

  it('manages contacts with an audit trail', async () => {
    const bad = await t.api.post(`/api/vendors/${vendorId}/contacts`, { email: 'nope' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['email', 'name']);

    const made = await t.api.post(`/api/vendors/${vendorId}/contacts`, {
      name: 'Rowan Pike', role: 'Support lead', email: 'rowan@alder.example', is_incident_contact: true,
    });
    expect(made.status).toBe(201);
    const upd = await t.api.patch(`/api/vendors/${vendorId}/contacts/${made.body.id}`, { phone: '555-0199' });
    expect(upd.body.phone).toBe('555-0199');
    expect((await t.api.get(`/api/vendors/${vendorId}/contacts`)).body).toHaveLength(1);
    expect((await t.api.del(`/api/vendors/${vendorId}/contacts/${made.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/vendors/${vendorId}/contacts`)).body).toHaveLength(0);

    const actions = (await t.api.get(`/api/history?record_type=vendor&record_id=${vendorId}`)).body.map((h: any) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['vendor.contact_add', 'vendor.contact_update', 'vendor.contact_remove']));
  });

  it('lets an agent read but not change vendors', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/vendors')).status).toBe(200);
    expect((await agent.post('/api/vendors', { name: 'Nope' })).status).toBe(403);
    expect((await agent.post(`/api/vendors/${vendorId}/contacts`, { name: 'Nope' })).status).toBe(403);
  });

  it('soft-deletes', async () => {
    const made = await t.api.post('/api/vendors', { name: 'Doomed Supplies' });
    expect((await t.api.del(`/api/vendors/${made.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/vendors/${made.body.id}`)).status).toBe(404);
  });
});

describe('contracts and the notice date', () => {
  let vendorId: string;
  let contractId: string;

  beforeAll(async () => {
    vendorId = (await t.api.post('/api/vendors', { name: 'Birchfield Systems', criticality: 'medium' })).body.id;
  });

  it('computes pure dates', () => {
    expect(noticeDate('2031-03-01', 60)).toBe('2030-12-31');
    expect(noticeDate('2031-03-01', null)).toBe('2031-03-01');
    expect(noticeDate(null, 60)).toBeNull();
    expect(addDays('2032-02-28', 2)).toBe('2032-03-01');
  });

  it('computes the notice date on create and ignores a supplied one', async () => {
    const made = await t.api.post('/api/contracts', {
      title: 'Birchfield license', vendor_id: vendorId, start_date: '2030-01-01', end_date: '2030-12-31',
      notice_days: 90, notice_date: '1999-01-01', total_value: '12,500', value_by_year: { 2030: 12500 },
    });
    expect(made.status).toBe(201);
    expect(made.body.ref).toBe('CON-00001');
    expect(made.body.notice_date).toBe('2030-10-02');
    expect(made.body.total_value).toBe(12500);
    expect(made.body._display.vendor_id).toBe('Birchfield Systems');
    contractId = made.body.id;
  });

  it('recomputes on update and records it in history', async () => {
    const a = await t.api.patch(`/api/contracts/${contractId}`, { notice_days: 30 });
    expect(a.body.notice_date).toBe('2030-12-01');
    const b = await t.api.patch(`/api/contracts/${contractId}`, { end_date: '2031-06-30' });
    expect(b.body.notice_date).toBe('2031-05-31');
    const c = await t.api.patch(`/api/contracts/${contractId}`, { end_date: null });
    expect(c.body.notice_date).toBeNull();
    await t.api.patch(`/api/contracts/${contractId}`, { end_date: '2030-12-31' });
    const history = await t.api.get(`/api/history?record_type=contract&record_id=${contractId}`);
    expect(history.body[0].after).toEqual({ end_date: '2030-12-31', notice_date: '2030-12-01' });
  });

  it('validates', async () => {
    const noVendor = await t.api.post('/api/contracts', { title: 'Orphan', vendor_id: '11111111-1111-4111-8111-111111111111' });
    expect(noVendor.body.error.fields.vendor_id).toMatch(/not found/);
    const bad = await t.api.patch(`/api/contracts/${contractId}`, { notice_days: 1.5 });
    expect(bad.body.error.fields.notice_days).toBeDefined();
    const order = await t.api.patch(`/api/contracts/${contractId}`, { start_date: '2031-01-01' });
    expect(order.body.error.fields.end_date).toBeDefined();
    const byYear = await t.api.patch(`/api/contracts/${contractId}`, { value_by_year: { next: 'lots' } });
    expect(byYear.body.error.fields.value_by_year).toBeDefined();
  });

  it('filters by vendor', async () => {
    expect((await t.api.get(`/api/contracts?f.vendor_id=${vendorId}`)).body.total).toBe(1);
  });
});

describe('security terms', () => {
  let vendorId: string;
  let c1: string;
  let c2: string;

  beforeAll(async () => {
    vendorId = (await t.api.post('/api/vendors', { name: 'Cedar Gate Cloud', criticality: 'critical' })).body.id;
    c1 = (await t.api.post('/api/contracts', { title: 'Cedar master', vendor_id: vendorId })).body.id;
    c2 = (await t.api.post('/api/contracts', { title: 'Cedar order', vendor_id: vendorId })).body.id;
  });

  it('classifies free text', () => {
    expect(classifyClauseText('Not stated')).toBe('absent');
    expect(classifyClauseText('None; "best efforts" only')).toBe('absent');
    expect(classifyClauseText('No')).toBe('absent');
    expect(classifyClauseText('Within 24 hours of discovery')).toBe('present');
    expect(classifyClauseText('Customer owns its data. Return on exit not stated')).toBe('partial');
    expect(classifyClauseText('Yes, but limits to be agreed')).toBe('partial');
    expect(classifyClauseText('Not known')).toBeNull();
    expect(classifyClauseText('Not applicable')).toBeNull();
    expect(classifyClauseText('')).toBeNull();
    expect(worstStatus(['present', 'absent', 'partial'])).toBe('absent');
    expect(worstStatus([null, 'present'])).toBe('present');
    expect(worstStatus([null])).toBeNull();
  });

  it('lists every clause, assessed or not', async () => {
    const res = await t.api.get(`/api/contracts/${c1}/clauses`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(9);
    expect(res.body.map((c: any) => c.clause_key)).toContain('independent_assurance');
    expect(res.body.every((c: any) => c.status === null)).toBe(true);
  });

  it('updates a clause and audits it on the contract', async () => {
    const res = await t.api.patch(`/api/contracts/${c1}/clauses/breach_notice`, {
      status: 'present', clause_text: 'Within 48 hours.', note: 'Section 9',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clause_key: 'breach_notice', status: 'present', clause_text: 'Within 48 hours.', note: 'Section 9' });
    // Same values again: no second audit event.
    await t.api.patch(`/api/contracts/${c1}/clauses/breach_notice`, { status: 'present' });
    const events = (await t.api.get(`/api/history?record_type=contract&record_id=${c1}`)).body
      .filter((h: any) => h.action === 'contract.clause_check');
    expect(events).toHaveLength(1);
    expect(events[0].after).toMatchObject({ clause: 'breach_notice', status: 'present' });

    expect((await t.api.patch(`/api/contracts/${c1}/clauses/breach_notice`, { status: 'maybe' })).status).toBe(400);
    expect((await t.api.patch(`/api/contracts/${c1}/clauses/made_up`, { status: 'present' })).status).toBe(404);
    const agent = await t.as('agent');
    expect((await agent.patch(`/api/contracts/${c1}/clauses/mfa`, { status: 'present' })).status).toBe(403);
    expect((await agent.get(`/api/contracts/${c1}/clauses`)).status).toBe(200);
  });

  it('builds the matrix with the worst status per vendor and clause', async () => {
    await t.api.patch(`/api/contracts/${c2}/clauses/breach_notice`, { status: 'absent', clause_text: 'None.' });
    await t.api.patch(`/api/contracts/${c2}/clauses/mfa`, { status: 'partial' });
    const res = await t.api.get('/api/vendors/terms-matrix');
    expect(res.status).toBe(200);
    expect(res.body.clauses).toHaveLength(9);
    const row = res.body.vendors.find((v: any) => v.id === vendorId);
    expect(row.contracts).toBe(2);
    expect(row.criticality_label).toBe('Critical');
    expect(row.cells.breach_notice.status).toBe('absent');
    expect(row.cells.breach_notice.items).toHaveLength(2);
    expect(row.cells.mfa.status).toBe('partial');
    expect(row.cells.liability).toEqual({ status: null, items: [] });
    // Critical vendors sort first.
    expect(res.body.vendors[0].criticality).toBe('critical');

    const filtered = await t.api.get('/api/vendors/terms-matrix?criticality=low');
    expect(filtered.body.vendors.find((v: any) => v.id === vendorId)).toBeUndefined();
  });

  it('summarizes a vendor', async () => {
    const res = await t.api.get(`/api/vendors/${vendorId}/summary`);
    expect(res.body.contracts).toBe(2);
    expect(res.body.terms).toEqual({ present: 0, partial: 1, absent: 1, not_assessed: 7 });
    expect(res.body.systems ?? 0).toBe(0); // the inventory module is not loaded in this test
  });
});

describe('evidence', () => {
  let vendorId: string;

  beforeAll(async () => {
    vendorId = (await t.api.post('/api/vendors', { name: 'Dovecote Insurance Checks' })).body.id;
  });

  it('creates evidence and validates its references', async () => {
    const made = await t.api.post('/api/evidence', {
      title: 'Assurance report', vendor_id: vendorId, type: 'assurance_report',
      received_on: addDays(today, -300), expires_on: addDays(today, 20),
    });
    expect(made.status).toBe(201);
    expect(made.body._display.type).toBe('Assurance report');
    const other = (await t.api.post('/api/vendors', { name: 'Elm Row Hosting' })).body.id;
    const contract = (await t.api.post('/api/contracts', { title: 'Elm hosting', vendor_id: other })).body.id;
    const wrong = await t.api.post('/api/evidence', { title: 'Mismatch', vendor_id: vendorId, contract_id: contract });
    expect(wrong.body.error.fields.contract_id).toMatch(/different vendor/);
    // E18-18: the contract picker on the evidence form asks for the chosen vendor's contracts only.
    const mine = (await t.api.post('/api/contracts', { title: 'Dovecote checks', vendor_id: vendorId })).body.id;
    const offered = (await t.api.get(`/api/contracts?f.vendor_id=${vendorId}&sort=title&pageSize=200`)).body.rows.map((r: any) => r.id);
    expect(offered).toEqual([mine]);
    expect(offered).not.toContain(contract);
    const dates = await t.api.post('/api/evidence', { title: 'Backwards', vendor_id: vendorId, received_on: '2030-02-01', expires_on: '2030-01-01' });
    expect(dates.body.error.fields.expires_on).toBeDefined();
  });

  it('reports what is expiring inside the window, including what has already expired', async () => {
    await t.api.post('/api/evidence', { title: 'Old certificate', vendor_id: vendorId, type: 'insurance_certificate', expires_on: addDays(today, -5) });
    await t.api.post('/api/evidence', { title: 'Far off', vendor_id: vendorId, expires_on: addDays(today, 200) });
    await t.api.post('/api/evidence', { title: 'No expiry', vendor_id: vendorId });

    const d30 = await t.api.get('/api/vendors/evidence-expiring?days=30');
    expect(d30.body.days).toBe(30);
    expect(d30.body.rows.map((r: any) => r.title)).toEqual(['Old certificate', 'Assurance report']);
    expect(d30.body.rows[0]).toMatchObject({ expired: true, days_left: -5, vendor_name: 'Dovecote Insurance Checks', type_label: 'Insurance certificate' });
    expect(d30.body.rows[1]).toMatchObject({ expired: false, days_left: 20 });

    expect((await t.api.get('/api/vendors/evidence-expiring?days=10')).body.rows).toHaveLength(1);
    expect((await t.api.get('/api/vendors/evidence-expiring?days=365')).body.rows).toHaveLength(3);
    expect((await t.api.get('/api/vendors/evidence-expiring')).body.days).toBe(90);
  });
});

describe('renewal reminders', () => {
  let contractId: string;
  const noon = (date: string) => new Date(`${date}T17:00:00Z`); // midday in New York
  const reminderEvents = async (id: string) =>
    (await t.api.get(`/api/history?record_type=contract&record_id=${id}`)).body.filter((h: any) => h.action === 'contract.reminder');

  beforeAll(async () => {
    const vendorId = (await t.api.post('/api/vendors', { name: 'Foxglove Telecom' })).body.id;
    // Notice date 2040-06-29: reminders fall due on 1 March (120), 31 March (90), 30 April (60), 30 May (30).
    const made = await t.api.post('/api/contracts', { title: 'Foxglove lines', vendor_id: vendorId, end_date: '2040-08-28', notice_days: 60 });
    expect(made.body.notice_date).toBe('2040-06-29');
    contractId = made.body.id;
  });

  const mine = (fired: FiredReminder[]) => fired.filter((f) => f.contract_id === contractId);

  it('does nothing before the first threshold', async () => {
    expect(mine(await runContractReminders(t.ctx, noon('2040-02-28')))).toEqual([]);
    expect(await reminderEvents(contractId)).toHaveLength(0);
  });

  it('fires the 120-day reminder exactly once', async () => {
    const first = mine(await runContractReminders(t.ctx, noon('2040-03-01')));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ threshold_days: 120, due_on: '2040-03-01', notice_date: '2040-06-29' });
    expect(mine(await runContractReminders(t.ctx, noon('2040-03-01')))).toEqual([]);
    expect(mine(await runContractReminders(t.ctx, noon('2040-03-15')))).toEqual([]);
    const events = await reminderEvents(contractId);
    expect(events).toHaveLength(1);
    expect(events[0].actor_name).toBe('System');
    expect(events[0].summary).toMatch(/120 days/);
  });

  it('fires each later threshold once as time passes', async () => {
    expect(mine(await runContractReminders(t.ctx, noon('2040-03-31'))).map((f) => f.threshold_days)).toEqual([90]);
    expect(mine(await runContractReminders(t.ctx, noon('2040-04-30'))).map((f) => f.threshold_days)).toEqual([60]);
    expect(mine(await runContractReminders(t.ctx, noon('2040-05-30'))).map((f) => f.threshold_days)).toEqual([30]);
    expect(mine(await runContractReminders(t.ctx, noon('2040-07-15')))).toEqual([]);
    expect(await reminderEvents(contractId)).toHaveLength(4);
  });

  it('re-arms when the notice date moves, and stays quiet for thresholds already behind it', async () => {
    await t.api.patch(`/api/contracts/${contractId}`, { end_date: '2041-08-28' }); // notice date 2041-06-29
    // 2041-05-05 is past the 120, 90 and 60-day points: one reminder (the nearest), the others superseded.
    const fired = mine(await runContractReminders(t.ctx, noon('2041-05-05')));
    expect(fired.map((f) => f.threshold_days)).toEqual([60]);
    expect(mine(await runContractReminders(t.ctx, noon('2041-05-06')))).toEqual([]);
    expect(await reminderEvents(contractId)).toHaveLength(5);
  });

  it('skips contracts that have ended', async () => {
    const vendorId = (await t.api.post('/api/vendors', { name: 'Gorse Lane Print' })).body.id;
    const ended = await t.api.post('/api/contracts', { title: 'Gorse print', vendor_id: vendorId, end_date: '2040-08-28', status: 'terminated' });
    await runContractReminders(t.ctx, noon('2040-08-01'));
    expect(await reminderEvents(ended.body.id)).toHaveLength(0);
  });

  it('shows the renewal calendar in notice-date order with reminder state', async () => {
    const vendorId = (await t.api.post('/api/vendors', { name: 'Hazel Court Software' })).body.id;
    const soon = await t.api.post('/api/contracts', { title: 'Hazel soon', vendor_id: vendorId, end_date: addDays(today, 75), notice_days: 30 });
    const past = await t.api.post('/api/contracts', { title: 'Hazel passed', vendor_id: vendorId, end_date: addDays(today, 10), notice_days: 30 });
    await t.api.post('/api/contracts', { title: 'Hazel undated', vendor_id: vendorId });
    await runContractReminders(t.ctx, new Date());

    const res = await t.api.get('/api/contracts/renewals');
    expect(res.status).toBe(200);
    expect(res.body.thresholds).toEqual([120, 90, 60, 30]);
    const dates = res.body.contracts.map((c: any) => c.notice_date);
    expect(dates).toEqual([...dates].sort());
    const a = res.body.contracts.find((c: any) => c.id === soon.body.id);
    expect(a).toMatchObject({ days_to_notice: 45, window: '60', vendor_name: 'Hazel Court Software' });
    expect(a.reminders.map((r: any) => r.state)).toEqual(['superseded', 'superseded', 'fired', 'scheduled']);
    const b = res.body.contracts.find((c: any) => c.id === past.body.id);
    expect(b).toMatchObject({ days_to_notice: -20, window: 'passed' });
    expect(res.body.undated.map((c: any) => c.title)).toContain('Hazel undated');
    expect((await (await t.as('requester')).get('/api/contracts/renewals')).status).toBe(403);

    // Someone who may see contracts but not vendors gets the contracts without vendor names.
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('contracts_only', 'Contracts only', true) returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'contracts.view')`, [role!.id]);
    const limited = await (await t.as('contracts_only')).get('/api/contracts/renewals');
    expect(limited.status).toBe(200);
    expect(limited.body.contracts.find((c: any) => c.id === soon.body.id)).toMatchObject({ title: 'Hazel soon', vendor_name: null });
    expect(limited.body.undated.every((c: any) => c.vendor_name === null)).toBe(true);
  });
});
