import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// record_acknowledgment (E18-94): offered only while the caller's saves are data loads; records that
// a reader acknowledged a version on a past date, keeps to the document's distribution, and "as" on
// the document tools names the person who did the work. Invented people and documents only.

let t: Awaited<ReturnType<typeof testApp>>;
let base = '';
const clients: Client[] = [];
let adminToken = '';
let former = '';
let docId = '';

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'sandpiper-ack-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return client;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
const text = (r: any) => (r.content ?? []).map((x: any) => x.text).join('\n');
const tools = async (c: Client) => (await c.listTools()).tools;
const confirm = () => t.db.query('update sessions set confirmed_at = now()');

beforeAll(async () => {
  t = await testApp();
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('kfield', 'k.field@example.test', 'Kim Field', 'disabled') returning id`))!.id;
  await t.db.query(`insert into users (username, email, display_name, status) values ('nreader', 'n.reader@example.test', 'Noel Reader', 'active')`);
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await confirm();
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
  adminToken = (await t.api.post('/api/mcp/tokens', { name: 'History loader', access: 'write', expiresInDays: 7 })).body.token;
  // The document's history is loaded (so the administrator may approve the version they wrote).
  expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
  const doc = (await t.api.post('/api/policies', { title: 'Invented fare handling SOP', doc_number: 'SOP-FARE-001', access: 'restricted', access_users: [former] })).body;
  docId = doc.id;
  const v = (await t.api.post(`/api/policies/${docId}/versions`, { body: 'Invented text.' })).body;
  await t.api.post(`/api/policies/${docId}/versions/${v.id}/approve`, {});
  expect((await t.api.post(`/api/policies/${docId}/versions/${v.id}/publish`, {})).status).toBe(200);
  expect((await t.api.post('/api/admin/data-load', { on: false })).status).toBe(200);
}, 60_000);
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
});

describe('record_acknowledgment', () => {
  it('is not offered outside data load mode, nor "as" on the document tools', async () => {
    const list = await tools(await connect(adminToken));
    expect(list.map((x) => x.name)).not.toContain('record_acknowledgment');
    const review = list.find((x) => x.name === 'record_document_review')!;
    expect(Object.keys((review.inputSchema as any).properties)).not.toContain('as');
  });

  it('in data load mode records a reader\'s past acknowledgment and refuses someone outside the distribution', async () => {
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const c = await connect(adminToken);
    const list = await tools(c);
    expect(list.map((x) => x.name)).toContain('record_acknowledgment');
    expect(Object.keys((list.find((x) => x.name === 'link_document')!.inputSchema as any).properties)).toContain('as');
    const r = await call(c, 'record_acknowledgment', { document: 'SOP-FARE-001', version: 1, person: 'kfield', acknowledged_on: '2023-09-12' });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toMatch(/Recorded Kim Field's acknowledgment of version 1/);
    const row = (await t.db.one<Row>('select acknowledged_at from policy_acknowledgements where policy_id = $1 and user_id = $2', [docId, former]))!;
    expect(new Date(row.acknowledged_at).toISOString().slice(0, 10)).toBe('2023-09-12');
    const again = await call(c, 'record_acknowledgment', { document: 'SOP-FARE-001', person: 'k.field@example.test', acknowledged_on: '2023-10-01' });
    expect(text(again)).toMatch(/had already acknowledged/);
    const outside = await call(c, 'record_acknowledgment', { document: 'SOP-FARE-001', person: 'nreader', acknowledged_on: '2023-09-12' });
    expect(outside.isError).toBe(true);
    expect(text(outside)).toMatch(/not one of this document's readers/);
    const ev = (await t.db.one<Row>(`select summary from audit_events where action = 'mcp.write' and record_id = $1 order by id desc limit 1`, [docId]))!;
    expect(ev.summary).toMatch(/via MCP \(tool record_acknowledgment\)/);
  });

  it('records a document review in the name of the person given as "as"', async () => {
    const c = await connect(adminToken);
    const r = await call(c, 'record_document_review', { document: 'SOP-FARE-001', result: 'no_change', reviewed_on: '2023-11-02', as: 'kfield' });
    expect(r.isError, text(r)).toBeFalsy();
    const review = (await t.db.one<Row>(`select reviewed_by_name, created_by from policy_plan_reviews where policy_id = $1 and kind = 'periodic'`, [docId]))!;
    expect(review).toEqual({ reviewed_by_name: 'Kim Field', created_by: former });
  });
});
