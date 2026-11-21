import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp, type TestApi } from '../../test/helpers.ts';
import { sweepStartingSoon } from './notify.ts';
import { blackoutWindows, blackoutApplies } from './conflicts.ts';
import { DEFAULT_APPROVAL_RULES } from './rules.ts';

// Approvals routed to named people and roles, notifications, the "Waiting for me" list,
// blackout periods for chosen systems that repeat, and the calendar for one system.
// Runs with whichever modules are loaded; the parts that need notifications or the inventory
// check that nothing breaks without them. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
let agent: TestApi & { userId: string };
let ann: TestApi & { userId: string };
let bob: TestApi & { userId: string };
let notifications = false;
let inventory = false;

const LOW = { people_affected: 'few', downtime: 'none', back_out: 'quick', experience: 'routine', testing: 'full' };
const complete = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
  title: 'Timetable switch-over on the depot server', description: 'Load the new timetable.', reason: 'Service change weekend.',
  implementation_plan: 'Load and verify.', backout_plan: 'Reload the old timetable.', risk_answers: LOW,
  planned_start: start, planned_end: end, ...extra,
});
const move = (api: TestApi, id: string, to: string, body: Record<string, unknown> = {}) => api.post(`/api/changes/${id}/transition`, { to, ...body });
const inbox = async (userId: string) => (notifications
  ? t.db.query<any>('select kind, title, route, record_id from notifications where user_id = $1 order by created_at', [userId])
  : []);
const setRules = (patch: (r: (typeof DEFAULT_APPROVAL_RULES)[number]) => Record<string, unknown>) =>
  t.api.patch('/api/changes/settings', { approval_rules: DEFAULT_APPROVAL_RULES.map((r) => ({ ...r, ...patch(r) })) });

beforeAll(async () => {
  t = await testApp();
  notifications = t.app.hasDecorator('notify');
  inventory = t.ctx.resources.get('system') !== undefined;
  agent = await t.as('agent');
  ann = await t.as('approver');
  bob = await t.as('approver');
});
afterAll(async () => { await t.close(); });

describe('the services these tests lean on', () => {
  it('are found whenever their modules are loaded, so the checks below are not skipped by accident', () => {
    const loaded = process.env.GRC_MODULES?.split(',').map((m) => m.trim());
    if (!loaded || loaded.includes('notifications')) expect(notifications).toBe(true);
    if (!loaded || loaded.includes('inventory')) expect(inventory).toBe(true);
  });
});

describe('approvals routed to named approvers', () => {
  it('lets only the named people decide, tells them, and lists the change as waiting for them', async () => {
    const saved = await setRules((r) => (r.change_type === 'normal' && r.risk_level === 'low' ? { approver_user_ids: [ann.userId] } : {}));
    expect(saved.status).toBe(200);
    expect(saved.body.user_names[ann.userId]).toBeTruthy();
    expect((await setRules((r) => (r.risk_level === 'low' ? { approver_user_ids: ['not-a-user'] } : {}))).body.error.fields)
      .toHaveProperty(['approval_rules.1.approver_user_ids']);
    expect((await setRules((r) => (r.risk_level === 'high' ? { approver_user_ids: [ann.userId] } : {}))).body.error.fields['approval_rules.3.approver_user_ids'])
      .toMatch(/at least 2/);

    const made = (await agent.post('/api/changes', complete('2032-01-05T18:00:00Z', '2032-01-05T20:00:00Z'))).body;
    expect((await move(agent, made.id, 'submitted')).body).toMatchObject({ status: 'submitted', approver_pool: { users: [ann.userId], roles: [] } });

    expect((await ann.get('/api/changes/waiting')).body.rows.map((r: any) => r.id)).toContain(made.id);
    expect((await bob.get('/api/changes/waiting')).body.rows.map((r: any) => r.id)).not.toContain(made.id);
    expect((await agent.get('/api/changes/waiting')).body.rows).toEqual([]); // no approve permission
    const view = (await bob.get(`/api/changes/${made.id}/approvals`)).body;
    expect(view).toMatchObject({ can_decide: false, pool: { users: [{ id: ann.userId }] } });
    expect(view.waiting_for).toHaveLength(1);

    const refused = await bob.post(`/api/changes/${made.id}/approvals`, { decision: 'approved' });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'not_an_approver']);
    if (notifications) {
      const asked = (await inbox(ann.userId)).filter((n) => n.record_id === made.id);
      expect(asked).toEqual([expect.objectContaining({ kind: 'approval', route: `/changes/${made.id}?tab=approvals` })]);
      expect((await inbox(bob.userId)).filter((n) => n.record_id === made.id)).toEqual([]);
      expect((await inbox(agent.userId)).filter((n) => n.record_id === made.id)).toEqual([]); // the requester is not asked
    }

    const ok = await ann.post(`/api/changes/${made.id}/approvals`, { decision: 'approved', notes: 'Agreed at the timetable meeting.' });
    expect(ok.status).toBe(201);
    expect(ok.body.change.status).toBe('approved');
    expect(ok.body.approvals.decisions[0]).toMatchObject({ approver_user_id: ann.userId, recorded_by: ann.userId });
    expect((await ann.get('/api/changes/waiting')).body.rows.map((r: any) => r.id)).not.toContain(made.id);
    if (notifications) {
      const told = (await inbox(agent.userId)).filter((n) => n.record_id === made.id);
      expect(told.map((n) => n.title)).toEqual([expect.stringMatching(/^Change approved: CHG-/)]);
      expect((await inbox(ann.userId)).filter((n) => n.record_id === made.id && /approved:/.test(n.title))).toEqual([]);
    }
  });

  it('routes to a role, counts each member once and needs as many as the rule says', async () => {
    await setRules((r) => (r.change_type === 'normal' && r.risk_level === 'low' ? { approvals: 2, approver_role_keys: ['approver'] } : {}));
    const made = (await agent.post('/api/changes', complete('2032-01-12T18:00:00Z', '2032-01-12T20:00:00Z'))).body;
    await move(agent, made.id, 'submitted');
    // The administrator holds changes.approve but not the role.
    expect((await t.api.post(`/api/changes/${made.id}/approvals`, { decision: 'approved' })).body.error.code).toBe('not_an_approver');
    expect((await ann.post(`/api/changes/${made.id}/approvals`, { decision: 'approved' })).body.change).toMatchObject({ status: 'submitted', approvals_received: 1 });
    expect((await ann.post(`/api/changes/${made.id}/approvals`, { decision: 'approved', approver_name: 'Someone else' })).body.error.code).toBe('duplicate_approver');
    expect((await bob.post(`/api/changes/${made.id}/approvals`, { decision: 'approved' })).body.change).toMatchObject({ status: 'approved', approvals_received: 2 });
    // A change submitted before the rule changed keeps the approvers it was given.
    await setRules(() => ({}));
    expect((await t.api.get(`/api/changes/${made.id}`)).body.approver_pool).toEqual({ users: [], roles: ['approver'] });
  });

  it('tells the owner and implementer once before an approved change starts', async () => {
    const soon = new Date(Date.now() + 3 * 3_600_000);
    const later = new Date(soon.getTime() + 3_600_000);
    const made = (await agent.post('/api/changes', complete(soon.toISOString(), later.toISOString(), { assignee_id: bob.userId }))).body;
    await move(agent, made.id, 'submitted');
    await ann.post(`/api/changes/${made.id}/approvals`, { decision: 'approved' });
    const first = await sweepStartingSoon(t.ctx);
    if (!notifications) { expect(first).toEqual({ changes: 0, notifications: 0 }); return; }
    expect(first.changes).toBeGreaterThanOrEqual(1);
    for (const who of [agent.userId, bob.userId]) {
      expect((await inbox(who)).filter((n) => n.record_id === made.id && n.kind === 'reminder')).toHaveLength(1);
    }
    expect((await sweepStartingSoon(t.ctx)).changes).toBe(0);
    // A new window gives a new reminder.
    const moved = new Date(soon.getTime() + 3_600_000);
    await agent.patch(`/api/changes/${made.id}`, { planned_start: moved.toISOString(), planned_end: new Date(moved.getTime() + 3_600_000).toISOString() });
    expect((await sweepStartingSoon(t.ctx)).changes).toBe(1);
  });
});

describe('blackout periods for chosen systems, that repeat', () => {
  it('works out monthly and weekly windows and which systems they apply to', () => {
    const b = { starts_at: '2032-01-31T22:00:00Z', ends_at: '2032-02-01T06:00:00Z', repeat: 'monthly', repeat_until: '2032-04-30' };
    const w = blackoutWindows(b, new Date('2032-01-01T00:00:00Z'), new Date('2032-06-01T00:00:00Z'));
    expect(w.map((x) => x.start.toISOString().slice(0, 10))).toEqual(['2032-01-31', '2032-02-29', '2032-03-31', '2032-04-30']);
    expect(blackoutWindows({ ...b, repeat: 'weekly', repeat_until: null }, new Date('2032-02-20T00:00:00Z'), new Date('2032-02-22T00:00:00Z'))
      .map((x) => x.start.toISOString().slice(0, 10))).toEqual(['2032-02-21']);
    expect(blackoutWindows({ ...b, repeat: 'none' }, new Date('2032-03-01T00:00:00Z'), new Date('2032-04-01T00:00:00Z'))).toEqual([]);
    expect(blackoutApplies({ system_ids: [] }, ['x'])).toBe(true);
    expect(blackoutApplies({ system_ids: ['a'] }, ['b'])).toBe(false);
    expect(blackoutApplies({ system_ids: '["a"]' }, ['a', 'b'])).toBe(true);
  });

  it('flags only changes on the chosen systems, in every repeat, and shows them on that system\'s calendar', async () => {
    if (!inventory) return;
    const sys = async (name: string) => (await t.ctx.resources.create('system', { name })).id as string;
    const fares = await sys('Invented fare collection');
    const signage = await sys('Invented platform signage');
    const bad = await t.api.post('/api/changes/blackouts', { name: 'x', starts_at: '2032-03-01T00:00:00Z', ends_at: '2032-03-20T00:00:00Z', repeat: 'weekly' });
    expect(bad.body.error.fields.repeat).toBeDefined();
    const blackout = await t.api.post('/api/changes/blackouts', {
      name: 'Month-end fare reconciliation', reason: 'Fare data is being closed off', system_ids: [fares],
      starts_at: '2032-01-31T22:00:00Z', ends_at: '2032-02-01T06:00:00Z', repeat: 'monthly', repeat_until: '2032-12-31',
    });
    expect(blackout.status).toBe(201);

    const onFares = (await agent.post('/api/changes', complete('2032-03-31T23:00:00Z', '2032-04-01T01:00:00Z', { system_id: fares }))).body;
    const onSignage = (await agent.post('/api/changes', complete('2032-03-31T23:00:00Z', '2032-04-01T01:00:00Z', { system_id: signage }))).body;
    const conflictsOf = async (id: string) => (await agent.get(`/api/changes/${id}/conflicts`)).body.conflicts;
    await move(agent, onFares.id, 'submitted');
    await move(agent, onSignage.id, 'submitted');
    expect((await conflictsOf(onFares.id)).map((c: any) => c.key)).toEqual([`blackout:${blackout.body.id}`]);
    // Repeats keep the local start time (17:00 in New York): 21:00 UTC once daylight saving time began (OP-07).
    expect((await conflictsOf(onFares.id))[0]).toMatchObject({ starts_at: '2032-03-31T21:00:00.000Z', shared_systems: [{ id: fares }] });
    expect(await conflictsOf(onSignage.id)).toEqual([]);

    const cal = (await agent.get(`/api/changes/calendar?from=2032-03-01T00:00:00Z&to=2032-04-15T00:00:00Z&system_id=${fares}`)).body;
    expect(cal.system).toMatchObject({ id: fares });
    expect(cal.changes.map((c: any) => c.id)).toEqual([onFares.id]);
    expect(cal.blackouts.map((b: any) => b.starts_at)).toEqual(['2032-02-29T22:00:00.000Z', '2032-03-31T21:00:00.000Z']);
    const signageCal = (await agent.get(`/api/changes/calendar?from=2032-03-01T00:00:00Z&to=2032-04-15T00:00:00Z&system_id=${signage}`)).body;
    expect(signageCal.blackouts).toEqual([]);
    expect((await agent.get('/api/changes/calendar?from=2032-03-01T00:00:00Z&to=2032-04-15T00:00:00Z&system_id=nope')).status).toBe(400);

    // The register can be filtered by system, as the system page does.
    expect((await agent.get(`/api/changes?f.system_id=${fares}`)).body.rows.map((r: any) => r.id)).toEqual([onFares.id]);
    // Setting the main system links it, and the link is in the change's history.
    const audit = await t.db.query<any>(`select action, after from audit_events where record_id = $1 and action = 'link.add'`, [onFares.id]);
    expect(audit[0].after).toMatchObject({ to_type: 'system', to_id: fares, relation: 'affects' });
    await agent.patch(`/api/changes/${onFares.id}`, { system_id: signage });
    expect((await t.db.query(`select 1 from audit_events where record_id = $1 and action = 'link.remove'`, [onFares.id])).length).toBe(1);
  });
});
