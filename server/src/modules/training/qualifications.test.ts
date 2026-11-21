import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricsAvailable } from '../../core/metrics.ts';
import { testApp } from '../../test/helpers.ts';
import { addDays, addMonths, localDate } from './dates.ts';
import { runCertificationReminders, syncTrainingAssignments } from './index.ts';

// Positions, requirements, certifications, the qualification matrix and metrics (E29-02 to E29-07).
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let coord: Client;      // training.* and people.*
let today: string;
let posId: string;
let courseId: string;
const ids: Record<string, string> = {};
const ctxOf = () => t.ctx;

beforeAll(async () => {
  process.env.GRC_MODULES = 'people,training,notifications';
  t = await testApp();
  coord = await t.as('training_coordinator');
  today = localDate();
  posId = (await coord.post('/api/positions', { name: 'Invented signal maintainer', safety_sensitive: true })).body.id;
  courseId = (await coord.post('/api/courses', { title: 'Invented track safety', recurrence_months: 12, due_days: 30 })).body.id;
  // Ana has an account (the coordinator's) and a supervisor; Ben has none.
  const coordEmail = (await t.db.one<any>('select email from users where id = $1', [coord.userId])).email;
  ids.sup = (await coord.post('/api/people', { full_name: 'Sam Supervisor', employee_number: 'S1', user_id: coord.userId })).body.id;
  ids.ana = (await coord.post('/api/people', { full_name: 'Ana Example', employee_number: 'M1', position_id: posId, supervisor_person_id: ids.sup, email: 'ana@example.test' })).body.id;
  ids.ben = (await coord.post('/api/people', { full_name: 'Ben Example', employee_number: 'M2', position_id: posId, email: 'ben@example.test' })).body.id;
  void coordEmail;
});
afterAll(async () => { await t.close(); });

describe('requirements', () => {
  it('adds course and certification requirements to a position (training.edit)', async () => {
    const c = await coord.post(`/api/positions/${posId}/requirements`, { kind: 'course', course_id: courseId });
    expect(c.status).toBe(201);
    const k = await coord.post(`/api/positions/${posId}/requirements`, { kind: 'certification', certification_type: 'track_access', grace_days: 7 });
    expect(k.status).toBe(201);
    expect((await coord.post(`/api/positions/${posId}/requirements`, { kind: 'course', course_id: courseId })).status).toBe(409);
    expect((await coord.post(`/api/positions/${posId}/requirements`, { kind: 'certification', certification_type: 'nope' })).status).toBe(400);
    expect((await coord.post(`/api/positions/${posId}/requirements`, { kind: 'certification', certification_type: 'first_aid', grace_days: -1 })).status).toBe(400);
    const agent = await t.as('agent');
    expect((await agent.post(`/api/positions/${posId}/requirements`, { kind: 'certification', certification_type: 'first_aid' })).status).toBe(403);
    expect((await coord.get(`/api/positions/${posId}/requirements`)).body).toHaveLength(2);
  });
});

describe('training for roster people', () => {
  it('a position rule assigns the course to roster people, with or without an account', async () => {
    const rule = await coord.post(`/api/courses/${courseId}/assignments`, { audience_type: 'position', position_id: posId });
    expect(rule.status).toBe(201);
    expect(rule.body.audience_label).toBe('Position: Invented signal maintainer');
    expect(rule.body.people).toBe(2);
    const recs = await t.db.query<any>('select person_id, person_key from training_records where course_id = $1 and deleted_at is null order by person_key', [courseId]);
    expect(recs.map((r) => r.person_key).sort()).toEqual([`p:${ids.ana}`, `p:${ids.ben}`].sort());
    expect((await syncTrainingAssignments(ctxOf())).created).toBe(0);
  });

  it('records completion for a roster person by employee number', async () => {
    const res = await coord.post('/api/training/records', { course_id: courseId, people: [{ employee_number: 'M1' }], completed_on: today });
    expect(res.status).toBe(201);
    expect(res.body.completed).toBe(1);
    const mine = await coord.get(`/api/training/people/${ids.ana}`);
    expect(mine.body.records[0]).toMatchObject({ person: 'Ana Example', status: 'complete' });
  });

  it('records kept by email before the person was on the roster become theirs', async () => {
    await coord.post('/api/training/records', { course_id: courseId, people: [{ name: 'Cy Example', email: 'cy@example.test' }], completed_on: today });
    const cy = (await coord.post('/api/people', { full_name: 'Cy Example', email: 'cy@example.test' })).body.id;
    const rec = await t.db.one<any>(`select person_key, person_id from training_records where person_id = $1`, [cy]);
    expect(rec.person_key).toBe(`p:${cy}`);
  });
});

describe('certifications and the matrix', () => {
  it('creates certifications with CRT- numbers and fills expiry from the type\'s validity', async () => {
    const issued = addMonths(today, -10);
    const res = await coord.post('/api/certifications', { person_id: ids.ana, certification_type: 'track_access', issued_on: issued });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ref: 'CRT-00001', expires_on: addMonths(issued, 12), issuing_body: 'Internal' });
    expect((await coord.post('/api/certifications', { person_id: ids.ben, certification_type: 'track_access', issued_on: today, expires_on: addDays(today, -1) })).status).toBe(400);
    expect((await coord.post('/api/certifications', { person_id: '00000000-0000-4000-8000-000000000000', certification_type: 'first_aid' })).status).toBe(400);
    // Ben's expired 3 days ago (inside the 7 grace days) and one that expired long ago.
    await coord.post('/api/certifications', { person_id: ids.ben, certification_type: 'track_access', issued_on: addMonths(today, -24), expires_on: addDays(today, -3) });
  });

  it('works out who is qualified: every mandatory requirement met and in date', async () => {
    const m = await coord.get(`/api/training/qualifications?position=${posId}`);
    expect(m.status).toBe(200);
    expect(m.body.columns.map((c: any) => c.label)).toEqual(['Track access permit', 'Invented track safety']);
    const ana = m.body.rows.find((r: any) => r.id === ids.ana);
    const ben = m.body.rows.find((r: any) => r.id === ids.ben);
    expect(ana.qualified).toBe(true);
    expect(ana.cells['cert:track_access'].state).toBe('met');
    expect(ben.qualified).toBe(false);
    expect(ben.cells[`course:${courseId}`].state).toBe('missing');
    expect(ben.cells['cert:track_access'].state).toBe('expiring'); // within grace, so still counts
    expect(m.body.counts).toMatchObject({ people: 2, qualified: 1, withRequirements: 2 });
    expect((await coord.get('/api/training/qualifications?qualified=false')).body.rows.map((r: any) => r.id)).toEqual([ids.ben]);
    const agent = await t.as('agent');
    expect((await agent.get('/api/training/qualifications')).status).toBe(403);
  });

  it('lists expiring certifications and sends each reminder step once', async () => {
    const res = await coord.get('/api/training/certifications/expiring?days=75');
    expect(res.body.counts.expired).toBe(1);
    expect(res.body.rows.map((r: any) => r.person)).toEqual(['Ben Example', 'Ana Example']);
    expect((await coord.get('/api/training/certifications/expiring?days=-1')).status).toBe(400);
    const first = await runCertificationReminders(ctxOf());
    expect(first.reminded).toBe(2);
    expect((await runCertificationReminders(ctxOf())).reminded).toBe(0);
    // Ana's supervisor (with an account) is told.
    const n = await t.db.query<any>(`select title from notifications where user_id = $1 and kind = 'reminder'`, [coord.userId]);
    expect(n.some((x) => /Track access permit of Ana Example/.test(x.title))).toBe(true);
  });

  it('offers the training metrics', async () => {
    const ctx = ctxOf();
    const keys = metricsAvailable(t.app, ctx.resources).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['training.compliance_pct', 'training.certifications_expired']));
    const res = await t.api.get(`/api/metrics?month=${today.slice(0, 7)}`);
    const byKey = Object.fromEntries(res.body.metrics.map((m: any) => [m.key, m.value]));
    expect(byKey['training.compliance_pct']).toBe(50);
    expect(byKey['training.certifications_expired']).toBe(1);
  });
});
