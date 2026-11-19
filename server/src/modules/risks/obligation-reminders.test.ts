import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleContext } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runObligationReminders } from './obligation-reminders.ts';

// Obligation due-date reminders (E08-22). Invented obligations only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const told = async (userId: string, like: string) =>
  (await t.db.query(`select 1 from notifications where user_id = $1 and title like $2`, [userId, `%${like}%`])).length;

describe('obligation due-date reminders', () => {
  it('is scheduled on the job queue', async () => {
    expect(await t.db.one(`select every_seconds from job_schedules where name = 'obligations.reminders'`)).toEqual({ every_seconds: 6 * 3600 });
  });

  it('sends nothing without the notifications module', async () => {
    const without = { ...t.ctx, app: { hasDecorator: () => false } } as unknown as ModuleContext;
    expect((await runObligationReminders(without)).available).toBe(false);
  });

  it('tells the owner once inside the window and once when the date is reached', async () => {
    if (!t.app.hasDecorator('notify')) return;
    const owner = await t.as('security_lead');
    const make = async (title: string, next_due_on: string) =>
      (await t.api.post('/api/obligations', { title, owner_id: owner.userId, next_due_on })).body;
    const soon = await make('Annual fare-data return', dayInZone(10));
    await make('Five-year plan filing', dayInZone(200));
    const longAgo = await make('Old filing', dayInZone(-400));

    const run = await runObligationReminders(t.ctx);
    expect(run.available).toBe(true);
    expect(await told(owner.userId, 'Annual fare-data return')).toBe(1);
    expect(await told(owner.userId, 'Five-year plan filing')).toBe(0); // outside the 30-day window
    expect(await told(owner.userId, 'Old filing')).toBe(0); // long past: no flood on the first run
    expect(longAgo.id).toBeTruthy();

    await runObligationReminders(t.ctx);
    expect(await told(owner.userId, 'Annual fare-data return')).toBe(1);

    // The date is reached: one more.
    await t.db.query('update obligations set next_due_on = $2 where id = $1', [soon.id, dayInZone(0)]);
    await runObligationReminders(t.ctx);
    await runObligationReminders(t.ctx);
    expect(await told(owner.userId, 'Obligation due today: ')).toBe(1);

    // A wider window, set on the reminders page, brings the far one in.
    expect((await t.api.patch('/api/notifications/reminder-settings', { values: { 'obligations.reminder_days': 365 } })).status).toBe(200);
    await runObligationReminders(t.ctx);
    expect(await told(owner.userId, 'Five-year plan filing')).toBe(1);
  });
});
