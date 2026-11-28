import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E45-65: the MCP tool link_evidence uses an evidence library record for another record (with "as" in
// data load mode); and a link attached with attach_link during a data load is undone with that load's
// files (wave 25 left it out). Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
let base = '';
let token = '';
const clients: Client[] = [];
const confirm = () => t.db.query('update sessions set confirmed_at = now()');

async function connect(): Promise<Client> {
  const client = new Client({ name: 'sandpiper-evidence-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return client;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
const text = (r: any) => (r.content ?? []).map((x: any) => x.text).join('\n');
const ok = (r: any) => { expect(r.isError, text(r)).toBeFalsy(); return r.structuredContent; };

beforeAll(async () => {
  t = await testApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await confirm();
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
  token = (await t.api.post('/api/mcp/tokens', { name: 'Evidence loader', access: 'write', expiresInDays: 7 })).body.token;
  await t.db.query(`insert into users (username, email, display_name, status) values ('mkeeper', 'm.keeper@example.test', 'Morgan Keeper', 'disabled')`);
}, 60_000);
afterAll(async () => { for (const c of clients) await c.close().catch(() => undefined); await t?.close(); });

describe('link_evidence', () => {
  it('links a library evidence record to a record by references, and again changes only the relation', async () => {
    const ev = (await t.api.post('/api/evidence-library', { title: 'Invented depot fire drill record' })).body;
    expect(ev.ref).toMatch(/^EVD-/);
    const sys = (await t.api.post('/api/systems', { name: 'Invented depot alarm panel' })).body;
    const c = await connect();
    const r = ok(await call(c, 'link_evidence', { evidence: ev.ref, type: 'system', id: sys.ref ?? sys.id, note: 'Annual drill' }));
    expect(r).toMatchObject({ relation: 'supports', evidence: { id: ev.id } });
    const again = ok(await call(c, 'link_evidence', { evidence: ev.id, type: 'system', id: sys.id, relation: 'demonstrates' }));
    expect(again.link_id).toBe(r.link_id);
    expect((await t.db.query<Row>('select relation from evidence_links where evidence_id = $1', [ev.id])).map((x) => x.relation)).toEqual(['demonstrates']);
    // A record that does not exist is an error, and nothing is linked.
    expect((await call(c, 'link_evidence', { evidence: 'EVD-99999', type: 'system', id: sys.id })).isError).toBe(true);
  });

  it('names the person who linked it in data load mode', async () => {
    const ev = (await t.api.post('/api/evidence-library', { title: 'Invented brake test certificate' })).body;
    const sys = (await t.api.post('/api/systems', { name: 'Invented brake test bench' })).body;
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    try {
      const c = await connect();
      const schema = (await c.listTools()).tools.find((x) => x.name === 'link_evidence')!.inputSchema as any;
      expect(Object.keys(schema.properties)).toContain('as');
      ok(await call(c, 'link_evidence', { evidence: ev.ref, type: 'system', id: sys.id, as: 'mkeeper' }));
      const keeper = (await t.db.one<Row>(`select id from users where username = 'mkeeper'`))!.id;
      expect((await t.db.one<Row>('select created_by from evidence_links where evidence_id = $1', [ev.id]))!.created_by).toBe(keeper);
    } finally {
      await confirm();
      await t.api.post('/api/admin/data-load', { on: false });
    }
  });
});

describe('links attached in a data load', () => {
  it('are listed with the load\'s files and removed when that load is undone', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Invented timetable server' })).body;
    // Outside a load a link is not listed, and a date is refused.
    const plain = await t.api.post('/api/attachments/link', { record_type: 'system', record_id: sys.id, url: 'https://docs.example.test/plain' });
    expect(plain.status).toBe(201);
    expect((await t.api.post('/api/attachments/link', { record_type: 'system', record_id: sys.id, url: 'https://docs.example.test/x', created_at: '2021-01-01' })).status).toBe(400);
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const c = await connect();
    const l = ok(await call(c, 'attach_link', { type: 'system', id: sys.id, url: 'https://docs.example.test/timetable-manual', created_at: '2021-03-04' }));
    const row = (await t.db.one<Row>('select created_at from attachments where id = $1', [l.attachment_id]))!;
    expect(new Date(row.created_at).toISOString().slice(0, 10)).toBe('2021-03-04');
    expect(await t.db.one(`select 1 from data_load_records where record_type = 'attachment' and record_id = $1`, [plain.body.id])).toBeUndefined();
    await confirm();
    const undo = await t.api.post('/api/admin/data-load/undo', { type: 'attachment', day: dayInZone() });
    expect(undo.body).toMatchObject({ deleted: 1 });
    expect((await t.db.one<Row>('select deleted_at from attachments where id = $1', [l.attachment_id]))!.deleted_at).toBeTruthy();
    expect((await t.db.one<Row>('select deleted_at from attachments where id = $1', [plain.body.id]))!.deleted_at).toBeNull();
    await t.api.post('/api/admin/data-load', { on: false });
  });
});
