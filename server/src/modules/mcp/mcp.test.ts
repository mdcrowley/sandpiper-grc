import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// AI assistant access (MCP): the real endpoint over HTTP on port 0, driven by the SDK's own client.
// Stand-in record types keep the test independent of other modules: an ordinary one (permission
// module "tickets") and a restricted one (permission module "risks", needs security.view).

const stand: ModuleDef = {
  key: 'mcpstand',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists mcp_test_widgets (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, notes text, status text, owner_id uuid,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists mcp_test_secrets (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('mcp_widget_status', [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }], { module: 'tickets' });
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'mcpwidget', table: 'mcp_test_widgets', module: 'tickets', label: 'Widget', plural: 'Widgets',
      path: '/api/mcp-widgets', route: '/mcp-widgets', titleField: 'title', ref: { field: 'ref', prefix: 'WID-' }, searchable: ['title', 'notes'],
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        status: { label: 'Status', type: 'lookup', list: 'mcp_widget_status', default: 'open' },
        owner_id: { label: 'Owner', type: 'user' },
      },
    });
    ctx.defineResource({
      type: 'mcpsecret', table: 'mcp_test_secrets', module: 'risks', label: 'Secret', plural: 'Secrets',
      path: '/api/mcp-secrets', route: '/mcp-secrets', titleField: 'title', restricted: true, searchable: ['title'],
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
  },
};

const BRIDGE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../tools/mcp-stdio.mjs');

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let base = '';
const clients: Client[] = [];

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'sandpiper-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return client;
}
const names = async (c: Client) => (await c.listTools()).tools.map((x) => x.name);
const text = (r: any) => (r.content ?? []).map((c: any) => c.text).join('\n');
const settings = (body: unknown) => t.api.put('/api/mcp/admin/settings', body);
async function makeToken(api: { post: typeof t.api.post }, name: string, access: 'read' | 'write' = 'read') {
  const res = await api.post('/api/mcp/tokens', { name, access, expiresInDays: 7 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.token as string;
}
async function post(body: unknown, headers: Record<string, string>) {
  return fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } };

let secretId = '';
let widgetRef = '';
let adminRead = '';
let agentRead = '';

beforeAll(async () => {
  t = await testApp({ extraModules: [stand] });
  agent = await t.as('agent'); // tickets.*, no risks or security permissions
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  widgetRef = (await t.api.post('/api/mcp-widgets', { title: 'Depot radio console fault', notes: 'Intermittent audio at the north depot' })).body.ref;
  secretId = (await t.api.post('/api/mcp-secrets', { title: 'Zebrafish ransomware playbook' })).body.id;
});
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
});

describe('switched off by default', () => {
  it('refuses to make assistant tokens and to answer until an administrator switches it on', async () => {
    const refused = await t.api.post('/api/mcp/tokens', { name: 'Too early', access: 'read', expiresInDays: 7 });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'mcp_disabled']);
    expect((await t.api.get('/api/mcp/status')).body).toMatchObject({ enabled: false, writeEnabled: false, endpoint: '/mcp' });
    expect((await settings({ enabled: true })).body).toMatchObject({ enabled: true, writeEnabled: false });
    adminRead = await makeToken(t.api, 'Admin desktop assistant');
    agentRead = await makeToken(agent, 'Agent laptop assistant');
    await settings({ enabled: false });
    const res = await post(INIT, { authorization: `Bearer ${adminRead}` });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.message).toMatch(/switched off/);
    await settings({ enabled: true });
  });
});

describe('the endpoint', () => {
  it('initializes and lists read-only tools, resources and prompts', async () => {
    const c = await connect(adminRead);
    expect(c.getServerVersion()?.name).toBe('sandpiper-grc');
    const tools = (await c.listTools()).tools;
    const list = tools.map((x) => x.name);
    for (const n of ['list_record_types', 'search', 'list_records', 'get_record', 'get_related', 'get_history', 'my_work', 'overdue_summary']) expect(list).toContain(n);
    for (const n of ['create_record', 'update_record', 'add_comment', 'link_records']) expect(list).not.toContain(n);
    expect(list.some((n) => /delete/.test(n))).toBe(false);
    const search = tools.find((x) => x.name === 'search')!;
    expect(search.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(search.inputSchema.properties).toHaveProperty('query');
    const resources = (await c.listResources()).resources;
    expect(resources.some((r) => r.uri.startsWith('sandpiper://guide/'))).toBe(true);
    expect((await c.listResourceTemplates()).resourceTemplates.map((r) => r.uriTemplate)).toContain('sandpiper://record/{type}/{id}');
    const prompts = (await c.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(['weekly_risk_and_action_review', 'board_summary', 'triage_open_tickets', 'incident_status_update']));
    const p = await c.getPrompt({ name: 'triage_open_tickets', arguments: {} });
    expect(text({ content: [p.messages[0].content] })).toMatch(/list_records/);
  });

  it('answers read-only calls with a summary and structured content', async () => {
    const c = await connect(adminRead);
    const types = await c.callTool({ name: 'list_record_types', arguments: { type: 'Widgets' } });
    expect(types.isError).toBeFalsy();
    expect((types.structuredContent as any).fields.find((f: any) => f.name === 'status').choices.map((x: any) => x.value)).toEqual(['open', 'done']);
    const listed = await c.callTool({ name: 'list_records', arguments: { type: 'mcpwidget', filters: { status: 'open' } } });
    expect(text(listed)).toMatch(/Depot radio console fault/);
    expect((listed.structuredContent as any).rows[0]).toMatchObject({ ref: widgetRef, status: 'Open' });
    const got = await c.callTool({ name: 'get_record', arguments: { type: 'widget', id: widgetRef.toLowerCase() } });
    expect((got.structuredContent as any)).toMatchObject({ ref: widgetRef, title: 'Depot radio console fault' });
    expect((got.structuredContent as any).url).toMatch(/\/mcp-widgets\//);
    const found = await c.callTool({ name: 'search', arguments: { query: 'radio console' } });
    expect((found.structuredContent as any).results.map((r: any) => r.ref)).toContain(widgetRef);
    // The administrator holds security.view: the restricted record is there for them.
    expect((await c.callTool({ name: 'search', arguments: { query: 'Zebrafish' } })).structuredContent).toMatchObject({ results: [expect.objectContaining({ type: 'mcpsecret' })] });
    const bad = await c.callTool({ name: 'list_records', arguments: { type: 'mcpwidget', filters: { color: 'red' } } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/color/);
    const res = await c.readResource({ uri: `sandpiper://record/mcpwidget/${widgetRef}` });
    expect(JSON.parse((res.contents[0] as any).text)).toMatchObject({ ref: widgetRef });
  });

  it('runs every work and insight tool offered (with whatever modules are loaded)', async () => {
    const c = await connect(adminRead);
    const offered = await names(c);
    for (const name of ['my_work', 'overdue_summary', 'risk_heatmap', 'framework_progress', 'incident_clocks', 'contracts_nearing_notice',
      'vulnerability_summary', 'service_desk_metrics', 'fleet_equipment_gaps', 'safety_summary', 'run_report']) {
      if (!offered.includes(name)) {
        // Offered exactly when the module behind it is loaded.
        const needs: Record<string, string> = { risk_heatmap: 'risk', framework_progress: 'framework', incident_clocks: 'security_incident', contracts_nearing_notice: 'contract', vulnerability_summary: 'vulnerability', service_desk_metrics: 'ticket', fleet_equipment_gaps: 'vehicle', safety_summary: 'safety_event', run_report: 'report_definition' };
        expect(t.ctx.resources.get(needs[name]), name).toBeUndefined();
        continue;
      }
      const r = await c.callTool({ name, arguments: {} });
      expect([name, r.isError ? text(r) : 'ok']).toEqual([name, 'ok']);
      expect(typeof r.structuredContent).toBe('object');
    }
  });

  it('never shows an agent restricted records, through any tool, resource or search', async () => {
    const c = await connect(agentRead);
    const list = await names(c);
    for (const n of ['risk_heatmap', 'incident_clocks', 'vulnerability_summary']) expect(list).not.toContain(n);
    const types = await c.callTool({ name: 'list_record_types', arguments: {} });
    const keys = (types.structuredContent as any).types.map((x: any) => x.type);
    expect(keys).toContain('mcpwidget');
    for (const k of ['mcpsecret', 'risk', 'security_incident', 'vulnerability']) expect(keys).not.toContain(k);
    expect((await c.callTool({ name: 'list_records', arguments: { type: 'mcpsecret' } })).isError).toBe(true);
    expect((await c.callTool({ name: 'get_record', arguments: { type: 'mcpsecret', id: secretId } })).isError).toBe(true);
    expect((await c.callTool({ name: 'search', arguments: { query: 'Zebrafish' } })).structuredContent).toMatchObject({ results: [] });
    expect(text(await c.callTool({ name: 'get_history', arguments: { type: 'mcpsecret', id: secretId } }))).not.toMatch(/Zebrafish/);
    await expect(c.readResource({ uri: `sandpiper://record/mcpsecret/${secretId}` })).rejects.toThrow();
    // With every module loaded, the real restricted types behave the same.
    if (t.ctx.resources.get('risk')) {
      expect((await c.callTool({ name: 'list_records', arguments: { type: 'risk' } })).isError).toBe(true);
      expect((await c.callTool({ name: 'risk_heatmap', arguments: {} })).isError).toBe(true);
    }
    if (t.ctx.resources.get('security_incident')) {
      expect((await c.callTool({ name: 'incident_clocks', arguments: {} })).isError).toBe(true);
    }
    const work = await c.callTool({ name: 'my_work', arguments: {} });
    expect(work.isError).toBeFalsy();
    expect(text(await c.callTool({ name: 'overdue_summary', arguments: {} }))).not.toMatch(/Zebrafish/);
  });
});

describe('write access', () => {
  it('is refused while switched off, even for a token with write permissions', async () => {
    const adminWrite = await makeToken(t.api, 'Admin writer');
    const c = await connect(adminWrite);
    expect(await names(c)).not.toContain('create_record');
    const res = await c.callTool({ name: 'create_record', arguments: { type: 'mcpwidget', fields: { title: 'Nope' } } });
    expect(res.isError).toBe(true);
    expect((await t.api.get('/api/mcp-widgets?q=Nope')).body.total).toBe(0);
  });

  it('works when switched on and the token can write, with validation errors per field and an audit naming the token', async () => {
    await settings({ writeEnabled: true });
    const readOnly = await connect(agentRead);
    expect(await names(readOnly)).not.toContain('create_record');
    const agentWrite = await makeToken(agent, 'Agent writer', 'write');
    const c = await connect(agentWrite);
    const tools = (await c.listTools()).tools;
    const create = tools.find((x) => x.name === 'create_record')!;
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(tools.find((x) => x.name === 'update_record')!.annotations).toMatchObject({ idempotentHint: true });

    const invalid = await c.callTool({ name: 'create_record', arguments: { type: 'mcpwidget', fields: { notes: 'no title', ref: 'X' } } });
    expect(invalid.isError).toBe(true);
    expect((invalid.structuredContent as any).error.fields).toHaveProperty('ref');
    const missing = await c.callTool({ name: 'create_record', arguments: { type: 'mcpwidget', fields: { notes: 'no title' } } });
    expect(missing.isError).toBe(true);
    expect((missing.structuredContent as any).error.fields).toHaveProperty('title');

    const made = await c.callTool({ name: 'create_record', arguments: { type: 'mcpwidget', fields: { title: 'Fare validator offline', owner_id: 'me' } } });
    expect(made.isError).toBeFalsy();
    const id = (made.structuredContent as any).id;
    const row = (await t.api.get(`/api/mcp-widgets/${id}`)).body;
    expect(row.owner_id).toBe(agent.userId);
    const upd = await c.callTool({ name: 'update_record', arguments: { type: 'mcpwidget', id: row.ref, changes: { status: 'done' } } });
    expect((upd.structuredContent as any).now).toEqual({ status: 'Done' });
    expect((await c.callTool({ name: 'add_comment', arguments: { type: 'mcpwidget', id, body: 'Replaced the unit.' } })).isError).toBeFalsy();
    expect((await c.callTool({ name: 'link_records', arguments: { from_type: 'mcpwidget', from_id: id, to_type: 'mcpwidget', to_id: widgetRef } })).isError).toBeFalsy();
    // The agent cannot touch a restricted record even with write access.
    expect((await c.callTool({ name: 'add_comment', arguments: { type: 'mcpsecret', id: secretId, body: 'x' } })).isError).toBe(true);
    expect((await c.callTool({ name: 'create_record', arguments: { type: 'mcpsecret', fields: { title: 'x' } } })).isError).toBe(true);

    const events = await t.db.query<any>(`select * from audit_events where record_id = $1 order by id`, [id]);
    expect(events.find((e) => e.action === 'mcpwidget.create')).toMatchObject({ actor_id: agent.userId, token_name: 'Agent writer' });
    const mcp = events.filter((e) => e.action === 'mcp.write');
    expect(mcp).toHaveLength(4);
    for (const e of mcp) {
      expect(e.summary).toMatch(/via MCP .*with API token "Agent writer"/);
      expect(e).toMatchObject({ actor_id: agent.userId, token_name: 'Agent writer' });
    }
    expect(text(await c.callTool({ name: 'get_history', arguments: { type: 'mcpwidget', id } }))).toMatch(/Agent writer/);
    await settings({ writeEnabled: false });
  });

  it('offers only the tools an administrator allows', async () => {
    await settings({ allowedTools: ['search', 'get_record'] });
    const c = await connect(adminRead);
    expect((await names(c)).sort()).toEqual(['get_record', 'search']);
    expect((await c.callTool({ name: 'list_records', arguments: { type: 'mcpwidget' } })).isError).toBe(true);
    await settings({ allowedTools: null });
  });
});

describe('who may connect', () => {
  it('refuses requests from web pages (an Origin header) and requests carrying only the session cookie', async () => {
    const fromPage = await post(INIT, { authorization: `Bearer ${adminRead}`, origin: 'http://evil.example' });
    expect(fromPage.status).toBe(403);
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: 'admin', password: 'a long test passphrase 1' } });
    const cookie = login.cookies.map((k) => `${k.name}=${k.value}`).join('; ');
    const cookieOnly = await post(INIT, { cookie, 'x-grc-csrf': '1' });
    expect(cookieOnly.status).toBe(401);
    expect(cookieOnly.headers.get('www-authenticate')).toMatch(/Bearer/);
    expect((await post(INIT, { authorization: 'Bearer grc_pat_not-a-real-token' })).status).toBe(401);
    // An allowed origin is accepted.
    await settings({ allowedOrigins: ['https://tools.example.org'] });
    expect((await post(INIT, { authorization: `Bearer ${adminRead}`, origin: 'https://tools.example.org' })).status).toBe(200);
    await settings({ allowedOrigins: [] });
    expect((await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${adminRead}` } })).status).toBe(405);
  });

  it('refuses ordinary API tokens without the mcp scope, and keeps assistant settings and tokens out of a token\'s reach', async () => {
    const plain = (await t.api.post('/api/me/tokens', { name: 'Plain script', scopes: ['*'], expiresInDays: 1 })).body.token;
    const res = await post(INIT, { authorization: `Bearer ${plain}` });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.message).toMatch(/mcp\.use/);
    for (const [method, url, body] of [['PUT', '/api/mcp/admin/settings', { writeEnabled: true }], ['POST', '/api/mcp/tokens', { name: 'x', access: 'write', expiresInDays: 1 }], ['GET', '/api/mcp/admin', undefined]] as const) {
      const r = await t.app.inject({ method, url, headers: { authorization: `Bearer ${adminRead}` }, ...(body ? { payload: body } : {}) });
      expect([url, r.statusCode]).toEqual([url, 403]);
      expect(['token_not_allowed', 'forbidden']).toContain(r.json().error.code);
    }
    expect((await t.api.get('/api/mcp/status')).body.writeEnabled).toBe(false);
    // The settings need a recent password confirmation.
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour'`);
    expect((await settings({ writeEnabled: true })).body.error.code).toBe('reauth_required');
    await t.db.query('update sessions set confirmed_at = now()');
  });

  it('limits requests per token', async () => {
    await settings({ ratePerMinute: 3 });
    const token = await makeToken(t.api, 'Busy assistant');
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(INIT, { authorization: `Bearer ${token}` })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    // Other tokens have their own allowance.
    expect((await post(INIT, { authorization: `Bearer ${await makeToken(agent, 'Quiet assistant')}` })).status).toBe(200);
    await settings({ ratePerMinute: 120 });
  });

  it('keeps a call log per token for administrators', async () => {
    const log = (await t.api.get('/api/mcp/admin')).body;
    const agentRow = log.usage.find((u: any) => u.token_name === 'Agent writer');
    expect(agentRow.calls).toBeGreaterThan(5);
    expect(agentRow.errors).toBeGreaterThan(0);
    expect(agentRow.tools.create_record).toBeGreaterThanOrEqual(3);
    expect(log.tools.find((x: any) => x.name === 'create_record')).toMatchObject({ write: true, offered: false });
    expect(log.recent[0]).toHaveProperty('tool');
    const mine = (await agent.get('/api/mcp/status')).body;
    expect(mine.tokens.map((x: any) => x.name).sort()).toEqual(['Agent laptop assistant', 'Agent writer', 'Quiet assistant']);
    expect(mine.tokens[0].scopes).toContain('mcp.use');
    expect(mine.tokens.find((x: any) => x.name === 'Agent laptop assistant').scopes.every((s: string) => /\.(view|use)$/.test(s))).toBe(true);
  });
});

describe('the stdio bridge', () => {
  it('relays a session to the HTTP endpoint with the token from the environment', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BRIDGE],
      env: { ...process.env, GRC_URL: base, GRC_TOKEN: adminRead } as Record<string, string>, stderr: 'pipe',
    });
    const c = new Client({ name: 'sandpiper-stdio-test', version: '1.0.0' });
    await c.connect(transport);
    clients.push(c);
    expect(c.getServerVersion()?.name).toBe('sandpiper-grc');
    expect(await names(c)).toContain('get_record');
    const got = await c.callTool({ name: 'get_record', arguments: { type: 'mcpwidget', id: widgetRef } });
    expect((got.structuredContent as any).title).toBe('Depot radio console fault');
    // Progress notifications come through the bridge too (streamed), before the result.
    const seen: number[] = [];
    const work = await c.callTool({ name: 'my_work', arguments: {} }, undefined, { onprogress: (p) => { seen.push(p.progress); } });
    expect(work.isError).toBeFalsy();
    expect(seen.length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it('reports a refused token as an error rather than hanging', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BRIDGE],
      env: { ...process.env, GRC_URL: `${base}/`, GRC_TOKEN: 'grc_pat_wrong' } as Record<string, string>, stderr: 'pipe',
    });
    const c = new Client({ name: 'sandpiper-stdio-test', version: '1.0.0' });
    await expect(c.connect(transport)).rejects.toThrow(/not valid|refused|401/i);
    await c.close().catch(() => undefined);
  }, 30_000);
});
