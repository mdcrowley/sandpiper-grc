import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { PROMPTS } from './prompts.ts';
import { normalizeDate } from './resolve.ts';

// Building records completely through MCP (E45-46 to E45-49, wave 25): linked records and people given by
// reference, title, email or name; list values by label; dates in common formats; files and links on
// any record (with "as" in data load mode); related types and custom fields in list_record_types; and
// what a save left empty.

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let base = '';
const clients: Client[] = [];
let adminToken = '';
let agentToken = '';
let agentName = '';

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'sandpiper-complete-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return client;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
const text = (r: any) => (r.content ?? []).map((x: any) => x.text).join('\n');
const ok = (r: any) => { expect(r.isError, text(r)).toBeFalsy(); return r.structuredContent; };
const tools = async (c: Client) => (await c.listTools()).tools.map((x) => x.name);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const confirm = () => t.db.query('update sessions set confirmed_at = now()');

async function send(c: Client, name: string, bytes: Buffer): Promise<string> {
  const s = ok(await call(c, 'start_upload', { file_name: name, size: bytes.length, sha256: sha(bytes) }));
  ok(await call(c, 'upload_part', { upload_id: s.upload_id, part: 1, data: bytes.toString('base64') }));
  return ok(await call(c, 'finish_upload', { upload_id: s.upload_id })).upload_id;
}

let sysA = { id: '', ref: '' };
let lookupChoice = { value: '', label: '' };

beforeAll(async () => {
  t = await testApp();
  agent = await t.as('agent');
  agentName = (await t.db.one<{ username: string }>('select username from users where id = $1', [agent.userId]))!.username;
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await confirm();
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
  adminToken = (await t.api.post('/api/mcp/tokens', { name: 'Record loader', access: 'write', expiresInDays: 7 })).body.token;
  agentToken = (await agent.post('/api/mcp/tokens', { name: 'Agent writer', access: 'write', expiresInDays: 7 })).body.token;
  expect(adminToken && agentToken).toBeTruthy();
  const a = (await t.api.post('/api/systems', { name: 'Invented Fare Collection' })).body;
  sysA = { id: a.id, ref: a.ref };
  // Two systems with one name: a name that cannot pick one.
  await t.api.post('/api/systems', { name: 'Invented Radio' });
  await t.api.post('/api/systems', { name: 'invented radio' });
  const meta = (await t.api.get('/api/meta')).body;
  const choices: { value: string; label: string }[] = meta.lookups.ticket_category ?? [];
  lookupChoice = choices.find((c) => c.label.toLowerCase() !== c.value.toLowerCase()) ?? choices[0];
  expect(lookupChoice).toBeTruthy();
});
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
});

describe('dates', () => {
  it('reads common formats and refuses others', () => {
    expect(normalizeDate('2024-03-05')).toBe('2024-03-05');
    expect(normalizeDate('2024-03-05T10:00:00Z')).toBe('2024-03-05');
    expect(normalizeDate('03/05/2024')).toBe('2024-03-05');
    expect(normalizeDate('25/12/2023')).toBe('2023-12-25');
    expect(normalizeDate('March 5, 2024')).toBe('2024-03-05');
    expect(normalizeDate('5 Mar 2024')).toBe('2024-03-05');
    expect(normalizeDate(45356)).toBe('2024-03-05');
    expect(normalizeDate('2024-02-30')).toBeNull();
    expect(normalizeDate('soon')).toBeNull();
  });
});

describe('values resolved on create and update', () => {
  it('takes a linked record by reference, a person by email and a list value by its label, and says what it matched', async () => {
    const c = await connect(adminToken);
    const email = (await t.db.one<{ email: string }>('select email from users where id = $1', [agent.userId]))!.email;
    const r = ok(await call(c, 'create_record', {
      type: 'ticket', fields: { title: 'Fare gates offline', system_id: sysA.ref.toLowerCase(), assignee_id: email.toUpperCase(), category: lookupChoice.label.toUpperCase() },
    }));
    const row = (await t.db.one<any>('select * from tickets where id = $1', [r.id]))!;
    expect([row.system_id, row.assignee_id, row.category]).toEqual([sysA.id, agent.userId, lookupChoice.value]);
    expect(r.resolved.map((x: any) => x.field).sort()).toEqual(['assignee_id', 'category', 'system_id']);
    expect(r.resolved.find((x: any) => x.field === 'system_id').label).toContain(sysA.ref);
  });

  it('takes a linked record by its exact title and a person by username, on update too', async () => {
    const c = await connect(adminToken);
    const made = ok(await call(c, 'create_record', { type: 'ticket', fields: { title: 'Ticket machine jammed', system_id: 'invented fare collection' } }));
    expect((await t.db.one<any>('select system_id from tickets where id = $1', [made.id]))!.system_id).toBe(sysA.id);
    const up = ok(await call(c, 'update_record', { type: 'ticket', id: made.ref, changes: { assignee_id: agentName } }));
    expect(up.resolved[0]).toMatchObject({ field: 'assignee_id', value: agent.userId });
  });

  it('refuses a name that matches several records, listing them, and a name that matches none, saving nothing', async () => {
    const c = await connect(adminToken);
    const before = (await t.db.one<{ n: number }>('select count(*)::int as n from tickets'))!.n;
    const amb = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Radio static', system_id: 'Invented Radio' } });
    expect(amb.isError).toBe(true);
    expect(amb.structuredContent.error.fields.system_id).toMatch(/matches 2 records.*SYS-.*SYS-/);
    const none = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Radio static', system_id: 'Invented Fare' } });
    expect(none.structuredContent.error.fields.system_id).toMatch(/no system "Invented Fare".*Close matches: SYS-\d+ Invented Fare Collection/);
    const nobody = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Radio static', assignee_id: 'nobody@example.test', category: 'not a category' } });
    expect(Object.keys(nobody.structuredContent.error.fields).sort()).toEqual(['assignee_id', 'category']);
    expect((await t.db.one<{ n: number }>('select count(*)::int as n from tickets'))!.n).toBe(before);
  });

  it('names a disabled account only in data load mode', async () => {
    const off = (await t.db.one<{ id: string }>(`insert into users (username, email, display_name, status) values ('retired1', 'retired1@example.test', 'Invented Retired Person', 'disabled') returning id`))!.id;
    const c = await connect(adminToken);
    const refused = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Old ticket', assignee_id: 'retired1@example.test' } });
    expect(refused.structuredContent.error.fields.assignee_id).toMatch(/no active account/);
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true })).status).toBe(200);
    try {
      const loader = await connect(adminToken);
      const r = ok(await call(loader, 'create_record', { type: 'ticket', fields: { title: 'Old ticket', assignee_id: 'Invented Retired Person' } }));
      expect((await t.db.one<any>('select assignee_id from tickets where id = $1', [r.id]))!.assignee_id).toBe(off);
    } finally {
      await confirm();
      await t.api.post('/api/admin/data-load', { on: false });
    }
  });

  it('answers with the optional fields left empty and the related types without records', async () => {
    const c = await connect(adminToken);
    const r = ok(await call(c, 'create_record', { type: 'vendor', fields: { name: 'Invented Signal Supplies' } }));
    expect(r.unfilled.length).toBeGreaterThan(0);
    expect(r.unfilled.every((u: any) => u.field !== 'name')).toBe(true);
    expect(r.related_empty.map((x: any) => x.type)).toContain('contract');
    expect(text(await call(c, 'update_record', { type: 'vendor', id: r.id, changes: { name: 'Invented Signal Supplies Ltd' } }))).toMatch(/Still empty: .*No related records yet: .*Contracts/);
  });
});

describe('list_record_types', () => {
  it('lists the related types, value help and custom fields with their choices', async () => {
    await confirm();
    const cf = await t.api.post('/api/admin/custom-fields', {
      record_type: 'vendor', label: 'Invented depot zone', key: 'depot_zone', type: 'select', help: 'The depot the vendor serves.',
      options: [{ value: 'north', label: 'North yard' }, { value: 'south', label: 'South yard' }],
    });
    expect(cf.status, JSON.stringify(cf.body)).toBe(201);
    const c = await connect(adminToken);
    const r = ok(await call(c, 'list_record_types', { type: 'vendor' }));
    expect(r.related_types.map((x: any) => x.type)).toContain('contract');
    const zone = r.fields.find((f: any) => f.name === 'cf_depot_zone');
    expect(zone).toMatchObject({ label: 'Invented depot zone', custom: true, help: 'The depot the vendor serves.' });
    expect(zone.choices).toEqual([{ value: 'north', label: 'North yard' }, { value: 'south', label: 'South yard' }]);
    expect(text(await call(c, 'list_record_types', { type: 'vendor' }))).toMatch(/Related types[\s\S]*contract/);
    // The custom field takes a label too.
    const v = ok(await call(c, 'create_record', { type: 'vendor', fields: { name: 'Invented Track Works', cf_depot_zone: 'south yard' } }));
    expect((await t.api.get(`/api/vendors/${v.id}`)).body.cf_depot_zone).toBe('south');
    const all = ok(await call(c, 'list_record_types', {}));
    expect(all.types.find((x: any) => x.type === 'ticket').required).toContain('title');
  });
});

describe('files and links on any record', () => {
  it('offers the upload tools to anyone who may write records, and attaches a file and a link to a ticket', async () => {
    const c = await connect(agentToken);
    const names = await tools(c);
    expect(names).toEqual(expect.arrayContaining(['start_upload', 'upload_part', 'finish_upload', 'attach_file', 'attach_link', 'list_attachments']));
    const made = ok(await call(c, 'create_record', { type: 'ticket', fields: { title: 'Validator screen cracked' } }));
    const up = await send(c, 'validator-photo.txt', Buffer.from('An invented note about a cracked validator screen.\n'));
    const f = ok(await call(c, 'attach_file', { type: 'ticket', id: made.ref, upload_id: up, description: 'Field note' }));
    expect(f).toMatchObject({ file_name: 'validator-photo.txt', kind: 'file' });
    const again = await call(c, 'attach_file', { type: 'ticket', id: made.ref, upload_id: up });
    expect(again.isError).toBe(true);
    const l = ok(await call(c, 'attach_link', { type: 'ticket', id: made.ref, url: 'https://docs.example.test/validators/manual', title: 'Validator manual' }));
    expect(l).toMatchObject({ title: 'Validator manual', kind: 'file' });
    const list = ok(await call(c, 'list_attachments', { type: 'ticket', id: made.ref }));
    expect(list.files.map((x: any) => x.name).sort()).toEqual(['Validator manual', 'validator-photo.txt']);
    const bad = await call(c, 'attach_link', { type: 'ticket', id: made.ref, url: 'ftp://docs.example.test/x' });
    expect(bad.isError).toBe(true);
  });

  it('keeps evidence with its dates on an asset, and names the real person in data load mode', async () => {
    const asset = (await t.api.post('/api/assets', { name: 'Invented Depot Router' })).body;
    expect(asset.id).toBeTruthy();
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true })).status).toBe(200);
    try {
      const c = await connect(adminToken);
      expect(await tools(c)).toContain('attach_file');
      const up = await send(c, 'router-certificate.txt', Buffer.from('An invented certificate.\n'));
      const f = ok(await call(c, 'attach_file', {
        type: 'asset', id: asset.id, upload_id: up, evidence: true, collected_on: 'March 5, 2024', expires_on: '03/05/2026', as: agentName,
      }));
      expect(f).toMatchObject({ kind: 'evidence', collected_on: '2024-03-05', expires_on: '2026-03-05', data_load: true });
      const l = ok(await call(c, 'attach_link', { type: 'asset', id: asset.id, url: 'https://docs.example.test/router', as: agentName }));
      expect(l.added_by).toBe((await t.db.one<any>('select display_name from users where id = $1', [agent.userId]))!.display_name);
      const events = await t.db.query<{ summary: string }>(`select summary from audit_events where action = 'mcp.write' and record_id = $1`, [asset.id]);
      expect(events.filter((e) => /on behalf of/.test(e.summary)).length).toBe(2);
    } finally {
      await confirm();
      await t.api.post('/api/admin/data-load', { on: false });
    }
    // Outside a load "as" is not offered.
    const c2 = await connect(adminToken);
    const schema = (await c2.listTools()).tools.find((x) => x.name === 'attach_file')!.inputSchema as any;
    expect(Object.keys(schema.properties)).not.toContain('as');
  });
});

describe('guidance', () => {
  it('tells the assistant to build records completely and offers the loading prompt', async () => {
    const c = await connect(adminToken);
    expect(c.getInstructions()).toMatch(/instead of writing those facts into the description/);
    expect((await c.listPrompts()).prompts.map((p) => p.name)).toContain('load_records_from_sources');
    const p = PROMPTS.find((x) => x.name === 'load_records_from_sources')!.text({ record_type: 'vendor', sources: 'an invented vendor list' });
    expect(p).toMatch(/list_record_types[\s\S]*create_record[\s\S]*attach_file[\s\S]*add_comment[\s\S]*unfilled/);
  });
});
