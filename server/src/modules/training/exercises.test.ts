import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';

// The real action tracker lives in another module. When it is not loaded (GRC_MODULES=training)
// a stand-in with the same shared contract is registered for the "with actions" tests.
const realActions = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('risks');

const actionsStandIn: ModuleDef = {
  key: 'testactions',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_actions (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, description text, status text,
        priority text, owner_id uuid, due_on date, source text, source_type text, source_id text,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('action_status', [{ value: 'open', label: 'Open', color: 'blue' }, { value: 'done', label: 'Done', color: 'green' }]);
    await ctx.lookups.ensure('action_priority', [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]);
    await ctx.lookups.ensure('action_source', [{ value: 'exercise', label: 'Exercise' }, { value: 'other', label: 'Other' }]);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'action', table: 'test_actions', module: 'actions', label: 'Action', plural: 'Actions',
      path: '/api/actions', route: '/actions', titleField: 'title', ref: { field: 'ref', prefix: 'ACT-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        status: { label: 'Status', type: 'lookup', list: 'action_status', default: 'open' },
        priority: { label: 'Priority', type: 'lookup', list: 'action_priority', default: 'medium' },
        owner_id: { label: 'Owner', type: 'user' },
        due_on: { label: 'Due', type: 'date' },
        source: { label: 'Source', type: 'lookup', list: 'action_source', default: 'other' },
        source_type: { label: 'Source record type', type: 'text' },
        source_id: { label: 'Source record', type: 'text' },
      },
    });
  },
};

const today = localDate();

describe('exercises', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let id: string;
  beforeAll(async () => { t = await testApp({ extraModules: realActions ? [] : [actionsStandIn] }); });
  afterAll(async () => { await t.close(); });

  it('creates an exercise with a reference and checks its dates', async () => {
    const made = await t.api.post('/api/exercises', {
      title: 'Tabletop: lost laptop', type: 'tabletop', exercise_date: addDays(today, -30), scenario: 'A laptop is left on a train.',
      scope: 'Laptops, remote wipe', facilitator: 'Example Facilitator', objectives: 'Wipe within one hour',
    });
    expect(made.status).toBe(201);
    expect(made.body.ref).toMatch(/^EXR-\d{5}$/);
    expect(made.body.status).toBe('planned');
    id = made.body.id;
    expect((await t.api.post('/api/exercises', { title: 'No type' })).body.error.fields.type).toBeDefined();
    const bad = await t.api.patch(`/api/exercises/${id}`, { next_due_on: addDays(today, -60) });
    expect(bad.body.error.fields.next_due_on).toMatch(/after the exercise date/);
    const done = await t.api.patch(`/api/exercises/${id}`, { status: 'completed', result: 'partly_met', next_due_on: addDays(today, 335) });
    expect(done.body._display).toMatchObject({ status: 'Completed', result: 'Partly met', type: 'Tabletop exercise' });
  });

  it('records participants', async () => {
    const one = await t.api.post(`/api/exercises/${id}/participants`, { name: 'Jo Example', role: 'IT lead' });
    expect(one.status).toBe(201);
    expect(one.body).toMatchObject({ name: 'Jo Example', role: 'IT lead', attended: true });
    const many = await t.api.post(`/api/exercises/${id}/participants`, { names: 'Al Example\n\n Bo Example ', attended: true });
    expect(many.body.map((p: any) => p.name)).toEqual(['Al Example', 'Bo Example']);
    expect((await t.api.post(`/api/exercises/${id}/participants`, { role: 'Nobody' })).body.error.fields.name).toBeDefined();
    const absent = await t.api.patch(`/api/exercises/${id}/participants/${one.body.id}`, { attended: false });
    expect(absent.body.attended).toBe(false);
    expect((await t.api.del(`/api/exercises/${id}/participants/${many.body[1].id}`)).status).toBe(200);
    const list = await t.api.get(`/api/exercises/${id}/participants`);
    expect(list.body.map((p: any) => [p.name, p.attended])).toEqual([['Jo Example', false], ['Al Example', true]]);
  });

  it('records findings and raises a follow-up action from one', async () => {
    const f = await t.api.post(`/api/exercises/${id}/findings`, {
      finding: 'Nobody knew how to start a remote wipe.', severity: 'high', recommendation: 'Write the steps down and practice them.',
    });
    expect(f.status).toBe(201);
    expect((await t.api.post(`/api/exercises/${id}/findings`, { severity: 'catastrophic' })).body.error.fields).toMatchObject({
      finding: expect.any(String), severity: expect.any(String),
    });
    const low = await t.api.post(`/api/exercises/${id}/findings`, { finding: 'The room was too small.', severity: 'low' });

    const raised = await t.api.post(`/api/exercises/${id}/findings/${f.body.id}/action`, { due_on: addDays(today, 30) });
    expect(raised.status).toBe(201);
    expect(raised.body.action.ref).toMatch(/^ACT-/);
    const action = (await t.api.get(`/api/actions/${raised.body.action.id}`)).body;
    expect(action).toMatchObject({
      title: 'Nobody knew how to start a remote wipe.', source: 'exercise', source_type: 'exercise', source_id: id,
      priority: 'high', status: 'open', due_on: addDays(today, 30),
    });
    expect(action.description).toContain('Write the steps down');
    // The action tracker can list everything that came from this exercise.
    expect((await t.api.get(`/api/actions?f.source_type=exercise&f.source_id=${id}`)).body.total).toBe(1);

    // One action per finding.
    expect((await t.api.post(`/api/exercises/${id}/findings/${f.body.id}/action`)).status).toBe(409);
    const list = (await t.api.get(`/api/exercises/${id}/findings`)).body;
    expect(list.actions_available).toBe(true);
    expect(list.findings[0].action).toMatchObject({ id: raised.body.action.id, status: 'open', status_label: 'Open' });
    expect(list.findings[1].action).toBeNull();

    const edited = await t.api.patch(`/api/exercises/${id}/findings/${low.body.id}`, { severity: 'medium' });
    expect(edited.body.severity).toBe('medium');
    expect((await t.api.del(`/api/exercises/${id}/findings/${low.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/exercises/${id}/findings`)).body.findings.length).toBe(1);
  });

  it('lists what is upcoming and overdue, and when each kind was last run', async () => {
    const late = (await t.api.post('/api/exercises', { title: 'Restore test: payroll', type: 'restore_test', exercise_date: addDays(today, -5) })).body;
    const soon = (await t.api.post('/api/exercises', { title: 'Continuity test: second site', type: 'continuity_test', exercise_date: addDays(today, 14) })).body;
    await t.api.post('/api/exercises', { title: 'Canceled one', type: 'restore_test', status: 'cancelled', exercise_date: addDays(today, -90) });
    const cal = (await t.api.get('/api/exercises/calendar')).body;
    expect(cal.overdue.map((e: any) => [e.id, e.kind])).toEqual([[late.id, 'planned']]);
    expect(cal.upcoming.map((e: any) => [e.id, e.kind, e.date])).toEqual([
      [soon.id, 'planned', addDays(today, 14)],
      [id, 'repeat', addDays(today, 335)],
    ]);
    const types = Object.fromEntries(cal.by_type.map((x: any) => [x.type, x]));
    expect(types.tabletop).toMatchObject({ completed: 1, last_run: addDays(today, -30), last_result: 'partly_met', next_due: addDays(today, 335), overdue: false });
    expect(types.restore_test).toMatchObject({ completed: 0, last_run: null, next_due: addDays(today, -5), overdue: true });

    // Planning the next tabletop replaces the "next due" reminder of the last one.
    await t.api.post('/api/exercises', { title: 'Tabletop: power cut', type: 'tabletop', exercise_date: addDays(today, 60) });
    const after = (await t.api.get('/api/exercises/calendar')).body;
    expect(after.upcoming.filter((e: any) => e.type === 'tabletop').map((e: any) => e.kind)).toEqual(['planned']);
  });

  it('applies permissions and writes audit events', async () => {
    const agent = await t.as('agent'); // no exercises grant
    expect((await agent.get('/api/exercises')).status).toBe(403);
    expect((await agent.get('/api/exercises/calendar')).status).toBe(403);
    expect((await agent.get(`/api/exercises/${id}/findings`)).status).toBe(403);
    expect((await agent.post(`/api/exercises/${id}/participants`, { name: 'X' })).status).toBe(403);
    const lead = await t.as('security_lead');
    expect((await lead.get('/api/exercises/calendar')).status).toBe(200);
    expect((await lead.post(`/api/exercises/${id}/findings`, { finding: 'Lead finding' })).status).toBe(201);

    const history = (await t.api.get(`/api/history?record_type=exercise&record_id=${id}`)).body.map((h: any) => h.action);
    for (const action of [
      'exercise.create', 'exercise.update', 'exercise_participant.create', 'exercise_participant.update', 'exercise_participant.delete',
      'exercise_finding.create', 'exercise_finding.update', 'exercise_finding.delete', 'exercise_finding.action',
    ]) expect(history).toContain(action);
    expect((await t.db.query(`select 1 from audit_events where action = 'action.create' and after->>'source_id' = $1`, [id])).length).toBe(1);
  });
});

describe.skipIf(realActions)('exercises without the action tracker', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it('keeps the finding and says clearly that actions are not available', async () => {
    const ex = (await t.api.post('/api/exercises', { title: 'Restore test: mail', type: 'restore_test' })).body;
    const f = await t.api.post(`/api/exercises/${ex.id}/findings`, { finding: 'The backup was a week old.', severity: 'high' });
    expect(f.status).toBe(201);
    const res = await t.api.post(`/api/exercises/${ex.id}/findings/${f.body.id}/action`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('actions_unavailable');
    expect(res.body.error.message).toMatch(/action tracker is not switched on/);
    const list = (await t.api.get(`/api/exercises/${ex.id}/findings`)).body;
    expect(list).toMatchObject({ actions_available: false, findings: [{ finding: 'The backup was a week old.', action: null, action_id: null }] });
  });
});
