import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Acting on behalf of someone through MCP (E18-71): the "as" argument of the write tools is offered
// only while data load mode is on and the caller's saves are loads; it writes records and comments
// in the name of the real people, the audit log keeps the token and its administrator, and an
// unknown person is an error.

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let base = '';
const clients: Client[] = [];
let adminToken = '';
let agentToken = '';
let former = '';

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'sandpiper-behalf-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return client;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
const text = (r: any) => (r.content ?? []).map((x: any) => x.text).join('\n');
const props = async (c: Client, tool: string) => Object.keys(((await c.listTools()).tools.find((x) => x.name === tool)?.inputSchema as any)?.properties ?? {});
const confirm = () => t.db.query('update sessions set confirmed_at = now()');
const WRITE_TOOLS = ['create_record', 'update_record', 'add_comment', 'link_records'];

beforeAll(async () => {
  t = await testApp();
  agent = await t.as('agent');
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('kfield', 'k.field@example.test', 'Kim Field', 'disabled') returning id`))!.id;
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await confirm();
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
  adminToken = (await t.api.post('/api/mcp/tokens', { name: 'History loader', access: 'write', expiresInDays: 7 })).body.token;
  agentToken = (await agent.post('/api/mcp/tokens', { name: 'Agent assistant', access: 'write', expiresInDays: 7 })).body.token;
  expect(adminToken && agentToken).toBeTruthy();
}, 60_000);
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
});

describe('"as" while data load mode is off', () => {
  it('is not offered, and naming someone by hand through the API is refused', async () => {
    const c = await connect(adminToken);
    for (const tool of WRITE_TOOLS) expect(await props(c, tool), tool).not.toContain('as');
    expect(await props(c, 'add_comment')).not.toContain('created_at');
    // An argument the schema does not offer is dropped; the comment is the token owner's own.
    const made = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Printer jam at the depot' } });
    expect(made.isError, text(made)).toBeFalsy();
    const r = await call(c, 'add_comment', { type: 'ticket', id: made.structuredContent.id, body: 'Mine', as: 'kfield' });
    expect(r.isError, text(r)).toBeFalsy();
    const row = await t.db.one<any>(`select author_name from comments where record_id = $1`, [made.structuredContent.id]);
    expect(row.author_name).toBe('Test Admin');
  });
});

describe('"as" in data load mode', () => {
  beforeAll(async () => {
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
  });

  it('is offered on the write tools, described, only to a loader', async () => {
    const c = await connect(adminToken);
    for (const tool of WRITE_TOOLS) expect(await props(c, tool), tool).toContain('as');
    expect(await props(c, 'add_comment')).toContain('created_at');
    const tools = (await c.listTools()).tools;
    expect(tools.find((x) => x.name === 'create_record')!.description).toMatch(/give "as" for the person who created it/);
    const asSchema = JSON.stringify((tools.find((x) => x.name === 'create_record')!.inputSchema as any).properties.as);
    expect(asSchema).toMatch(/name:<their name>/);
    const other = await connect(agentToken);
    for (const tool of WRITE_TOOLS) expect(await props(other, tool), tool).not.toContain('as');
  });

  let ticketId = '';

  it('creates a record and comments in the name of the real people, audited with the token', async () => {
    const c = await connect(adminToken);
    const made = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Ticket machine fault (2022)', status: 'closed', created_at: '2022-02-01T09:00:00Z' }, as: 'k.field@example.test' });
    expect(made.isError, text(made)).toBeFalsy();
    expect(text(made)).toMatch(/on behalf of Kim Field/);
    expect(made.structuredContent.on_behalf_of).toBe('Kim Field');
    ticketId = made.structuredContent.id;
    const row = (await t.db.one<any>('select created_by, updated_by from tickets where id = $1', [ticketId]))!;
    expect(row).toEqual({ created_by: former, updated_by: former });
    const create = (await t.db.one<any>(`select actor_name, token_name, on_behalf_name, summary from audit_events where action = 'ticket.create' and record_id = $1`, [ticketId]))!;
    expect(create).toMatchObject({ actor_name: 'Test Admin', token_name: 'History loader', on_behalf_name: 'Kim Field' });
    const mcp = (await t.db.one<any>(`select summary from audit_events where action = 'mcp.write' and record_id = $1 order by id desc limit 1`, [ticketId]))!;
    expect(mcp.summary).toMatch(/on behalf of Kim Field via MCP \(tool create_record\) with API token "History loader"/);

    const comment = await call(c, 'add_comment', { type: 'ticket', id: ticketId, body: 'Replaced the coin unit.', internal: false, as: 'name:Sam Contractor', created_at: '2022-02-02T12:00:00Z' });
    expect(comment.isError, text(comment)).toBeFalsy();
    expect(comment.structuredContent).toMatchObject({ author: 'Sam Contractor' });
    const stored = (await t.db.one<any>('select author_id, author_name, created_at from comments where id = $1', [comment.structuredContent.comment_id]))!;
    expect([stored.author_id, stored.author_name, new Date(stored.created_at).toISOString()]).toEqual([null, 'Sam Contractor', '2022-02-02T12:00:00.000Z']);

    const update = await call(c, 'update_record', { type: 'ticket', id: ticketId, changes: { priority: 'p2' }, as: { user: 'kfield' } });
    expect(update.isError, text(update)).toBeFalsy();
    expect(text(update)).toMatch(/Updated ticket .* on behalf of Kim Field/);
  });

  it('refuses an unknown person on the "as" argument, never writing as the loader', async () => {
    const c = await connect(adminToken);
    const before = (await t.db.query('select 1 from comments where record_id = $1', [ticketId])).length;
    const r = await call(c, 'add_comment', { type: 'ticket', id: ticketId, body: 'Who?', as: 'not.a.person' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.fields.as).toMatch(/No account or roster person matches "not.a.person"/);
    expect((await t.db.query('select 1 from comments where record_id = $1', [ticketId])).length).toBe(before);
  });
});
