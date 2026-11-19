import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleContext } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { sendEvidenceReminders } from './evidence-reminders.ts';

// Reminders when evidence notes expire (E07-24). Invented framework and outcome only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const told = async (userId: string, like: string) =>
  (await t.db.query(`select 1 from notifications where user_id = $1 and title like $2`, [userId, `%${like}%`])).length;

describe('evidence note expiry reminders', () => {
  it('is scheduled on the job queue with the review reminders', async () => {
    const names = (await t.db.query<{ name: string }>(`select name from job_schedules where name like 'frameworks.%' order by name`)).map((r) => r.name);
    expect(names).toEqual(['frameworks.evidence_reminders', 'frameworks.review_reminders']);
  });

  it('sends nothing without the notifications module', async () => {
    const without = { ...t.ctx, app: { hasDecorator: () => false } } as unknown as ModuleContext;
    expect((await sendEvidenceReminders(without)).available).toBe(false);
  });

  it('tells the outcome owner once before expiry and once after', async () => {
    if (!t.app.hasDecorator('notify')) return;
    const owner = await t.as('security_lead');
    const fw = await t.db.one<{ id: string }>(`insert into frameworks (key, name) values ('tst-evidence', 'Invented test framework') returning id`);
    const outcome = await t.db.one<{ id: string }>(
      `insert into framework_outcomes (framework_id, code, title, owner_id) values ($1, 'TST.EV-1', 'Evidence test outcome', $2) returning id`,
      [fw!.id, owner.userId],
    );
    const add = async (title: string, expires_on: string) =>
      (await t.db.one<{ id: string }>(`insert into outcome_evidence (outcome_id, title, expires_on) values ($1, $2, $3) returning id`, [outcome!.id, title, expires_on]))!.id;
    const soon = await add('Signed statement', dayInZone(10));
    await add('Far-off certificate', dayInZone(200));
    await add('Expired long ago', dayInZone(-300));

    const run = await sendEvidenceReminders(t.ctx);
    expect(run).toMatchObject({ available: true, expiring: 1, expired: 0 });
    expect(await told(owner.userId, 'Signed statement')).toBe(1);
    expect(await told(owner.userId, 'Far-off certificate')).toBe(0);
    expect(await told(owner.userId, 'Expired long ago')).toBe(0);

    await sendEvidenceReminders(t.ctx);
    expect(await told(owner.userId, 'Signed statement')).toBe(1);

    await t.db.query('update outcome_evidence set expires_on = $2 where id = $1', [soon, dayInZone(-1)]);
    await sendEvidenceReminders(t.ctx);
    await sendEvidenceReminders(t.ctx);
    expect(await told(owner.userId, 'has expired: Signed statement')).toBe(1);
    expect((await t.api.post('/api/frameworks/evidence-reminders/run')).status).toBe(200);
  });
});
