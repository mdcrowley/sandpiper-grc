import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';
import { runPolicyReminders } from './index.ts';

// Separation of duties on versions, discarding a draft, the reminder interval setting,
// notifications for acknowledgment requests and reminders, and what the expiring-exceptions
// list shows to someone who may not read policies. Runs with whichever modules are loaded;
// without the notification service the notification checks confirm nothing breaks.
// Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let author: Client;
let approver: Client;
let staff: Client;
let notifications = false;

async function withGrants(key: string, grants: string[]): Promise<Client> {
  const role = (await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled, requires_mfa) values ($1, $1, 'Test', true, false) returning id`, [key]))!;
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, g]);
  return t.as(key);
}
const inbox = async (userId: string) => (notifications
  ? t.db.query<any>('select kind, title, body, route, record_type from notifications where user_id = $1 order by created_at', [userId])
  : []);

beforeAll(async () => {
  t = await testApp();
  notifications = t.app.hasDecorator('notify');
  author = await t.as('security_lead');
  approver = await t.as('security_lead');
  staff = await withGrants('policy_staff', []); // no policy permissions at all: only asked to acknowledge
});
afterAll(async () => { await t.close(); });

async function policyWithDraft(title: string, extra: Record<string, unknown> = {}) {
  const p = (await author.post('/api/policies', { title, audience_roles: ['policy_staff'], ack_days: 5, ...extra })).body;
  const v = (await author.post(`/api/policies/${p.id}/versions`, { body: '## Purpose\n\nInvented text about securing on-vehicle systems.' })).body;
  return { p, v };
}

describe('versions', () => {
  it('refuses approval by the person who wrote the version', async () => {
    const { p, v } = await policyWithDraft('Invented on-vehicle systems policy');
    const own = await author.post(`/api/policies/${p.id}/versions/${v.id}/approve`);
    expect([own.status, own.body.error.code]).toEqual([403, 'own_version']);
    expect((await approver.post(`/api/policies/${p.id}/versions/${v.id}/approve`)).body.status).toBe('approved');
  });

  it('discards a draft or in-review version, keeps its text in the history, and never a published one', async () => {
    const { p, v } = await policyWithDraft('Invented depot visitor policy');
    expect((await staff.del(`/api/policies/${p.id}/versions/${v.id}`)).status).toBe(403);
    await author.post(`/api/policies/${p.id}/versions/${v.id}/submit`);
    const gone = await author.del(`/api/policies/${p.id}/versions/${v.id}`);
    expect(gone.body).toMatchObject({ ok: true, status: 'draft' });
    expect((await author.get(`/api/policies/${p.id}/versions`)).body).toEqual([]);
    const event = await t.db.one<any>(`select before from audit_events where action = 'policy.version_discard' and record_id = $1`, [p.id]);
    expect(event.before).toMatchObject({ version: 1, status: 'in_review', body: expect.stringContaining('on-vehicle') });

    // A fresh draft can be started, approved and published; the published one cannot be discarded.
    const v2 = (await author.post(`/api/policies/${p.id}/versions`, { body: 'Second try.' })).body;
    await approver.post(`/api/policies/${p.id}/versions/${v2.id}/approve`);
    await approver.post(`/api/policies/${p.id}/versions/${v2.id}/publish`);
    expect((await author.del(`/api/policies/${p.id}/versions/${v2.id}`)).body.error.code).toBe('not_draft');
  });
});

describe('the reminder interval', () => {
  it('is read by anyone who reads policies, set only by an administrator of policies, validated and audited', async () => {
    expect((await author.get('/api/policies/settings')).body).toEqual({ reminder_interval_days: 7 });
    expect((await staff.get('/api/policies/settings')).status).toBe(403);
    const writer = await withGrants('policy_writer', ['policies.view', 'policies.edit', 'policies.approve']);
    expect((await writer.put('/api/policies/settings', { reminder_interval_days: 3 })).status).toBe(403);
    for (const bad of [0, 91, 2.5, 'soon', null]) {
      expect((await t.api.put('/api/policies/settings', { reminder_interval_days: bad })).body.error.fields.reminder_interval_days).toBeTruthy();
    }
    expect((await t.api.put('/api/policies/settings', { reminder_interval_days: 3 })).body).toEqual({ reminder_interval_days: 3 });
    expect((await t.db.query(`select 1 from audit_events where action = 'setting.change' and record_id = 'policies.reminder_interval_days' and actor_id is not null`)).length).toBe(1);
    await t.api.put('/api/policies/settings', { reminder_interval_days: 7 });
  });
});

describe('notifications', () => {
  it('asks each person in the audience on publication, links to their own reader, and reminds them once per interval', async () => {
    const { p, v } = await policyWithDraft('Invented securing on-vehicle systems policy');
    await approver.post(`/api/policies/${p.id}/versions/${v.id}/approve`);
    const pub = await approver.post(`/api/policies/${p.id}/versions/${v.id}/publish`);
    expect(pub.body.requested).toBe(1);
    const ack = await t.db.one<{ id: string }>('select id from policy_acknowledgements where policy_id = $1 and user_id = $2', [p.id, staff.userId]);
    const mine = (await inbox(staff.userId)).filter((n) => n.route === `/policies/acknowledgments/${ack!.id}`);
    if (notifications) {
      expect(mine).toEqual([expect.objectContaining({ kind: 'acknowledgement', record_type: null, title: expect.stringMatching(/^Please read and acknowledge POL-/) })]);
      // The person can open what the link points at, without any policy permission.
      expect((await staff.get(`/api/policies/acknowledgments/${ack!.id}`)).status).toBe(200);
    } else {
      expect(mine).toEqual([]);
    }

    const later = new Date(Date.parse(`${addDays(localDate(), 6)}T12:00:00Z`));
    expect((await runPolicyReminders(t.ctx, later)).map((r) => r.policy_id)).toContain(p.id);
    expect((await runPolicyReminders(t.ctx, new Date(later.getTime() + 86_400_000))).map((r) => r.policy_id)).not.toContain(p.id);
    if (notifications) {
      const reminders = (await inbox(staff.userId)).filter((n) => n.title.startsWith('Reminder:') && n.title.includes(p.title));
      expect(reminders).toHaveLength(1);
      expect(reminders[0].body).toMatch(/was due on/);
    }
    // Acknowledged: no more reminders.
    await staff.post(`/api/policies/acknowledgments/${ack!.id}/acknowledge`);
    expect((await runPolicyReminders(t.ctx, new Date(later.getTime() + 30 * 86_400_000))).map((r) => r.policy_id)).not.toContain(p.id);
  });
});

describe('expiring exceptions', () => {
  it('leaves out the policy name for someone who may see exceptions but not policies', async () => {
    const { p } = await policyWithDraft('Invented ticket machine policy');
    await t.api.post('/api/exceptions', {
      title: 'Invented ticket machine exception', policy_id: p.id, status: 'approved', approver_name: 'Invented approver', expires_on: addDays(localDate(), 5),
    });
    const exceptionsOnly = await withGrants('exceptions_only', ['exceptions.view']);
    const row = (await exceptionsOnly.get('/api/exceptions/expiring')).body.rows.find((r: any) => r.title === 'Invented ticket machine exception');
    expect(row).toMatchObject({ policy_ref: null, policy_title: null });
    expect((await author.get('/api/exceptions/expiring')).body.rows.find((r: any) => r.title === 'Invented ticket machine exception'))
      .toMatchObject({ policy_title: 'Invented ticket machine policy' });
  });
});
