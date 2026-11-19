import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleContext } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { runOverdueReminders } from './overdue-reminders.ts';

// Overdue milestones and register items (E11-24). With the notifications module loaded the real
// notifications are read back; without it the run reports that nothing could be sent.
let t: Awaited<ReturnType<typeof testApp>>;
let adminId: string;
beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
});
afterAll(async () => { await t.close(); });

const titles = async (userId: string) =>
  (await t.db.query<{ title: string }>(`select title from notifications where user_id = $1 order by created_at`, [userId])).map((r) => r.title);

describe('overdue milestone and register item reminders', () => {
  it('is scheduled on the job queue', async () => {
    expect(await t.db.one(`select type from job_schedules where name = 'projects.overdue_reminders'`)).toEqual({ type: 'projects.overdue_reminders' });
    expect(await t.db.one(`select type from job_schedules where name = 'projects.reminders'`)).toEqual({ type: 'projects.reminders' });
  });

  it('sends nothing, and says so, without the notifications module', async () => {
    const without = { ...t.ctx, app: { hasDecorator: () => false } } as unknown as ModuleContext;
    expect(await runOverdueReminders(without)).toEqual({ available: false, milestones: 0, items: 0, notified: 0 });
  });

  it('tells the owner, or the manager, once for each overdue due date', async () => {
    if (!t.app.hasDecorator('notify')) return; // covered above
    const owner = await t.as('project_manager');
    const p = (await t.api.post('/api/projects', { name: 'Depot lighting upgrade', project_manager_id: adminId })).body;
    const late = dayInZone(-3);
    const m = (await t.api.post(`/api/projects/${p.id}/milestones`, { name: 'Lamps delivered', due_on: dayInZone(5) })).body;
    await t.db.query('update project_milestones set due_on = $2 where id = $1', [m.id, late]);
    await t.api.post(`/api/projects/${p.id}/milestones`, { name: 'Not yet due', due_on: dayInZone(10) });
    const owned = (await t.api.post(`/api/projects/${p.id}/items`, { kind: 'issue', title: 'Ladder access', owner_id: owner.userId, due_on: dayInZone(4) })).body;
    const unowned = (await t.api.post(`/api/projects/${p.id}/items`, { kind: 'risk', title: 'Supplier delay', due_on: dayInZone(4) })).body;
    const closed = (await t.api.post(`/api/projects/${p.id}/items`, { kind: 'issue', title: 'Already closed', owner_id: owner.userId, due_on: dayInZone(4) })).body;
    await t.db.query('update project_items set due_on = $2 where id = any($1::uuid[])', [[owned.id, unowned.id, closed.id], late]);
    await t.db.query(`update project_items set status = 'closed' where id = $1`, [closed.id]);

    const first = await runOverdueReminders(t.ctx);
    expect(first.available).toBe(true);
    expect(first.notified).toBeGreaterThanOrEqual(3);
    const mine = await titles(adminId);
    expect(mine.some((x) => x.startsWith('Milestone overdue: Lamps delivered'))).toBe(true);
    expect(mine.some((x) => x.includes('Not yet due'))).toBe(false);
    expect(mine.some((x) => x.includes('Supplier delay'))).toBe(true); // no owner: the manager
    const theirs = await titles(owner.userId);
    expect(theirs.filter((x) => x.includes('Ladder access'))).toHaveLength(1);
    expect(theirs.some((x) => x.includes('Already closed'))).toBe(false);

    // Once: a second run sends nothing new.
    const again = await runOverdueReminders(t.ctx);
    expect(again.notified).toBe(0);

    // A new due date that is missed again is a new occasion.
    await t.db.query('update project_items set due_on = $2 where id = $1', [owned.id, dayInZone(-1)]);
    await runOverdueReminders(t.ctx);
    expect((await titles(owner.userId)).filter((x) => x.includes('Ladder access'))).toHaveLength(2);

    // A finished milestone is left alone.
    await t.db.query('update project_milestones set done_on = $2, due_on = $3 where id = $1', [m.id, dayInZone(0), dayInZone(-2)]);
    expect((await runOverdueReminders(t.ctx)).milestones).toBe(0);
  });
});
