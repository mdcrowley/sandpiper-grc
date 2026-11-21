import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import type { ModuleDef, Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { runGovernanceReminders } from './reminders.ts';

// Stand-ins: a roster person (contract C4, people module) and a record type with an approval kind
// whose two steps are decided by people named on the record, the second by a different person.
const standIn: ModuleDef = {
  key: 'govstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_people (
        id uuid primary key default gen_random_uuid(), ref text, full_name text not null, employee_number text, status text,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists t_grequests (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, approver_id uuid, second_id uuid, status text,
        restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'person', table: 't_people', module: 'people', label: 'Person', plural: 'People', path: '/api/people', route: '/people',
      titleField: 'full_name', ref: { field: 'ref', prefix: 'PER-' },
      fields: { ref: { label: 'Reference', type: 'text', readOnly: true }, full_name: { label: 'Name', type: 'text', required: true }, employee_number: { label: 'Employee number', type: 'text' }, status: { label: 'Status', type: 'text' } },
    });
    ctx.defineResource({
      type: 'grequest', table: 't_grequests', module: 'governance', label: 'Test request', plural: 'Test requests', path: '/api/t-grequests', route: '/t-grequests',
      titleField: 'title', ref: { field: 'ref', prefix: 'TRQ-' }, restricted: 'flag',
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Title', type: 'text', required: true },
        approver_id: { label: 'First approver', type: 'user' }, second_id: { label: 'Second approver', type: 'user' },
        status: { label: 'Status', type: 'text' }, restricted: { label: 'Restricted', type: 'boolean' },
      },
    });
    defineApprovalKind(ctx.app, {
      key: 'grequest_approval', recordType: 'grequest', label: 'Test request approval', startsWhen: 'A test starts it', outcome: 'Sets the status',
      approverPermission: 'policies.approve',
      async install(h) {
        if (!(await h.hasDefinitions())) {
          await h.define({ name: 'Test request approval', steps: [
            { key: 'a', name: 'First', approvers: { kind: 'field', field: 'approver_id' }, quorum: 'any' },
            { key: 'b', name: 'Second', approvers: { kind: 'field', field: 'second_id' }, quorum: 'any', distinct_approvers: true },
          ] });
        }
      },
      async onFinish(e) {
        await ctx.db.query('update t_grequests set status = $2 where id = $1', [e.instance.recordId, e.outcome]);
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let secretary: Client; // compliance officer: governance.*, no policies.approve, no security.view
let chair: Client;     // security lead: governance.view, policies.*, security.view
let chair2: Client;    // a second security lead
let viewer: Client;    // safety manager: governance.view only
let committeeId: string;
let meetingId: string;

const audit = (action: string, recordId?: string) =>
  t.db.query<Row>(`select * from audit_events where action = $1 ${recordId ? 'and record_id = $2' : ''} order by id`, recordId ? [action, recordId] : [action]);

beforeAll(async () => {
  process.env.GRC_MODULES = 'governance,policies,workflows,notifications,reports,risks';
  t = await testApp({ extraModules: [standIn] });
  secretary = await t.as('compliance_officer');
  chair = await t.as('security_lead');
  chair2 = await t.as('security_lead');
  viewer = await t.as('safety_manager');
});
afterAll(async () => { delete process.env.GRC_MODULES; await t.close(); });

describe('committees and members', () => {
  it('creates a committee with a COM- reference and checks the quorum', async () => {
    const bad = await secretary.post('/api/committees', { name: 'Invented committee', kind: 'safety', quorum_rule: 'percent', quorum_value: 150 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.quorum_value).toBeTruthy();
    expect((await secretary.post('/api/committees', { name: 'Invented committee', kind: 'safety', quorum_value: -2 })).status).toBe(400);
    const res = await secretary.post('/api/committees', {
      name: 'Invented joint safety committee', kind: 'safety', quorum_rule: 'percent', quorum_value: 50,
      chair_id: chair.userId, secretary_id: secretary.userId, joint_labor_management: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.ref).toMatch(/^COM-/);
    committeeId = res.body.id;
    expect((await viewer.post('/api/committees', { name: 'Not allowed', kind: 'other' })).status).toBe(403);
  });

  it('adds members by side, from an account, a roster person or a name', async () => {
    const person = (await t.api.post('/api/people', { full_name: 'Invented Frontline Rep', employee_number: 'E100' })).body;
    const add = (b: Row) => secretary.post(`/api/committees/${committeeId}/members`, b);
    expect((await add({ user_id: chair.userId, side: 'management', role: 'chair' })).body.name).toMatch(/Test security_lead/);
    expect((await add({ person_id: person.id, side: 'labor' })).body.name).toBe('Invented Frontline Rep');
    // The name is read from the person, never copied.
    expect((await t.db.query<Row>('select name from committee_members where person_id = $1', [person.id]))[0].name).toBeNull();
    expect((await add({ name: 'Invented Labor Member', side: 'labor' })).status).toBe(201);
    expect((await add({ name: 'Invented Alternate', side: 'labor', role: 'alternate', voting: false })).status).toBe(201);
    expect((await add({ side: 'labor' })).status).toBe(400);
    expect((await add({ name: 'X', side: 'sideways' })).status).toBe(400);
    expect((await add({ person_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await add({ name: 'X', from_on: '2026-05-01', to_on: '2026-01-01' })).status).toBe(400);
    const members = (await viewer.get(`/api/committees/${committeeId}/members`)).body;
    expect(members).toHaveLength(4);
    expect(members[0].side).toBe('management');
    // Three voting members, 50% rounded up: two needed.
    expect((await viewer.get(`/api/committees/${committeeId}/quorum`)).body).toMatchObject({ voting: 3, needed: 2 });
    expect((await audit('committee.member_add', committeeId)).length).toBe(4);
  });
});

describe('meetings, attendance, agenda and minutes', () => {
  it('copies the chair and secretary and refuses to set "minutes approved" by hand', async () => {
    const res = await secretary.post('/api/meetings', { committee_id: committeeId, title: 'Invented meeting', scheduled_at: new Date(Date.now() - 86_400_000).toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.ref).toMatch(/^MTG-/);
    expect(res.body.chair_id).toBe(chair.userId);
    expect(res.body.secretary_id).toBe(secretary.userId);
    meetingId = res.body.id;
    expect((await secretary.patch(`/api/meetings/${meetingId}`, { status: 'minutes_approved' })).status).toBe(400);
  });

  it('works out the quorum from attendance', async () => {
    const att = (await viewer.get(`/api/meetings/${meetingId}/attendance`)).body;
    expect(att.quorum.met).toBeNull();
    const voting = att.members.filter((m: Row) => m.voting);
    let r = await secretary.put(`/api/meetings/${meetingId}/attendance`, { attendance: [{ member_id: voting[0].member_id, present: true }, { member_id: voting[1].member_id, apology: true }] });
    expect(r.status).toBe(200);
    expect(r.body.quorum).toMatchObject({ present: 1, needed: 2, met: false });
    r = await secretary.put(`/api/meetings/${meetingId}/attendance`, { attendance: [{ member_id: voting[1].member_id, present: true }] });
    expect(r.body.quorum.met).toBe(true);
    expect((await secretary.get(`/api/meetings/${meetingId}`)).body.quorum_met).toBe(true);
    expect((await secretary.put(`/api/meetings/${meetingId}/attendance`, { attendance: [{ member_id: '00000000-0000-4000-8000-000000000000', present: true }] })).status).toBe(400);
    expect((await viewer.put(`/api/meetings/${meetingId}/attendance`, { attendance: [] })).status).toBe(403);
  });

  it('keeps an agenda that names only records the reader may see', async () => {
    const restricted = (await t.api.post('/api/t-grequests', { title: 'Invented restricted request', restricted: true })).body;
    // The secretary cannot see a restricted record, so cannot put it on the agenda.
    expect((await secretary.post(`/api/meetings/${meetingId}/agenda`, { title: 'Hidden', record_type: 'grequest', record_id: restricted.id })).status).toBe(400);
    expect((await t.api.post(`/api/meetings/${meetingId}/agenda`, { title: 'Restricted item', record_type: 'grequest', record_id: restricted.id })).status).toBe(201);
    const a = await secretary.post(`/api/meetings/${meetingId}/agenda`, { title: 'Apologies and minutes of the last meeting', presenter: 'Chair' });
    expect(a.status).toBe(201);
    const agenda = (await secretary.get(`/api/meetings/${meetingId}/agenda`)).body;
    expect(agenda).toHaveLength(2);
    expect(agenda[0].record).toEqual({ hidden: true });
    const order = await secretary.put(`/api/meetings/${meetingId}/agenda/order`, { ids: [agenda[1].id, agenda[0].id] });
    expect(order.body.map((x: Row) => x.title)).toEqual(['Apologies and minutes of the last meeting', 'Restricted item']);
    expect((await secretary.put(`/api/meetings/${meetingId}/agenda/order`, { ids: [agenda[1].id] })).status).toBe(400);
  });

  it('freezes a report pack for the meeting', async () => {
    const pack = await t.api.post('/api/report-packs', { name: 'Invented committee pack', sharing: 'everyone', sections: [{ kind: 'text', title: 'Cover note', body: 'Invented.' }] });
    expect(pack.status).toBe(201);
    // The secretary may not export reports, so cannot produce the pack.
    expect((await secretary.post(`/api/meetings/${meetingId}/freeze-pack`, { pack_id: pack.body.id })).status).toBe(403);
    const r = await t.api.post(`/api/meetings/${meetingId}/freeze-pack`, { pack_id: pack.body.id });
    expect(r.status).toBe(201);
    expect(r.body.snapshot.title).toMatch(/^MTG-/);
    expect((await viewer.get(`/api/meetings/${meetingId}/pack`)).body.snapshot.id).toBe(r.body.snapshot.id);
  });

  it('has the minutes approved by the chair through the approval workflow', async () => {
    expect((await secretary.post(`/api/meetings/${meetingId}/minutes/submit`)).status).toBe(409); // not held yet
    await secretary.patch(`/api/meetings/${meetingId}`, { status: 'held' });
    expect((await secretary.post(`/api/meetings/${meetingId}/minutes/submit`)).status).toBe(400); // no minutes
    await secretary.patch(`/api/meetings/${meetingId}`, { minutes: 'Invented minutes.' });
    expect((await chair.post(`/api/meetings/${meetingId}/minutes/submit`)).status).toBe(403); // chair lacks governance.edit
    const sub = await secretary.post(`/api/meetings/${meetingId}/minutes/submit`);
    expect(sub.status).toBe(201);
    expect((await secretary.patch(`/api/meetings/${meetingId}`, { minutes: 'Changed while waiting.' })).status).toBe(409);
    const waiting = (await chair.get('/api/workflows/approvals')).body.rows.find((r: Row) => r.record_id === meetingId);
    expect(waiting).toBeTruthy();
    expect((await chair.post(`/api/workflows/steps/${waiting.step_id}/decision`, { decision: 'approved' })).status).toBe(200);
    const m = (await secretary.get(`/api/meetings/${meetingId}`)).body;
    expect(m.status).toBe('minutes_approved');
    // Locked now.
    expect((await secretary.patch(`/api/meetings/${meetingId}`, { location: 'Elsewhere' })).status).toBe(409);
    expect((await secretary.post(`/api/meetings/${meetingId}/agenda`, { title: 'Late item' })).status).toBe(409);
    expect((await audit('meeting.minutes_approved', meetingId)).length).toBe(1);
  });
});

describe('decisions and applying them to waiting approvals', () => {
  let heldId: string;
  let requestId: string;

  beforeAll(async () => {
    const m = await secretary.post('/api/meetings', { committee_id: committeeId, title: 'Invented second meeting', scheduled_at: new Date(Date.now() - 3_600_000).toISOString(), status: 'held' });
    heldId = m.body.id;
    const req = (await t.api.post('/api/t-grequests', { title: 'Invented request', approver_id: chair.userId, second_id: chair.userId })).body;
    requestId = req.id;
    const started = await approvalEngine(t.app)!.start('grequest_approval', req, { requester: null, req: null });
    expect(started?.status).toBe('running');
  });

  it('records decisions with DEC- references, linked to the record decided', async () => {
    const d = await secretary.post('/api/meeting-decisions', { meeting_id: heldId, title: 'Approve the invented request', outcome: 'approved', record_type: 'grequest', record_id: requestId });
    expect(d.status).toBe(201);
    expect(d.body.ref).toMatch(/^DEC-/);
    const links = (await secretary.get(`/api/links?record_type=grequest&record_id=${requestId}`)).body;
    expect(links.some((l: Row) => l.relation === 'decided' && l.recordId === d.body.id)).toBe(true);
    // A decision cannot be added to a meeting whose minutes are approved.
    expect((await secretary.post('/api/meeting-decisions', { meeting_id: meetingId, title: 'Too late' })).status).toBe(409);
  });

  it('lists approvals waiting for the chair', async () => {
    const w = (await secretary.get(`/api/governance/waiting-decisions?committee=${committeeId}`)).body;
    expect(w.chair_id).toBe(chair.userId);
    expect(w.items.map((i: Row) => i.record_id)).toContain(requestId);
  });

  it('lets only the chair apply before the minutes are approved, and records it as the chair\'s decision', async () => {
    const d = (await secretary.get(`/api/meeting-decisions?f.meeting_id=${heldId}`)).body.rows[0];
    expect((await secretary.post(`/api/meeting-decisions/${d.id}/apply`)).status).toBe(409); // minutes not approved yet
    expect((await viewer.post(`/api/meeting-decisions/${d.id}/apply`)).status).toBe(403);   // neither chair nor secretary
    const r = await chair.post(`/api/meeting-decisions/${d.id}/apply`);
    expect(r.status).toBe(200);
    expect(r.body.applied_to_workflow).toMatch(/Test request approval/);
    const decided = await t.db.query<Row>(`select d.user_id, d.via from workflow_decisions d join workflow_instances i on i.id = d.instance_id where i.record_id = $1`, [requestId]);
    expect(decided).toEqual([expect.objectContaining({ user_id: chair.userId, via: 'meeting' })]);
    expect((await audit('meeting_decision.apply', d.id)).length).toBe(1);
    expect((await audit('workflow.decided_at_meeting', requestId)).length).toBe(1);
    expect((await chair.post(`/api/meeting-decisions/${d.id}/apply`)).status).toBe(409); // once only
    // Its outcome can no longer be changed.
    expect((await secretary.patch(`/api/meeting-decisions/${d.id}`, { outcome: 'rejected' })).status).toBe(409);
  });

  it('respects the different-person rule: the chair cannot also decide the second step', async () => {
    const d = await secretary.post('/api/meeting-decisions', { meeting_id: heldId, title: 'Approve the second step too', outcome: 'approved', record_type: 'grequest', record_id: requestId });
    const r = await chair.post(`/api/meeting-decisions/${d.body.id}/apply`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('chair_not_approver');
    expect((await secretary.get(`/api/meeting-decisions/${d.body.id}`)).body.applied_at).toBeNull();
  });

  it('respects the permission check: a chair without the kind\'s permission cannot decide', async () => {
    const other = (await secretary.post('/api/committees', { name: 'Invented other committee', kind: 'other', chair_id: secretary.userId, secretary_id: chair2.userId })).body;
    const m = (await secretary.post('/api/meetings', { committee_id: other.id, title: 'Invented', scheduled_at: new Date(Date.now() - 3_600_000).toISOString(), status: 'held' })).body;
    const req = (await t.api.post('/api/t-grequests', { title: 'Invented request two', approver_id: secretary.userId })).body;
    await approvalEngine(t.app)!.start('grequest_approval', req, { requester: null, req: null });
    const d = (await secretary.post('/api/meeting-decisions', { meeting_id: m.id, title: 'Approve', outcome: 'approved', record_type: 'grequest', record_id: req.id })).body;
    // The compliance officer chairs it but lacks policies.approve, which the kind needs.
    const r = await secretary.post(`/api/meeting-decisions/${d.id}/apply`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('chair_not_approver');
  });

  it('keeps decisions about restricted records restricted', async () => {
    const hidden = (await t.api.post('/api/t-grequests', { title: 'Invented restricted', restricted: true })).body;
    const d = await t.api.post('/api/meeting-decisions', { meeting_id: heldId, title: 'Invented restricted decision', record_type: 'grequest', record_id: hidden.id, outcome: 'noted' });
    expect(d.body.restricted).toBe(true);
    expect((await secretary.get(`/api/meeting-decisions/${d.body.id}`)).status).toBe(404);
    expect((await chair.get(`/api/meeting-decisions/${d.body.id}`)).status).toBe(200);
    expect((await secretary.get(`/api/meetings/${heldId}/decisions`)).body.some((x: Row) => x.id === d.body.id)).toBe(false);
    expect((await secretary.post('/api/meeting-decisions', { meeting_id: heldId, title: 'X', record_type: 'grequest', record_id: hidden.id })).status).toBe(400);
  });

  it('files actions agreed at a meeting under "Meeting"', async () => {
    const a = await secretary.post('/api/actions', { title: 'Invented follow-up', source_type: 'meeting', source_id: heldId, due_on: '2099-01-01' });
    expect(a.status).toBe(201);
    expect(a.body.source).toBe('meeting');
  });
});

describe('reminders', () => {
  it('reminds the secretary once when a pack is due and when minutes wait', async () => {
    const soon = await secretary.post('/api/meetings', { committee_id: committeeId, title: 'Invented upcoming', scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    const old = await secretary.post('/api/meetings', { committee_id: committeeId, title: 'Invented old', scheduled_at: new Date(Date.now() - 10 * 86_400_000).toISOString(), status: 'held' });
    const ctx = { app: t.app, db: t.db, settings: { get: async (_k: string, f: unknown) => f } } as any;
    const first = await runGovernanceReminders(ctx);
    expect(first.packsDue).toBeGreaterThanOrEqual(1);
    expect(first.minutesWaiting).toBeGreaterThanOrEqual(1);
    const mine = await t.db.query<Row>('select record_id from notifications where user_id = $1 and record_id = any($2::uuid[])', [secretary.userId, [soon.body.id, old.body.id]]);
    expect(mine).toHaveLength(2);
    await runGovernanceReminders(ctx);
    expect(await t.db.query<Row>('select record_id from notifications where user_id = $1 and record_id = any($2::uuid[])', [secretary.userId, [soon.body.id, old.body.id]])).toHaveLength(2);
  });
});
