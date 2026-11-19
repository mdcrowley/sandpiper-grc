import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { runPolicyReminders } from './index.ts';

// A stand-in for the frameworks module, so the outcome mapping can be tested without it.
const standIn: ModuleDef = {
  key: 'policystandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_outcomes (
        id uuid primary key default gen_random_uuid(), code text, title text not null, status text,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'framework_outcome', table: 't_outcomes', module: 'frameworks', label: 'Framework outcome', plural: 'Framework outcomes',
      path: '/api/framework-outcomes', route: '/frameworks/outcomes', titleField: 'title', ref: { field: 'code', prefix: 'OUT-' },
      fields: { code: { label: 'Code', type: 'text' }, title: { label: 'Outcome', type: 'text', required: true } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;      // policies.* (writes, approves, exports)
let lead2: Client;     // a second security lead, who approves what the first one writes
let agentA: Client;    // policies.view only; in the audience by role
let agentB: Client;
let pm: Client;        // no policy permissions; in the audience by department
let outsider: Client;  // project manager outside the audience
let policyId: string;
let v1: string;
let v2: string;

const audit = (action: string, recordId = policyId) =>
  t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, recordId]);
const BODY = '## Purpose\n\nInvented policy text.\n\n<script>alert(1)</script>';

beforeAll(async () => {
  process.env.GRC_MODULES = 'policies'; // the stand-in replaces the real frameworks module
  t = await testApp({ extraModules: [standIn] });
  lead = await t.as('security_lead');
  lead2 = await t.as('security_lead');
  agentA = await t.as('agent');
  agentB = await t.as('agent');
  pm = await t.as('project_manager');
  outsider = await t.as('project_manager');
});
afterAll(async () => { await t.close(); });

describe('policy register', () => {
  it('creates a policy with a reference, as a draft', async () => {
    const res = await lead.post('/api/policies', {
      title: 'Invented clear desk policy', summary: 'Keep desks clear.', category: 'governance',
      approver_name: 'Invented Approver', approver_role: 'Director', review_date: '2027-06-30', status: 'published',
    });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('POL-00001');
    expect(res.body.status).toBe('draft'); // status follows the versions; it cannot be typed in
    expect(res.body.current_version).toBeNull();
    expect(res.body.ack_days).toBe(14);
    policyId = res.body.id;
    expect((await lead.patch(`/api/policies/${policyId}`, { status: 'published' })).body.status).toBe('draft');
    expect((await audit('policy.create')).length).toBe(1);
  });

  it('validates the audience and the days to acknowledge', async () => {
    expect((await lead.patch(`/api/policies/${policyId}`, { audience_roles: ['no_such_role'] })).body.error.fields.audience_roles).toBeTruthy();
    expect((await lead.patch(`/api/policies/${policyId}`, { audience_departments: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(400);
    expect((await lead.patch(`/api/policies/${policyId}`, { audience_roles: 'agent' })).status).toBe(400);
    expect((await lead.patch(`/api/policies/${policyId}`, { ack_days: 0 })).body.error.fields.ack_days).toBeTruthy();
    const dept = await t.db.one<{ id: string }>(`insert into departments (name) values ('Invented Depot') returning id`);
    await t.db.query('update users set department_id = $1 where id = $2', [dept!.id, pm.userId]);
    const ok = await lead.patch(`/api/policies/${policyId}`, { audience_roles: ['agent'], audience_departments: [dept!.id], ack_days: 10 });
    expect(ok.status).toBe(200);
    expect(ok.body.audience_roles).toEqual(['agent']);
    const options = await lead.get('/api/policies/audience-options');
    expect(options.body.roles.map((r: any) => r.key)).toContain('agent');
    expect(options.body.departments).toEqual([{ id: dept!.id, name: 'Invented Depot' }]);
  });

  it('applies permissions', async () => {
    expect((await t.anon.get('/api/policies')).status).toBe(401);
    expect((await outsider.get('/api/policies')).status).toBe(403);
    expect((await agentA.get(`/api/policies/${policyId}`)).status).toBe(200);
    expect((await agentA.post('/api/policies', { title: 'Nope' })).status).toBe(403);
    expect((await agentA.patch(`/api/policies/${policyId}`, { title: 'Nope' })).status).toBe(403);
    expect((await agentA.post(`/api/policies/${policyId}/versions`, { body: 'x' })).status).toBe(403);
    expect((await agentA.post(`/api/policies/${policyId}/retire`)).status).toBe(403);
    expect((await outsider.get(`/api/policies/${policyId}/versions`)).status).toBe(403);
    expect((await outsider.get(`/api/policies/${policyId}/acknowledgements`)).status).toBe(403);
    expect((await outsider.post('/api/policies/preview', { body: 'x' })).status).toBe(403);
  });
});

describe('versions', () => {
  it('drafts a version and keeps one open version at a time', async () => {
    expect((await lead.post(`/api/policies/${policyId}/versions`, { body: '   ' })).body.error.fields.body).toBeTruthy();
    const res = await lead.post(`/api/policies/${policyId}/versions`, { body: BODY, change_summary: 'First issue' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ version: 1, status: 'draft', change_summary: 'First issue', body: BODY });
    v1 = res.body.id;
    expect((await lead.post(`/api/policies/${policyId}/versions`, { body: 'Another' })).body.error.code).toBe('version_open');
    expect((await audit('policy.version_create')).length).toBe(1);
  });

  it('renders the text safely on the server', async () => {
    const versions = await lead.get(`/api/policies/${policyId}/versions`);
    expect(versions.body[0].body_html).toContain('<h2>Purpose</h2>');
    expect(versions.body[0].body_html).not.toContain('<script');
    expect(versions.body[0].body_html).toContain('&lt;script&gt;');
    const preview = await lead.post('/api/policies/preview', { body: '[x](javascript:alert(1)) <img src=x onerror=alert(1)>' });
    expect(preview.body.html).not.toMatch(/<img|javascript:|<a /);
  });

  it('lets a draft be edited, and hides unpublished versions from readers', async () => {
    const edited = await lead.patch(`/api/policies/${policyId}/versions/${v1}`, { body: `${BODY}\n\nMore.`, change_summary: 'First issue, tidied' });
    expect(edited.body.change_summary).toBe('First issue, tidied');
    expect((await audit('policy.version_update')).length).toBe(1);
    expect((await agentA.get(`/api/policies/${policyId}/versions`)).body).toEqual([]);
    expect((await agentA.patch(`/api/policies/${policyId}/versions/${v1}`, { body: 'x' })).status).toBe(403);
  });

  it('only publishes an approved version', async () => {
    const early = await lead.post(`/api/policies/${policyId}/versions/${v1}/publish`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('not_approved');

    expect((await lead.post(`/api/policies/${policyId}/versions/${v1}/submit`)).body.status).toBe('in_review');
    expect((await lead.get(`/api/policies/${policyId}`)).body.status).toBe('in_review');
    expect((await lead.post(`/api/policies/${policyId}/versions/${v1}/publish`)).status).toBe(409);

    expect((await agentA.post(`/api/policies/${policyId}/versions/${v1}/approve`)).status).toBe(403);
    expect((await lead.post(`/api/policies/${policyId}/versions/${v1}/approve`)).body.error.code).toBe('own_version'); // the author cannot approve
    expect((await lead2.post(`/api/policies/${policyId}/versions/${v1}/approve`, { approved_on: 'tomorrow' })).status).toBe(400);
    const approved = await lead2.post(`/api/policies/${policyId}/versions/${v1}/approve`, { approved_on: '2026-11-01', effective_on: '2026-12-01' });
    expect(approved.body).toMatchObject({ status: 'approved', approved_by_name: 'Invented Approver', approved_on: '2026-11-01', effective_on: '2026-12-01' });
    expect((await lead.get(`/api/policies/${policyId}`)).body.status).toBe('approved');
    // An approved version is fixed: changes need a new version.
    expect((await lead.patch(`/api/policies/${policyId}/versions/${v1}`, { body: 'changed' })).body.error.code).toBe('not_draft');
    expect((await lead.post(`/api/policies/${policyId}/versions/${v1}/approve`)).status).toBe(409);
    expect((await agentA.post(`/api/policies/${policyId}/versions/${v1}/publish`)).status).toBe(403);
    expect((await audit('policy.version_submit')).length).toBe(1);
    expect((await audit('policy.version_approve'))[0].after).toMatchObject({ status: 'approved', approved_by_name: 'Invented Approver' });
  });
});

describe('acknowledgement', () => {
  let ackA: string;

  it('a policy is published and acknowledgements are tracked', async () => {
    // A disabled account in the audience is not asked.
    const gone = await t.as('agent');
    await t.db.query(`update users set status = 'disabled' where id = $1`, [gone.userId]);

    const pub = await lead.post(`/api/policies/${policyId}/versions/${v1}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ requested: 3, status: 'published' });
    expect(pub.body.version.status).toBe('published');
    const policy = (await lead.get(`/api/policies/${policyId}`)).body;
    expect(policy).toMatchObject({ status: 'published', current_version: 1 });
    expect((await audit('policy.publish'))[0].after).toMatchObject({ current_version: 1, acknowledgements_requested: 3 });
    expect((await lead.post(`/api/policies/${policyId}/versions/${v1}/publish`)).body.error.code).toBe('already_published');

    // Readers now see the published version.
    expect((await agentA.get(`/api/policies/${policyId}/versions`)).body.map((v: any) => v.version)).toEqual([1]);

    // Each person in the audience has a request; people outside it do not.
    const mine = await agentA.get('/api/policies/acknowledgements/mine');
    expect(mine.body.awaiting).toHaveLength(1);
    expect(mine.body.awaiting[0]).toMatchObject({ policy_ref: 'POL-00001', version: 1, state: 'outstanding', days_left: 10 });
    ackA = mine.body.awaiting[0].id;
    expect((await pm.get('/api/policies/acknowledgements/mine')).body.awaiting).toHaveLength(1); // by department, with no policy permissions
    expect((await outsider.get('/api/policies/acknowledgements/mine')).body.awaiting).toEqual([]);
    expect((await lead.get('/api/policies/acknowledgements/mine')).body.awaiting).toEqual([]);
    expect((await t.anon.get('/api/policies/acknowledgements/mine')).status).toBe(401);

    // The person reads exactly the version they are asked about, rendered safely.
    const read = await agentA.get(`/api/policies/acknowledgements/${ackA}`);
    expect(read.body.body_html).toContain('<h2>Purpose</h2>');
    expect(read.body.body_html).not.toContain('<script');

    // Nobody can acknowledge for someone else.
    expect((await agentB.get(`/api/policies/acknowledgements/${ackA}`)).status).toBe(404);
    expect((await agentB.post(`/api/policies/acknowledgements/${ackA}/acknowledge`)).status).toBe(404);
    expect((await lead.post(`/api/policies/acknowledgements/${ackA}/acknowledge`)).status).toBe(404);

    const done = await agentA.post(`/api/policies/acknowledgements/${ackA}/acknowledge`);
    expect(done.body.state).toBe('acknowledged');
    expect(done.body.acknowledged_at).toBeTruthy();
    // Acknowledging twice changes nothing and writes no second event.
    expect((await agentA.post(`/api/policies/acknowledgements/${ackA}/acknowledge`)).body.state).toBe('acknowledged');
    const events = await audit('policy.acknowledge');
    expect(events).toHaveLength(1);
    expect(events[0].after).toMatchObject({ version: 1, user_id: agentA.userId, late: false });
    const after = await agentA.get('/api/policies/acknowledgements/mine');
    expect(after.body.awaiting).toEqual([]);
    expect(after.body.acknowledged).toHaveLength(1);

    const track = await lead.get(`/api/policies/${policyId}/acknowledgements`);
    expect(track.body.version.version).toBe(1);
    expect(track.body.counts).toEqual({
      total: 3, acknowledged: 1, outstanding: 2, overdue: 0, acknowledged_pct: 33.3, outstanding_pct: 66.7, overdue_pct: 0,
    });
    expect(track.body.rows.filter((r: any) => r.state === 'outstanding').map((r: any) => r.user_id).sort()).toEqual([agentB.userId, pm.userId].sort());
    expect(track.body.departments).toEqual([
      expect.objectContaining({ department: 'Invented Depot', total: 1, acknowledged: 0 }),
      expect.objectContaining({ department: null, total: 2, acknowledged: 1 }),
    ]);
  });

  it('counts overdue acknowledgements and exports the list', async () => {
    await t.db.query(`update policy_acknowledgements set due_on = current_date - 3 where policy_id = $1 and acknowledged_at is null`, [policyId]);
    const track = await agentA.get(`/api/policies/${policyId}/acknowledgements`);
    expect(track.body.counts).toMatchObject({ outstanding: 2, overdue: 2, overdue_pct: 66.7 });
    expect((await agentB.get('/api/policies/acknowledgements/mine')).body.awaiting[0].state).toBe('overdue');

    expect((await agentA.get(`/api/policies/${policyId}/acknowledgements?format=csv`)).status).toBe(403); // view but not export
    const csv = await lead.get(`/api/policies/${policyId}/acknowledgements?format=csv`);
    expect(csv.status).toBe(200);
    const lines = csv.text.split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('Person,Email,Department,Status');
    expect(csv.text).toContain('Overdue');
    expect(csv.text).toContain('Acknowledged');
    expect(await audit('policy.ack_export')).toHaveLength(1);
  });

  it('the reminder run stamps overdue acknowledgements and writes an audit event', async () => {
    const now = new Date();
    const fired = await runPolicyReminders(t.ctx, now);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ policy_id: policyId, version: 1 });
    expect(fired[0].user_ids.sort()).toEqual([agentB.userId, pm.userId].sort());
    const stamped = await t.db.query<any>('select reminded_at, reminder_count, acknowledged_at from policy_acknowledgements where policy_id = $1', [policyId]);
    expect(stamped.filter((s) => s.reminded_at).length).toBe(2);
    expect(stamped.find((s) => s.acknowledged_at).reminded_at).toBeNull();
    const events = await audit('policy.ack_reminder');
    expect(events).toHaveLength(1);
    expect(events[0].actor_name).toBe('System');
    expect(events[0].summary).toMatch(/2 people are overdue for version 1/);

    // Not again the same day or the next; again once the interval (7 days by default) has passed.
    expect(await runPolicyReminders(t.ctx, now)).toEqual([]);
    expect(await runPolicyReminders(t.ctx, new Date(now.getTime() + 86_400_000))).toEqual([]);
    const later = await runPolicyReminders(t.ctx, new Date(now.getTime() + 7 * 86_400_000));
    expect(later[0].user_ids).toHaveLength(2);
    expect((await t.db.query<any>('select 1 from policy_acknowledgements where reminder_count = 2')).length).toBe(2);
    expect(await audit('policy.ack_reminder')).toHaveLength(2);
    expect((await lead.get(`/api/history?record_type=policy&record_id=${policyId}`)).body.map((h: any) => h.action)).toContain('policy.ack_reminder');
  });

  it('a new published version keeps the old one and re-requests acknowledgement', async () => {
    const draft = await lead.post(`/api/policies/${policyId}/versions`, { body: '## Purpose\n\nRevised invented text.', change_summary: 'Second issue' });
    expect(draft.body.version).toBe(2);
    v2 = draft.body.id;
    // Until it is published, readers still see version 1 and the policy stays published.
    expect((await lead.get(`/api/policies/${policyId}`)).body).toMatchObject({ status: 'published', current_version: 1 });
    await lead2.post(`/api/policies/${policyId}/versions/${v2}/approve`);
    const pub = await lead.post(`/api/policies/${policyId}/versions/${v2}/publish`);
    expect(pub.body.requested).toBe(3); // everyone again, including the person who acknowledged version 1

    const versions = (await lead.get(`/api/policies/${policyId}/versions`)).body;
    expect(versions.map((v: any) => [v.version, v.status])).toEqual([[2, 'published'], [1, 'superseded']]);
    expect(versions[1].body).toContain('Invented policy text.'); // the old text is kept
    expect((await lead.get(`/api/policies/${policyId}`)).body.current_version).toBe(2);

    const mine = await agentA.get('/api/policies/acknowledgements/mine');
    expect(mine.body.awaiting.map((a: any) => a.version)).toEqual([2]);
    expect(mine.body.acknowledged.map((a: any) => a.version)).toEqual([1]);
    // The unanswered request for version 1 is closed, not left overdue.
    const b = await agentB.get('/api/policies/acknowledgements/mine');
    expect(b.body.awaiting.map((a: any) => [a.version, a.state])).toEqual([[2, 'outstanding']]);
    const old = await t.db.one<any>('select id from policy_acknowledgements where version_id = $1 and user_id = $2', [v1, agentB.userId]);
    expect((await agentB.post(`/api/policies/acknowledgements/${old.id}/acknowledge`)).body.error.code).toBe('superseded');

    expect((await lead.get(`/api/policies/${policyId}/acknowledgements`)).body.counts).toMatchObject({ total: 3, acknowledged: 0, outstanding: 3 });
    const previous = await lead.get(`/api/policies/${policyId}/acknowledgements?version=1`);
    expect(previous.body.counts).toMatchObject({ total: 3, acknowledged: 1 });
    expect(await runPolicyReminders(t.ctx, new Date(Date.now() + 30 * 86_400_000))).toHaveLength(1); // only version 2 is chased
  });
});

describe('mapping to framework outcomes', () => {
  it('adds, lists and removes a mapping, with audit', async () => {
    const outcome = await t.api.post('/api/framework-outcomes', { code: 'AA.BB-01', title: 'Invented outcome' });
    const add = await lead.post(`/api/policies/${policyId}/outcomes`, { outcome_id: outcome.body.id });
    expect(add.status).toBe(201);
    expect((await lead.post(`/api/policies/${policyId}/outcomes`, { outcome_id: outcome.body.id })).body.added).toBe(false);
    expect((await lead.post(`/api/policies/${policyId}/outcomes`, { outcome_id: 'nope' })).status).toBe(400);
    expect((await agentA.post(`/api/policies/${policyId}/outcomes`, { outcome_id: outcome.body.id })).status).toBe(403);

    const list = await agentA.get(`/api/policies/${policyId}/outcomes`);
    expect(list.body).toMatchObject({ available: true, route: '/frameworks/outcomes' });
    expect(list.body.rows).toEqual([expect.objectContaining({ id: outcome.body.id, code: 'AA.BB-01', title: 'Invented outcome' })]);
    // It is an ordinary record link, so the outcome's Related tab shows the policy too.
    const back = await lead.get(`/api/links?record_type=framework_outcome&record_id=${outcome.body.id}`);
    expect(back.body[0]).toMatchObject({ direction: 'in', type: 'policy', relation: 'supports', ref: 'POL-00001' });
    expect(await audit('policy.outcome_link')).toHaveLength(1);

    expect((await lead.del(`/api/policies/${policyId}/outcomes/${outcome.body.id}`)).status).toBe(200);
    expect((await lead.del(`/api/policies/${policyId}/outcomes/${outcome.body.id}`)).status).toBe(404);
    expect((await lead.get(`/api/policies/${policyId}/outcomes`)).body.rows).toEqual([]);
    expect((await audit('policy.outcome_unlink'))[0].summary).toContain('Invented outcome');
  });
});

describe('retiring', () => {
  it('closes outstanding requests and stops new versions', async () => {
    const res = await lead.post(`/api/policies/${policyId}/retire`);
    expect(res.body).toMatchObject({ status: 'retired', closed: 3 });
    expect((await lead.get(`/api/policies/${policyId}`)).body.status).toBe('retired');
    expect((await agentA.get('/api/policies/acknowledgements/mine')).body.awaiting).toEqual([]);
    expect((await lead.post(`/api/policies/${policyId}/versions`, { body: 'x' })).body.error.code).toBe('retired');
    expect((await lead.post(`/api/policies/${policyId}/retire`)).status).toBe(409);
    expect((await audit('policy.retire'))[0]).toMatchObject({ before: { status: 'published' }, after: { status: 'retired' } });
    expect(await runPolicyReminders(t.ctx, new Date(Date.now() + 60 * 86_400_000))).toEqual([]);
    // The text stays readable.
    expect((await agentA.get(`/api/policies/${policyId}/versions`)).body).toHaveLength(2);
  });
});
