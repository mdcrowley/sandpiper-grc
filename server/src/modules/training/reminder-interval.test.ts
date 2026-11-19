import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';
import { notifyTraining } from './index.ts';

// E10-18: a course may set its own days between overdue reminders, falling back to the module
// setting. Reads the claim stamped on each training record, so it works with or without the
// notifications module. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
let lead: Awaited<ReturnType<typeof t.as>>;
let person: Awaited<ReturnType<typeof t.as>>;
beforeAll(async () => {
  t = await testApp();
  lead = await t.as('security_lead');
  person = await t.as('agent');
});
afterAll(async () => { await t.close(); });

const recordOf = async (courseId: string) =>
  (await t.db.one<{ overdue_reminded_at: Date | null }>('select overdue_reminded_at from training_records where course_id = $1', [courseId]))!;

describe('a course’s own reminder interval', () => {
  it('is validated: a whole number from 1 to 90, or empty', async () => {
    for (const bad of [0, 91]) {
      expect((await lead.post('/api/courses', { title: 'Invented bad interval course', reminder_interval_days: bad })).body.error.fields.reminder_interval_days).toBeTruthy();
    }
  });

  it('reminds on the course’s own interval, and on the module setting when it is empty', async () => {
    if (!t.app.hasDecorator('notify')) {
      expect((await notifyTraining(t.ctx)).overdue).toBe(0);
      return;
    }
    const own = (await lead.post('/api/courses', { title: 'Invented two-day course', due_days: 14, reminder_interval_days: 2 })).body;
    const usual = (await lead.post('/api/courses', { title: 'Invented usual course', due_days: 14 })).body;
    for (const c of [own, usual]) {
      await lead.post('/api/training/records', { course_id: c.id, people: [{ user_id: person.userId }], due_on: addDays(localDate(), -1) });
    }
    await notifyTraining(t.ctx);
    const first = { own: (await recordOf(own.id)).overdue_reminded_at, usual: (await recordOf(usual.id)).overdue_reminded_at };
    expect(first.own).not.toBeNull();
    expect(first.usual).not.toBeNull();

    // Three days later: the course with a two-day interval is reminded again, the usual one (7 days) is not.
    await notifyTraining(t.ctx, new Date(Date.now() + 3 * 86_400_000));
    expect((await recordOf(own.id)).overdue_reminded_at).not.toEqual(first.own);
    expect((await recordOf(usual.id)).overdue_reminded_at).toEqual(first.usual);
  });
});
