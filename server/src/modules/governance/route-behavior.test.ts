import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Behavior tests for hand-written governance routes no other test named (E40-05): PATCH and DELETE
// /api/committees/:id/members/:memberId, GET /api/committees/:id/meetings and
// POST /api/governance/reminders/run. Invented committees and people only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client; // governance.*
let viewer: Client; // governance.view
const MISSING = '00000000-0000-4000-8000-000000000301';
const audits = (action: string, id: string) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, id]);
const committee = async (name: string) => (await officer.post('/api/committees', { name, kind: 'safety' })).body.id as string;

beforeAll(async () => {
  t = await testApp();
  officer = await t.as('compliance_officer');
  viewer = await t.as('audit_lead');
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('PATCH /api/committees/:id/members/:memberId', () => {
  it('changes a member\'s side, role, voting and term, and audits before and after', async () => {
    const c = await committee('Invented joint safety committee');
    const m = (await officer.post(`/api/committees/${c}/members`, { name: 'Jordan Example', side: 'labor' })).body;
    expect(m).toMatchObject({ role: 'member', voting: true, side: 'labor', current: true });

    const res = await officer.patch(`/api/committees/${c}/members/${m.id}`, { role: 'chair', voting: false, side: 'management', to_on: dayInZone(-1) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: m.id, name: 'Jordan Example', role: 'chair', voting: false, side: 'management', to_on: dayInZone(-1), current: false });
    expect((await viewer.get(`/api/committees/${c}/members`)).body[0]).toMatchObject({ id: m.id, role: 'chair', current: false });
    const ev = await audits('committee.member_change', c);
    expect(ev).toHaveLength(1);
    expect(ev[0].before).toMatchObject({ role: 'member', voting: true, side: 'labor' });
    expect(ev[0].after).toMatchObject({ role: 'chair', voting: false, side: 'management' });

    // An empty change writes nothing.
    expect((await officer.patch(`/api/committees/${c}/members/${m.id}`, {})).body.id).toBe(m.id);
    expect(await audits('committee.member_change', c)).toHaveLength(1);
  });

  it('validates against the stored member, refuses another committee\'s member, and needs governance.edit', async () => {
    const c = await committee('Invented accessibility committee');
    const m = (await officer.post(`/api/committees/${c}/members`, { name: 'Morgan Example', from_on: '2026-03-01' })).body;
    const early = await officer.patch(`/api/committees/${c}/members/${m.id}`, { to_on: '2026-02-01' });
    expect(early.status).toBe(400);
    expect(early.body.error.fields.to_on).toBeDefined();
    expect((await officer.patch(`/api/committees/${c}/members/${m.id}`, { role: 'emperor' })).body.error.fields.role).toBeDefined();
    expect((await officer.patch(`/api/committees/${c}/members/${m.id}`, { role: '' })).body.error.fields.role).toBeDefined();
    expect((await officer.patch(`/api/committees/${c}/members/${m.id}`, { name: '' })).body.error.fields.name).toBeDefined();
    expect((await officer.patch(`/api/committees/${c}/members/${m.id}`, { from_on: 'soon' })).body.error.fields.from_on).toBeDefined();

    const other = await committee('Invented other committee');
    expect((await officer.patch(`/api/committees/${other}/members/${m.id}`, { voting: false })).status).toBe(404);
    expect((await officer.patch(`/api/committees/${c}/members/${MISSING}`, { voting: false })).status).toBe(404);
    expect((await officer.patch(`/api/committees/${MISSING}/members/${m.id}`, { voting: false })).status).toBe(404);

    expect((await viewer.patch(`/api/committees/${c}/members/${m.id}`, { voting: false })).status).toBe(403);
    expect((await viewer.del(`/api/committees/${c}/members/${m.id}`)).status).toBe(403);
    expect((await (await t.as('agent')).patch(`/api/committees/${c}/members/${m.id}`, { voting: false })).status).toBe(403);
    expect((await t.db.one<any>('select voting, deleted_at from committee_members where id = $1', [m.id]))).toEqual({ voting: true, deleted_at: null });
  });
});

describe('DELETE /api/committees/:id/members/:memberId', () => {
  it('removes a member from the list but keeps the row, and audits', async () => {
    const c = await committee('Invented bus operations committee');
    const stay = (await officer.post(`/api/committees/${c}/members`, { name: 'Riley Example' })).body;
    const go = (await officer.post(`/api/committees/${c}/members`, { name: 'Sky Example' })).body;
    const res = await officer.del(`/api/committees/${c}/members/${go.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await viewer.get(`/api/committees/${c}/members`)).body.map((m: any) => m.id)).toEqual([stay.id]);
    expect((await t.db.one<any>('select deleted_at, name from committee_members where id = $1', [go.id]))).toMatchObject({ name: 'Sky Example', deleted_at: expect.anything() });
    const ev = await audits('committee.member_remove', c);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toBe('Member removed: Sky Example');
    expect((await officer.del(`/api/committees/${c}/members/${go.id}`)).status).toBe(404);
    expect((await officer.patch(`/api/committees/${c}/members/${go.id}`, { voting: false })).status).toBe(404);
  });
});

describe('GET /api/committees/:id/meetings', () => {
  it('lists the committee\'s own meetings, newest first, without deleted ones', async () => {
    const c = await committee('Invented rail safety committee');
    const other = await committee('Invented finance committee');
    const meet = async (committee_id: string, title: string, days: number) =>
      (await officer.post('/api/meetings', { committee_id, title, scheduled_at: new Date(Date.now() + days * 86_400_000).toISOString() })).body.id as string;
    const older = await meet(c, 'Invented spring meeting', -30);
    const newer = await meet(c, 'Invented summer meeting', 30);
    const gone = await meet(c, 'Invented canceled meeting', 10);
    await meet(other, 'Invented finance meeting', 5);
    expect((await t.api.del(`/api/meetings/${gone}`)).status).toBe(200);

    const res = await viewer.get(`/api/committees/${c}/meetings`);
    expect(res.status).toBe(200);
    expect(res.body.map((m: any) => m.id)).toEqual([newer, older]);
    expect(Object.keys(res.body[0]).sort()).toEqual(['id', 'quorum_met', 'ref', 'scheduled_at', 'status', 'title']);
    expect(res.body[0]).toMatchObject({ title: 'Invented summer meeting', status: 'planned' });

    expect((await viewer.get(`/api/committees/${MISSING}/meetings`)).status).toBe(404);
    expect((await (await t.as('agent')).get(`/api/committees/${c}/meetings`)).status).toBe(403);
  });
});

describe('POST /api/governance/reminders/run', () => {
  it('needs governance.administer, runs, and answers its counts; each occasion is announced once', async () => {
    expect((await viewer.post('/api/governance/reminders/run')).status).toBe(403);
    expect((await (await t.as('executive_viewer')).post('/api/governance/reminders/run')).status).toBe(403);

    const c = await committee('Invented reminder committee');
    const m = (await officer.post('/api/meetings', { committee_id: c, title: 'Invented meeting soon', scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), secretary_id: officer.userId })).body.id;
    const res = await officer.post('/api/governance/reminders/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, packsDue: expect.any(Number), minutesWaiting: expect.any(Number), agendasDue: expect.any(Number), notified: expect.any(Number) });
    expect(res.body.packsDue).toBeGreaterThanOrEqual(1);
    const sent = async () => (await t.db.query(`select 1 from notifications where record_id = $1 and kind = 'governance'`, [m])).length;
    expect(await sent()).toBeGreaterThanOrEqual(1);
    const first = await sent();
    await officer.post('/api/governance/reminders/run');
    expect(await sent()).toBe(first);
  });
});
