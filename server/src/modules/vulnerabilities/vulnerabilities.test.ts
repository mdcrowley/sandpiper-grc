import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, today } from './policy.ts';

// Invented findings only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { process.env.GRC_MODULES = 'vulnerabilities'; // these tests describe the module on its own
  t = await testApp(); });
afterAll(async () => { await t.close(); });

const finding = (over: Record<string, unknown> = {}) => ({
  title: 'Pretend service accepts a default password', host_name: 'pretend-host-01', plugin_id: '700001', severity: 'high', ...over,
});

describe('fix-by date from the severity policy', () => {
  it('ships the default periods', async () => {
    const policy = (await t.api.get('/api/vulnerabilities/policy')).body;
    expect(policy.days).toMatchObject({ critical: 15, high: 30, medium: 90, low: 180, informational: null });
    expect(policy.knownExploitedSeverity).toBe('critical');
  });

  it('computes the date from first seen and the severity', async () => {
    const first = addDays(today(), -10);
    const due = async (over: Record<string, unknown>) =>
      (await t.api.post('/api/vulnerabilities', finding({ plugin_id: `p-${Math.random()}`, first_seen: first, ...over }))).body;
    expect((await due({ severity: 'critical' })).due_on).toBe(addDays(first, 15));
    expect((await due({ severity: 'high' })).due_on).toBe(addDays(first, 30));
    expect((await due({ severity: 'medium' })).due_on).toBe(addDays(first, 90));
    expect((await due({ severity: 'low' })).due_on).toBe(addDays(first, 180));
    expect((await due({ severity: 'informational' })).due_on).toBeNull();
    // Known exploited: the critical period, whatever the severity.
    expect((await due({ severity: 'medium', known_exploited: true })).due_on).toBe(addDays(first, 15));
    expect((await due({ severity: 'informational', known_exploited: true })).due_on).toBe(addDays(first, 15));
  });

  it('computes age and the overdue flag, and recomputes when severity changes', async () => {
    const made = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700010', first_seen: addDays(today(), -40) }))).body;
    expect(made.ref).toMatch(/^VUL-\d{5}$/);
    expect(made.age_days).toBe(40);
    expect(made.overdue).toBe(true); // high: 30 days
    expect(made.closed).toBe(false);
    const eased = (await t.api.patch(`/api/vulnerabilities/${made.id}`, { severity: 'medium' })).body;
    expect(eased.due_on).toBe(addDays(today(), 50));
    expect(eased.overdue).toBe(false);
    expect((await t.api.get('/api/vulnerabilities?f.overdue=true')).body.rows.every((r: any) => r.overdue)).toBe(true);
    // The computed fields cannot be written.
    const hacked = (await t.api.patch(`/api/vulnerabilities/${made.id}`, { due_on: '2099-01-01', closed: true })).body;
    expect(hacked.due_on).toBe(addDays(today(), 50));
    expect(hacked.closed).toBe(false);
  });

  it('lets the date be overridden only with a reason', async () => {
    const made = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700011' }))).body;
    const bad = await t.api.patch(`/api/vulnerabilities/${made.id}`, { due_override_on: '2031-01-31' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.due_override_reason).toBeTruthy();
    const ok = await t.api.patch(`/api/vulnerabilities/${made.id}`, { due_override_on: '2031-01-31', due_override_reason: 'Waiting for the supplier update' });
    expect(ok.body.due_on).toBe('2031-01-31');
    const back = await t.api.patch(`/api/vulnerabilities/${made.id}`, { due_override_on: null });
    expect(back.body.due_on).toBe(addDays(made.first_seen, 30));
  });

  it('lets the policy be changed, recalculates open findings and audits it', async () => {
    const first = addDays(today(), -5);
    const open = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700020', severity: 'low', first_seen: first }))).body;
    const fixed = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700021', severity: 'low', first_seen: first, status: 'fixed' }))).body;
    const put = (api: any, body: unknown) => api.post('/api/vulnerabilities/policy', body);
    const client = t.api;
    expect((await put(await t.as('agent'), { days: {} })).status).toBe(403);
    const wrong = await put(client, { days: { critical: 0, high: 'soon' }, knownExploitedSeverity: 'nonsense' });
    expect(wrong.status).toBe(400);
    expect(Object.keys(wrong.body.error.fields).sort()).toEqual(['days.critical', 'days.high', 'knownExploitedSeverity']);

    const saved = await put(client, { days: { critical: 7, high: 30, medium: 60, low: 120 }, knownExploitedSeverity: 'critical' });
    expect(saved.status).toBe(200);
    expect(saved.body.recalculated).toBeGreaterThan(0);
    expect((await t.api.get(`/api/vulnerabilities/${open.id}`)).body.due_on).toBe(addDays(first, 120));
    // Closed findings keep the date they had.
    expect((await t.api.get(`/api/vulnerabilities/${fixed.id}`)).body.due_on).toBe(fixed.due_on);
    const events = await t.db.query(`select action from audit_events where action in ('vulnerability.policy', 'setting.change') order by id`);
    expect(events.map((e: any) => e.action)).toEqual(['setting.change', 'vulnerability.policy']);
    // Each finding whose date moved has its own history entry with the old and new date.
    const own = await t.db.query<any>(`select before, after from audit_events where action = 'vulnerability.update' and record_id = $1 order by id desc limit 1`, [open.id]);
    expect(own[0]).toMatchObject({ before: { due_on: addDays(first, 180) }, after: { due_on: addDays(first, 120) } });
    expect((await t.db.query(`select 1 from audit_events where action = 'vulnerability.update' and record_id = $1`, [fixed.id])).length).toBe(0);
    await put(client, { days: { critical: 15, high: 30, medium: 90, low: 180 }, knownExploitedSeverity: 'critical' });
  });
});

describe('status rules', () => {
  it('sets and clears "fixed on" and the closed flag', async () => {
    const made = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700030', first_seen: addDays(today(), -3) }))).body;
    const fixed = (await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'fixed' })).body;
    expect(fixed).toMatchObject({ status: 'fixed', fixed_on: today(), closed: true, overdue: false, age_days: 3 });
    const reopened = (await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'open' })).body;
    expect(reopened).toMatchObject({ status: 'open', fixed_on: null, closed: false });
  });

  it('accepts risk only with an exception, or a justification and an approver', async () => {
    const made = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700031' }))).body;
    const bare = await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'risk_accepted' });
    expect(bare.status).toBe(400);
    expect(bare.body.error.fields.acceptance_justification).toBeTruthy();
    expect(bare.body.error.fields.acceptance_approver_id).toBeTruthy();
    const half = await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'risk_accepted', acceptance_justification: 'Isolated network, replaced next quarter' });
    expect(half.status).toBe(400);
    expect(half.body.error.fields.acceptance_justification).toBeUndefined();

    // The person recording the acceptance cannot name themselves as its approver.
    const me = (await t.api.get('/api/auth/state')).body.user.id;
    const self = await t.api.patch(`/api/vulnerabilities/${made.id}`, {
      status: 'risk_accepted', acceptance_justification: 'Isolated network, replaced next quarter', acceptance_approver_id: me,
    });
    expect(self.status).toBe(400);
    expect(self.body.error.fields.acceptance_approver_id).toMatch(/other than yourself/);

    const approver = (await t.as('agent')).userId;
    const ok = await t.api.patch(`/api/vulnerabilities/${made.id}`, {
      status: 'risk_accepted', acceptance_justification: 'Isolated network, replaced next quarter', acceptance_approver_id: approver,
    });
    expect(ok.body).toMatchObject({ status: 'risk_accepted', closed: true, overdue: false });
    // The record cannot be left accepted with the justification removed.
    expect((await t.api.patch(`/api/vulnerabilities/${made.id}`, { acceptance_justification: '' })).status).toBe(400);

    // The exceptions module is not loaded in this test, so an exception reference is refused rather than trusted.
    const other = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700032' }))).body;
    const byRef = await t.api.patch(`/api/vulnerabilities/${other.id}`, { status: 'risk_accepted', exception_id: '00000000-0000-4000-8000-000000000001' });
    expect(byRef.status).toBe(400);
    expect(byRef.body.error.fields.exception_id).toBeTruthy();
  });

  it('needs a reason for a false positive', async () => {
    const made = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700033' }))).body;
    expect((await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'false_positive' })).body.error.fields.false_positive_reason).toBeTruthy();
    const ok = await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'false_positive', false_positive_reason: 'The scanner misread the banner' });
    expect(ok.body.closed).toBe(true);
  });

  it('refuses a system or asset reference when inventory is not loaded, and a bad CVSS score', async () => {
    const res = await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700034', system_id: '00000000-0000-4000-8000-000000000002' }));
    expect(res.status).toBe(400);
    expect(res.body.error.fields.system_id).toBeTruthy();
    expect((await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700035', cvss: 11 }))).body.error.fields.cvss).toBeTruthy();
  });

  it('writes history for every change', async () => {
    const made = (await t.api.post('/api/vulnerabilities', finding({ plugin_id: '700036' }))).body;
    await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'in_remediation' });
    const history = (await t.api.get(`/api/history?record_type=vulnerability&record_id=${made.id}`)).body;
    expect(history.map((h: any) => h.action)).toEqual(['vulnerability.update', 'vulnerability.create']);
    expect(history[0].before).toEqual({ status: 'open' });
    expect(history[0].after).toEqual({ status: 'in_remediation' });
  });
});

describe('restricted behaviour', () => {
  let id: string;
  beforeAll(async () => {
    id = (await t.api.post('/api/vulnerabilities', finding({ title: 'Zebra crossing exposure', host_name: 'zebra-host', plugin_id: '700040' }))).body.id;
  });

  const blocked = async (client: any) => {
    expect((await client.get('/api/vulnerabilities')).status).toBe(403);
    expect((await client.get(`/api/vulnerabilities/${id}`)).status).toBe(403);
    expect((await client.get('/api/vulnerabilities/stats?group=severity')).status).toBe(403);
    expect((await client.get('/api/vulnerabilities?format=csv')).status).toBe(403);
    expect((await client.patch(`/api/vulnerabilities/${id}`, { title: 'x' })).status).toBe(403);
    expect((await client.post('/api/vulnerabilities', finding())).status).toBe(403);
    expect((await client.del(`/api/vulnerabilities/${id}`)).status).toBe(403);
    expect((await client.get('/api/search?q=zebra')).body).toEqual([]);
    expect((await client.get('/api/records/lookup?type=vulnerability&q=zebra')).body).toEqual([]);
    expect((await client.get(`/api/history?record_type=vulnerability&record_id=${id}`)).status).toBe(404);
    expect((await client.get(`/api/comments?record_type=vulnerability&record_id=${id}`)).status).toBe(404);
    expect((await client.get('/api/meta')).body.resources.vulnerability).toBeUndefined();
    expect((await client.get('/api/vulnerabilities/summary')).status).toBe(403);
    expect((await client.get('/api/vulnerabilities/policy')).status).toBe(403);
    expect((await client.get('/api/vulnerabilities/imports')).status).toBe(403);
    expect((await client.get('/api/vulnerabilities/imports/00000000-0000-4000-8000-000000000003')).status).toBe(403);
    expect((await client.get('/api/vulnerabilities/import/fields')).status).toBe(403);
    expect((await client.get('/api/vulnerabilities/import/presets')).status).toBe(403);
    expect((await client.post('/api/vulnerabilities/import/presets', { name: 'x', mapping: { title: 'Name' } })).status).toBe(403);
    expect((await client.del('/api/vulnerabilities/import/presets/00000000-0000-4000-8000-000000000003')).status).toBe(403);
    expect((await client.post('/api/vulnerabilities/import', { csv: 'Host,Name,Risk\nh,n,high', source: 's', mapping: { host_name: 'Host', title: 'Name', severity: 'Risk' }, dryRun: false })).status).toBe(403);
  };

  it('shows an agent nothing: list, record, search, summary and import routes', async () => {
    await blocked(await t.as('agent'));
    expect((await t.anon.get('/api/vulnerabilities/summary')).status).toBe(401);
  });

  it('needs security.view as well as the vulnerabilities permission', async () => {
    // A role with every vulnerabilities permission but no security.view.
    const role = (await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled, requires_mfa) values ('vuln_only', 'Vulnerabilities only', 'Test', true, false) returning id`))!;
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'vulnerabilities.*')`, [role.id]);
    await blocked(await t.as('vuln_only'));
    expect(await t.db.query(`select 1 from vulnerabilities where title = 'x'`)).toEqual([]);
  });

  it('lets a security lead work findings', async () => {
    const lead = await t.as('security_lead');
    expect((await lead.get('/api/vulnerabilities')).body.total).toBeGreaterThan(0);
    expect((await lead.get(`/api/vulnerabilities/${id}`)).body.title).toBe('Zebra crossing exposure');
    expect((await lead.get('/api/search?q=zebra')).body[0]).toMatchObject({ type: 'vulnerability', route: '/vulnerabilities' });
    const worked = await lead.patch(`/api/vulnerabilities/${id}`, { status: 'in_remediation', owner_id: lead.userId, remediation_notes: 'Update booked' });
    expect(worked.body._display).toMatchObject({ status: 'In remediation', severity: 'High' });
    expect((await lead.get('/api/vulnerabilities/summary')).status).toBe(200);
    expect((await lead.get('/api/vulnerabilities/imports')).status).toBe(200);
    expect((await lead.post('/api/comments', { record_type: 'vulnerability', record_id: id, body: 'Booked for Tuesday' })).status).toBe(201);
    const csv = await lead.get('/api/vulnerabilities?format=csv');
    expect(csv.text).toContain('Zebra crossing exposure');
    expect(csv.text).toContain('Restricted export by');
  });
});
