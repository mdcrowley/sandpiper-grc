import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';
import { runExceptionExpiry } from './index.ts';

// A stand-in for the risk register (a restricted record type), so linking can be tested without that module.
const standIn: ModuleDef = {
  key: 'exceptionstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_risks (
        id uuid primary key default gen_random_uuid(), ref text, title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'risk', table: 't_risks', module: 'risks', label: 'Risk', plural: 'Risks', restricted: true,
      path: '/api/risks', route: '/risks', titleField: 'title', ref: { field: 'ref', prefix: 'RSK-' },
      fields: { ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Title', type: 'text', required: true } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;    // exceptions.* including approve, and security.view
let editor: Client;  // may record and edit exceptions, may not approve
let policyId: string;
let id: string;

// Days in the organisation's time zone, as the server counts them (a UTC date is a day out in the evening).
const day = (offset: number) => addDays(localDate(), offset);
const events = (recordId: string) =>
  t.db.query<any>(`select * from audit_events where record_type = 'policy_exception' and record_id = $1 order by id`, [recordId]);

beforeAll(async () => {
  process.env.GRC_MODULES = 'policies'; // the stand-in replaces the real risks module
  t = await testApp({ extraModules: [standIn] });
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('exception_editor', 'Exception editor') returning id`);
  for (const p of ['exceptions.view', 'exceptions.create', 'exceptions.edit', 'policies.view', 'risks.view']) {
    await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, p]);
  }
  lead = await t.as('security_lead');
  editor = await t.as('exception_editor');
  policyId = (await lead.post('/api/policies', { title: 'Invented password policy' })).body.id;
});
afterAll(async () => { await t.close(); });

describe('exceptions register', () => {
  it('records a request with a reference and who asked', async () => {
    const res = await editor.post('/api/exceptions', {
      title: 'Invented kiosk without screen lock', policy_id: policyId, description: 'The kiosk stays unlocked.',
      justification: 'It is used by visitors.', compensating_controls: 'No access to internal systems.',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ref: 'EXC-00001', status: 'requested', requested_by: editor.userId, approved_on: null });
    expect(res.body._display.policy_id).toBe('Invented password policy');
    id = res.body.id;
    expect((await editor.post('/api/exceptions', { title: 'x', policy_id: '00000000-0000-4000-8000-000000000000' })).body.error.fields.policy_id).toBeTruthy();
    expect((await events(id)).map((e) => e.action)).toEqual(['policy_exception.create']);
  });

  it('applies permissions', async () => {
    const agent = await t.as('agent'); // no exception permissions
    expect((await agent.get('/api/exceptions')).status).toBe(403);
    expect((await agent.get('/api/exceptions/expiring')).status).toBe(403);
    expect((await agent.post('/api/exceptions', { title: 'Nope' })).status).toBe(403);
    expect((await t.anon.get('/api/exceptions')).status).toBe(401);
    expect((await editor.get('/api/exceptions')).body.total).toBe(1);
  });

  it('approving needs exceptions.approve and an expiry date', async () => {
    // No permission, whether on a new record or an existing one.
    expect((await editor.patch(`/api/exceptions/${id}`, { status: 'approved', expires_on: day(30) })).status).toBe(403);
    expect((await editor.post('/api/exceptions', { title: 'Self approved', status: 'approved', expires_on: day(30) })).status).toBe(403);
    expect((await editor.patch(`/api/exceptions/${id}`, { status: 'rejected' })).status).toBe(403);

    // No expiry date, or one already past.
    const none = await lead.patch(`/api/exceptions/${id}`, { status: 'approved' });
    expect(none.status).toBe(400);
    expect(none.body.error.fields.expires_on).toMatch(/expires/);
    expect((await lead.patch(`/api/exceptions/${id}`, { status: 'approved', expires_on: day(-2) })).body.error.fields.expires_on).toMatch(/passed/);
    expect((await lead.get(`/api/exceptions/${id}`)).body.status).toBe('requested');

    const ok = await lead.patch(`/api/exceptions/${id}`, { status: 'approved', expires_on: day(20), approver_role: 'Director' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', expires_on: day(20), approver_role: 'Director' });
    expect(ok.body.approver_name).toMatch(/^Test security_lead/); // defaults to the person approving
    expect(ok.body.approved_on).toBeTruthy();
    const last = (await events(id)).pop();
    expect(last).toMatchObject({ action: 'policy_exception.update', before: expect.objectContaining({ status: 'requested' }), after: expect.objectContaining({ status: 'approved' }) });
    expect(last.actor_name).toMatch(/^Test security_lead/);
  });

  it('protects an approved exception', async () => {
    expect((await editor.patch(`/api/exceptions/${id}`, { expires_on: day(400) })).status).toBe(403);
    expect((await editor.patch(`/api/exceptions/${id}`, { status: 'requested' })).status).toBe(403);
    expect((await editor.patch(`/api/exceptions/${id}`, { compensating_controls: 'Network isolation.' })).status).toBe(200);
    expect((await lead.patch(`/api/exceptions/${id}`, { expires_on: null })).status).toBe(400);
    expect((await lead.patch(`/api/exceptions/${id}`, { status: 'expired' })).body.error.fields.status).toMatch(/automatically/);
    expect((await lead.patch(`/api/exceptions/${id}`, { expires_on: day(10) })).body.expires_on).toBe(day(10));
  });

  it('links a risk, respecting who may see risks', async () => {
    const risk = await t.api.post('/api/risks', { title: 'Invented kiosk misuse' });
    expect((await editor.patch(`/api/exceptions/${id}`, { risk_id: risk.body.id })).body.error.fields.risk_id).toBe('Risk not found.');
    const ok = await lead.patch(`/api/exceptions/${id}`, { risk_id: risk.body.id });
    expect(ok.body._display.risk_id).toBe('Invented kiosk misuse');
    expect((await editor.get(`/api/exceptions/${id}`)).body._display.risk_id).toBe('Restricted');
  });

  it('flags expired exceptions automatically and lists what is expiring', async () => {
    const far = await lead.post('/api/exceptions', { title: 'Invented long exception', status: 'approved', expires_on: day(200) });
    expect(far.body).toMatchObject({ status: 'approved', requested_by: lead.userId });
    const old = await lead.post('/api/exceptions', { title: 'Invented lapsed exception', status: 'approved', expires_on: day(5) });
    const withdrawn = await editor.post('/api/exceptions', { title: 'Invented withdrawn exception', expires_on: day(3) });
    expect((await editor.patch(`/api/exceptions/${withdrawn.body.id}`, { status: 'withdrawn' })).body.status).toBe('withdrawn');
    await t.db.query(`update policy_exceptions set expires_on = $2 where id = $1`, [old.body.id, day(-4)]);

    expect(await runExceptionExpiry(t.ctx, new Date(Date.now() - 30 * 86_400_000))).toEqual([]); // not yet, a month ago
    const flagged = await runExceptionExpiry(t.ctx);
    expect(flagged.map((e) => e.id)).toEqual([old.body.id]);
    expect((await lead.get(`/api/exceptions/${old.body.id}`)).body.status).toBe('expired');
    const last = (await events(old.body.id)).pop();
    expect(last).toMatchObject({ action: 'policy_exception.update', actor_name: 'System', after: { status: 'expired' } });
    expect(await runExceptionExpiry(t.ctx)).toEqual([]);

    const soon = await editor.get('/api/exceptions/expiring?days=30');
    expect(soon.body.days).toBe(30);
    expect(soon.body.rows.map((r: any) => [r.title, r.expired, r.days_left])).toEqual([
      ['Invented lapsed exception', true, -4],
      ['Invented kiosk without screen lock', false, 10],
    ]);
    expect(soon.body.rows[1]).toMatchObject({ policy_title: 'Invented password policy', status_label: 'Approved' });
    expect((await editor.get('/api/exceptions/expiring?days=365')).body.rows).toHaveLength(3);
    expect((await editor.get('/api/exceptions/expiring')).body.days).toBe(30);
    // The generated list can be filtered the same way.
    expect((await editor.get('/api/exceptions?f.status=expired')).body.total).toBe(1);
    expect((await editor.get(`/api/exceptions?f.policy_id=${policyId}`)).body.total).toBe(1);
  });
});
