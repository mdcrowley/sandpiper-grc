import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { plainDate, sweepOverdue } from './notify.ts';
import { addDays, today } from './policy.ts';

// Notifications, criticality and the overdue report. These tests use whichever modules are
// loaded: with the notifications or inventory module absent (the module tested on its own)
// the parts that need them check that nothing breaks and nothing is sent.
// Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
let notifications = false;
let inventory = false;
type Client = Awaited<ReturnType<typeof t.as>>;

const d = (n: number) => addDays(today(), n);
let n = 0;
const finding = (over: Record<string, unknown> = {}) => ({
  title: `Invented weakness ${++n}`, host_name: `platform-host-${n}`, plugin_id: `95${String(n).padStart(4, '0')}`, severity: 'high', ...over,
});
const create = async (over: Record<string, unknown> = {}, api: { post: Client['post'] } = t.api) => {
  const res = await api.post('/api/vulnerabilities', finding(over));
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
};
/** A user holding one new role with exactly these permissions. */
async function withGrants(key: string, grants: string[]): Promise<Client> {
  const role = (await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled, requires_mfa) values ($1, $1, 'Test', true, false) returning id`, [key]))!;
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, g]);
  return t.as(key);
}
const inbox = async (c: { get: Client['get'] }) => (notifications ? (await c.get('/api/notifications?pageSize=100')).body.rows as any[] : []);
const stored = async (userId: string) => (notifications ? (await t.db.query<any>('select kind, title, route, record_id from notifications where user_id = $1 order by created_at', [userId])) : []);

beforeAll(async () => {
  t = await testApp();
  notifications = t.app.hasDecorator('notify');
  inventory = t.ctx.resources.get('system') !== undefined && t.ctx.resources.get('asset') !== undefined;
});
afterAll(async () => { await t.close(); });

describe('the services these tests lean on', () => {
  it('are found whenever their modules are loaded, so the checks below are not skipped by accident', () => {
    const loaded = process.env.GRC_MODULES?.split(',').map((m) => m.trim());
    if (!loaded || loaded.includes('notifications')) expect(notifications).toBe(true);
    if (!loaded || loaded.includes('inventory')) expect(inventory).toBe(true);
  });
});

describe('assignment notifications', () => {
  it('tells the new owner, with a link to the finding, and not the person who assigned it', async () => {
    const lead = await t.as('security_lead');
    const made = await create({ first_seen: d(-2) });
    const res = await t.api.patch(`/api/vulnerabilities/${made.id}`, { owner_id: lead.userId });
    expect(res.status).toBe(200);
    const got = await inbox(lead);
    if (!notifications) return expect(got).toEqual([]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      kind: 'assignment', title: `Vulnerability assigned to you: ${made.ref} ${made.title}`,
      body: `High severity on ${made.host_name}. Fix by ${plainDate(d(28))}.`,
      route: `/vulnerabilities/${made.id}`, record_type: 'vulnerability', record_id: made.id, unavailable: false,
    });
    expect((await inbox(t.api)).filter((x) => x.record_id === made.id)).toEqual([]);

    // Saving again without changing the owner tells nobody; taking it yourself tells nobody.
    await t.api.patch(`/api/vulnerabilities/${made.id}`, { remediation_notes: 'Booked' });
    expect(await inbox(lead)).toHaveLength(1);
    const own = await create({}, lead);
    await lead.patch(`/api/vulnerabilities/${own.id}`, { owner_id: lead.userId });
    const bySelf = await create({ owner_id: lead.userId }, lead);
    expect((await inbox(lead)).filter((x) => [own.id, bySelf.id].includes(x.record_id))).toEqual([]);

    // Created already assigned to someone else: they are told.
    const other = await t.as('security_lead');
    const given = await create({ owner_id: other.userId }, lead);
    expect((await inbox(other)).map((x) => x.record_id)).toEqual([given.id]);
  });

  it('never tells someone who may not see findings', async () => {
    const noSecurity = await withGrants('vuln_no_security', ['vulnerabilities.*']);
    const agent = await t.as('agent');
    const a = await create();
    expect((await t.api.patch(`/api/vulnerabilities/${a.id}`, { owner_id: noSecurity.userId })).status).toBe(200);
    const b = await create({ owner_id: agent.userId });
    expect(b.owner_id).toBe(agent.userId);
    expect(await stored(noSecurity.userId)).toEqual([]);
    expect(await stored(agent.userId)).toEqual([]);
  });

  it('tells the owner chosen for an import once, and not when the importer chose themselves', async () => {
    const lead = await t.as('security_lead');
    const csv = (ids: number[]) => ['Host,Check ID,Name,Risk', ...ids.map((i) => `import-host-${i},96${i},Imported weakness ${i},Medium`)].join('\n');
    const mapping = { host_name: 'Host', plugin_id: 'Check ID', title: 'Name', severity: 'Risk' };
    const run = (api: { post: Client['post'] }, ids: number[], over: Record<string, unknown>) =>
      api.post('/api/vulnerabilities/import', { csv: csv(ids), mapping, source: 'Owner scan', dryRun: false, ...over });

    expect((await run(t.api, [1], { ownerId: 'nobody' })).body.error.fields.ownerId).toBeTruthy();
    expect((await run(t.api, [1], { ownerId: '00000000-0000-4000-8000-000000000009' })).status).toBe(400);
    const dry = await run(t.api, [1, 2, 3, 4, 5], { ownerId: lead.userId, dryRun: true });
    expect(dry.body).toMatchObject({ created: 5, assigned: 5 });
    expect(await stored(lead.userId)).toEqual([]); // a dry run tells nobody

    const many = await run(t.api, [1, 2, 3, 4, 5], { ownerId: lead.userId });
    expect(many.body).toMatchObject({ created: 5, assigned: 5 });
    expect((await t.api.get(`/api/vulnerabilities?f.owner_id=${lead.userId}&f.import_batch_id=${many.body.batchId}`)).body.total).toBe(5);
    const few = await run(t.api, [1, 2, 6, 7], { ownerId: lead.userId }); // two known, two new
    expect(few.body).toMatchObject({ created: 2, unchanged: 2, assigned: 2 });
    const mine = await run(lead, [8, 9], { ownerId: lead.userId });
    expect(mine.body).toMatchObject({ created: 2, assigned: 2 });

    const got = await stored(lead.userId);
    if (!notifications) return expect(got).toEqual([]);
    expect(got.map((x) => x.kind)).toEqual(['assignment', 'assignment', 'assignment']);
    expect(got[0]).toMatchObject({
      title: '5 vulnerabilities from Owner scan were assigned to you',
      route: `/vulnerabilities/imports/${many.body.batchId}?f.owner_id=${lead.userId}`,
    });
    expect(got.slice(1).map((x) => x.title).sort()).toEqual([
      expect.stringMatching(/^Vulnerability assigned to you: VUL-\d+ Imported weakness 6$/),
      expect.stringMatching(/^Vulnerability assigned to you: VUL-\d+ Imported weakness 7$/),
    ]);
  });
});

describe('the overdue sweep', () => {
  it('tells each owner once when a finding passes its fix-by date, and only people who may see it', async () => {
    const lead = await t.as('security_lead');
    const busy = await t.as('security_lead');
    const noSecurity = await withGrants('vuln_no_security_2', ['vulnerabilities.*']);
    const late = await create({ first_seen: d(-45), owner_id: lead.userId }); // high: 30 days
    const fine = await create({ first_seen: d(-3), owner_id: lead.userId });
    const closed = await create({ first_seen: d(-45), owner_id: lead.userId, status: 'fixed', fixed_on: d(-1) });
    const unowned = await create({ first_seen: d(-45) });
    const hidden = await create({ first_seen: d(-45), owner_id: noSecurity.userId });
    const pile = [];
    for (let i = 0; i < 5; i++) pile.push(await create({ first_seen: d(-60 - i), owner_id: busy.userId }));
    await t.db.query('delete from notifications').catch(() => undefined); // the assignment notices above are not what is tested here

    const first = await sweepOverdue(t.ctx);
    if (!notifications) {
      expect(first).toMatchObject({ findings: 0, notifications: 0 });
      // Nothing was marked as told, so owners hear once the service is there.
      expect((await t.db.one<any>('select overdue_notified_for from vulnerabilities where id = $1', [late.id])).overdue_notified_for).toBeNull();
      return;
    }
    expect(first).toMatchObject({ findings: 7, notifications: 2 }); // late, hidden and the pile of five; one each for lead and busy
    const got = await inbox(lead);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      kind: 'due', title: `Past its fix-by date: ${late.ref} ${late.title}`,
      body: `High severity on ${late.host_name}. It was due on ${plainDate(late.due_on)}.`,
      route: `/vulnerabilities/${late.id}`, record_id: late.id,
    });
    expect([fine.id, closed.id, unowned.id].some((id) => got.some((x) => x.record_id === id))).toBe(false);
    // Five at once: one notification with the count, opening the owner's overdue findings.
    expect(await stored(busy.userId)).toEqual([expect.objectContaining({
      kind: 'due', title: '5 of your vulnerabilities are past their fix-by date',
      route: `/vulnerabilities?f.overdue=true&f.owner_id=${busy.userId}&sort=due_on&dir=asc`,
    })]);
    expect(await stored(noSecurity.userId)).toEqual([]);
    expect(await stored(hidden.owner_id)).toEqual([]);

    // Idempotent: a second sweep, the same hour or the next day, sends nothing more.
    expect(await sweepOverdue(t.ctx)).toMatchObject({ findings: 0, notifications: 0 });
    expect(await inbox(lead)).toHaveLength(1);

    // A finding that becomes overdue later is reported then.
    await t.api.patch(`/api/vulnerabilities/${fine.id}`, { due_override_on: d(-1), due_override_reason: 'Agreed earlier date' });
    expect(await sweepOverdue(t.ctx)).toMatchObject({ findings: 1, notifications: 1 });
    expect((await inbox(lead)).map((x) => x.record_id).sort()).toEqual([late.id, fine.id].sort());
  });
});

describe('criticality and the fix-by date (E10-13)', () => {
  const savePolicy = (body: Record<string, unknown>, api: { post: Client['post'] } = t.api) =>
    api.post('/api/vulnerabilities/policy', { days: { critical: 15, high: 30, medium: 90, low: 180 }, knownExploitedSeverity: 'critical', ...body });

  it('offers no criticality when the inventory is not loaded, and validates the shares', async () => {
    const policy = (await t.api.get('/api/vulnerabilities/policy')).body;
    expect(policy.criticalityPercent).toEqual({});
    if (!inventory) {
      expect(policy.criticalityTiers).toEqual([]);
      expect((await savePolicy({ criticalityPercent: { tier_1: 50 } })).body.error.fields['criticalityPercent.tier_1']).toBeTruthy();
      return;
    }
    expect(policy.criticalityTiers.map((x: any) => x.value)).toContain('tier_1');
    const bad = await savePolicy({ criticalityPercent: { tier_1: 0, tier_2: 'half', nonsense: 50 } });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['criticalityPercent.nonsense', 'criticalityPercent.tier_1', 'criticalityPercent.tier_2']);
  });

  it('shortens the fix-by date for a finding on a critical system, by the share in the policy', async () => {
    if (!inventory) return;
    const critical = (await t.api.post('/api/systems', { name: 'Invented Ledger', criticality_tier: 'tier_1' })).body;
    const ordinary = (await t.api.post('/api/systems', { name: 'Invented Noticeboard', criticality_tier: 'tier_3' })).body;
    const asset = (await t.api.post('/api/assets', { name: 'Invented ledger server', system_id: critical.id })).body;
    const first = d(-4);
    const onCritical = await create({ first_seen: first, system_id: critical.id });
    const onOrdinary = await create({ first_seen: first, system_id: ordinary.id });
    const overridden = await create({ first_seen: first, system_id: critical.id, due_override_on: d(40), due_override_reason: 'Agreed with the supplier' });
    // No share set yet: the severity period alone.
    expect(onCritical).toMatchObject({ due_on: addDays(first, 30), due_criticality: null });

    const saved = await savePolicy({ criticalityPercent: { tier_1: 50, tier_2: 75, tier_3: 100, tier_4: null } });
    expect(saved.status).toBe(200);
    expect(saved.body.criticalityPercent).toEqual({ tier_1: 50, tier_2: 75 }); // 100 and empty mean "no shortening"
    expect(saved.body.recalculated).toBeGreaterThanOrEqual(1);
    const get = async (id: string) => (await t.api.get(`/api/vulnerabilities/${id}`)).body;
    expect(await get(onCritical.id)).toMatchObject({ due_on: addDays(first, 15), due_criticality: 'tier_1' });
    expect(await get(onOrdinary.id)).toMatchObject({ due_on: addDays(first, 30), due_criticality: null });
    expect(await get(overridden.id)).toMatchObject({ due_on: d(40), due_criticality: null });

    // New findings, a finding moved to another system, and a finding that only names an asset.
    expect(await create({ first_seen: first, severity: 'critical', system_id: critical.id })).toMatchObject({ due_on: addDays(first, 8), due_criticality: 'tier_1' }); // half of 15, rounded up
    expect((await t.api.patch(`/api/vulnerabilities/${onOrdinary.id}`, { system_id: critical.id })).body).toMatchObject({ due_on: addDays(first, 15), due_criticality: 'tier_1' });
    expect((await t.api.patch(`/api/vulnerabilities/${onOrdinary.id}`, { system_id: null })).body).toMatchObject({ due_on: addDays(first, 30), due_criticality: null });
    expect(await create({ first_seen: first, asset_id: asset.id })).toMatchObject({ system_id: critical.id, due_on: addDays(first, 15), due_criticality: 'tier_1' });
    expect(await create({ first_seen: first, severity: 'informational', system_id: critical.id })).toMatchObject({ due_on: null, due_criticality: null });

    // The system's criticality changes in the inventory: the daily sweep brings its findings into line.
    await t.api.patch(`/api/systems/${critical.id}`, { criticality_tier: 'tier_2' });
    expect((await sweepOverdue(t.ctx)).recalculated).toBeGreaterThanOrEqual(1);
    expect(await get(onCritical.id)).toMatchObject({ due_on: addDays(first, 23), due_criticality: 'tier_2' }); // 75% of 30, rounded up
    expect((await t.db.query(`select 1 from audit_events where action = 'vulnerability.recalculate'`)).length).toBeGreaterThanOrEqual(1);

    // An older client that sends only the days keeps the shares.
    expect((await savePolicy({})).body.criticalityPercent).toEqual({ tier_1: 50, tier_2: 75 });
    expect((await savePolicy({ criticalityPercent: {} })).body.criticalityPercent).toEqual({});
    expect(await get(onCritical.id)).toMatchObject({ due_on: addDays(first, 30), due_criticality: null });
  });
});

describe('the overdue report', () => {
  it('groups overdue findings by owner, and by system owner when systems are in use', async () => {
    const owner = await t.as('security_lead');
    const a = await create({ first_seen: d(-100), severity: 'critical', owner_id: owner.userId });
    const b = await create({ first_seen: d(-50), severity: 'high', owner_id: owner.userId });
    await create({ first_seen: d(-1), owner_id: owner.userId }); // not overdue

    const byOwner = (await t.api.get('/api/vulnerabilities/overdue-report')).body;
    expect(byOwner).toMatchObject({ group: 'owner', available: true });
    const line = byOwner.groups.find((g: any) => g.ownerId === owner.userId);
    expect(line).toMatchObject({ kind: 'person', total: 2, oldestDue: a.due_on, systemIds: [] });
    expect(line.bySeverity).toMatchObject({ critical: 1, high: 1, medium: 0 });
    expect(byOwner.total).toBe(byOwner.groups.reduce((sum: number, g: any) => sum + g.total, 0));
    expect(byOwner.total).toBe((await t.api.get('/api/vulnerabilities?f.overdue=true')).body.total);
    expect((await t.api.get(`/api/vulnerabilities?f.overdue=true&f.owner_id=${owner.userId}`)).body.total).toBe(2);

    const bySystem = (await t.api.get('/api/vulnerabilities/overdue-report?group=system_owner')).body;
    const summary = (await t.api.get('/api/vulnerabilities/summary')).body;
    if (!inventory) {
      expect(bySystem).toEqual({ group: 'system_owner', available: false, groups: [], total: 0 });
      expect(summary.systemOwnerReport).toBe(false);
      return;
    }
    expect(summary.systemOwnerReport).toBe(true);
    const technical = await t.as('agent');
    const business = await t.as('agent');
    const owned = (await t.api.post('/api/systems', { name: 'Invented Rota System', technical_owner_id: technical.userId, business_owner_id: business.userId })).body;
    const businessOnly = (await t.api.post('/api/systems', { name: 'Invented Kiosk System', business_owner_id: business.userId })).body;
    const ownerless = (await t.api.post('/api/systems', { name: 'Invented Orphan System' })).body;
    await t.api.patch(`/api/vulnerabilities/${a.id}`, { system_id: owned.id });
    await t.api.patch(`/api/vulnerabilities/${b.id}`, { system_id: businessOnly.id });
    await create({ first_seen: d(-70), severity: 'high', system_id: owned.id });
    await create({ first_seen: d(-70), severity: 'high', system_id: ownerless.id });

    const report = (await t.api.get('/api/vulnerabilities/overdue-report?group=system_owner')).body;
    expect(report.available).toBe(true);
    const of = (id: string) => report.groups.find((g: any) => g.ownerId === id);
    expect(of(technical.userId)).toMatchObject({ kind: 'person', total: 2, systemIds: [owned.id] }); // the technical owner comes first
    expect(of(technical.userId).bySeverity).toMatchObject({ critical: 1, high: 1 });
    expect(of(business.userId)).toMatchObject({ kind: 'person', total: 1, systemIds: [businessOnly.id] }); // else the business owner
    expect(report.groups.find((g: any) => g.kind === 'no_owner')).toMatchObject({ name: 'System without an owner', systemIds: [ownerless.id] });
    expect(report.groups.find((g: any) => g.kind === 'no_system').total).toBeGreaterThanOrEqual(1);
    expect(report.total).toBe(byOwner.total + 2);
    // The link the dashboard makes from a line finds the same findings.
    expect((await t.api.get(`/api/vulnerabilities?f.overdue=true&f.system_id=${of(technical.userId).systemIds.join(',')}`)).body.total).toBe(2);

    // Someone who may see findings but not systems is not shown system owners.
    const noSystems = await withGrants('vuln_no_systems', ['vulnerabilities.*', 'security.view']);
    expect((await noSystems.get('/api/vulnerabilities/overdue-report?group=system_owner')).body).toMatchObject({ available: false, groups: [] });
    expect((await noSystems.get('/api/vulnerabilities/summary')).body.systemOwnerReport).toBe(false);
    expect((await noSystems.get('/api/vulnerabilities/overdue-report')).body.total).toBe(report.total);
  });
});

describe('restricted behavior of the newer routes', () => {
  it('gives nothing to a user without security.view, whatever vulnerabilities permissions they hold', async () => {
    const made = await create({ title: 'Quokka gateway exposure', first_seen: d(-90) });
    const blocked = await withGrants('vuln_no_security_3', ['vulnerabilities.*', 'systems.view']);
    for (const url of [
      '/api/vulnerabilities', '/api/vulnerabilities?format=csv', '/api/vulnerabilities/stats?group=severity', `/api/vulnerabilities/${made.id}`,
      '/api/vulnerabilities/summary', '/api/vulnerabilities/overdue-report', '/api/vulnerabilities/overdue-report?group=system_owner',
      '/api/vulnerabilities/policy', '/api/vulnerabilities/imports', `/api/vulnerabilities/imports/${made.id}`,
      '/api/vulnerabilities/import/fields', '/api/vulnerabilities/import/presets',
    ]) {
      const res = await blocked.get(url);
      expect([url, res.status]).toEqual([url, 403]);
      expect(res.text).not.toContain('Quokka');
    }
    expect((await blocked.get('/api/search?q=quokka')).body).toEqual([]);
    expect((await blocked.post('/api/vulnerabilities/policy', { days: {} })).status).toBe(403);
    expect((await blocked.post('/api/vulnerabilities/import', {
      csv: 'Host,Name,Risk\nh,n,high', source: 's', mapping: { host_name: 'Host', title: 'Name', severity: 'Risk' }, dryRun: false,
    })).status).toBe(403);
    expect(await stored(blocked.userId)).toEqual([]);
  });

  it('accepts a risk only under an approved exception that has not expired', async () => {
    if (!t.ctx.resources.get('policy_exception')) return; // the policies module is not loaded
    const exc = (data: Record<string, unknown>) => t.ctx.resources.create('policy_exception', { title: 'Invented exception', ...data });
    const requested = await exc({});
    const lapsed = await exc({ status: 'approved', approver_name: 'Invented approver', approved_on: d(-60), expires_on: d(-1) });
    const current = await exc({ status: 'approved', approver_name: 'Invented approver', approved_on: d(-5), expires_on: d(60) });
    const made = await create({ title: 'Platypus terminal weak cipher' });
    for (const bad of [requested, lapsed]) {
      const res = await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'risk_accepted', exception_id: bad.id });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.exception_id).toMatch(/approved exception/);
    }
    const ok = await t.api.patch(`/api/vulnerabilities/${made.id}`, { status: 'risk_accepted', exception_id: current.id });
    expect(ok.status).toBe(200);
    expect(ok.body.closed).toBe(true);
  });

  it('hides a follow-up action raised from a finding from anyone who may not see security records', async () => {
    if (!t.ctx.resources.get('action')) return; // the Actions module is not loaded
    const made = await create({ title: 'Wombat controller end of support' });
    const raised = await t.api.post('/api/actions', {
      title: 'Replace the wombat controller', source: 'other', source_type: 'vulnerability', source_id: made.id,
    });
    expect(raised.status).toBe(201);
    expect(raised.body.restricted).toBe(true);
    const actionsOnly = await withGrants('vuln_actions_only', ['actions.*']);
    expect((await actionsOnly.get(`/api/actions/${raised.body.id}`)).status).toBe(404);
    expect((await actionsOnly.get('/api/actions?q=wombat')).body.total).toBe(0);
    const lead = await withGrants('vuln_actions_lead', ['actions.*', 'security.view']);
    expect((await lead.get(`/api/actions/${raised.body.id}`)).status).toBe(200);
  });

  it('does not let someone without vulnerabilities.create import, or someone without edit', async () => {
    const body = { csv: 'Host,Name,Risk\nno-create-host,Not to be imported,high', source: 'Blocked scan', mapping: { host_name: 'Host', title: 'Name', severity: 'Risk' }, dryRun: false };
    const noCreate = await withGrants('vuln_no_create', ['vulnerabilities.view', 'vulnerabilities.edit', 'security.view']);
    const noEdit = await withGrants('vuln_no_edit', ['vulnerabilities.view', 'vulnerabilities.create', 'security.view']);
    for (const client of [noCreate, noEdit]) {
      expect((await client.post('/api/vulnerabilities/import', body)).status).toBe(403);
      expect((await client.post('/api/vulnerabilities/import', { ...body, dryRun: true })).status).toBe(403);
    }
    expect((await noCreate.post('/api/vulnerabilities/import/presets', { name: 'Blocked', mapping: { title: 'Name' } })).status).toBe(403);
    expect((await noCreate.get('/api/vulnerabilities/imports')).status).toBe(200); // history is readable
    expect((await t.api.get('/api/vulnerabilities?q=no-create-host')).body.total).toBe(0);
    expect(await t.db.query(`select 1 from vulnerability_import_batches where source = 'Blocked scan'`)).toEqual([]);
  });
});
