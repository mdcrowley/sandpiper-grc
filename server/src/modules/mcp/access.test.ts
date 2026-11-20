import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { chosenTools, DEFAULTS } from './settings.ts';
import { wantsProgress } from './http.ts';

// Who may connect (E21-17), tool choice per token and per role (E21-19), progress notifications
// (E21-20), request ids through tool calls (E13-14) and source addresses on assistant tokens (E02-18).

let t: Awaited<ReturnType<typeof testApp>>;
let base = '';
const clients: Client[] = [];
const settings = (body: unknown) => t.api.put('/api/mcp/admin/settings', body);
async function connect(token: string, headers: Record<string, string> = {}) {
  const c = new Client({ name: 'access-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}`, ...headers } } }));
  clients.push(c);
  return c;
}
const names = async (c: Client) => (await c.listTools()).tools.map((x) => x.name).sort();
const post = (token: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/mcp`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body),
});
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } };

beforeAll(async () => {
  t = await testApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await settings({ enabled: true });
});
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
});

describe('choosing tools', () => {
  it('narrows by the allowed list, then by role, then by token', () => {
    const s = { ...DEFAULTS, allowedTools: ['search', 'get_record', 'my_work'], roleTools: { agent: ['search', 'list_records'], auditor: ['get_record'] } };
    expect(chosenTools({ ...DEFAULTS }, ['agent'], null)).toBeNull();
    expect(chosenTools(s, ['agent'], null)).toEqual(['search']);
    expect(chosenTools(s, ['agent', 'auditor'], null)).toEqual(['get_record', 'search']);
    // A role without a list does not narrow.
    expect(chosenTools(s, ['agent', 'project_manager'], null)).toEqual(['get_record', 'my_work', 'search']);
    expect(chosenTools(s, ['agent'], ['get_record'])).toEqual([]);
    expect(chosenTools({ ...DEFAULTS }, [], ['my_work'])).toEqual(['my_work']);
  });

  it('offers only the tools chosen for the token and for the role', async () => {
    const agent = await t.as('agent');
    const made = await agent.post('/api/mcp/tokens', { name: 'Two tools', access: 'read', expiresInDays: 7, tools: ['search', 'get_record'] });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.tools).toEqual(['get_record', 'search']);
    expect(await names(await connect(made.body.token))).toEqual(['get_record', 'search']);
    // Changed afterwards by its owner, not by anyone else.
    expect((await agent.put(`/api/mcp/tokens/${made.body.id}/tools`, { tools: ['search'] })).body.tools).toEqual(['search']);
    expect(await names(await connect(made.body.token))).toEqual(['search']);
    const other = await t.as('agent');
    expect((await other.put(`/api/mcp/tokens/${made.body.id}/tools`, { tools: null })).status).toBe(404);
    expect((await agent.put(`/api/mcp/tokens/${made.body.id}/tools`, { tools: ['delete_everything'] })).body.error.fields.tools).toMatch(/Unknown/);
    expect((await agent.post('/api/mcp/tokens', { name: 'Bad', access: 'read', expiresInDays: 7, tools: [] })).body.error.fields.tools).toBeTruthy();
    // Per role.
    await settings({ roleTools: { agent: ['search', 'my_work'] } });
    expect(await names(await connect(made.body.token))).toEqual(['search']);
    await agent.put(`/api/mcp/tokens/${made.body.id}/tools`, { tools: null });
    expect(await names(await connect(made.body.token))).toEqual(['my_work', 'search']);
    expect((await settings({ roleTools: { nobody: ['search'] } })).body.error.fields.roleTools).toMatch(/Unknown role/);
    await settings({ roleTools: {} });
    expect((await names(await connect(made.body.token))).length).toBeGreaterThan(2);
  });
});

describe('who may connect', () => {
  it('limits assistant tokens to chosen roles, for new tokens and at once for existing ones', async () => {
    const agent = await t.as('agent');
    const lead = await t.as('security_lead');
    const tok = (await agent.post('/api/mcp/tokens', { name: 'Agent assistant', access: 'read', expiresInDays: 7 })).body.token;
    expect((await post(tok, INIT)).status).toBe(200);
    await settings({ allowedRoles: ['security_lead'] });
    const refused = await post(tok, INIT);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error.message).toMatch(/role may not connect/);
    expect((await agent.post('/api/mcp/tokens', { name: 'Again', access: 'read', expiresInDays: 7 })).body.error.code).toBe('mcp_not_allowed');
    expect((await agent.get('/api/mcp/status')).body.allowed).toBe(false);
    // The API tokens card no longer offers mcp.use to them either.
    expect((await agent.get('/api/me/tokens')).body.scopeFamilies).toEqual([]);
    expect((await agent.post('/api/me/tokens', { name: 'Sneaky', scopes: ['tickets.view', 'mcp.use'], expiresInDays: 1 })).body.error.fields.scopes).toMatch(/mcp\.use/);
    // An allowed role still connects.
    const leadTok = (await lead.post('/api/mcp/tokens', { name: 'Lead assistant', access: 'read', expiresInDays: 7 })).body.token;
    expect((await post(leadTok, INIT)).status).toBe(200);
    expect((await settings({ allowedRoles: ['no_such_role'] })).body.error.fields.allowedRoles).toMatch(/Unknown/);
    await settings({ allowedRoles: null });
    expect((await post(tok, INIT)).status).toBe(200);
  });
});

describe('progress notifications', () => {
  it('detects a call that asks for progress', () => {
    expect(wantsProgress({ method: 'tools/call', params: { name: 'my_work', _meta: { progressToken: 'p1' } } })).toBe(true);
    expect(wantsProgress([{ method: 'tools/call', params: { _meta: { progressToken: 3 } } }])).toBe(true);
    expect(wantsProgress({ method: 'tools/call', params: { name: 'my_work' } })).toBe(false);
    expect(wantsProgress({ method: 'tools/list', params: { _meta: { progressToken: 'p' } } })).toBe(false);
  });

  it('sends progress for long tools when the client asks, as an event stream, and plain JSON otherwise', async () => {
    const tok = (await t.api.post('/api/mcp/tokens', { name: 'Progress', access: 'read', expiresInDays: 7 })).body.token;
    const c = await connect(tok);
    const seen: { progress: number; total?: number; message?: string }[] = [];
    const res = await c.callTool({ name: 'my_work', arguments: {} }, undefined, { onprogress: (p) => { seen.push(p); } });
    expect(res.isError).toBeFalsy();
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.map((p) => p.progress)).toEqual([...seen.map((p) => p.progress)].sort((a, b) => a - b));
    expect(seen[seen.length - 1]).toMatchObject({ progress: 5, total: 5 });
    const raw = await post(tok, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'overdue_summary', arguments: {}, _meta: { progressToken: 'p-7' } } }, { 'mcp-protocol-version': '2025-06-18' });
    expect(raw.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = await raw.text();
    expect(body).toMatch(/notifications\/progress/);
    expect(body).toMatch(/"id":7/);
    const plain = await post(tok, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'overdue_summary', arguments: {} } }, { 'mcp-protocol-version': '2025-06-18' });
    expect(plain.headers.get('content-type')).toMatch(/application\/json/);
  });
});

describe('request ids and source addresses', () => {
  it('answers /mcp with X-Request-Id and records it on the call log and on what the tools cause', async () => {
    await settings({ writeEnabled: true });
    const tok = (await t.api.post('/api/mcp/tokens', { name: 'Traced', access: 'write', expiresInDays: 7 })).body.token;
    const c = await connect(tok, { 'x-request-id': 'assistant-run-17' });
    const type = t.ctx.resources.get('ticket') ? 'ticket' : null;
    const res = await post(tok, INIT, { 'x-request-id': 'probe-1' });
    expect(res.headers.get('x-request-id')).toBe('probe-1');
    await c.callTool({ name: 'search', arguments: { query: 'anything' } });
    const log = await t.db.one<any>(`select request_id from mcp_calls where tool = 'search' order by id desc limit 1`);
    expect(log.request_id).toBe('assistant-run-17');
    if (type) {
      const made = await c.callTool({ name: 'create_record', arguments: { type, fields: { title: 'Ticket machine at the east depot rejects cards' } } });
      expect(made.isError, JSON.stringify(made.content)).toBeFalsy();
      const events = await t.db.query<any>(`select action from audit_events where request_id = 'assistant-run-17'`);
      expect(events.map((e: any) => e.action)).toEqual(expect.arrayContaining(['mcp.write', 'ticket.create']));
    }
    await settings({ writeEnabled: false });
  });

  it('limits an assistant token to source addresses', async () => {
    const bad = await t.api.post('/api/mcp/tokens', { name: 'Bad sources', access: 'read', expiresInDays: 7, allowedSources: ['not-an-address'] });
    expect(bad.body.error.fields.allowedSources).toMatch(/not an address/);
    const elsewhere = (await t.api.post('/api/mcp/tokens', { name: 'Office only', access: 'read', expiresInDays: 7, allowedSources: ['203.0.113.0/24'] })).body;
    expect(elsewhere.allowed_sources).toEqual(['203.0.113.0/24']);
    const refused = await post(elsewhere.token, INIT);
    expect(refused.status).toBe(403);
    const here = (await t.api.post('/api/mcp/tokens', { name: 'This computer', access: 'read', expiresInDays: 7, allowedSources: ['127.0.0.1', '::1'] })).body;
    expect((await post(here.token, INIT)).status).toBe(200);
  });
});

describe('what a system failure affects', () => {
  it('follows the systems downstream of one system, by reference or name, where inventory is loaded', async () => {
    const tok = (await t.api.post('/api/mcp/tokens', { name: 'Impact', access: 'read', expiresInDays: 7 })).body.token;
    const c = await connect(tok);
    if (!t.ctx.resources.get('system')) {
      expect(await names(c)).not.toContain('system_impact');
      return;
    }
    const a = (await t.api.post('/api/systems', { name: 'Radio dispatch core' })).body;
    const b = (await t.api.post('/api/systems', { name: 'Passenger information displays' })).body;
    await t.db.query('insert into system_integrations (from_system_id, to_system_id) values ($1, $2)', [a.id, b.id]);
    const res = await c.callTool({ name: 'system_impact', arguments: { system: a.ref } }, undefined, { onprogress: () => undefined });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    expect((res.structuredContent as any).downstream).toEqual([expect.objectContaining({ label: 'Passenger information displays', depth: 1 })]);
    expect((res.content as any)[0].text).toMatch(/1 downstream system/);
    const byName = await c.callTool({ name: 'system_impact', arguments: { system: 'radio dispatch core' } });
    expect((byName.structuredContent as any).system.id).toBe(a.id);
    expect((await c.callTool({ name: 'system_impact', arguments: { system: 'Nothing like this' } })).isError).toBe(true);
    // Without permission to see systems the tool is not offered.
    const pm = await t.as('requester');
    const none = await pm.post('/api/mcp/tokens', { name: 'Requester', access: 'read', expiresInDays: 7 });
    if (none.status === 201) expect(await names(await connect(none.body.token))).not.toContain('system_impact');
  });
});

describe('search_audit_log', () => {
  it('finds everything one request did, for people who may read the audit log', async () => {
    const tok = (await t.api.post('/api/mcp/tokens', { name: 'Auditor', access: 'read', expiresInDays: 7 })).body.token;
    const c = await connect(tok);
    expect(await names(c)).toContain('search_audit_log');
    // The audit log is append-only: take the request id of an event already there.
    const last = await t.db.one<any>(`select request_id from audit_events where request_id is not null order by id desc limit 1`);
    const rid = String(last.request_id);
    const count = (await t.db.one<any>('select count(*)::int as n from audit_events where request_id = $1', [rid])).n;
    const res = await c.callTool({ name: 'search_audit_log', arguments: { request_id: rid } });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const data = res.structuredContent as any;
    expect(data.total).toBe(count);
    expect(data.events.every((e: any) => e.request_id === rid)).toBe(true);
    expect(data.events[0]).not.toHaveProperty('before');
    expect(data.url).toContain(`/admin/audit?request_id=${encodeURIComponent(rid)}`);
    expect((await c.callTool({ name: 'search_audit_log', arguments: {} })).isError).toBe(true);
    // Someone who cannot read the audit log is not offered the tool.
    const requester = await t.as('requester');
    const theirs = await requester.post('/api/mcp/tokens', { name: 'No audit', access: 'read', expiresInDays: 7 });
    if (theirs.status === 201) expect(await names(await connect(theirs.body.token))).not.toContain('search_audit_log');
  });
});
