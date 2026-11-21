import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleContext } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runHazardReviewReminders } from './hazard-reminders.ts';

// Hazard review reminders (E20-12). Invented hazards only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const told = async (userId: string, like: string) =>
  (await t.db.query(`select 1 from notifications where user_id = $1 and title like $2`, [userId, `%${like}%`])).length;

describe('hazard review reminders', () => {
  it('is scheduled on the job queue, beside the corrective-action reminders and the notification clocks', async () => {
    const names = (await t.db.query<{ name: string }>(`select name from job_schedules where name like 'safety.%' order by name`)).map((r) => r.name);
    expect(names).toEqual(['safety.clocks', 'safety.hazard_reviews', 'safety.reminders']);
  });

  it('sends nothing without the notifications module', async () => {
    const without = { ...t.ctx, app: { hasDecorator: () => false } } as unknown as ModuleContext;
    expect((await runHazardReviewReminders(without)).available).toBe(false);
  });

  it('tells the owner when the review is near and when it is reached, once each; closed hazards are skipped', async () => {
    if (!t.app.hasDecorator('notify')) return;
    const owner = await t.as('safety_manager');
    const make = async (title: string, review_date: string, extra: Record<string, unknown> = {}) => {
      const res = await t.api.post('/api/hazards', { title, owner_id: owner.userId, review_date, likelihood: 2, severity: 2, ...extra });
      expect(res.status).toBe(201);
      return res.body;
    };
    const near = await make('Slippery platform edge in rain', dayInZone(5));
    await make('Depot yard crossing', dayInZone(60));
    await make('Retired hazard', dayInZone(2), { status: 'closed' });

    const run = await runHazardReviewReminders(t.ctx);
    expect(run.available).toBe(true);
    expect(await told(owner.userId, 'Slippery platform edge')).toBe(1);
    expect(await told(owner.userId, 'Depot yard crossing')).toBe(0);
    expect(await told(owner.userId, 'Retired hazard')).toBe(0);

    await runHazardReviewReminders(t.ctx);
    expect(await told(owner.userId, 'Slippery platform edge')).toBe(1);

    await t.db.query('update hazards set review_date = $2 where id = $1', [near.id, dayInZone(-1)]);
    await runHazardReviewReminders(t.ctx);
    expect(await told(owner.userId, 'Hazard review overdue: ')).toBe(1);

    // Administrators can run it by hand.
    expect((await t.api.post('/api/safety/hazard-reminders/run')).body).toMatchObject({ available: true });
  });
});
