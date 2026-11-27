import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_LOAD_KEY } from '../../core/dataload.ts';
import { TIME_ZONE } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Data load mode (E18-70): historical service desk tickets loaded through the MCP endpoint with
// their original times, the service desk figures that follow from them, who may load, the end
// time, deleting and undoing a load, legal holds, and silence (no notifications, no webhooks).

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let base = '';
const clients: Client[] = [];
let adminToken = '';
let agentToken = '';

const OPENED = '2024-03-04T14:00:00.000Z';
const RESOLVED = '2024-03-11T16:30:00.000Z';
const CLOSED = '2024-03-14T09:00:00.000Z';

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'sandpiper-load-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return client;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
const text = (r: any) => (r.content ?? []).map((x: any) => x.text).join('\n');
const tools = async (c: Client) => (await c.listTools()).tools.map((x) => x.name);
const confirm = () => t.db.query('update sessions set confirmed_at = now()');
const switchOn = async (body: Record<string, unknown> = {}) => { await confirm(); return t.api.post('/api/admin/data-load', { on: true, ...body }); };
const ticket = async (id: string) => (await t.db.one<any>('select * from tickets where id = $1', [id]))!;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

beforeAll(async () => {
  t = await testApp();
  agent = await t.as('agent');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await confirm();
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
  adminToken = (await t.api.post('/api/mcp/tokens', { name: 'Admin loader', access: 'write', expiresInDays: 7 })).body.token;
  agentToken = (await agent.post('/api/mcp/tokens', { name: 'Agent assistant', access: 'write', expiresInDays: 7 })).body.token;
  expect(adminToken).toBeTruthy();
  expect(agentToken).toBeTruthy();
});
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
});

describe('off by default', () => {
  it('is off, refuses read-only fields through MCP, ignores them on the REST API and offers no delete', async () => {
    expect((await t.api.get('/api/admin/data-load')).body).toMatchObject({ on: false, until: null, maxDays: 30, defaultDays: 7, loads: [] });
    expect((await t.api.get('/api/auth/state')).body.dataLoad).toBeNull();
    const c = await connect(adminToken);
    expect(await tools(c)).not.toContain('delete_record');
    const refused = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Too early', opened_at: OPENED } });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error.fields.opened_at).toMatch(/worked out by the application/);
    const made = await t.api.post('/api/tickets', { title: 'Opened today', opened_at: OPENED, ref: 'TKT-77777' });
    expect(made.status).toBe(201);
    expect(iso(made.body.opened_at)).not.toBe(OPENED);
    expect(made.body.ref).not.toBe('TKT-77777');
    expect((await t.db.query('select 1 from data_load_records')).length).toBe(0);
    // Outside a load an assignment notifies and a webhook delivery is queued (the comparison for later).
    await t.db.query(`insert into settings (key, value) values ('integrations.outbound_enabled', 'true'::jsonb) on conflict (key) do update set value = excluded.value`);
    await t.db.query(`insert into webhooks (name, url, secret, events, active) values ('Probe', 'https://hooks.example.test/x', 'probe-secret', '["*"]'::jsonb, true)`);
    const assigned = await t.api.post('/api/tickets', { title: 'Assigned today', assignee_id: agent.userId });
    expect(assigned.status).toBe(201);
    expect((await t.db.query('select 1 from notifications where user_id = $1', [agent.userId])).length).toBeGreaterThan(0);
    expect((await t.db.query('select 1 from webhook_deliveries')).length).toBeGreaterThan(0);
    const del = await t.api.del(`/api/data-load/records/ticket/${made.body.id}`);
    expect([del.status, del.body.error.code]).toEqual([409, 'data_load_off']);
  });
});

describe('switching it on', () => {
  it('needs a recent password, a session and an end at most 30 days ahead, and is audited', async () => {
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour'`);
    expect((await t.api.post('/api/admin/data-load', { on: true })).body.error.code).toBe('reauth_required');
    await confirm();
    const tooLong = await t.api.post('/api/admin/data-load', { on: true, until: new Date(Date.now() + 31 * 86_400_000).toISOString() });
    expect([tooLong.status, Object.keys(tooLong.body.error.fields)]).toEqual([400, ['until']]);
    expect((await agent.post('/api/admin/data-load', { on: true })).status).toBe(403);
    const on = await switchOn();
    expect(on.status).toBe(200);
    expect(on.body.on).toBe(true);
    const days = (Date.parse(on.body.until) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect((await t.db.query(`select 1 from audit_events where action = 'data_load.start'`)).length).toBe(1);
    expect((await t.api.get('/api/auth/state')).body.dataLoad).toMatchObject({ on: true, until: on.body.until });
    expect((await agent.get('/api/auth/state')).body.dataLoad).toBeNull();
    // A token can never switch it on.
    const viaToken = await t.app.inject({ method: 'POST', url: '/api/admin/data-load', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, payload: JSON.stringify({ on: true }) });
    expect(viaToken.statusCode).toBe(403);
  });
});

let loadedId = '';
let assignedId = '';
let nextRef = '';

describe('loading historical tickets through MCP', () => {

  it('tells the assistant what it may now set', async () => {
    const c = await connect(adminToken);
    const list = await call(c, 'list_record_types', {});
    expect(list.structuredContent.data_load).toMatchObject({ on: true, your_saves_are_loads: true });
    expect(text(list)).toMatch(/Data load mode is on until/);
    const one = await call(c, 'list_record_types', { type: 'ticket' });
    expect(one.structuredContent.data_load.extra_fields).toEqual(expect.arrayContaining(['opened_at', 'resolved_at', 'closed_at', 'response_breached', 'ref', 'created_at', 'created_by', 'updated_at']));
    expect(one.structuredContent.fields.find((f: any) => f.name === 'opened_at').settable_in_data_load).toBe(true);
    const offered = (await c.listTools()).tools;
    expect(offered.find((x) => x.name === 'create_record')!.description).toMatch(/Data load mode is on/);
    expect(offered.find((x) => x.name === 'delete_record')!.annotations).toMatchObject({ destructiveHint: true });
  });

  it('keeps the original opened, resolved and closed times and works out due times and breaches from them', async () => {
    const c = await connect(adminToken);
    const r = await call(c, 'create_record', {
      type: 'ticket',
      fields: {
        title: 'Depot printer offline (historical)', status: 'closed', priority: 'p3', ref: 'TKT-90001',
        opened_at: OPENED, resolved_at: RESOLVED, closed_at: CLOSED, first_responded_at: '2024-03-04T15:00:00Z',
        created_at: OPENED, updated_at: CLOSED, satisfaction_score: 4,
      },
    });
    expect(r.isError, text(r)).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ ref: 'TKT-90001', data_load: true });
    loadedId = r.structuredContent.id;
    const row = await ticket(loadedId);
    expect([iso(row.opened_at), iso(row.resolved_at), iso(row.closed_at)]).toEqual([OPENED, RESOLVED, CLOSED]);
    expect(iso(row.created_at)).toBe(OPENED);
    expect(iso(row.updated_at)).toBe(CLOSED);
    expect(row.status).toBe('closed'); // no resolution code needed for history
    // Due times are worked out from the original opening, not from today.
    expect(Date.parse(row.response_due_at)).toBeGreaterThan(Date.parse(OPENED));
    expect(Date.parse(row.resolve_due_at)).toBeLessThan(Date.parse('2024-04-30T00:00:00Z'));
    expect(row.resolve_breached).toBe(Date.parse(RESOLVED) > Date.parse(row.resolve_due_at));
    // Given values win.
    const given = await call(c, 'create_record', {
      type: 'ticket',
      fields: { title: 'Fare machine fault (historical)', status: 'resolved', opened_at: OPENED, resolved_at: RESOLVED, response_due_at: '2024-03-04T18:00:00Z', response_breached: true, resolve_breached: false, paused_minutes: 30 },
    });
    expect(given.isError, text(given)).toBeFalsy();
    const g = await ticket(given.structuredContent.id);
    expect([iso(g.response_due_at), g.response_breached, g.resolve_breached, g.paused_minutes]).toEqual(['2024-03-04T18:00:00.000Z', true, false, 30]);
  });

  it('keeps a given reference unique and moves the numbering past it', async () => {
    const c = await connect(adminToken);
    const dup = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Duplicate', ref: 'TKT-90001', opened_at: OPENED } });
    expect(dup.isError).toBe(true);
    expect(dup.structuredContent.error.fields.ref).toMatch(/already has the reference/);
    // A value the database works out (a generated column) still cannot be set.
    const generated = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Generated', opened_at: OPENED, target_missed: true } });
    expect(generated.structuredContent.error.fields.target_missed).toMatch(/worked out by the database/);
    const next = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Numbered as usual', opened_at: OPENED } });
    // The ticket loaded before without a reference took TKT-90002, so this one is TKT-90003.
    expect(next.structuredContent.ref).toBe('TKT-90003');
    nextRef = next.structuredContent.ref;
  });

  it('marks the history and audit events as a data load and lists the record for undoing', async () => {
    const history = (await t.api.get(`/api/history?record_type=ticket&record_id=${loadedId}`)).body as any[];
    expect(history.some((h) => /loaded \(data load mode\)/.test(h.summary))).toBe(true);
    const mcp = await t.db.query<any>(`select summary from audit_events where action = 'mcp.write' and record_id = $1`, [loadedId]);
    expect(mcp[0].summary).toMatch(/data load/);
    expect((await t.db.query(`select 1 from data_load_records where record_type = 'ticket' and record_id = $1`, [loadedId])).length).toBe(1);
  });

  it('updates history with any status and supplied times', async () => {
    const c = await connect(adminToken);
    const r = await call(c, 'update_record', { type: 'ticket', id: nextRef, changes: { status: 'closed', resolved_at: RESOLVED, closed_at: CLOSED, updated_at: CLOSED } });
    expect(r.isError, text(r)).toBeFalsy();
    const row = await ticket(r.structuredContent.id);
    expect([row.status, iso(row.resolved_at), iso(row.closed_at), iso(row.updated_at)]).toEqual(['closed', RESOLVED, CLOSED, CLOSED]);
  });

  it('feeds the service desk figures with the original dates', async () => {
    const m = (await t.api.get('/api/tickets/metrics?from=2024-03-01&to=2024-03-31')).body;
    expect(m.total).toBe(3);
    expect(m.resolved).toBe(3);
    expect(m.volume_by_day.find((d: any) => d.opened > 0)).toBeTruthy();
    expect(m.resolution.average_minutes).toBeGreaterThan(60 * 24 * 6);
  });

  it('sends nothing: no notification for an assignment, no webhook delivery', async () => {
    const before = (await t.db.query('select 1 from webhook_deliveries')).length;
    const told = (await t.db.query('select 1 from notifications where user_id = $1', [agent.userId])).length;
    const c = await connect(adminToken);
    const r = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Assigned long ago', status: 'assigned', assignee_id: agent.userId, opened_at: OPENED } });
    expect(r.isError, text(r)).toBeFalsy();
    assignedId = r.structuredContent.id;
    expect((await t.db.query('select 1 from notifications where user_id = $1', [agent.userId])).length).toBe(told);
    expect((await t.db.query('select 1 from webhook_deliveries')).length).toBe(before);
    // Open and long past its targets (assigning is not a response, E18-74): recorded as missed and
    // warned at once, so the service-level check that runs every minute sends no alert about history.
    const open = await ticket(assignedId);
    expect([open.response_breached, open.resolve_breached, open.resolve_warned]).toEqual([true, true, true]);
    expect((await t.api.post('/api/tickets/sla/sweep')).status).toBe(200);
    expect((await t.db.query('select 1 from notifications where user_id = $1', [agent.userId])).length).toBe(told);
  });

  it('refuses read-only fields to a non-administrator and offers them no delete', async () => {
    const c = await connect(agentToken);
    expect(await tools(c)).not.toContain('delete_record');
    const r = await call(c, 'create_record', { type: 'ticket', fields: { title: 'Agent history', opened_at: OPENED } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.fields.opened_at).toMatch(/worked out by the application/);
    const rest = await agent.post('/api/tickets', { title: 'Agent via REST', opened_at: OPENED });
    expect(iso(rest.body.opened_at)).not.toBe(OPENED);
    expect((await t.db.query('select 1 from data_load_records where record_id = $1', [rest.body.id])).length).toBe(0);
    expect((await agent.del(`/api/data-load/records/ticket/${loadedId}`)).status).toBe(403);
  });

  it('deletes a loaded record through MCP, but nothing else, and never one under a legal hold', async () => {
    const c = await connect(adminToken);
    const other = await t.db.one<{ id: string }>(`select id from tickets where title = 'Opened today'`);
    expect((await t.db.query('select 1 from data_load_records where record_id = $1', [other!.id])).length).toBe(0);
    const notLoaded = await call(c, 'delete_record', { type: 'ticket', id: other!.id });
    expect(notLoaded.isError).toBe(true);
    expect(notLoaded.structuredContent.error.code).toBe('not_found');
    const hold = (await t.api.post('/api/legal-holds', { matter: 'Fare dispute records' })).body;
    expect((await t.api.post(`/api/legal-holds/${hold.id}/records`, { records: [{ type: 'ticket', id: assignedId }] })).status).toBeLessThan(300);
    const held = await call(c, 'delete_record', { type: 'ticket', id: assignedId });
    expect(held.isError).toBe(true);
    expect(held.structuredContent.error.code).toBe('on_hold');
    const ok = await call(c, 'delete_record', { type: 'ticket', id: nextRef });
    expect(ok.isError, text(ok)).toBeFalsy();
    expect((await t.db.one<any>(`select deleted_at from tickets where ref = $1`, [nextRef]))!.deleted_at).not.toBeNull();
    expect((await t.db.one<any>(`select l.deleted_at from data_load_records l join tickets k on k.id = l.record_id where k.ref = $1`, [nextRef]))!.deleted_at).not.toBeNull();
  });

  it('lists the loads by day and type and undoes one, keeping records under a hold', async () => {
    const page = (await t.api.get('/api/admin/data-load')).body;
    const load = page.loads.find((l: any) => l.record_type === 'ticket');
    expect(load).toMatchObject({ label: 'Tickets' });
    expect(load.records).toBe(4);
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour'`);
    expect((await t.api.post('/api/admin/data-load/undo', { type: 'ticket', day: load.day })).body.error.code).toBe('reauth_required');
    await confirm();
    const undone = await t.api.post('/api/admin/data-load/undo', { type: 'ticket', day: load.day });
    expect(undone.status).toBe(200);
    expect(undone.body.held).toBe(1);
    expect(undone.body.deleted).toBe(load.remaining - 1);
    expect((await t.db.one<any>('select deleted_at from tickets where id = $1', [loadedId]))!.deleted_at).not.toBeNull();
    expect((await t.db.one<any>('select deleted_at from tickets where id = $1', [assignedId]))!.deleted_at).toBeNull();
    expect((await t.db.query(`select 1 from audit_events where action = 'data_load.undo'`)).length).toBe(1);
    const day = (await t.db.one<{ d: string }>(`select to_char(now() at time zone $1, 'YYYY-MM-DD') as d`, [TIME_ZONE]))!.d;
    expect(load.day).toBe(day);
  });
});

describe('the end time', () => {
  it('switches itself off at its end, is audited, and refuses as before', async () => {
    await t.db.query(`update settings set value = jsonb_set(value, '{until}', to_jsonb($2::text)) where key = $1`, [DATA_LOAD_KEY, new Date(Date.now() - 1000).toISOString()]);
    expect((await t.api.get('/api/admin/data-load')).body.on).toBe(false);
    expect((await t.db.query(`select 1 from audit_events where action = 'data_load.end'`)).length).toBe(1);
    const c = await connect(adminToken);
    expect(await tools(c)).not.toContain('delete_record');
    const r = await call(c, 'create_record', { type: 'ticket', fields: { title: 'After the end', opened_at: OPENED } });
    expect(r.isError).toBe(true);
  });

  it('can be switched off by hand, audited', async () => {
    await switchOn({ days: 1 });
    const off = await t.api.post('/api/admin/data-load', { on: false });
    expect(off.body.on).toBe(false);
    expect((await t.db.query(`select 1 from audit_events where action = 'data_load.stop'`)).length).toBe(1);
  });

  it('needs AI assistant write access for an assistant token', async () => {
    await switchOn({ days: 1 });
    await confirm();
    await t.api.put('/api/mcp/admin/settings', { writeEnabled: false });
    const del = await t.app.inject({ method: 'DELETE', url: `/api/data-load/records/ticket/${loadedId}`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(del.statusCode).toBe(409);
    await t.api.put('/api/mcp/admin/settings', { writeEnabled: true });
  });
});
