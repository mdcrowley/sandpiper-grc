import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E14-06: an AI assistant lists the approvals waiting for its person and decides one, through the
// MCP tools my_approvals and decide_approval. Needs the mcp module; skipped when it is not loaded.

const stand: ModuleDef = {
  key: 'wfmcpstand',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_wf_mcp_items (
      id uuid primary key default gen_random_uuid(), ref text, title text not null, status text,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'wf_mcp_item', table: 'test_wf_mcp_items', module: 'tickets', label: 'Work order', plural: 'Work orders',
      path: '/api/test-wf-mcp-items', route: '/test-wf-mcp-items', titleField: 'title', ref: { field: 'ref', prefix: 'WO-' },
      fields: { ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Title', type: 'text', required: true }, status: { label: 'Status', type: 'text' } },
    });
  },
};

const loaded = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('mcp');
let t: Awaited<ReturnType<typeof testApp>>;
let client: Client;

describe.runIf(loaded)('approvals through MCP', () => {
  let requester: Awaited<ReturnType<typeof t.as>>;
  let approver: Awaited<ReturnType<typeof t.as>>;

  beforeAll(async () => {
    t = await testApp({ extraModules: [stand] });
    requester = await t.as('agent');
    approver = await t.as('agent');
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
    const made = await approver.post('/api/mcp/tokens', { name: 'Approver assistant', access: 'write', expiresInDays: 7 });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    client = new Client({ name: 'sandpiper-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${made.body.token}` } } }));
  }, 60_000);
  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await t?.close();
  });

  const text = (r: any) => (r.content ?? []).map((c: any) => c.text).join('\n');

  it('lists the waiting approval and approves it', async () => {
    const wf = await t.api.post('/api/workflows/definitions', {
      record_type: 'wf_mcp_item', name: 'Work order sign-off', trigger: 'create',
      steps: [{ name: 'Supervisor', approvers: { kind: 'users', users: [approver.userId] } }],
      on_approve: [{ field: 'status', value: 'signed off' }],
    });
    expect(wf.status, JSON.stringify(wf.body)).toBe(201);
    const item = (await requester.post('/api/test-wf-mcp-items', { title: 'Replace platform display' })).body as Row;

    const tools = (await client.listTools()).tools.map((x) => x.name);
    expect(tools).toEqual(expect.arrayContaining(['my_approvals', 'decide_approval']));

    const listed = await client.callTool({ name: 'my_approvals', arguments: {} });
    expect(text(listed)).toMatch(/Replace platform display/);
    const stepId = (listed.structuredContent as any)?.approvals?.[0]?.step_id ?? /step_id ([0-9a-f-]{36})/.exec(text(listed))![1];

    const refused = await client.callTool({ name: 'decide_approval', arguments: { step_id: stepId, decision: 'reject' } });
    expect(refused.isError).toBe(true);
    const done = await client.callTool({ name: 'decide_approval', arguments: { step_id: stepId, decision: 'approve', comment: 'Checked on site' } });
    expect(done.isError).toBeFalsy();
    expect(text(done)).toMatch(/Approved "Supervisor"/);
    expect((await t.api.get(`/api/test-wf-mcp-items/${item.id}`)).body.status).toBe('signed off');
    expect(text(await client.callTool({ name: 'my_approvals', arguments: {} }))).toMatch(/Nothing is waiting/);
  });
});
