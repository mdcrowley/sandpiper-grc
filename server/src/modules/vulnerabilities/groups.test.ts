import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, today } from './policy.ts';

// E45-36: one finding on several hosts worked as one item, bulk actions, raising a change and the
// urgency order. Invented hosts and identifiers only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  process.env.GRC_MODULES = 'vulnerabilities,changes';
  t = await testApp();
});
afterAll(async () => { await t.close(); });

const make = async (over: Record<string, unknown>) => {
  const res = await t.api.post('/api/vulnerabilities', { title: 'Pretend file share allows remote code', severity: 'high', plugin_id: '880001', ...over });
  expect(res.status).toBe(201);
  return res.body;
};

describe('findings grouped by identifier', () => {
  let ids: string[] = [];
  beforeAll(async () => {
    ids = [
      (await make({ host_name: 'grp-host-a', port: '445' })).id,
      (await make({ host_name: 'grp-host-b', port: '445', severity: 'critical' })).id,
      (await make({ host_name: 'grp-host-c', port: '445' })).id,
    ];
    await make({ title: 'Pretend lone finding', plugin_id: '880002', host_name: 'grp-host-a', severity: 'low' });
  });

  it('lists one row per finding with host counts and the worst open severity', async () => {
    const res = await t.api.get('/api/vulnerabilities/groups?q=880001');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const g = res.body.rows[0];
    expect(g).toMatchObject({ key: 'id:880001', hosts: 3, open: 3, closed: 0, severity: 'critical', unassigned: 3 });
    expect(g.urgency).toBeGreaterThan(0);
    const multi = await t.api.get('/api/vulnerabilities/groups?multi=true&q=grp');
    expect(multi.body.rows.map((r: any) => r.key)).not.toContain('id:880002');
  });

  it('shows each host of one group', async () => {
    const res = await t.api.get(`/api/vulnerabilities/group?key=${encodeURIComponent('id:880001')}`);
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(3);
    expect(res.body.findings.map((f: any) => f.host_name).sort()).toEqual(['grp-host-a', 'grp-host-b', 'grp-host-c']);
    expect((await t.api.get('/api/vulnerabilities/group?key=nothing-here')).status).toBe(404);
  });

  it('assigns, accepts and closes several at once, reporting what a rule refused', async () => {
    const me = (await t.api.get('/api/auth/state')).body.user.id;
    const assigned = await t.api.post('/api/vulnerabilities/bulk', { ids, patch: { owner_id: me, title: 'ignored' } });
    expect(assigned.body).toMatchObject({ updated: 3, failed: [] });
    expect((await t.api.get(`/api/vulnerabilities/${ids[0]}`)).body.owner_id).toBe(me);
    expect((await t.api.get(`/api/vulnerabilities/${ids[0]}`)).body.title).toBe('Pretend file share allows remote code');

    // Risk acceptance needs a justification and an approver who is not the person recording it.
    const refused = await t.api.post('/api/vulnerabilities/bulk', { ids: [ids[0]], patch: { status: 'risk_accepted', acceptance_justification: 'Segment is isolated', acceptance_approver_id: me } });
    expect(refused.body.updated).toBe(0);
    expect(refused.body.failed[0].message).toMatch(/someone other/i);
    const lead = await t.as('security_lead');
    const accepted = await t.api.post('/api/vulnerabilities/bulk', { ids: [ids[0]], patch: { status: 'risk_accepted', acceptance_justification: 'Segment is isolated', acceptance_approver_id: lead.userId } });
    expect(accepted.body.updated).toBe(1);

    const fixed = await t.api.post('/api/vulnerabilities/bulk', { ids: [ids[1]], patch: { status: 'fixed', fixed_on: today() } });
    expect(fixed.body.updated).toBe(1);
    const g = (await t.api.get('/api/vulnerabilities/groups?q=880001')).body.rows[0];
    expect(g).toMatchObject({ open: 1, closed: 2, severity: 'high' });
    expect((await t.api.post('/api/vulnerabilities/bulk', { ids, patch: { title: 'x' } })).status).toBe(400);
    expect((await t.api.post('/api/vulnerabilities/bulk', { ids: ['nope'], patch: { owner_id: me } })).status).toBe(400);
  });

  it('needs the edit permission for bulk actions', async () => {
    const agent = await t.as('agent');
    expect((await agent.post('/api/vulnerabilities/bulk', { ids, patch: { status: 'open' } })).status).toBe(403);
  });
});

describe('raise a change from findings', () => {
  it('creates a draft change naming the findings, linked both ways, and starts remediation', async () => {
    const a = await make({ plugin_id: '880101', title: 'Pretend outdated database engine', host_name: 'chg-host-a', solution: 'Upgrade to the supported release.' });
    const b = await make({ plugin_id: '880101', title: 'Pretend outdated database engine', host_name: 'chg-host-b' });
    const res = await t.api.post('/api/vulnerabilities/raise-change', { ids: [a.id, b.id] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ linked: 2, started: 2 });
    const change = (await t.api.get(`/api/changes/${res.body.id}`)).body;
    expect(change.title).toBe('Fix: Pretend outdated database engine on 2 hosts');
    expect(change.description).toContain(a.ref);
    expect(change.description).toContain('chg-host-b');
    expect(change.description).toContain('Upgrade to the supported release.');
    expect(change.status).toBe('draft');
    const fromFinding = (await t.api.get(`/api/links?record_type=vulnerability&record_id=${a.id}`)).body;
    expect(fromFinding).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'change', recordId: change.id, relation: 'fixes' })]));
    const fromChange = (await t.api.get(`/api/links?record_type=change&record_id=${change.id}`)).body;
    expect(fromChange.map((l: any) => l.recordId).sort()).toEqual([a.id, b.id].sort());
    expect((await t.api.get(`/api/vulnerabilities/${a.id}`)).body.status).toBe('in_remediation');
  });

  it('names the number of findings when they are different findings', async () => {
    const a = await make({ plugin_id: '880201', title: 'Pretend weak cipher', host_name: 'mix-host-a' });
    const b = await make({ plugin_id: '880202', title: 'Pretend old library', host_name: 'mix-host-a' });
    const res = await t.api.post('/api/vulnerabilities/raise-change', { ids: [a.id, b.id] });
    expect((await t.api.get(`/api/changes/${res.body.id}`)).body.title).toBe('Fix 2 vulnerability findings on 1 host');
    expect((await t.api.post('/api/vulnerabilities/raise-change', { ids: [] })).status).toBe(400);
  });

  it('needs the permission to create changes', async () => {
    const f = await make({ plugin_id: '880102', host_name: 'chg-host-c' });
    const lead = await t.as('security_lead');
    const can = (await lead.get('/api/auth/state')).body.permissions as string[];
    const res = await lead.post('/api/vulnerabilities/raise-change', { ids: [f.id] });
    expect(res.status).toBe(can.some((p) => p === 'changes.create' || p === 'changes.*' || p === '*') ? 201 : 403);
    const agent = await t.as('agent'); // no security.view: findings are out of reach
    expect((await agent.post('/api/vulnerabilities/raise-change', { ids: [f.id] })).status).toBe(403);
  });
});

describe('urgency order', () => {
  it('sorts open findings by severity, exposure, known exploitation and fix-by date', async () => {
    const first = addDays(today(), -5);
    const low = await make({ plugin_id: 'u-1', title: 'Urgency low', severity: 'low', host_name: 'urg-1', first_seen: first });
    const high = await make({ plugin_id: 'u-2', title: 'Urgency high', severity: 'high', host_name: 'urg-2', first_seen: first });
    const exposed = await make({ plugin_id: 'u-3', title: 'Urgency high internet', severity: 'high', exposure: 'internet', host_name: 'urg-3', first_seen: first });
    const exploited = await make({ plugin_id: 'u-4', title: 'Urgency high internet exploited', severity: 'high', exposure: 'internet', known_exploited: true, host_name: 'urg-4', first_seen: first });
    const overdue = await make({ plugin_id: 'u-5', title: 'Urgency high overdue', severity: 'high', host_name: 'urg-5', first_seen: addDays(today(), -60) });
    // high 7, fix-by date within 30 days x1.2; exposure internet x2; known exploited x2; overdue x2 (instead of x1.2).
    expect(Number(high.urgency)).toBe(8.4);
    expect(Number(exposed.urgency)).toBe(16.8);
    expect(Number(exploited.urgency)).toBe(33.6);
    expect(Number(overdue.urgency)).toBe(14);
    expect(Number(low.urgency)).toBe(2);
    const list = (await t.api.get('/api/vulnerabilities?q=Urgency&pageSize=50&sort=')).body.rows.map((r: any) => r.title);
    const order = (await t.api.get('/api/vulnerabilities?f.host_name=urg-1,urg-2,urg-3,urg-4,urg-5')).body.rows.map((r: any) => r.title);
    expect(order[0]).toBe('Urgency high internet exploited');
    expect(order[order.length - 1]).toBe('Urgency low');
    expect(list.length).toBeGreaterThan(0);
    const closed = (await t.api.patch(`/api/vulnerabilities/${low.id}`, { status: 'fixed' })).body;
    expect(Number(closed.urgency)).toBe(0);
    expect((await t.api.post('/api/vulnerabilities', { title: 'Bad exposure', severity: 'low', exposure: 'orbit' })).status).toBe(400);
  });
});
