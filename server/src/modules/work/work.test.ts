import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarSources } from '../../core/calendar.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { isPast } from './index.ts';

// E41-03: one My work list and a compliance calendar across every area, from the calendar source
// registry. The administrator owns one item of every new kind; the agent (no audits, controls or
// funding permission) owns an action to verify.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let agent: Client;
let adminId: string;
const before = process.env.GRC_MODULES;
const ids: Record<string, string> = {};

const KINDS = ['audits.requests', 'controls.tests', 'actions.verifications', 'audits.inspections', 'obligations.attestations', 'vendors.reassessments', 'training.certifications', 'funding.certifications'];

beforeAll(async () => {
  process.env.GRC_MODULES = 'work,audits,risks,controls,vendors,training,people,funding,workflows,inventory,notifications,attachments,admin,feeds,mobile';
  t = await testApp();
  agent = await t.as('agent');
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  const soon = dayInZone(5);
  const late = dayInZone(-3);

  // An evidence request (overdue), an inspection, a control's next test and a planned test.
  ids.request = (await t.db.one<{ id: string }>(
    `insert into audit_requests (ref, audit_id, request, owner_id, due_on, status) values ('REQ-9001', gen_random_uuid(), 'Invented: the depot key log.', $1, $2, 'requested') returning id`,
    [adminId, late]))!.id;
  await t.db.query(`insert into audit_requests (ref, audit_id, request, owner_id, due_on, status) values ('REQ-9002', gen_random_uuid(), 'Already given.', $1, $2, 'accepted')`, [adminId, late]);
  ids.inspection = (await t.db.one<{ id: string }>(
    `insert into inspections (ref, template_id, title, inspector_id, due_on, status) values ('INS-9001', gen_random_uuid(), 'Invented depot walk-through', $1, $2, 'scheduled') returning id`, [adminId, soon]))!.id;
  const control = await t.api.post('/api/controls', { title: 'Invented gate badge check', control_type: 'preventive', domain: 'safety', status: 'active', owner_id: adminId });
  expect(control.status, JSON.stringify(control.body)).toBe(201);
  ids.control = control.body.id;
  await t.db.query('update controls set next_test_due = $2 where id = $1', [ids.control, soon]);

  // Corrective actions waiting for verification: the admin's, and the agent's.
  ids.verify = (await t.db.one<{ id: string }>(
    `insert into actions (ref, title, status, verification_required, verifier_id, verification_due) values ('ACT-9001', 'Invented fence repair', 'pending_verification', true, $1, $2) returning id`, [adminId, soon]))!.id;
  ids.agentVerify = (await t.db.one<{ id: string }>(
    `insert into actions (ref, title, status, verification_required, verifier_id, verification_due) values ('ACT-9002', 'Invented lighting fix', 'pending_verification', true, $1, $2) returning id`, [agent.userId, soon]))!.id;

  // An obligation with a recorded period to attest (overdue), other than its next due date.
  const obligation = await t.api.post('/api/obligations', { title: 'Invented quarterly safety return', owner_id: adminId });
  expect(obligation.status, JSON.stringify(obligation.body)).toBe(201);
  ids.obligation = obligation.body.id;
  await t.db.query(`insert into obligation_periods (obligation_id, period_start, period_end, due_on) values ($1, $2, $2, $2)`, [ids.obligation, late]);

  // A vendor to reassess.
  const vendor = await t.api.post('/api/vendors', { name: 'Invented Signal Supplies', owner_id: adminId });
  expect(vendor.status, JSON.stringify(vendor.body)).toBe(201);
  ids.vendor = vendor.body.id;
  await t.db.query('update vendors set next_assessment_due = $2 where id = $1', [ids.vendor, soon]);

  // The admin's own certification, expiring soon.
  const person = await t.api.post('/api/people', { full_name: 'Invented Admin Person', employee_number: 'W1', user_id: adminId });
  expect(person.status, JSON.stringify(person.body)).toBe(201);
  const type = (await t.db.one<{ value: string }>(`select value from lookups where list_key = 'certification_type' order by sort limit 1`))!.value;
  const cert = await t.api.post('/api/certifications', { person_id: person.body.id, certification_type: type, issued_on: dayInZone(-300), expires_on: soon });
  expect(cert.status, JSON.stringify(cert.body)).toBe(201);
  ids.cert = cert.body.id;

  // A funding certification for the admin to sign.
  const funding = await t.api.post('/api/funding-certifications', { year: 2027, title: 'Invented yearly assurances', signer_id: adminId, due_on: soon });
  expect(funding.status, JSON.stringify(funding.body)).toBe(201);
  ids.funding = funding.body.id;
});
afterAll(async () => {
  await t?.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

describe('due work registry', () => {
  it('registers every kind once, as work', () => {
    const admin = { id: adminId, username: 'admin', displayName: 'Admin', email: '', roles: ['admin'], permissions: ['*'] };
    const sources = calendarSources(t.app, t.ctx.resources, admin as never);
    for (const key of KINDS) {
      const s = sources.find((x) => x.key === key);
      expect(s, key).toBeTruthy();
      expect(s!.work, key).toBe(true);
      expect(s!.anyone, key).toBe(true);
    }
  });

  it('knows what is past its date', () => {
    expect(isPast('2026-01-01', true, '2026-01-02')).toBe(true);
    expect(isPast('2026-01-02', true, '2026-01-02')).toBe(false);
    expect(isPast('2026-01-02T10:00:00Z', false, '2026-01-02', Date.parse('2026-01-02T11:00:00Z'))).toBe(true);
  });
});

describe('GET /api/work/mine', () => {
  it('lists the person\'s own due work of every kind, overdue first', async () => {
    const res = await t.api.get('/api/work/mine');
    expect(res.status).toBe(200);
    const keys = res.body.sections.map((s: any) => s.key);
    for (const key of KINDS) expect(keys, key).toContain(key);
    const requests = res.body.sections.find((s: any) => s.key === 'audits.requests');
    expect(requests.count).toBe(1); // the accepted one is done
    expect(requests.items[0]).toMatchObject({ recordId: ids.request, overdue: true, kind: 'Evidence requests', area: 'audits', personId: adminId, ref: 'REQ-9001' });
    expect(res.body.sections[0].overdue).toBeGreaterThan(0);
    expect(res.body.overdue).toBe(2); // the request and the period to attest
    const verifications = res.body.sections.find((s: any) => s.key === 'actions.verifications');
    expect(verifications.items.map((i: any) => i.recordId)).toEqual([ids.verify]); // not the agent's
    expect(res.body.sections.find((s: any) => s.key === 'training.certifications').items[0].recordId).toBe(ids.cert);
    expect(res.body.sections.find((s: any) => s.key === 'funding.certifications').items[0].title).toContain('Sign certification');
  });

  it('gives another person only their own, and only kinds they may see', async () => {
    const res = await agent.get('/api/work/mine');
    expect(res.status).toBe(200);
    const keys = res.body.sections.map((s: any) => s.key);
    expect(keys).toEqual(['actions.verifications']);
    expect(res.body.sections[0].items[0].recordId).toBe(ids.agentVerify);
  });

  it('checks its query', async () => {
    const skipped = await t.api.get('/api/work/mine?skip=audits.requests,controls.tests');
    expect(skipped.body.sections.map((s: any) => s.key)).not.toContain('audits.requests');
    expect(skipped.body.sections.map((s: any) => s.key)).not.toContain('controls.tests');
    expect((await t.api.get('/api/work/mine?days=400')).status).toBe(400);
    expect((await t.api.get('/api/work/mine?limit=0')).status).toBe(400);
    expect((await t.anon.get('/api/work/mine')).status).toBe(401);
  });
});

describe('GET /api/work/calendar', () => {
  const from = dayInZone(-10);
  const to = dayInZone(20);

  it('shows everything dated in the window that the person may see, for anyone', async () => {
    const all = await t.api.get(`/api/work/calendar?from=${from}&to=${to}&person=all`);
    expect(all.status).toBe(200);
    const recordIds = all.body.items.map((i: any) => i.recordId);
    for (const id of [ids.request, ids.inspection, ids.control, ids.verify, ids.agentVerify, ids.obligation, ids.vendor, ids.cert, ids.funding]) expect(recordIds).toContain(id);
    expect(all.body.areas.map((a: any) => a.key)).toEqual(expect.arrayContaining(['audits', 'controls', 'vendors', 'funding', 'training']));
    const agentItem = all.body.items.find((i: any) => i.recordId === ids.agentVerify);
    expect(agentItem.personId).toBe(agent.userId);
    expect(agentItem.personName).toBeTruthy();
  });

  it('filters by person and by area', async () => {
    const theirs = await t.api.get(`/api/work/calendar?from=${from}&to=${to}&person=${agent.userId}`);
    expect(theirs.body.items.map((i: any) => i.recordId)).toEqual([ids.agentVerify]);
    const mine = await t.api.get(`/api/work/calendar?from=${from}&to=${to}`);
    expect(mine.body.items.map((i: any) => i.recordId)).not.toContain(ids.agentVerify);
    const audits = await t.api.get(`/api/work/calendar?from=${from}&to=${to}&person=all&area=audits`);
    expect(new Set(audits.body.items.map((i: any) => i.area))).toEqual(new Set(['audits']));
    expect(audits.body.items.length).toBe(2);
    const kind = await t.api.get(`/api/work/calendar?from=${from}&to=${to}&person=all&kind=vendors.reassessments`);
    expect(kind.body.items.map((i: any) => i.recordId)).toEqual([ids.vendor]);
  });

  it('leaves out what the person may not see', async () => {
    const res = await agent.get(`/api/work/calendar?from=${from}&to=${to}&person=all`);
    expect(res.status).toBe(200);
    const areas = new Set(res.body.items.map((i: any) => i.area));
    expect(areas.has('audits')).toBe(false);
    expect(areas.has('controls')).toBe(false);
    expect(areas.has('funding')).toBe(false);
    expect(res.body.areas.map((a: any) => a.key)).not.toContain('audits');
  });

  it('checks its query', async () => {
    expect((await t.api.get('/api/work/calendar?from=2026-01-01&to=2028-01-01')).status).toBe(400);
    expect((await t.api.get('/api/work/calendar?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await t.api.get('/api/work/calendar?person=nobody')).status).toBe(400);
    const month = await t.api.get('/api/work/calendar');
    expect(month.status).toBe(200);
    expect(month.body.from.slice(8)).toBe('01');
  });
});

describe('switched-off areas and the mobile app', () => {
  it('shows the new kinds in the app\'s My work', async () => {
    expect((await t.api.patch('/api/admin/features', { features: { mobile: true } })).status).toBe(200);
    const home = await t.api.get('/api/mobile/home');
    expect(home.status).toBe(200);
    const keys = home.body.sections.map((s: any) => s.key);
    for (const key of ['audits.requests', 'controls.tests', 'actions.verifications', 'obligations.attestations', 'vendors.reassessments', 'training.certifications', 'funding.certifications']) {
      expect(keys, key).toContain(key);
    }
    expect(keys).toContain('inspections'); // its own section, not twice
    expect(keys).not.toContain('audits.inspections');
    const req = home.body.sections.find((s: any) => s.key === 'audits.requests');
    expect(req).toMatchObject({ label: 'Evidence requests', count: 1, webRoute: '/calendar?view=mine&kind=audits.requests' });
    expect(req.items[0]).toMatchObject({ type: 'audit_request', id: ids.request, overdue: true });
  });

  it('leaves a switched-off area out of My work, the calendar and the app', async () => {
    expect((await t.api.patch('/api/admin/features', { features: { vendors: false, audits: false } })).status).toBe(200);
    try {
      const keys = (await t.api.get('/api/work/mine')).body.sections.map((s: any) => s.key);
      expect(keys).not.toContain('vendors.reassessments');
      expect(keys).not.toContain('audits.requests');
      const cal = await t.api.get(`/api/work/calendar?from=${dayInZone(-10)}&to=${dayInZone(20)}&person=all`);
      expect(cal.body.items.some((i: any) => ['vendors', 'audits'].includes(i.area))).toBe(false);
      expect(cal.body.areas.map((a: any) => a.key)).not.toContain('vendors');
      const app = (await t.api.get('/api/mobile/home')).body.sections.map((s: any) => s.key);
      expect(app).not.toContain('vendors.reassessments');
    } finally {
      await t.api.patch('/api/admin/features', { features: { vendors: true, audits: true, mobile: false } });
    }
  });
});
