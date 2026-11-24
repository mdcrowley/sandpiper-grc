import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMail } from './mail/index.ts';
import { startSmtpSink, type SmtpSink } from './mail/smtp-sink.ts';
import type { ModuleDef } from './module.ts';
import { testApp } from '../test/helpers.ts';

// Behavior tests for core routes no other test named (E40-05): DELETE /api/links/:id and
// POST /api/admin/users/:id/alert-contact/test. Invented names, numbers and addresses only.

const mailOn: ModuleDef = { key: 'rb_core_mail', async seedDefaults(ctx) { await ensureMail(ctx); } };
let t: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;
const MISSING = '00000000-0000-4000-8000-000000000501';

beforeAll(async () => {
  t = await testApp({ extraModules: [mailOn] });
  sink = await startSmtpSink();
}, 60_000);
afterAll(async () => { await t?.close(); await sink?.close(); });

const system = async (name: string) => (await t.api.post('/api/systems', { name })).body.id as string;
const linkOf = async (from: string, to: string, toType = 'system') => {
  const res = await t.api.post('/api/links', { from_type: 'system', from_id: from, to_type: toType, to_id: to, relation: 'depends_on' });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

describe('DELETE /api/links/:id', () => {
  it('removes the link from both records, and audits it on the record it starts from', async () => {
    const a = await system('Invented radio gateway');
    const b = await system('Invented dispatch console');
    const id = await linkOf(a, b);
    expect((await t.api.get(`/api/links?record_type=system&record_id=${b}`)).body).toHaveLength(1);

    const agent = await t.as('agent'); // systems.*
    const res = await agent.del(`/api/links/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await t.api.get(`/api/links?record_type=system&record_id=${a}`)).body).toEqual([]);
    expect((await t.api.get(`/api/links?record_type=system&record_id=${b}`)).body).toEqual([]);
    const history = (await t.api.get(`/api/history?record_type=system&record_id=${a}`)).body;
    expect(history.find((h: any) => h.action === 'link.remove')).toMatchObject({ summary: 'Link to system removed', before: { to_type: 'system', to_id: b, relation: 'depends_on' } });

    expect((await agent.del(`/api/links/${id}`)).status).toBe(404);
    expect((await agent.del('/api/links/not-a-uuid')).status).toBe(404);
    expect((await agent.del(`/api/links/${MISSING}`)).status).toBe(404);
  });

  it('needs edit permission on the record the link starts from', async () => {
    const a = await system('Invented fare server');
    const b = await system('Invented fare backup');
    const id = await linkOf(a, b);
    expect((await (await t.as('project_manager')).del(`/api/links/${id}`)).status).toBe(404); // systems.view only
    expect((await (await t.as('training_coordinator')).del(`/api/links/${id}`)).status).toBe(404); // no systems permission
    expect((await t.anon.del(`/api/links/${id}`)).status).toBe(401);
    expect(await t.db.query('select 1 from record_links where id = $1', [id])).toHaveLength(1);
    expect(await t.db.query(`select 1 from audit_events where action = 'link.remove' and record_id = $1`, [a])).toHaveLength(0);
  });

  // BUG: DELETE /api/links/:id checks only the record the link starts from (server/src/core/routes.ts:247),
  // so someone who may edit that record removes a link to a restricted record they cannot see (and learns
  // the link exists). POST /api/links checks both ends. Fix: also call
  // `await visibleRecord(req, link!.to_type, link!.to_id)` before deleting, answering 404 the same way.
  it('does not let someone remove a link to a record they may not see', async () => {
    const sys = await system('Invented payroll host');
    const risk = (await t.api.post('/api/risks', { title: 'Invented restricted risk on the payroll host' })).body;
    expect(risk.id).toBeTruthy();
    const id = await linkOf(sys, risk.id, 'risk');
    const agent = await t.as('agent'); // systems.*, no risks or security.view
    expect((await agent.get(`/api/links?record_type=system&record_id=${sys}`)).body).toEqual([]);
    expect((await agent.del(`/api/links/${id}`)).status).toBe(404);
  });
});

describe('POST /api/admin/users/:id/alert-contact/test', () => {
  it('refuses until a contact is saved and texts are set up, then sends a test to that person and audits it', async () => {
    const person = await t.as('agent');
    const url = `/api/admin/users/${person.userId}/alert-contact/test`;
    const none = await t.api.post(url);
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('no_contact');

    expect((await t.api.put(`/api/admin/users/${person.userId}/alert-contact`, { smsAddress: '5550100444@text.example.net' })).status).toBe(200);
    expect((await t.api.post(url)).body.error.code).toBe('not_configured');

    expect((await t.api.put('/api/admin/text/settings', { gateway: true })).status).toBe(200);
    expect((await t.api.put('/api/admin/mail/settings', { host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test', enabled: true })).status).toBe(200);
    const before = sink.messages.length;
    const res = await t.api.post(url);
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: any) => [r.provider, r.status])).toEqual([['smtp', 'sent']]);
    expect(sink.messages.length).toBe(before + 1);
    const ev = await t.db.query<any>(`select summary from audit_events where action = 'text.test' and record_id = $1`, [person.userId]);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toMatch(/^Test text message to Test agent \d+: email-to-text sent$/);
    expect(JSON.stringify(ev)).not.toContain('5550100444');
  });

  it('needs admin.administer and a person that exists', async () => {
    const person = await t.as('agent');
    for (const role of ['agent', 'security_lead']) {
      expect((await (await t.as(role)).post(`/api/admin/users/${person.userId}/alert-contact/test`)).status).toBe(403);
    }
    expect((await t.api.post(`/api/admin/users/${MISSING}/alert-contact/test`)).status).toBe(404);
    expect((await t.api.post('/api/admin/users/nope/alert-contact/test')).status).toBe(404);
  });
});
