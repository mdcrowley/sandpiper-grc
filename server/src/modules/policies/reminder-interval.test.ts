import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';
import { runPolicyReminders } from './index.ts';

// E10-18: a policy may set its own days between acknowledgment reminders, falling back to the
// module setting. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
let staffRole = '';
beforeAll(async () => {
  t = await testApp();
  staffRole = 'policy_interval_staff';
  await t.db.query(`insert into roles (key, name, description, enabled, requires_mfa) values ($1, $1, 'Test', true, false)`, [staffRole]);
  await t.as(staffRole);
});
afterAll(async () => { await t.close(); });

async function published(title: string, extra: Record<string, unknown>) {
  const author = await t.as('security_lead');
  const approver = await t.as('security_lead');
  const p = (await author.post('/api/policies', { title, audience_roles: [staffRole], ack_days: 1, ...extra })).body;
  const v = (await author.post(`/api/policies/${p.id}/versions`, { body: 'Invented text.' })).body;
  await approver.post(`/api/policies/${p.id}/versions/${v.id}/approve`);
  await approver.post(`/api/policies/${p.id}/versions/${v.id}/publish`);
  return p;
}
const at = (days: number) => new Date(Date.parse(`${addDays(localDate(), days)}T12:00:00Z`));
const run = async (when: Date) => (await runPolicyReminders(t.ctx, when)).map((r) => r.policy_id);

describe('a policy’s own reminder interval', () => {
  it('is validated: a whole number from 1 to 90, or empty', async () => {
    for (const bad of [0, 91, 2.5]) {
      expect((await t.api.post('/api/policies', { title: 'Invalid interval', reminder_interval_days: bad })).body.error.fields.reminder_interval_days).toBeTruthy();
    }
    expect((await t.api.post('/api/policies', { title: 'Fine interval', reminder_interval_days: null })).status).toBe(201);
  });

  it('reminds on the policy’s own interval, and on the module setting when it is empty', async () => {
    const own = await published('Invented two-day policy', { reminder_interval_days: 2 });
    const usual = await published('Invented usual-interval policy', {});
    // Overdue from day 2 (one day to acknowledge): the first reminder goes out for both.
    expect(await run(at(3))).toEqual(expect.arrayContaining([own.id, usual.id]));
    // Two days later the policy with its own interval reminds again; the usual one (7 days) does not.
    const later = await run(at(5));
    expect(later).toContain(own.id);
    expect(later).not.toContain(usual.id);
    expect(await run(at(10))).toContain(usual.id);
  });
});
