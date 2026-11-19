import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';
import { notifyTraining } from './index.ts';

// Failed results (E10-10), self-certified completion (E10-11), assignment and overdue
// notifications (E10-09) and exercise steps from an incident scenario checklist (E10-14).
// Runs with whichever modules are loaded; without notifications or security incidents the
// parts that need them check that nothing breaks. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;
let driver: Client;
let notifications = false;
const today = () => localDate();

async function withGrants(key: string, grants: string[]): Promise<Client> {
  const role = (await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled, requires_mfa) values ($1, $1, 'Test', true, false) returning id`, [key]))!;
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, g]);
  return t.as(key);
}
const course = async (title: string, extra: Record<string, unknown> = {}) =>
  (await lead.post('/api/courses', { title, due_days: 14, ...extra })).body;
const mine = async (c: Client, courseId: string) =>
  ((await c.get('/api/training/mine')).body.rows as any[]).filter((r) => r.course_id === courseId);
const inbox = async (userId: string) => (notifications
  ? t.db.query<any>('select kind, title, body, route from notifications where user_id = $1 order by created_at', [userId])
  : []);

beforeAll(async () => {
  t = await testApp();
  notifications = t.app.hasDecorator('notify');
  lead = await t.as('security_lead');
  driver = await withGrants('training_driver', []); // no training permission: sees only My training
});
afterAll(async () => { await t.close(); });

describe('the services these tests lean on', () => {
  it('are found whenever their modules are loaded, so the checks below are not skipped by accident', async () => {
    const loaded = process.env.GRC_MODULES?.split(',').map((m) => m.trim());
    if (!loaded || loaded.includes('notifications')) expect(notifications).toBe(true);
    if (!loaded || loaded.includes('secincidents')) expect((await lead.get('/api/exercises/scenario-checklists')).body.available).toBe(true);
  });
});

describe('a failed result (E10-10)', () => {
  it('is an attempt: the training stays due, and a later pass completes it', async () => {
    const c = await course('Invented securing on-vehicle systems');
    const failed = await lead.post('/api/training/records', {
      course_id: c.id, people: [{ user_id: driver.userId }], completed_on: addDays(today(), -2), result: 'failed', score: 41,
    });
    expect(failed.status).toBe(201);
    expect(failed.body).toMatchObject({ attempted: 1, created: 0, completed: 0 });
    let rows = await mine(driver, c.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'due', completed_on: null, attempted_on: addDays(today(), -2), result: 'failed' });
    const progress = (await lead.get(`/api/courses/${c.id}/progress`)).body;
    expect(progress).toMatchObject({ total: 1, complete: 0, rate: 0 });
    expect((await t.db.query(`select 1 from audit_events where action = 'training_record.attempt' and record_id = $1`, [c.id])).length).toBe(1);

    const passed = await lead.post('/api/training/records', { course_id: c.id, people: [{ user_id: driver.userId }], completed_on: today(), result: 'passed', score: 88 });
    expect(passed.body.completed).toBe(1);
    rows = await mine(driver, c.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'complete', completed_on: today(), result: 'passed', attempted_on: addDays(today(), -2) });
    expect((await lead.get(`/api/courses/${c.id}/progress`)).body.rate).toBe(100);
  });

  it('turns a completion edited to "did not pass" back into an attempt', async () => {
    const c = await course('Invented depot radio procedure');
    await lead.post('/api/training/records', { course_id: c.id, people: [{ user_id: driver.userId }], completed_on: today(), result: 'passed' });
    const [rec] = await mine(driver, c.id);
    const edited = await lead.patch(`/api/training/records/${rec.id}`, { result: 'failed' });
    expect(edited.body).toMatchObject({ status: 'due', completed_on: null, attempted_on: today(), result: 'failed' });
  });

  it('migrates rows written before: a lone failed completion becomes due, a failed one followed by a pass stays history', async () => {
    const c = await course('Invented ticket machine handling');
    const ins = (person: string, completed: string, result: string) => t.db.query(
      `insert into training_records (course_id, person_name, person_key, assigned_on, completed_on, result) values ($1,$2,$3,$4,$4,$5)`,
      [c.id, person, `n:${person.toLowerCase()}`, completed, result]);
    await ins('Invented Lone', addDays(today(), -30), 'failed');
    await ins('Invented Retry', addDays(today(), -30), 'failed');
    await ins('Invented Retry', addDays(today(), -10), 'passed');
    await t.db.exec(readFileSync(new URL('./migrations/002_attempts_self_cert_checklists.sql', import.meta.url), 'utf8'));
    const people = (await lead.get(`/api/courses/${c.id}/progress`)).body.people as any[];
    expect(people.find((p) => p.person === 'Invented Lone')).toMatchObject({ status: 'due', attempted_on: addDays(today(), -30), completed_on: null });
    expect(people.find((p) => p.person === 'Invented Retry')).toMatchObject({ status: 'complete', completed_on: addDays(today(), -10) });
  });
});

describe('self-certified completion (E10-11)', () => {
  it('lets a person complete their own training on a course that allows it, with an evidence note', async () => {
    const strict = await course('Invented signalling safety');
    const open = await course('Invented passenger privacy briefing', { self_certify: true });
    expect(open.self_certify).toBe(true);
    await lead.post('/api/training/records', { course_id: open.id, people: [{ user_id: driver.userId }] });

    const offered = (await driver.get('/api/training/mine/self-certify')).body.map((c: any) => c.id);
    expect(offered).toContain(open.id);
    expect(offered).not.toContain(strict.id);
    expect((await driver.post('/api/training/mine/complete', { course_id: strict.id, evidence_note: 'x' })).body.error.code).toBe('not_self_certified');
    expect((await driver.post('/api/training/mine/complete', { course_id: open.id })).body.error.fields.evidence_note).toBeTruthy();
    expect((await driver.post('/api/training/mine/complete', { course_id: open.id, evidence_note: 'x', completed_on: addDays(today(), 3) })).body.error.fields.completed_on).toBeTruthy();

    const done = await driver.post('/api/training/mine/complete', { course_id: open.id, evidence_note: 'Read the briefing in the crew room.' });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ status: 'complete', self_certified: true, completed_on: today(), evidence_note: 'Read the briefing in the crew room.' });
    expect(await mine(driver, open.id)).toHaveLength(1); // the assigned record was completed, not a second one added
    expect((await driver.post('/api/training/mine/complete', { course_id: open.id, evidence_note: 'again' })).status).toBe(409);
    const event = await t.db.one<any>(`select actor_id, summary from audit_events where action = 'training_record.self_certify' and record_id = $1`, [open.id]);
    expect(event).toMatchObject({ actor_id: driver.userId, summary: expect.stringMatching(/self-certified/) });
    // Others' records are untouched and the register still needs a permission.
    expect((await driver.get('/api/training/records')).status).toBe(403);
  });
});

describe('notifications (E10-09)', () => {
  it('tells a person once about new training, and reminds them when overdue once per interval', async () => {
    const c = await course('Invented fare system refresher');
    await lead.post('/api/training/records', { course_id: c.id, people: [{ user_id: driver.userId }], due_on: addDays(today(), -1) });
    const assigned = (await inbox(driver.userId)).filter((n) => n.title.includes('Invented fare system refresher'));
    if (!notifications) { expect(await notifyTraining(t.ctx)).toEqual({ assigned: 0, overdue: 0, notifications: 0 }); return; }
    expect(assigned.map((n) => n.kind)).toEqual(['assignment', 'due']); // assigned, and already past its due date
    expect(assigned[0]).toMatchObject({ route: '/training/mine', title: expect.stringMatching(/^Training assigned to you/) });

    expect((await notifyTraining(t.ctx)).overdue).toBe(0); // nothing again inside the interval
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect((await notifyTraining(t.ctx, later)).overdue).toBeGreaterThanOrEqual(1);
    expect((await inbox(driver.userId)).filter((n) => n.kind === 'due' && n.title.includes('Invented fare system refresher'))).toHaveLength(2);

    // Completed: no more reminders.
    await lead.post('/api/training/records', { course_id: c.id, people: [{ user_id: driver.userId }], completed_on: today() });
    const before = (await inbox(driver.userId)).length;
    await notifyTraining(t.ctx, new Date(Date.now() + 30 * 86_400_000));
    expect((await inbox(driver.userId)).filter((n) => n.title.includes('Invented fare system refresher'))).toHaveLength(3);
    expect((await inbox(driver.userId)).length).toBeGreaterThanOrEqual(before);
  });

  it('keeps the reminder interval as a setting with validation', async () => {
    expect((await lead.get('/api/training/settings')).body).toEqual({ reminder_interval_days: 7 });
    expect((await driver.put('/api/training/settings', { reminder_interval_days: 3 })).status).toBe(403);
    expect((await t.api.put('/api/training/settings', { reminder_interval_days: 0 })).body.error.fields.reminder_interval_days).toBeTruthy();
    expect((await t.api.put('/api/training/settings', { reminder_interval_days: 14 })).body).toEqual({ reminder_interval_days: 14 });
    await t.api.put('/api/training/settings', { reminder_interval_days: 7 });
  });
});

describe('exercise steps (E10-14)', () => {
  it('copies an incident scenario checklist once, records how each step went, and audits it', async () => {
    const ex = (await lead.post('/api/exercises', { title: 'Invented ransomware tabletop at the depot', type: 'tabletop' })).body;
    const lists = (await lead.get('/api/exercises/scenario-checklists')).body;
    if (!lists.available) {
      expect((await lead.post(`/api/exercises/${ex.id}/steps/copy`, { scenario: 'x' })).status).toBe(409);
    } else {
      const scenario = lists.scenarios[0];
      expect(scenario.steps).toBeGreaterThan(0);
      const copied = await lead.post(`/api/exercises/${ex.id}/steps/copy`, { scenario: scenario.value });
      expect(copied.body.copied).toBe(scenario.steps);
      expect((await lead.post(`/api/exercises/${ex.id}/steps/copy`, { scenario: scenario.value })).body.error.code).toBe('already_copied');
      const first = copied.body.steps[0];
      const went = await lead.patch(`/api/exercises/${ex.id}/steps/${first.id}`, { outcome: 'with_issues', notes: 'The on-call list was out of date.' });
      expect(went.body).toMatchObject({ outcome: 'with_issues' });
      expect((await lead.patch(`/api/exercises/${ex.id}/steps/${first.id}`, { outcome: 'brilliant' })).body.error.fields.outcome).toBeTruthy();
      const read = (await lead.get(`/api/exercises/${ex.id}/steps`)).body;
      expect(read.summary).toMatchObject({ total: scenario.steps, with_issues: 1, unrecorded: scenario.steps - 1 });
    }
    const own = await lead.post(`/api/exercises/${ex.id}/steps`, { step: 'Invented: call the bus operations controller' });
    expect(own.status).toBe(201);
    expect((await lead.post(`/api/exercises/${ex.id}/steps`, {})).body.error.fields.step).toBeTruthy();
    expect((await driver.get(`/api/exercises/${ex.id}/steps`)).status).toBe(403);
    expect((await lead.del(`/api/exercises/${ex.id}/steps/${own.body.id}`)).body).toEqual({ ok: true });
    const actions = (await t.db.query<any>(`select action from audit_events where record_id = $1 and action like 'exercise_step.%'`, [ex.id])).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['exercise_step.create', 'exercise_step.delete']));
  });
});
