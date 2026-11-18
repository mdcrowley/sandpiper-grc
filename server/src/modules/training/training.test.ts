import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, addMonths, localDate } from './dates.ts';
import { syncTrainingAssignments } from './sync.ts';

// Invented data throughout.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const today = localDate();
const at = (date: string) => new Date(`${date}T12:00:00Z`);
const recordsOf = async (courseId: string) =>
  (await t.api.get(`/api/training/records?scope=all&course_id=${courseId}`)).body.rows as any[];

describe('courses', () => {
  it('creates a course with a reference and defaults, and validates numbers', async () => {
    const made = await t.api.post('/api/courses', { title: 'Lifting safely', category: 'other', format: 'classroom', recurrence_months: 12 });
    expect(made.status).toBe(201);
    expect(made.body.ref).toMatch(/^CRS-\d{5}$/);
    expect(made.body).toMatchObject({ status: 'active', mandatory: false, due_days: 30 });
    const bad = await t.api.post('/api/courses', { title: 'Bad', recurrence_months: 1.5, format: 'carrier pigeon' });
    expect(bad.status).toBe(400);
    expect((await t.api.post('/api/courses', { title: 'Bad', recurrence_months: -1 })).body.error.fields.recurrence_months).toMatch(/whole number/);
  });
});

describe('assignment rules and sync', () => {
  let courseId: string;
  let agent: Awaited<ReturnType<typeof t.as>>;
  let other: Awaited<ReturnType<typeof t.as>>;

  it('raises records for the active users a rule matches, once', async () => {
    agent = await t.as('agent');
    other = await t.as('project_manager');
    const disabled = await t.as('agent');
    await t.db.query(`update users set status = 'disabled' where id = $1`, [disabled.userId]);
    courseId = (await t.api.post('/api/courses', { title: 'Desk security', recurrence_months: 12, due_days: 10 })).body.id;

    const role = await t.db.one<{ id: string }>(`select id from roles where key = 'agent'`);
    const rule = await t.api.post(`/api/courses/${courseId}/assignments`, { audience_type: 'role', role_id: role!.id });
    expect(rule.status).toBe(201);
    expect(rule.body).toMatchObject({ audience_type: 'role', audience_label: 'Agent', people: 1, records_created: 1 });

    const rows = await recordsOf(courseId);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ user_id: agent.userId, source: 'rule', status: 'due', assigned_on: today, due_on: addDays(today, 10) });

    // Running again changes nothing.
    expect(await syncTrainingAssignments(t.ctx)).toEqual({ created: 0, renewed: 0 });
    expect((await recordsOf(courseId)).length).toBe(1);

    // The same audience cannot be added twice; a bad audience is refused.
    expect((await t.api.post(`/api/courses/${courseId}/assignments`, { audience_type: 'role', role_id: role!.id })).status).toBe(409);
    expect((await t.api.post(`/api/courses/${courseId}/assignments`, { audience_type: 'team' })).status).toBe(400);
    expect((await t.api.post(`/api/courses/${courseId}/assignments`, { audience_type: 'department' })).body.error.fields.department_id).toBeDefined();
  });

  it('assigns by department and by person, and to everyone', async () => {
    const dept = await t.db.one<{ id: string }>(`insert into departments (name) values ('Example Finance') returning id`);
    await t.db.query('update users set department_id = $2 where id = $1', [other.userId, dept!.id]);
    const byDept = (await t.api.post('/api/courses', { title: 'Paying invoices safely' })).body.id;
    const made = await t.api.post(`/api/courses/${byDept}/assignments`, { audience_type: 'department', department_id: dept!.id });
    expect(made.body.records_created).toBe(1);
    const rows = await recordsOf(byDept);
    expect(rows.map((r) => [r.user_id, r.department])).toEqual([[other.userId, 'Example Finance']]);

    const byUser = (await t.api.post('/api/courses', { title: 'Server room access' })).body.id;
    expect((await t.api.post(`/api/courses/${byUser}/assignments`, { audience_type: 'user', user_id: agent.userId })).body.records_created).toBe(1);

    const all = (await t.api.post('/api/courses', { title: 'Fire drill briefing' })).body.id;
    const everyone = await t.api.post(`/api/courses/${all}/assignments`, { audience_type: 'everyone' });
    const active = (await t.db.one<{ c: number }>(`select count(*)::int c from users where status = 'active' and deleted_at is null`))!.c;
    expect(everyone.body.records_created).toBe(active);

    // A new starter is picked up by the next run; a retired course is left alone.
    await t.api.patch(`/api/courses/${byUser}`, { status: 'retired' });
    const starter = await t.as('agent');
    const run = await syncTrainingAssignments(t.ctx);
    expect(run.created).toBe(2); // "Desk security" (role) and "Fire drill briefing" (everyone)
    expect((await recordsOf(all)).some((r) => r.user_id === starter.userId)).toBe(true);

    const rules = await t.api.get(`/api/courses/${all}/assignments`);
    expect(rules.body.length).toBe(1);
    expect((await t.api.del(`/api/courses/${all}/assignments/${rules.body[0].id}`)).status).toBe(200);
    expect((await t.api.get(`/api/courses/${all}/assignments`)).body).toEqual([]);
  });

  it('makes a new record due when a completion is older than the repeat period', async () => {
    const mine = (await recordsOf(courseId)).find((r) => r.user_id === agent.userId);
    const done = await t.api.patch(`/api/training/records/${mine.id}`, { completed_on: today, score: 90, result: 'passed' });
    expect(done.body).toMatchObject({ status: 'complete', completed_on: today, score: 90 });

    // Eleven months on: still current.
    expect((await syncTrainingAssignments(t.ctx, at(addMonths(today, 11)))).renewed).toBe(0);

    // Twelve months on: due again, once.
    const later = addDays(addMonths(today, 12), 1);
    expect((await syncTrainingAssignments(t.ctx, at(later))).renewed).toBeGreaterThanOrEqual(1);
    const rows = (await recordsOf(courseId)).filter((r) => r.user_id === agent.userId);
    expect(rows.length).toBe(2);
    const fresh = rows.find((r) => !r.completed_on);
    expect(fresh).toMatchObject({ source: 'rule', assigned_on: later, due_on: addDays(later, 10) });
    expect((await syncTrainingAssignments(t.ctx, at(later))).renewed).toBe(0);
    expect((await recordsOf(courseId)).filter((r) => r.user_id === agent.userId).length).toBe(2);

    // Removing the new record does not bring it back: the completion has already raised its follow-up.
    await t.api.del(`/api/training/records/${fresh.id}`);
    expect((await syncTrainingAssignments(t.ctx, at(later))).renewed).toBe(0);
  });

  it('repeats for people without an account too', async () => {
    const id = (await t.api.post('/api/courses', { title: 'Visitor sign-in rules', recurrence_months: 6 })).body.id;
    const done = addDays(today, -200);
    const made = await t.api.post('/api/training/records', {
      course_id: id, completed_on: done, result: 'attended',
      people: [{ name: 'Sam Example', email: 'sam.example@example.test', department: 'Front desk' }],
    });
    expect(made.body).toMatchObject({ created: 1, skipped: 0 });
    expect((await syncTrainingAssignments(t.ctx)).renewed).toBe(1);
    const rows = await recordsOf(id);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => !r.completed_on)).toMatchObject({ person: 'Sam Example', department: 'Front desk', has_account: false, status: 'due' });
  });
});

describe('recording completions', () => {
  let courseId: string;

  it('records a list of people at once, completing open records and skipping repeats', async () => {
    courseId = (await t.api.post('/api/courses', { title: 'Clear desk briefing' })).body.id;
    const assigned = await t.api.post('/api/training/records', {
      course_id: courseId, people: [{ name: 'Ada Example', email: 'ada@example.test' }, { name: 'Ben Example' }],
    });
    expect(assigned.body).toMatchObject({ assigned: 2, created: 0 });

    const done = await t.api.post('/api/training/records', {
      course_id: courseId, completed_on: today, score: '85%', result: 'Passed', evidence_note: 'Sign-in sheet',
      people: [{ email: 'ADA@example.test' }, { name: 'Cal Example', department: 'Stores' }, { name: 'Cal Example' }],
    });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ completed: 1, created: 1, skipped: 0 });

    const again = await t.api.post('/api/training/records', { course_id: courseId, completed_on: today, people: [{ name: 'Cal Example' }] });
    expect(again.body).toMatchObject({ created: 0, duplicate: 1, skipped: 1 });

    const progress = (await t.api.get(`/api/courses/${courseId}/progress`)).body;
    expect(progress).toMatchObject({ total: 3, complete: 2, due: 1, overdue: 0, rate: 67 });
    expect(progress.people.find((p: any) => p.person === 'Ada Example')).toMatchObject({ status: 'complete', score: 85, result: 'passed', evidence_note: 'Sign-in sheet' });
  });

  it('validates', async () => {
    const bad = await t.api.post('/api/training/records', {
      course_id: courseId, completed_on: addDays(today, 3), score: 140, result: 'excellent', people: [],
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['completed_on', 'people', 'result', 'score']);
    expect((await t.api.post('/api/training/records', { course_id: courseId, people: [{ email: 'not an address' }] })).body.error.fields.people).toMatch(/Person 1/);
    expect((await t.api.post('/api/training/records', { course_id: '00000000-0000-4000-8000-000000000000', people: [{ name: 'X' }] })).status).toBe(404);
  });

  it('shows a signed-in user their own training', async () => {
    const me = (await t.api.get('/api/auth/state')).body.user;
    await t.api.post('/api/training/records', { course_id: courseId, people: [{ user_id: me.id }] });
    const mine = await t.api.get('/api/training/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.rows.length).toBeGreaterThan(0);
    expect(mine.body.rows.every((r: any) => r.user_id === me.id)).toBe(true);
    expect(mine.body.rows.some((r: any) => r.course_title === 'Clear desk briefing' && r.status === 'due')).toBe(true);
  });
});

describe('permissions and audit', () => {
  it('lets an agent read but not change training, and keeps others out', async () => {
    const agent = await t.as('agent');
    const course = (await t.api.get('/api/courses?q=Clear desk')).body.rows[0];
    expect((await agent.get('/api/courses')).status).toBe(200);
    expect((await agent.get('/api/training/summary')).status).toBe(200);
    expect((await agent.get(`/api/courses/${course.id}/progress`)).status).toBe(200);
    expect((await agent.post('/api/courses', { title: 'Nope' })).status).toBe(403);
    expect((await agent.post('/api/training/records', { course_id: course.id, people: [{ name: 'X' }] })).status).toBe(403);
    expect((await agent.post('/api/training/import', { csv: 'a\nb' })).status).toBe(403);
    expect((await agent.post(`/api/courses/${course.id}/assignments`, { audience_type: 'everyone' })).status).toBe(403);
    expect((await agent.post('/api/training/sync')).status).toBe(403);
    const row = (await t.api.get(`/api/training/records?course_id=${course.id}`)).body.rows[0];
    expect((await agent.patch(`/api/training/records/${row.id}`, { completed_on: today })).status).toBe(403);
    expect((await agent.del(`/api/training/records/${row.id}`)).status).toBe(403);

    const pm = await t.as('project_manager');
    for (const url of ['/api/courses', '/api/training/summary', '/api/training/records', '/api/training/audiences', `/api/courses/${course.id}/assignments`]) {
      expect((await pm.get(url)).status).toBe(403);
    }
    expect((await pm.get('/api/training/mine')).status).toBe(200);
    expect((await t.anon.get('/api/training/mine')).status).toBe(401);

    const lead = await t.as('security_lead');
    expect((await lead.post('/api/training/records', { course_id: course.id, people: [{ name: 'Lead Entry' }] })).status).toBe(201);
  });

  it('writes an audit event for every change and shows them in the course history', async () => {
    const course = (await t.api.get('/api/courses?q=Desk security')).body.rows[0];
    const history = (await t.api.get(`/api/history?record_type=course&record_id=${course.id}`)).body.map((h: any) => h.action);
    for (const action of ['course.create', 'training_assignment.create', 'training.sync', 'training_record.complete', 'training_record.delete']) {
      expect(history).toContain(action);
    }
    const complete = await t.db.one<any>(
      `select actor_name, before, after from audit_events where action = 'training_record.complete' and record_id = $1 order by id limit 1`, [course.id],
    );
    expect(complete.actor_name).toBe('Test Admin');
    expect(complete.after).toMatchObject({ completed_on: today, score: 90 });
    const system = await t.db.one<any>(`select actor_name from audit_events where action = 'training.sync' limit 1`);
    expect(system.actor_name).toBe('System');
    const removed = await t.db.query(`select 1 from audit_events where action = 'training_assignment.delete'`);
    expect(removed.length).toBe(1);
  });
});
