import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarSources } from '../../core/calendar.ts';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import type { Row } from '../../core/module.ts';
import { ANONYMIZED_TEXT } from '../../core/retention.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { cleanImpacts, suggestedMtd } from './bia.ts';
import { runContinuityReminders } from './reminders.ts';
import { addMonths } from './shared.ts';

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let manager: Client; // continuity_manager: continuity.*, no security.view
let viewer: Client;  // safety_manager: continuity.view only
const sys: Record<string, string> = {};
let serviceId: string;

const ok = <T = Row>(res: { status: number; body: T }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};

beforeAll(async () => {
  t = await testApp();
  manager = await t.as('continuity_manager');
  // Wave 26: the Safety manager may now run an emergency activation; this test needs a continuity viewer only.
  await t.db.query("delete from role_permissions where role_id = (select id from roles where key = 'safety_manager') and permission in ('continuity.create', 'continuity.edit')");
  viewer = await t.as('safety_manager');
  for (const [k, rto] of [['fast', 2], ['slow', 24], ['unknown', null], ['gone', 48], ['svc', 72]] as const) {
    sys[k] = ok(await t.api.post('/api/systems', { name: `Test system ${k}`, rto_hours: rto }), 201).id;
  }
  serviceId = ok(await t.api.post('/api/services', { route_code: 'T1', name: 'Test route' }), 201).id;
  await t.db.query('insert into service_systems (service_id, system_id) values ($1,$2)', [serviceId, sys.svc]);
});
afterAll(async () => { await t.close(); });

async function process(name: string, data: Row = {}): Promise<string> {
  return ok(await manager.post('/api/business-processes', { name, status: 'active', criticality: 'vital', ...data }), 201).id;
}

describe('business processes and their dependencies (E31-01)', () => {
  it('saves dependencies, mirrors them as record links and keeps what the caller cannot change', async () => {
    const id = await process('Dispatch test', { mtd_hours: 4 });
    expect((await manager.post('/api/business-processes', { name: 'Bad', mtd_hours: -1 })).body.error.fields.mtd_hours).toBeTruthy();
    const saved = ok(await manager.put(`/api/business-processes/${id}/dependencies`, {
      dependencies: [{ dep_type: 'system', dep_id: sys.fast }, { dep_type: 'service', dep_id: serviceId, critical: false }, { dep_type: 'system', dep_id: sys.fast }],
    }));
    expect(saved.dependencies.map((d: Row) => [d.dep_type, d.critical])).toEqual([['system', true], ['service', false]]);
    const links = await t.db.query<Row>(`select to_type from record_links where from_type = 'business_process' and from_id = $1 and relation = 'depends_on' order by to_type`, [id]);
    expect(links.map((l) => l.to_type)).toEqual(['service', 'system']);
    // A record the caller can no longer see (here, removed) is listed without its name, cannot be added, and stays when the list is saved.
    ok(await t.api.put(`/api/business-processes/${id}/dependencies`, { dependencies: [{ dep_type: 'system', dep_id: sys.fast }, { dep_type: 'system', dep_id: sys.gone }] }));
    ok(await t.api.del(`/api/systems/${sys.gone}`));
    expect((await manager.put(`/api/business-processes/${id}/dependencies`, { dependencies: [{ dep_type: 'system', dep_id: sys.gone }] })).status).toBe(400);
    const seen = ok(await manager.get(`/api/business-processes/${id}/dependencies`));
    expect(seen.dependencies.find((d: Row) => d.dep_id === sys.gone)).toMatchObject({ hidden: true, label: null });
    ok(await manager.put(`/api/business-processes/${id}/dependencies`, { dependencies: [] }));
    const left = await t.db.query<Row>('select dep_id::text as dep_id from process_dependencies where process_id = $1', [id]);
    expect(left.map((r) => r.dep_id)).toEqual([sys.gone]);
    expect((await viewer.put(`/api/business-processes/${id}/dependencies`, { dependencies: [] })).status).toBe(403);
    // Self-dependency refused.
    expect((await manager.put(`/api/business-processes/${id}/dependencies`, { dependencies: [{ dep_type: 'process', dep_id: id }] })).status).toBe(400);
  });

  it('lists the processes that depend on a system, also through a service', async () => {
    const a = await process('Direct user');
    const b = await process('Through a route');
    ok(await manager.put(`/api/business-processes/${a}/dependencies`, { dependencies: [{ dep_type: 'system', dep_id: sys.svc }] }));
    ok(await manager.put(`/api/business-processes/${b}/dependencies`, { dependencies: [{ dep_type: 'service', dep_id: serviceId }] }));
    const rows = ok<Row[]>(await viewer.get(`/api/continuity/dependents?type=system&id=${sys.svc}`));
    expect(rows.find((r) => r.id === a)?.via).toBeNull();
    expect(rows.find((r) => r.id === b)?.via).toMatchObject({ type: 'service', id: serviceId, label: 'T1 Test route' });
    expect((await manager.get(`/api/continuity/dependents?type=system&id=${sys.gone}`)).status).toBe(404);
  });
});

describe('gap report (E31-05) and summary', () => {
  it('flags tolerable downtime and recovery targets shorter than system recovery times, and unknown ones', async () => {
    const before = ok(await viewer.get('/api/continuity/summary'));
    const gap = await process('Gap through service', { mtd_hours: 8 });
    ok(await manager.put(`/api/business-processes/${gap}/dependencies`, { dependencies: [{ dep_type: 'service', dep_id: serviceId }, { dep_type: 'system', dep_id: sys.unknown }] }));
    const target = await process('Target gap only', { mtd_hours: 48, rto_target_hours: 4 });
    ok(await manager.put(`/api/business-processes/${target}/dependencies`, { dependencies: [{ dep_type: 'system', dep_id: sys.slow }] }));
    const fine = await process('No gap', { mtd_hours: 48 });
    ok(await manager.put(`/api/business-processes/${fine}/dependencies`, { dependencies: [{ dep_type: 'system', dep_id: sys.slow }, { dep_type: 'system', dep_id: sys.fast, critical: true }] }));

    const { rows } = ok(await viewer.get('/api/continuity/gaps'));
    const g = rows.find((r: Row) => r.id === gap);
    expect(g).toMatchObject({ gap: true, unknown: 1, worst_rto: 72 });
    expect(g.systems.find((s: Row) => s.id === sys.svc)).toMatchObject({ exceeds_mtd: true, via: { id: serviceId, label: 'T1 Test route' } });
    expect(rows.find((r: Row) => r.id === target)).toMatchObject({ gap: false, target_gap: true });
    expect(rows.find((r: Row) => r.id === fine)).toBeUndefined();
    const after = ok(await viewer.get('/api/continuity/summary'));
    expect(after.with_gap - before.with_gap).toBe(1);
    expect(ok(await t.api.get('/api/continuity/summary')).with_gap).toBe(after.with_gap);
    expect(JSON.stringify(after)).not.toContain('Gap through service');
  });

  it('leaves dependencies of a switched-off part out of the report and the editor', async () => {
    const p = await process('Service only', { mtd_hours: 1 });
    ok(await manager.put(`/api/business-processes/${p}/dependencies`, { dependencies: [{ dep_type: 'service', dep_id: serviceId }] }));
    expect(ok(await manager.get('/api/continuity/gaps')).rows.find((r: Row) => r.id === p)?.gap).toBe(true);
    await t.db.query('update sessions set confirmed_at = now()');
    ok(await t.api.patch('/api/admin/features', { features: { fleet: false } }));
    try {
      expect(ok(await manager.get('/api/continuity/gaps')).rows.find((r: Row) => r.id === p)).toBeUndefined();
      const deps = ok(await manager.get(`/api/business-processes/${p}/dependencies`));
      expect(deps.kinds).not.toContain('service');
      expect(deps.dependencies).toEqual([]);
      ok(await manager.put(`/api/business-processes/${p}/dependencies`, { dependencies: [] }));
    } finally {
      ok(await t.api.patch('/api/admin/features', { features: { fleet: true } }));
    }
    expect((await t.db.query('select 1 from process_dependencies where process_id = $1', [p])).length).toBe(1);
  });
});

describe('impact analyses (E31-02)', () => {
  it('checks the grid, and signing off copies the tolerable downtime onto the process', async () => {
    expect(cleanImpacts([{ band: '2h' }])).toMatch(/time band/);
    expect(cleanImpacts([{ band: '1h', safety: 6 }])).toMatch(/1 \(minimal\) to 5/);
    expect(suggestedMtd(cleanImpacts([{ band: '1h', operational: 2 }, { band: '1d', financial: 4 }]) as Row[])).toBe(24);
    const p = await process('Analyzed');
    const bia = ok(await manager.post('/api/bias', {
      process_id: p, mtd_hours: 12, rto_target_hours: 6, impacts: [{ band: '4h', operational: 3 }, { band: '1h', operational: 1 }], answers: { riders_notice: 'yes' },
    }), 201);
    expect(bia.impacts.map((r: Row) => r.band)).toEqual(['1h', '4h']);
    expect((await manager.patch(`/api/bias/${bia.id}`, { status: 'signed_off' })).status).toBe(400);
    expect((await manager.post(`/api/bias/${bia.id}/sign-off`)).status).toBe(409);
    // Submitted only with "Submit for sign-off"; a process with no owner has no workflow, so it waits for "Sign off".
    expect((await manager.patch(`/api/bias/${bia.id}`, { status: 'submitted' })).status).toBe(400);
    expect(ok(await manager.post(`/api/bias/${bia.id}/submit`))).toMatchObject({ status: 'submitted', instance_id: null });
    expect((await manager.post(`/api/bias/${bia.id}/submit`)).body.error.code).toBe('already_submitted');
    expect((await viewer.post(`/api/bias/${bia.id}/sign-off`)).status).toBe(403);
    ok(await manager.post(`/api/bias/${bia.id}/sign-off`));
    const proc = ok(await manager.get(`/api/business-processes/${p}`));
    expect(proc).toMatchObject({ mtd_hours: 12, rto_target_hours: 6, last_bia_on: dayInZone(), next_bia_due: addMonths(dayInZone(), 12) });
    expect((await manager.patch(`/api/bias/${bia.id}`, { notes: 'late change' })).status).toBe(409);
  });
});

describe('impact analysis sign-off through an approval workflow (E31-10)', () => {
  it('asks the process owner, whose approval signs the analysis off and whose rejection sends it back', async () => {
    const owner = viewer; // continuity.view only: the owner need not hold continuity.approve
    const p = await process('Owned process', { owner_id: owner.userId });
    const bia = ok(await manager.post('/api/bias', { process_id: p, mtd_hours: 8, rto_target_hours: 4 }), 201);
    expect((await owner.post(`/api/bias/${bia.id}/submit`)).status).toBe(403);
    const sent = ok(await manager.post(`/api/bias/${bia.id}/submit`, { note: 'Please check the 4 hour band' }));
    expect(sent).toMatchObject({ status: 'submitted', workflow: 'Impact analysis sign-off' });
    expect(sent.instance_id).toBeTruthy();
    expect(ok(await manager.get(`/api/bias/${bia.id}`)).process_owner_id).toBe(owner.userId);
    expect(ok(await viewer.get(`/api/bias/${bia.id}/sign-off`))).toMatchObject({ available: true, request: { status: 'running' } });
    const eng = approvalEngine(t.app)!;
    expect(await eng.waiting('bia_signoff', owner.userId)).toContain(bia.id);
    expect(await eng.waiting('bia_signoff', manager.userId)).not.toContain(bia.id);
    // The owner is told.
    const told = await t.db.query<Row>(`select title from notifications where user_id = $1 and record_id = $2`, [owner.userId, bia.id]);
    expect(told.length).toBeGreaterThan(0);

    // Rejection: back to draft with the reason in the history.
    await eng.decide('bia_signoff', bia.id, null, 'rejected', 'The 1 day band is too low', { userId: owner.userId });
    expect(ok(await manager.get(`/api/bias/${bia.id}`)).status).toBe('draft');
    const history = ok(await manager.get(`/api/history?record_type=bia&record_id=${bia.id}`));
    expect(JSON.stringify(history)).toContain('The 1 day band is too low');

    // Approval: signed off as "Sign off" does, by the owner.
    ok(await manager.post(`/api/bias/${bia.id}/submit`));
    await eng.decide('bia_signoff', bia.id, null, 'approved', null, { userId: owner.userId });
    const done = ok(await manager.get(`/api/bias/${bia.id}`));
    expect(done).toMatchObject({ status: 'signed_off', signed_off_on: dayInZone() });
    expect(done.signed_off_by_name).toContain('safety_manager');
    expect(ok(await manager.get(`/api/business-processes/${p}`))).toMatchObject({ mtd_hours: 8, rto_target_hours: 4, last_bia_on: dayInZone() });
  });

  it('lets an approver sign off directly, ends the request on a return to draft, and refuses the owner submitting', async () => {
    const owner = await t.as('continuity_manager');
    const p = await process('Directly signed', { owner_id: owner.userId });
    const eng = approvalEngine(t.app)!;
    const a = ok(await manager.post('/api/bias', { process_id: p, mtd_hours: 24 }), 201);
    expect((await owner.post(`/api/bias/${a.id}/submit`)).body.error.code).toBe('owner_submits');
    ok(await manager.post(`/api/bias/${a.id}/submit`));
    expect((await eng.running('bia_signoff', a.id))).toBeTruthy();
    // Sent back to draft by hand: the request ends.
    ok(await manager.patch(`/api/bias/${a.id}`, { status: 'draft' }));
    expect(await eng.running('bia_signoff', a.id)).toBeNull();
    expect((await eng.latest('bia_signoff', a.id))!.status).toBe('canceled');
    // Signed off directly while the owner is asked: the request is replaced.
    ok(await manager.post(`/api/bias/${a.id}/submit`));
    ok(await manager.post(`/api/bias/${a.id}/sign-off`));
    expect((await eng.latest('bia_signoff', a.id))!.status).toBe('canceled');
    expect(ok(await manager.get(`/api/bias/${a.id}`))).toMatchObject({ status: 'signed_off', signed_off_by_name: expect.stringContaining('continuity_manager') });
    // A submission needs the tolerable downtime.
    const b = ok(await manager.post('/api/bias', { process_id: p }), 201);
    expect((await manager.post(`/api/bias/${b.id}/submit`)).body.error.fields.mtd_hours).toBeTruthy();
  });

  it('is gone while the continuity area is off', async () => {
    expect(ok(await t.api.get('/api/workflows/options')).kinds.some((k: Row) => k.key === 'bia_signoff')).toBe(true);
    await t.db.query('update sessions set confirmed_at = now()');
    ok(await t.api.patch('/api/admin/features', { features: { continuity: false } }));
    try {
      expect(ok(await t.api.get('/api/workflows/options')).kinds.some((k: Row) => k.key === 'bia_signoff')).toBe(false);
    } finally {
      ok(await t.api.patch('/api/admin/features', { features: { continuity: true } }));
    }
  });
});

describe('plans: approval, call tree, checklist and exercises (E31-03, E31-04)', () => {
  let planId: string;
  it('needs a scope and activation criteria, then approval sets the review date', async () => {
    const approver = await t.as('continuity_manager');
    planId = ok(await manager.post('/api/continuity-plans', { title: 'Test plan', plan_type: 'continuity', review_months: 6 }), 201).id;
    expect((await manager.patch(`/api/continuity-plans/${planId}`, { status: 'approved' })).status).toBe(400);
    expect((await manager.post(`/api/continuity-plans/${planId}/submit`)).body.error.fields.scope).toBeTruthy();
    ok(await manager.patch(`/api/continuity-plans/${planId}`, { scope: 'Everything', activation_criteria: 'When it breaks' }));
    ok(await manager.post(`/api/continuity-plans/${planId}/submit`), 201);
    expect(ok(await manager.get(`/api/continuity-plans/${planId}`)).status).toBe('in_review');
    expect((await manager.post(`/api/continuity-plans/${planId}/submit`)).status).toBe(409);
    const eng = approvalEngine(t.app)!;
    await eng.decide('continuity_plan', planId, null, 'rejected', 'Add the depots', { userId: approver.userId });
    expect(ok(await manager.get(`/api/continuity-plans/${planId}`)).status).toBe('draft');
    ok(await manager.post(`/api/continuity-plans/${planId}/submit`), 201);
    await eng.decide('continuity_plan', planId, null, 'approved', null, { userId: approver.userId });
    expect(ok(await manager.get(`/api/continuity-plans/${planId}`))).toMatchObject({ status: 'approved', approved_on: dayInZone(), next_review_on: addMonths(dayInZone(), 6) });
  });

  it('builds a call tree from people and typed names, refuses loops and prints it', async () => {
    const person = ok(await t.api.post('/api/people', { full_name: 'Casey Caller', phone: '555-0199' }), 201).id;
    const lead = ok(await manager.post(`/api/continuity-plans/${planId}/call-tree`, { role: 'Lead', person_id: person, name: 'ignored', phone: '1' }), 201);
    expect(lead).toMatchObject({ name: 'Casey Caller', phone: '555-0199', linked: 'person' });
    expect((await manager.post(`/api/continuity-plans/${planId}/call-tree`, { role: 'Nobody' })).status).toBe(400);
    const child = ok(await manager.post(`/api/continuity-plans/${planId}/call-tree`, { parent_id: lead.id, role: 'Depot', name: 'Typed Person', phone: '555-0100' }), 201);
    expect((await manager.patch(`/api/continuity-plans/${planId}/call-tree/${lead.id}`, { parent_id: child.id })).status).toBe(400);
    const tree = ok<Row[]>(await viewer.get(`/api/continuity-plans/${planId}/call-tree`));
    expect(tree.map((n) => [n.name, n.depth])).toEqual([['Casey Caller', 0], ['Typed Person', 1]]);
    const pdf = await manager.get(`/api/continuity-plans/${planId}/call-tree.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.text.startsWith('%PDF')).toBe(true);
    expect((await viewer.get(`/api/continuity-plans/${planId}/call-tree.pdf`)).status).toBe(403);
    ok(await manager.del(`/api/continuity-plans/${planId}/call-tree/${lead.id}`));
    expect(ok<Row[]>(await viewer.get(`/api/continuity-plans/${planId}/call-tree`))[0]).toMatchObject({ name: 'Typed Person', parent_id: null });
  });

  it('keeps a checklist, the processes covered and the exercises that tested it', async () => {
    const items = ok<Row[]>(await manager.put(`/api/continuity-plans/${planId}/checklist`, { items: [
      { phase: 'activate', item: 'Open the room', role: 'Lead' }, { phase: 'stand_down', item: 'Debrief' },
    ] }));
    expect(items.map((i) => i.item)).toEqual(['Open the room', 'Debrief']);
    expect((await manager.put(`/api/continuity-plans/${planId}/checklist`, { items: [{ phase: 'later', item: 'x' }] })).status).toBe(400);
    const p = await process('Covered');
    expect(ok<Row[]>(await manager.put(`/api/continuity-plans/${planId}/processes`, { process_ids: [p, p] })).length).toBe(1);
    expect(ok<Row[]>(await viewer.get(`/api/business-processes/${p}/plans`)).map((x) => x.id)).toEqual([planId]);
    const ex = ok(await t.api.post('/api/exercises', { title: 'Tabletop', type: 'tabletop', exercise_date: dayInZone(-3), status: 'completed' }), 201).id;
    ok(await manager.post(`/api/continuity-plans/${planId}/exercises`, { exercise_id: ex }), 201);
    const list = ok(await manager.get(`/api/continuity-plans/${planId}/exercises`));
    expect(list).toMatchObject({ available: true, last_exercised_on: dayInZone(-3) });
    expect(list.exercises.map((e: Row) => e.id)).toEqual([ex]);
  });
});

describe('emergency activations (E31-06)', () => {
  it('copies the plans\' checklists, logs, assigns roles, stands down and closes with summaries, and raises a plan', async () => {
    const plan = ok(await manager.post('/api/continuity-plans', { title: 'Storm plan' }), 201).id;
    ok(await manager.put(`/api/continuity-plans/${plan}/checklist`, { items: [{ phase: 'activate', item: 'Open the room' }, { phase: 'respond', item: 'Move buses' }] }));
    const a = ok(await manager.post('/api/emergency-activations', { title: 'Storm', event_type: 'severe_weather', level: 'partial', plan_ids: [plan] }), 201);
    expect(a).toMatchObject({ status: 'active', declared_by: manager.userId });
    expect((await manager.post('/api/emergency-activations', { title: 'Bad', event_type: 'other', plan_ids: ['00000000-0000-0000-0000-000000000000'] })).status).toBe(400);
    const checklist = ok<Row[]>(await viewer.get(`/api/emergency-activations/${a.id}/checklist`));
    expect(checklist.map((c) => c.item)).toEqual(['Open the room', 'Move buses']);
    ok(await manager.post(`/api/emergency-activations/${a.id}/checklist/${checklist[0].id}`, { done: true }));
    ok(await manager.post(`/api/emergency-activations/${a.id}/log`, { entry: 'Water over the road' }), 201);
    expect((await viewer.post(`/api/emergency-activations/${a.id}/log`, { entry: 'x' })).status).toBe(403);
    ok(await manager.post(`/api/emergency-activations/${a.id}/roles`, { role: 'Emergency manager', user_id: manager.userId }), 201);
    expect((await manager.post(`/api/emergency-activations/${a.id}/roles`, { role: 'Nobody' })).status).toBe(400);
    await manager.patch(`/api/emergency-activations/${a.id}`, { status: 'closed' });
    expect(ok(await manager.get(`/api/emergency-activations/${a.id}`)).status).toBe('active');
    expect((await manager.post(`/api/emergency-activations/${a.id}/cap`, { title: 'Drains' })).status).toBe(409);
    expect((await manager.post(`/api/emergency-activations/${a.id}/close`, { after_action_summary: 'x' })).status).toBe(409);
    expect((await manager.post(`/api/emergency-activations/${a.id}/stand-down`, {})).status).toBe(400);
    ok(await manager.post(`/api/emergency-activations/${a.id}/stand-down`, { summary: 'All clear' }));
    const cap = ok(await manager.post(`/api/emergency-activations/${a.id}/cap`, { title: 'Clear the drains' }), 201);
    expect(ok(await t.api.get(`/api/caps/${cap.cap.id}`))).toMatchObject({ source: 'continuity', source_type: 'emergency_activation', source_id: a.id });
    expect((await manager.post(`/api/emergency-activations/${a.id}/close`, {})).status).toBe(400);
    const closed = ok(await manager.post(`/api/emergency-activations/${a.id}/close`, { after_action_summary: 'Drains were blocked' }));
    expect(closed).toMatchObject({ status: 'closed', after_action_summary: 'Drains were blocked' });
    expect((await manager.post(`/api/emergency-activations/${a.id}/log`, { entry: 'late' })).status).toBe(409);
    const log = ok<Row[]>(await viewer.get(`/api/emergency-activations/${a.id}/log`));
    expect(log.map((l) => l.entry)).toEqual(expect.arrayContaining(['Water over the road', 'Activation stood down.', 'Activation closed with its after-action summary.']));
    expect(log.some((l) => /took the role Emergency manager/.test(l.entry))).toBe(true);
  });
});

describe('retention', () => {
  async function anonymizeNow(type: string, id: string, table: string) {
    await t.db.query('update sessions set confirmed_at = now()');
    ok(await t.api.put(`/api/admin/retention/${type}`, { periodMonths: 12, disposal: 'anonymize' }));
    await t.db.query(`update ${table} set updated_at = now() - interval '30 months', created_at = now() - interval '30 months' where id = $1`, [id]);
    await t.core.retention.sweep();
    const review = (await t.api.get(`/api/admin/retention/reviews?record_type=${type}`)).body.rows.find((r: Row) => r.record_id === id);
    expect(review).toBeTruthy();
    ok(await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'End of the schedule.', confirm: true }));
  }

  it('anonymizing a plan clears the typed names and phones of its call tree', async () => {
    const plan = ok(await manager.post('/api/continuity-plans', { title: 'Old plan' }), 201).id;
    ok(await manager.post(`/api/continuity-plans/${plan}/call-tree`, { role: 'Lead', name: 'Robin Typed', phone: '555-0111', alternate_phone: '555-0112' }), 201);
    await anonymizeNow('continuity_plan', plan, 'continuity_plans');
    const rows = await t.db.query<Row>('select name, phone, alternate_phone from call_tree_nodes where plan_id = $1', [plan]);
    expect(rows).toEqual([{ name: ANONYMIZED_TEXT, phone: null, alternate_phone: null }]);
  });

  it('anonymizing an activation clears its log, typed role names and checklist names', async () => {
    const a = ok(await manager.post('/api/emergency-activations', { title: 'Old event', event_type: 'other' }), 201).id;
    ok(await manager.post(`/api/emergency-activations/${a}/log`, { entry: 'Robin Typed called in sick' }), 201);
    ok(await manager.post(`/api/emergency-activations/${a}/roles`, { role: 'Scribe', name: 'Robin Typed' }), 201);
    await anonymizeNow('emergency_activation', a, 'emergency_activations');
    const text = JSON.stringify([
      await t.db.query('select entry, by_name from activation_log_entries where activation_id = $1', [a]),
      await t.db.query('select name from activation_roles where activation_id = $1', [a]),
    ]);
    expect(text).not.toContain('Robin');
    expect(text).not.toContain('Test continuity_manager');
  });
});

describe('reminders, calendar and metrics (E31-08)', () => {
  it('reminds plan owners and process owners once, even when two runs overlap', async () => {
    const plan = ok(await t.api.post('/api/continuity-plans', { title: 'Due plan', owner_id: manager.userId }), 201).id;
    await t.db.query(`update continuity_plans set status = 'approved', next_review_on = $2 where id = $1`, [plan, dayInZone(10)]);
    const proc = await process('Due analysis', { owner_id: manager.userId, next_bia_due: dayInZone(5) });
    const [a, b] = await Promise.all([runContinuityReminders(t.ctx), runContinuityReminders(t.ctx)]);
    expect(a.plans + b.plans).toBeGreaterThanOrEqual(1);
    const count = async (type: string, id: string) => (await t.db.query(
      `select 1 from notifications where record_type = $1 and record_id = $2 and kind = 'continuity'`, [type, id])).length;
    expect(await count('continuity_plan', plan)).toBe(1);
    expect(await count('business_process', proc)).toBe(1);
    await runContinuityReminders(t.ctx);
    expect(await count('continuity_plan', plan)).toBe(1);
  });

  it('offers calendar sources and metrics while the area is on, and none while it is off', async () => {
    const keys = () => metricsAvailable(t.app, t.ctx.resources).map((m) => m.key);
    expect(keys()).toEqual(expect.arrayContaining(['continuity.processes_with_gap', 'continuity.plans_review_overdue']));
    const metrics = ok(await viewer.get(`/api/metrics?month=${dayInZone().slice(0, 7)}`));
    expect(JSON.stringify(metrics)).toContain('continuity.processes_with_gap');
    const plan = ok(await t.api.post('/api/continuity-plans', { title: 'Calendar plan', owner_id: manager.userId, next_review_on: dayInZone(20) }), 201).id;
    const session = { id: manager.userId, username: 'm', displayName: 'M', email: '', roles: ['continuity_manager'], permissions: ['continuity.*', 'exercises.view'] };
    const sources = calendarSources(t.app, t.ctx.resources, session);
    expect(sources.map((s) => s.key)).toEqual(expect.arrayContaining(['continuity.exercises', 'continuity.reviews']));
    const events = await sources.find((s) => s.key === 'continuity.reviews')!.events(t.ctx, session, dayInZone(), dayInZone(30));
    expect(events.map((e) => e.recordId)).toContain(plan);

    await t.db.query('update sessions set confirmed_at = now()');
    ok(await t.api.patch('/api/admin/features', { features: { continuity: false } }));
    try {
      expect(JSON.stringify(ok(await t.api.get(`/api/metrics?month=${dayInZone().slice(0, 7)}`)))).not.toContain('continuity.');
      expect(calendarSources(t.app, t.ctx.resources, { ...session, off: ['continuity'] }).map((s) => s.key)).not.toContain('continuity.reviews');
      const res = await t.api.get('/api/continuity/gaps');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('switched_off');
      expect((await t.api.get('/api/business-processes')).body.error.code).toBe('switched_off');
      const lists = ok(await t.api.get('/api/meta')).lookups;
      expect(lists.process_criticality).toBeUndefined();
      expect((lists.action_source ?? []).map((v: Row) => v.value)).not.toContain('continuity');
      expect((lists.notification_kind ?? []).map((v: Row) => v.value)).not.toContain('continuity');
    } finally {
      ok(await t.api.patch('/api/admin/features', { features: { continuity: true } }));
    }
  });
});
