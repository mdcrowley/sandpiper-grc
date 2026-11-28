import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { usernameBase } from '../admin/users.ts';
import { testApp } from '../../test/helpers.ts';

// create_account (E18-95): accounts used only to name people in a data load (requester, author,
// assignee, "as"). Offered only while the caller's saves are loads; the account is disabled, with no
// password, link or email; calling again returns it as it is; it resolves in person fields and "as".
// Invented people only.

let t: Awaited<ReturnType<typeof testApp>>;
let base = '';
const clients: Client[] = [];
let adminToken = '';

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'sandpiper-account-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return client;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
const text = (r: any) => (r.content ?? []).map((x: any) => x.text).join('\n');
const tools = async (c: Client) => (await c.listTools()).tools.map((x) => x.name);
const confirm = () => t.db.query('update sessions set confirmed_at = now()');
const loadMode = async (on: boolean) => {
  await confirm();
  expect((await t.api.post('/api/admin/data-load', on ? { on: true, days: 1 } : { on: false })).status).toBe(200);
};

beforeAll(async () => {
  t = await testApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await confirm();
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
  adminToken = (await t.api.post('/api/mcp/tokens', { name: 'Contact list loader', access: 'write', expiresInDays: 7 })).body.token;
}, 60_000);
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
});

describe('usernameBase', () => {
  it('makes a plain username from a name or an email address', () => {
    expect(usernameBase('Invented Person')).toBe('invented.person');
    expect(usernameBase('Zoë O\'Mara-Ruiz')).toBe('zoe.o.mara-ruiz');
    expect(usernameBase('a.b')).toBe('a.b');
    expect(usernameBase('Al')).toBe('al.account');
    expect(usernameBase('***')).toBe('user.account');
  });
});

describe('create_account', () => {
  it('is not offered, and the route refuses, outside data load mode', async () => {
    expect(await tools(await connect(adminToken))).not.toContain('create_account');
    const r = await t.api.post('/api/data-load/accounts', { displayName: 'Invented Early' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('data_load_off');
  });

  it('creates a disabled account with no password, link or email, once', async () => {
    await loadMode(true);
    const agent = await t.as('agent');
    expect((await agent.post('/api/data-load/accounts', { displayName: 'Invented Agent' })).status).toBe(403);
    const c = await connect(adminToken);
    expect(await tools(c)).toContain('create_account');
    const mailBefore = (await t.db.query('select 1 from mail_log')).length;

    const r = await call(c, 'create_account', { name: 'Invented Person', email: 'invented.person@example.test' });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toMatch(/Created account Invented Person \(invented\.person\) for attribution only/);
    const u = (await t.db.one<Row>(`select * from users where lower(email) = 'invented.person@example.test'`))!;
    expect(u).toMatchObject({ username: 'invented.person', display_name: 'Invented Person', status: 'disabled', password_hash: null });
    expect((await t.db.query('select 1 from one_time_tokens where user_id = $1', [u.id])).length).toBe(0);
    expect((await t.db.query('select 1 from user_roles where user_id = $1', [u.id])).length).toBe(0);
    expect((await t.db.query('select 1 from mail_log')).length).toBe(mailBefore);
    const ev = (await t.db.one<Row>(`select summary, after from audit_events where action = 'user.create' and record_id = $1`, [u.id]))!;
    expect(ev.summary).toMatch(/for attribution only .*\(data load\)$/);
    expect(ev.after).toMatchObject({ status: 'disabled', attribution_only: true });
    expect((await t.db.one<Row>(`select summary from audit_events where action = 'mcp.write' and record_id = $1`, [u.id]))!.summary)
      .toMatch(/via MCP \(tool create_account\)/);

    // Again, by email or by username: returned as it is, never a second account.
    const again = await call(c, 'create_account', { name: 'Someone Else', email: 'INVENTED.PERSON@example.test', roles: ['agent'] });
    expect(text(again)).toMatch(/already exists: left as it is/);
    const byName = await call(c, 'create_account', { name: 'Invented Person', username: 'invented.person' });
    expect(text(byName)).toMatch(/already exists/);
    expect((await t.db.query(`select 1 from users where lower(username) like 'invented.person%'`)).length).toBe(1);
    expect((await t.db.one<Row>('select display_name from users where id = $1', [u.id]))!.display_name).toBe('Invented Person');
    expect((await t.db.query('select 1 from user_roles where user_id = $1', [u.id])).length).toBe(0);

    // Same name, different email: a second, unique username.
    const twin = await call(c, 'create_account', { name: 'Invented Person', email: 'invented.person@vendor.example.test' });
    expect(twin.isError, text(twin)).toBeFalsy();
    expect(text(twin)).toMatch(/\(invented\.person2\)/);

    // No email: a placeholder that can never receive mail; the same name again is the same account.
    const noMail = await call(c, 'create_account', { name: 'Invented Contact', roles: ['agent'] });
    expect(noMail.isError, text(noMail)).toBeFalsy();
    const nc = (await t.db.one<Row>(`select id, email, status from users where username = 'invented.contact'`))!;
    expect(nc).toMatchObject({ email: 'invented.contact@no-email.invalid', status: 'disabled' });
    expect((await t.db.query('select 1 from user_roles where user_id = $1', [nc.id])).length).toBe(1);
    expect(text(await call(c, 'create_account', { name: 'Invented Contact' }))).toMatch(/already exists/);

    // Bad input is a field error.
    const bad = await call(c, 'create_account', { name: 'Invented Bad', email: 'not-an-address', roles: ['no_such_role'] });
    expect(bad.isError).toBe(true);
  });

  it('links a roster person: the one named, or the one with the same email', async () => {
    const c = await connect(adminToken);
    const p1 = (await t.api.post('/api/people', { full_name: 'Invented Roster', email: 'invented.roster@example.test' })).body;
    const p2 = (await t.api.post('/api/people', { full_name: 'Invented Named', employee_number: 'E-90021' })).body;
    const r1 = await call(c, 'create_account', { name: 'Invented Roster', email: 'invented.roster@example.test' });
    expect(text(r1)).toMatch(new RegExp(`Linked to roster person ${p1.ref}`));
    const r2 = await call(c, 'create_account', { name: 'Invented Named', email: 'invented.named@example.test', person: 'E-90021' });
    expect(r2.isError, text(r2)).toBeFalsy();
    const u2 = (await t.db.one<Row>(`select id from users where username = 'invented.named'`))!.id;
    expect((await t.db.one<Row>('select user_id from people where id = $1', [p2.id]))!.user_id).toBe(u2);
  });

  it('names the account as a ticket requester and as the author of a comment ("as")', async () => {
    const c = await connect(adminToken);
    const made = await call(c, 'create_record', {
      type: 'ticket', fields: { title: 'Invented fare machine fault', requester_id: 'invented.person@example.test', opened_at: '2023-05-02T09:00:00Z' },
    });
    expect(made.isError, text(made)).toBeFalsy();
    const uid = (await t.db.one<Row>(`select id from users where username = 'invented.person'`))!.id;
    const ticket = (await t.db.one<Row>(`select id, ref, requester_id from tickets where title = 'Invented fare machine fault'`))!;
    expect(ticket.requester_id).toBe(uid);
    const comment = await call(c, 'add_comment', { type: 'ticket', id: ticket.ref, body: 'Reported at the platform.', as: 'invented.person', created_at: '2023-05-02T09:05:00Z' });
    expect(comment.isError, text(comment)).toBeFalsy();
    const row = (await t.db.one<Row>('select author_id, author_name from comments where record_id = $1', [ticket.id]))!;
    expect(row).toMatchObject({ author_id: uid, author_name: 'Invented Person' });
  });

  it('outside a load, the account gets no notification and no email, and cannot be named', async () => {
    await loadMode(false);
    const uid = (await t.db.one<Row>(`select id from users where username = 'invented.person'`))!.id;
    expect(await t.app.notify({ userIds: [uid], kind: 'general', title: 'Invented reminder' })).toMatchObject({ sent: 0 });
    expect((await t.db.query('select 1 from notifications where user_id = $1', [uid])).length).toBe(0);
    expect(await t.app.sendMail({ to: ['invented.person@example.test'], subject: 'Hello', text: 'Hi' })).toMatchObject({ queued: 0 });
    expect(await t.app.sendMail({ userIds: [uid], subject: 'Hello', text: 'Hi' })).toMatchObject({ queued: 0 });
    // Not offered any more, and a person field no longer matches the disabled account.
    const c = await connect(adminToken);
    expect(await tools(c)).not.toContain('create_account');
    const r = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Invented later fault', requester_id: 'invented.person' } });
    expect(r.isError).toBe(true);
  });
});
