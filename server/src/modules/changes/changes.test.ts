import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp, type TestApi } from '../../test/helpers.ts';
import mod from './index.ts';
import { computeRisk, DEFAULT_APPROVAL_RULES, DEFAULT_QUESTIONNAIRE, matchRule } from './rules.ts';

// Stand-ins for the inventory and actions modules, so cross-module behaviour is tested without them.
const standIns: ModuleDef = {
  key: 'changestandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_chg_systems (
        id uuid primary key default gen_random_uuid(), name text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists t_chg_actions (
        id uuid primary key default gen_random_uuid(), title text not null, description text, priority text,
        source text, source_type text, source_id text, owner_id uuid, due_on date,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'system', table: 't_chg_systems', module: 'systems', label: 'System', plural: 'Systems',
      path: '/api/systems', route: '/systems', titleField: 'name',
      fields: { name: { label: 'Name', type: 'text', required: true } },
    });
    ctx.defineResource({
      type: 'action', table: 't_chg_actions', module: 'actions', label: 'Action', plural: 'Actions',
      path: '/api/actions', route: '/actions', titleField: 'title',
      fields: {
        title: { label: 'Title', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        priority: { label: 'Priority', type: 'text' },
        source: { label: 'Source', type: 'text' },
        source_type: { label: 'Source type', type: 'text' },
        source_id: { label: 'Source record', type: 'text' },
        owner_id: { label: 'Owner', type: 'user' },
        due_on: { label: 'Due', type: 'date' },
      },
    });
  },
};

const LOW = { people_affected: 'few', downtime: 'none', back_out: 'quick', experience: 'routine', testing: 'full' };
const MEDIUM = { people_affected: 'team', downtime: 'out_of_hours', back_out: 'slow', experience: 'some', testing: 'partial' };
const HIGH = { people_affected: 'most', downtime: 'working_hours', back_out: 'slow', experience: 'never', testing: 'partial' };

/** A two-hour window on an invented day; every test uses its own days so windows never clash by accident. */
const win = (day: string, hour = 18, hours = 2) => ({
  planned_start: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`,
  planned_end: `${day}T${String(hour + hours).padStart(2, '0')}:00:00.000Z`,
});

const complete = (day: string, extra: Record<string, unknown> = {}) => ({
  title: 'Replace the archive disk', description: 'Swap the failing disk.', reason: 'The disk reports errors.',
  implementation_plan: 'Swap the disk and rebuild.', test_plan: 'Read a file back.', backout_plan: 'Refit the old disk.',
  risk_answers: LOW, ...win(day), ...extra,
});

let t: Awaited<ReturnType<typeof testApp>>;
let agent: TestApi & { userId: string };
let approver: TestApi & { userId: string };
let viewer: TestApi & { userId: string };

const move = (api: TestApi, id: string, to: string, body: Record<string, unknown> = {}) => api.post(`/api/changes/${id}/transition`, { to, ...body });
const approveAs = (api: TestApi, id: string, name: string, decision = 'approved') =>
  api.post(`/api/changes/${id}/approvals`, { decision, approver_name: name, approver_role: 'Change manager', reference: 'Email of today' });
const actions = async (id: string) => (await t.db.query<{ action: string }>('select action from audit_events where record_id = $1 order by at, id', [id])).map((r) => r.action);

/** A change raised by the agent and taken to "approved" by the approver. */
async function approved(day: string, extra: Record<string, unknown> = {}) {
  const made = await agent.post('/api/changes', complete(day, extra));
  expect(made.status).toBe(201);
  expect((await move(agent, made.body.id, 'submitted')).body.status).toBe('submitted');
  const res = await approveAs(approver, made.body.id, 'Ada Approver');
  expect(res.body.change.status).toBe('approved');
  return made.body.id as string;
}

beforeAll(async () => {
  process.env.GRC_MODULES = 'changes'; // the stand-ins replace the real inventory and risks modules
  t = await testApp({ extraModules: [standIns] });
  agent = await t.as('agent');
  approver = await t.as('approver');
  viewer = await t.as('project_manager'); // holds changes.view only
});
afterAll(async () => { await t.close(); });

describe('rules', () => {
  it('scores the questionnaire by weight and needs every answer for a level', () => {
    expect(computeRisk(LOW, DEFAULT_QUESTIONNAIRE)).toMatchObject({ score: 0, level: 'low', complete: true });
    expect(computeRisk(MEDIUM, DEFAULT_QUESTIONNAIRE)).toMatchObject({ score: 42, level: 'medium' });
    expect(computeRisk(HIGH, DEFAULT_QUESTIONNAIRE)).toMatchObject({ score: 72, level: 'high' });
    expect(computeRisk({ people_affected: 'most' }, DEFAULT_QUESTIONNAIRE)).toMatchObject({ level: null, complete: false });
    expect(computeRisk(null, DEFAULT_QUESTIONNAIRE)).toMatchObject({ score: null, level: null });
  });

  it('matches approval rules by type and risk; an emergency never needs more than one approver', () => {
    expect(matchRule(DEFAULT_APPROVAL_RULES, 'normal', 'high').approvals).toBe(2);
    expect(matchRule(DEFAULT_APPROVAL_RULES, 'normal', 'low').approvals).toBe(1);
    expect(matchRule(DEFAULT_APPROVAL_RULES, 'standard', 'low').approvals).toBe(0);
    expect(matchRule([{ ...DEFAULT_APPROVAL_RULES[4], approvals: 3, pir_required: false }], 'emergency', 'high')).toMatchObject({ approvals: 1, pir_required: true });
    expect(matchRule([], 'normal', 'low').approvals).toBe(1);
  });
});

describe('change record', () => {
  it('lets an agent raise a change with a reference, a draft status, a computed risk and an audit event', async () => {
    const res = await agent.post('/api/changes', complete('2031-01-06', { risk_answers: MEDIUM, status: 'approved' }));
    expect(res.status).toBe(201);
    expect(res.body.ref).toMatch(/^CHG-\d{5}$/);
    expect(res.body).toMatchObject({ status: 'draft', change_type: 'normal', risk_score: 42, risk_level: 'medium', approvals_required: 1, owner_id: agent.userId });
    expect(res.body._display.status).toBe('Draft');
    expect(await actions(res.body.id)).toEqual(['change.create']);
    expect((await viewer.get(`/api/changes/${res.body.id}`)).status).toBe(200);
    expect((await viewer.post('/api/changes', complete('2031-01-07'))).status).toBe(403);
    expect((await t.anon.get('/api/changes')).status).toBe(401);
  });

  it('validates the window, the answers and the type', async () => {
    const backwards = await agent.post('/api/changes', { ...complete('2031-01-08'), planned_end: '2031-01-08T10:00:00Z' });
    expect(backwards.body.error.fields.planned_end).toMatch(/after the planned start/);
    const answer = await agent.post('/api/changes', complete('2031-01-08', { risk_answers: { downtime: 'sometimes' } }));
    expect(answer.body.error.fields.risk_answers).toMatch(/not an answer/);
    const standard = await agent.post('/api/changes', complete('2031-01-08', { change_type: 'standard' }));
    expect(standard.body.error.fields.change_type).toMatch(/template/);
  });

  it('lets the risk be overridden only with a reason, and audits it', async () => {
    const made = await agent.post('/api/changes', complete('2031-01-09'));
    const bare = await agent.patch(`/api/changes/${made.body.id}`, { risk_override: 'high' });
    expect(bare.body.error.fields.risk_override_reason).toBeDefined();
    const res = await agent.patch(`/api/changes/${made.body.id}`, { risk_override: 'high', risk_override_reason: 'Touches the payment network' });
    expect(res.body).toMatchObject({ risk_level: 'high', risk_computed: 'low', approvals_required: 2 });
    expect(await actions(made.body.id)).toContain('change.risk_override');
  });
});

describe('lifecycle and approvals', () => {
  it('enforces the allowed moves and what a submission needs', async () => {
    const made = await agent.post('/api/changes', { title: 'Half-written change' });
    const id = made.body.id;
    expect((await move(agent, id, 'scheduled')).body.error.code).toBe('bad_transition');
    expect((await move(agent, id, 'closed')).body.error.code).toBe('bad_transition');
    expect((await agent.patch(`/api/changes/${id}`, { status: 'approved' })).body.status).toBe('draft');
    const early = await move(agent, id, 'submitted');
    expect(early.status).toBe(400);
    expect(Object.keys(early.body.error.fields).sort()).toEqual(['backout_plan', 'description', 'implementation_plan', 'planned_end', 'planned_start', 'reason', 'risk_answers']);
    expect((await move(viewer, id, 'cancelled')).status).toBe(403);
  });

  it('needs the approvals the rule asks for, from people with changes.approve, before work can be scheduled or started', async () => {
    const made = await agent.post('/api/changes', complete('2031-02-03', { risk_answers: HIGH }));
    const id = made.body.id;
    const submitted = await move(agent, id, 'submitted');
    expect(submitted.body).toMatchObject({ status: 'submitted', approvals_required: 2, approvals_received: 0 });

    expect((await approveAs(viewer, id, 'Vic Viewer')).status).toBe(403);
    const own = await approveAs(agent, id, 'The Requester');
    expect([own.status, own.body.error.code]).toEqual([403, 'own_change']);
    expect((await move(agent, id, 'scheduled')).body.error.code).toBe('bad_transition');
    expect((await move(agent, id, 'in_progress')).body.error.code).toBe('approvals_missing');
    // A decision recorded by hand names who gave it.
    expect((await approver.post(`/api/changes/${id}/approvals`, { decision: 'approved', by_hand: true })).body.error.fields.approver_name).toBeDefined();

    const first = await approveAs(approver, id, 'Ada Approver');
    expect(first.status).toBe(201);
    expect(first.body.change).toMatchObject({ status: 'submitted', approvals_received: 1 });
    // One person cannot make up the number by typing other names: the decision belongs to whoever records it.
    expect((await approveAs(approver, id, 'Ben Owner')).body.error.code).toBe('duplicate_approver');
    expect((await approver.post(`/api/changes/${id}/approvals`, { decision: 'approved' })).body.error.code).toBe('duplicate_approver');
    expect((await t.api.get(`/api/changes/${id}/approvals`)).body).toMatchObject({ received: 1, can_decide: true });
    // The second approver records their own decision, without typing a name.
    const second = await t.api.post(`/api/changes/${id}/approvals`, { decision: 'approved', notes: 'Fine by me.' });
    expect(second.body.change).toMatchObject({ status: 'approved', approvals_received: 2 });
    expect(second.body.approvals.decisions.map((d: any) => d.approver_name).sort()).toEqual(['Ada Approver', 'Test Admin']);
    expect((await approveAs(approver, id, 'Cy Late')).body.error.code).toBe('not_awaiting_approval');
    expect((await actions(id)).filter((a) => a === 'change.approval').length).toBe(2);

    // The type and risk fixed the approval path, so they are locked now.
    expect((await agent.patch(`/api/changes/${id}`, { risk_answers: LOW })).body.error.code).toBe('locked');
    expect((await agent.patch(`/api/changes/${id}`, { test_plan: 'Read two files back.' })).status).toBe(200);

    expect((await move(agent, id, 'scheduled')).body.status).toBe('scheduled');
    const started = await move(agent, id, 'in_progress');
    expect(started.body.status).toBe('in_progress');
    expect(started.body.actual_start).toBeTruthy();
    expect((await move(agent, id, 'completed')).body.error.fields.outcome).toBeDefined();
    const done = await move(agent, id, 'completed', { outcome: 'successful' });
    expect(done.body).toMatchObject({ status: 'completed', outcome: 'successful', pir_required: false });
    expect((await move(agent, id, 'closed')).body.status).toBe('closed');
    expect((await agent.patch(`/api/changes/${id}`, { title: 'Too late' })).body.error.code).toBe('closed');
    expect((await actions(id)).filter((a) => a === 'change.transition').length).toBe(5);
  });

  it('returns a rejected change to draft, and earlier approvals no longer count', async () => {
    const made = await agent.post('/api/changes', complete('2031-02-10', { risk_answers: HIGH }));
    const id = made.body.id;
    await move(agent, id, 'submitted');
    await approveAs(approver, id, 'Ada Approver');
    const rejected = await approveAs(t.api, id, 'Ben Owner', 'rejected');
    expect(rejected.body.change.status).toBe('rejected');
    expect((await move(agent, id, 'scheduled')).body.error.code).toBe('bad_transition');
    expect((await move(agent, id, 'draft')).body).toMatchObject({ status: 'draft', approvals_received: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect((await move(agent, id, 'submitted')).body.status).toBe('submitted');
    const again = await approveAs(approver, id, 'Ada Approver');
    expect(again.body.change).toMatchObject({ status: 'submitted', approvals_received: 1 });
    expect(again.body.approvals.decisions.filter((d: any) => d.current).length).toBe(1);
  });

  it('lets an emergency change proceed with one approver and demands a review before closure', async () => {
    const made = await agent.post('/api/changes', complete('2031-03-03', { change_type: 'emergency', risk_answers: HIGH }));
    const id = made.body.id;
    expect(made.body).toMatchObject({ risk_level: 'high', approvals_required: 1, pir_required: true });
    await move(agent, id, 'submitted');
    expect((await move(agent, id, 'in_progress')).body.error.code).toBe('approvals_missing');
    expect((await approveAs(approver, id, 'Dee Duty')).body.change.status).toBe('approved');
    expect((await move(agent, id, 'in_progress')).body.status).toBe('in_progress');
    expect((await move(agent, id, 'completed', { outcome: 'successful' })).body.status).toBe('completed');

    expect((await move(agent, id, 'closed')).body.error.code).toBe('review_missing');
    expect((await move(agent, id, 'reviewed')).body.error.code).toBe('review_missing');
    expect((await viewer.post(`/api/changes/${id}/review`, { what_happened: 'x', cause: 'y' })).status).toBe(403);
    const thin = await agent.post(`/api/changes/${id}/review`, { what_happened: 'The service was restored.' });
    expect(thin.body.error.fields.cause).toBeDefined();
    const review = await agent.post(`/api/changes/${id}/review`, {
      what_happened: 'The service was restored in an hour.', cause: 'A full disk.', follow_up: 'Add an alert.',
      actions: [{ title: 'Add a disk space alert', due_on: '2031-04-01', owner_id: agent.userId }, { title: '  ' }],
    });
    expect(review.status).toBe(200);
    expect(review.body.change).toMatchObject({ status: 'reviewed', pir_cause: 'A full disk.' });
    expect(review.body.actions).toHaveLength(1);
    const raised = await t.db.query<any>('select * from t_chg_actions where source_id = $1', [id]);
    expect(raised[0]).toMatchObject({ title: 'Add a disk space alert', source: 'other', source_type: 'change', owner_id: agent.userId });
    expect(await actions(id)).toEqual(expect.arrayContaining(['change.review', 'change.action_raised']));
    expect((await move(agent, id, 'closed')).body.status).toBe('closed');
  });

  it('demands a review before a failed change is closed', async () => {
    const id = await approved('2031-03-10');
    await move(agent, id, 'in_progress');
    const failed = await move(agent, id, 'completed', { outcome: 'failed', outcome_notes: 'The disk would not rebuild.' });
    expect(failed.body).toMatchObject({ status: 'completed', pir_required: true });
    expect((await move(agent, id, 'closed')).body.error.code).toBe('review_missing');
    const wf = await agent.get(`/api/changes/${id}/workflow`);
    expect(wf.body.review).toEqual({ required: true, done: false });
    await agent.post(`/api/changes/${id}/review`, { what_happened: 'The rebuild failed.', cause: 'A faulty spare.' });
    expect((await move(agent, id, 'closed')).body.status).toBe('closed');
  });

  it('can allow approval after the fact for emergencies, and flags it', async () => {
    const rules = DEFAULT_APPROVAL_RULES.map((r) => (r.change_type === 'emergency' ? { ...r, retrospective: true } : r));
    expect((await viewer.patch('/api/changes/settings', { approval_rules: rules })).status).toBe(403);
    const two = await t.api.patch('/api/changes/settings', { approval_rules: rules.map((r) => (r.change_type === 'emergency' ? { ...r, approvals: 2 } : r)) });
    expect(two.body.error.fields['approval_rules.4.approvals']).toMatch(/one approver/);
    expect((await t.api.patch('/api/changes/settings', { approval_rules: rules })).status).toBe(200);
    expect((await t.db.query(`select 1 from audit_events where action = 'setting.change' and record_id = 'changes.approval_rules'`)).length).toBe(1);

    const made = await agent.post('/api/changes', complete('2031-03-17', { change_type: 'emergency' }));
    const id = made.body.id;
    await move(agent, id, 'submitted');
    expect((await move(agent, id, 'in_progress')).body.status).toBe('in_progress');
    await move(agent, id, 'completed', { outcome: 'successful' });
    await agent.post(`/api/changes/${id}/review`, { what_happened: 'Fixed.', cause: 'Known fault.' });
    expect((await move(agent, id, 'closed')).body.error.code).toBe('approvals_missing');
    const late = await approveAs(approver, id, 'Dee Duty');
    expect(late.body.change).toMatchObject({ status: 'reviewed', approvals_received: 1, approved_retrospectively: true });
    expect(late.body.approvals.decisions[0].retrospective).toBe(true);
    expect((await move(agent, id, 'closed')).body.status).toBe('closed');

    await t.api.patch('/api/changes/settings', { approval_rules: DEFAULT_APPROVAL_RULES });
  });
});

describe('standard change templates', () => {
  it('are kept by people with changes.administer and give a pre-approved change', async () => {
    const template = {
      name: 'Monthly patching', title: 'Monthly patching of one server', implementation_plan: 'Patch and restart.',
      backout_plan: 'Restore the snapshot.', risk_level: 'low', duration_minutes: 90,
    };
    expect((await viewer.post('/api/changes/templates', template)).status).toBe(403);
    expect((await approver.post('/api/changes/templates', template)).status).toBe(403);
    expect((await t.api.post('/api/changes/templates', { name: 'No plans' })).body.error.fields.backout_plan).toBeDefined();
    const made = await t.api.post('/api/changes/templates', template);
    expect(made.status).toBe(201);
    expect((await t.db.query(`select 1 from audit_events where action = 'change.template_create' and record_id = $1`, [made.body.id])).length).toBe(1);

    expect((await viewer.post(`/api/changes/templates/${made.body.id}/raise`, { planned_start: '2031-04-07T18:00:00Z' })).status).toBe(403);
    const raised = await agent.post(`/api/changes/templates/${made.body.id}/raise`, { planned_start: '2031-04-07T18:00:00Z' });
    expect(raised.status).toBe(201);
    expect(raised.body).toMatchObject({
      change_type: 'standard', status: 'approved', approvals_required: 0, template_name: 'Monthly patching',
      title: 'Monthly patching of one server', backout_plan: 'Restore the snapshot.', risk_level: 'low',
    });
    expect(new Date(raised.body.planned_end).toISOString()).toBe('2031-04-07T19:30:00.000Z');
    expect(await actions(raised.body.id)).toEqual(expect.arrayContaining(['change.create', 'change.from_template']));
    expect((await move(agent, raised.body.id, 'scheduled')).body.status).toBe('scheduled');
    expect((await agent.patch(`/api/changes/${raised.body.id}`, { change_type: 'normal' })).status).not.toBe(200);

    const listed = (await agent.get('/api/changes/templates')).body.find((x: any) => x.id === made.body.id);
    expect(listed).toMatchObject({ uses: 1, uses_90_days: 1 });
    await t.api.patch(`/api/changes/templates/${made.body.id}`, { active: false });
    expect((await agent.post(`/api/changes/templates/${made.body.id}/raise`, { planned_start: '2031-04-08T18:00:00Z' })).body.error.code).toBe('template_inactive');
    expect((await agent.get('/api/changes/templates')).body.some((x: any) => x.id === made.body.id)).toBe(false);
  });
});

describe('calendar, blackout periods and conflicts', () => {
  it('flags a change that falls in a blackout period and needs an audited override to schedule it', async () => {
    const blackout = { name: 'Year-end close', starts_at: '2031-05-05T00:00:00Z', ends_at: '2031-05-08T00:00:00Z', reason: 'Accounts are being closed' };
    expect((await viewer.post('/api/changes/blackouts', blackout)).status).toBe(403);
    expect((await t.api.post('/api/changes/blackouts', { ...blackout, ends_at: '2031-05-01T00:00:00Z' })).body.error.fields.ends_at).toBeDefined();
    const made = await t.api.post('/api/changes/blackouts', blackout);
    expect(made.status).toBe(201);

    const live = await agent.post('/api/changes/conflicts/check', { ...win('2031-05-06'), system_ids: [] });
    expect(live.body.conflicts.map((c: any) => c.kind)).toEqual(['blackout']);
    expect((await agent.post('/api/changes/conflicts/check', { ...win('2031-05-09'), system_ids: [] })).body.conflicts).toEqual([]);

    const id = await approved('2031-05-06');
    const found = (await agent.get(`/api/changes/${id}/conflicts`)).body.conflicts;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: `blackout:${made.body.id}`, kind: 'blackout', acknowledged: null });
    expect(found[0].summary).toContain('Year-end close');

    const blocked = await move(agent, id, 'scheduled');
    expect([blocked.status, blocked.body.error.code]).toEqual([409, 'conflicts']);
    expect((await move(agent, id, 'in_progress')).body.error.code).toBe('conflicts');
    expect((await viewer.post(`/api/changes/${id}/conflicts/acknowledge`, { reason: 'Because' })).status).toBe(403);
    expect((await approver.post(`/api/changes/${id}/conflicts/acknowledge`, {})).body.error.fields.reason).toBeDefined();
    const ack = await approver.post(`/api/changes/${id}/conflicts/acknowledge`, { reason: 'Agreed with the finance director' });
    expect(ack.body.conflicts[0].acknowledged).toMatchObject({ reason: 'Agreed with the finance director' });
    const events = await t.db.query<any>(`select summary, after from audit_events where action = 'change.conflict_override' and record_id = $1`, [id]);
    expect(events).toHaveLength(1);
    expect(events[0].after.reason).toBe('Agreed with the finance director');
    expect((await move(agent, id, 'scheduled')).body.status).toBe('scheduled');

    const cal = await viewer.get('/api/changes/calendar?from=2031-05-01T00:00:00Z&to=2031-06-01T00:00:00Z');
    expect(cal.body.blackouts.map((b: any) => b.name)).toEqual(['Year-end close']);
    expect(cal.body.changes.find((c: any) => c.id === id)).toMatchObject({ unacknowledged: 0 });
    expect(cal.body.changes.find((c: any) => c.id === id).conflicts).toHaveLength(1);

    // Moving the change inside the blackout means the override no longer covers it.
    await agent.patch(`/api/changes/${id}`, win('2031-05-07'));
    expect((await agent.get(`/api/changes/${id}/conflicts`)).body.conflicts[0].acknowledged).toBeNull();
    expect((await agent.get('/api/changes/calendar?from=2031-05-01T00:00:00Z&to=2031-06-01T00:00:00Z')).body.changes.find((c: any) => c.id === id).unacknowledged).toBe(1);
    expect((await agent.get('/api/changes/calendar?from=bad&to=worse')).status).toBe(400);
  });

  it('flags two live changes that overlap on a shared system', async () => {
    const alpha = (await t.api.post('/api/systems', { name: 'Alpha ledger' })).body.id;
    const beta = (await t.api.post('/api/systems', { name: 'Beta gateway' })).body.id;

    const first = await approved('2031-06-02', { system_id: alpha });
    // The main system is also a generic link, so the system's own page lists the change.
    const onSystem = await t.api.get(`/api/links?record_type=system&record_id=${alpha}`);
    expect(onSystem.body).toEqual([expect.objectContaining({ direction: 'in', relation: 'affects', type: 'change', recordId: first })]);

    const second = await agent.post('/api/changes', complete('2031-06-02', { ...win('2031-06-02', 19, 2), system_id: beta, title: 'Reconfigure the gateway' }));
    expect((await agent.get(`/api/changes/${second.body.id}/conflicts`)).body.conflicts).toEqual([]);

    // A second affected system, added as a link, brings the clash.
    const linked = await agent.post('/api/links', { from_type: 'change', from_id: second.body.id, to_type: 'system', to_id: alpha, relation: 'affects' });
    expect(linked.status).toBe(201);
    const clash = (await agent.get(`/api/changes/${second.body.id}/conflicts`)).body.conflicts;
    expect(clash).toHaveLength(1);
    expect(clash[0]).toMatchObject({ key: `change:${first}`, kind: 'change', shared_systems: [{ id: alpha, label: 'Alpha ledger' }] });
    expect((await agent.get(`/api/changes/${first}/conflicts`)).body.conflicts).toEqual([]); // the other is still a draft

    await move(agent, second.body.id, 'submitted');
    expect((await agent.get(`/api/changes/${first}/conflicts`)).body.conflicts[0].key).toBe(`change:${second.body.id}`);
    expect((await move(agent, first, 'scheduled')).body.error.code).toBe('conflicts');

    const check = await agent.post('/api/changes/conflicts/check', { ...win('2031-06-02', 18, 2), system_ids: [alpha], exclude_id: first });
    expect(check.body.conflicts.map((c: any) => c.key)).toEqual([`change:${second.body.id}`]);

    // No overlap, no conflict.
    await agent.patch(`/api/changes/${second.body.id}`, win('2031-06-03'));
    expect((await agent.get(`/api/changes/${first}/conflicts`)).body.conflicts).toEqual([]);
    expect((await move(agent, first, 'scheduled')).body.status).toBe('scheduled');
  });
});

describe('configuration', () => {
  it('keeps the questionnaire as data and applies a change to drafts', async () => {
    const made = await agent.post('/api/changes', complete('2031-07-07', { risk_answers: MEDIUM }));
    expect(made.body.risk_level).toBe('medium');
    const current = (await agent.get('/api/changes/settings')).body.questionnaire;
    const bands = [{ level: 'low', upTo: 10 }, { level: 'medium', upTo: 40 }, { level: 'high', upTo: 100 }];

    expect((await viewer.patch('/api/changes/settings', { questionnaire: { ...current, bands } })).status).toBe(403);
    const bad = await t.api.patch('/api/changes/settings', { questionnaire: { questions: [{ label: 'Only one answer?', weight: 1, options: [{ label: 'Yes', score: 1 }] }], bands } });
    expect(bad.body.error.fields['questions.0.options']).toBeDefined();
    const saved = await t.api.patch('/api/changes/settings', { questionnaire: { ...current, bands } });
    expect(saved.status).toBe(200);
    expect(saved.body.recalculated).toBeGreaterThan(0);
    expect((await agent.get(`/api/changes/${made.body.id}`)).body).toMatchObject({ risk_level: 'high', approvals_required: 2 });

    await t.api.patch('/api/changes/settings', { questionnaire: DEFAULT_QUESTIONNAIRE });
    expect((await agent.get(`/api/changes/${made.body.id}`)).body.risk_level).toBe('medium');
  });

  it('reports the register overview', async () => {
    const res = await viewer.get('/api/changes/overview?week_from=2031-06-01T00:00:00Z&week_to=2031-06-08T00:00:00Z');
    expect(res.status).toBe(200);
    expect(res.body.this_week).toBe(2);
    expect(res.body.awaiting_approval).toBeGreaterThan(0);
  });
});

describe('sample data', () => {
  it('seeds changes, templates and blackout periods once, with exactly one conflict', async () => {
    const count = async (sql: string) => (await t.db.one<{ c: number }>(`select count(*)::int c from ${sql}`))!.c;
    await mod.seed!(t.ctx, { profile: 'dev', seedDir: '' });
    const first = await count(`changes where title like '[Sample]%'`);
    expect(first).toBe(14);
    await mod.seed!(t.ctx, { profile: 'dev', seedDir: '' });
    expect(await count(`changes where title like '[Sample]%'`)).toBe(first);
    expect(await count(`change_templates where name like '[Sample]%'`)).toBe(2);
    expect(await count(`change_blackouts where name like '[Sample]%'`)).toBe(3);
    expect(await count(`change_blackouts where name like '[Sample]%' and repeat = 'monthly'`)).toBe(1);

    const statuses = await t.db.query<{ status: string }>(`select distinct status from changes where title like '[Sample]%'`);
    expect(statuses.length).toBeGreaterThanOrEqual(7);
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    const to = new Date(Date.now() + 30 * 86400000).toISOString();
    const cal = await t.api.get(`/api/changes/calendar?from=${from}&to=${to}`);
    const samples = cal.body.changes.filter((c: any) => c.title.startsWith('[Sample]'));
    expect(samples.reduce((n: number, c: any) => n + c.unacknowledged, 0)).toBe(1);
    expect(samples.find((c: any) => c.unacknowledged)?.conflicts[0].kind).toBe('blackout');
  });
});
