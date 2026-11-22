import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { ADMIN, testApp } from '../test/helpers.ts';
import { SESSION_COOKIE } from './auth.ts';
import { APPLICATION_RULES, lifecycleField, lifecycleManaged, NEW } from './lifecycle.ts';
import type { ModuleDef, Row } from './module.ts';

// Allowed status changes and required fields as data per record type (E14-31).

/** An invented record type: parcels at a depot's lost-property office. */
const parcels: ModuleDef = {
  key: 'testparcels',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_parcels (
      id uuid primary key default gen_random_uuid(), ref text, name text not null, notes text, status text, owner_id uuid,
      shelf text, fragile boolean,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('test_parcel_status', [
      { value: 'received', label: 'Received' }, { value: 'sorting', label: 'Sorting' }, { value: 'held', label: 'Held' },
      { value: 'delivered', label: 'Delivered' }, { value: 'archived', label: 'Archived' },
    ], { module: 'tickets' });
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'test_parcel', table: 'test_parcels', module: 'tickets', label: 'Parcel', plural: 'Parcels',
      path: '/api/test-parcels', route: '/test-parcels', titleField: 'name', ref: { field: 'ref', prefix: 'PCL-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        status: { label: 'Status', type: 'lookup', list: 'test_parcel_status', default: 'received' },
        owner_id: { label: 'Owner', type: 'user' },
        shelf: { label: 'Shelf', type: 'text' },
        fragile: { label: 'Fragile', type: 'boolean' },
      },
      hooks: {
        // The module's own rule, in code: only a delivered parcel may be archived.
        beforeUpdate: (_req, existing, patch) => {
          if (patch.status === 'archived' && existing.status !== 'delivered') ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: 'Only a delivered parcel can be archived.' });
          return patch;
        },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
const make = async (body: Row = {}) => {
  const res = await t.api.post('/api/test-parcels', { name: 'Umbrella left on route 12', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row;
};
const rules = (body: Row) => t.api.put('/api/admin/lifecycles/test_parcel', body);
const reset = () => t.api.del('/api/admin/lifecycles/test_parcel');
/** A person's request, for calling the engine directly. */
const asPerson = async (): Promise<FastifyRequest> => ({ user: { id: '00000000-0000-4000-8000-000000000001', username: 'p', displayName: 'P', email: '', roles: ['administrator'], permissions: ['*'] } } as unknown as FastifyRequest);

beforeAll(async () => {
  t = await testApp({ extraModules: [parcels] });
  agent = await t.as('agent'); // tickets.*: may edit parcels
});
afterAll(async () => { await t.close(); });

describe('defaults reproduce the behavior before E14-31', () => {
  it('every record type with a status allows every move and requires nothing', async () => {
    const res = t.core.resources;
    const req = await asPerson();
    const types = res.registry.all().filter((d) => lifecycleField(d));
    expect(types.length).toBeGreaterThan(1);
    for (const def of types) {
      const field = lifecycleField(def)!;
      const r = (await res.lifecycles.rulesFor(def))!;
      expect(r, def.type).toMatchObject({ field, blocked: [], required: {}, who: {}, customized: false });
      const values = (await t.ctx.lookups.values(def.fields[field].list!)).map((v) => v.value);
      for (const from of [NEW, ...values]) {
        for (const to of values) {
          const existing = from === NEW ? null : { id: 'x', [field]: from, custom: {} };
          expect(await res.lifecycles.check(def, existing, { [field]: to }, req), `${def.type}: ${from} -> ${to}`).toEqual({});
        }
      }
    }
  });

  it('describes each type in /api/meta with nothing blocked, and marks the types whose status the application sets', async () => {
    const meta = (await t.api.get('/api/meta')).body.resources;
    for (const [type, m] of Object.entries<Row>(meta)) {
      if (!m.lifecycle) continue;
      expect(m.lifecycle, type).toMatchObject({ blocked: [], required: {}, denied: [] });
    }
    expect(meta.test_parcel.lifecycle).toMatchObject({ field: 'status', managed: false });
    const managed = t.core.resources.registry.all().filter((d) => lifecycleManaged(d)).map((d) => d.type);
    for (const type of managed) expect(['change', 'policy', 'emergency_activation', 'legal_hold', 'privacy_assessment', 'inventory_count']).toContain(type);
    if (t.core.resources.registry.get('project')) expect(lifecycleField(t.core.resources.registry.get('project')!)).toBe('status');
    // Notes describe real types only.
    for (const type of Object.keys(APPLICATION_RULES)) {
      const def = t.core.resources.registry.get(type);
      if (def) expect(lifecycleField(def), type).not.toBeNull();
    }
  });

  it('lists the types with a status on the administration page', async () => {
    const list = (await t.api.get('/api/admin/lifecycles')).body.types as Row[];
    expect(list.find((x) => x.type === 'test_parcel')).toMatchObject({ customized: false, statuses: 5, blocked: 0, managed: false });
    expect(list.every((x) => x.field)).toBe(true);
    expect((await agent.get('/api/admin/lifecycles')).status).toBe(403);
  });
});

describe('editing the rules', () => {
  it('stores them, audits the change, and restores the defaults', async () => {
    const saved = await rules({ blocked: [['received', 'delivered'], [NEW, 'archived']], required: { delivered: ['owner_id'] }, who: { held: { permission: null, roles: ['administrator'] } } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ customized: true, managed: false, updatedBy: ADMIN.displayName, newStatuses: [] });
    expect(saved.body.rules.blocked).toEqual([['received', 'delivered'], [NEW, 'archived']]);
    const audit = await t.db.one<Row>(`select summary, before, after from audit_events where action = 'lifecycle.update' order by at desc limit 1`);
    expect(audit!.summary).toBe('Lifecycle of parcels changed: 2 moves not allowed, 1 required field, 1 status limited to some people');
    expect(audit!.before).toMatchObject({ record_type: 'test_parcel', defaults: true });
    expect(audit!.after).toMatchObject({ blocked: [['received', 'delivered'], [NEW, 'archived']] });

    const restored = await reset();
    expect(restored.body).toMatchObject({ customized: false, rules: { blocked: [], required: {}, who: {} } });
    const back = await t.db.one<Row>(`select summary, before from audit_events where action = 'lifecycle.restore' order by at desc limit 1`);
    expect(back!.summary).toMatch(/restored to the defaults/);
    expect(back!.before.blocked).toHaveLength(2);
  });

  it('refuses statuses, fields and roles that do not exist, and fields a person cannot fill in', async () => {
    const bad = await rules({ blocked: [['received', 'lost']], required: { held: ['ref'] }, who: { held: { roles: ['nobody'] } } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['blocked', 'required', 'who']);
    expect((await rules({ who: { held: { permission: 'not a permission' } } })).status).toBe(400);
    expect((await rules({ required: { held: ['status'] } })).status).toBe(400);
  });

  it('cannot change a type whose status only the application sets', async () => {
    const change = t.core.resources.registry.get('change');
    if (!change) return;
    const res = await t.api.put('/api/admin/lifecycles/change', { blocked: [['draft', 'closed']] });
    expect([res.status, res.body.error.code]).toEqual([409, 'set_by_application']);
    const detail = (await t.api.get('/api/admin/lifecycles/change')).body;
    expect(detail.managed).toBe(true);
    expect(detail.notes.length).toBeGreaterThan(0);
  });
});

describe('enforcement on every save path', () => {
  beforeAll(async () => {
    await rules({ blocked: [['received', 'delivered'], [NEW, 'delivered'], [NEW, 'archived']], required: { held: ['shelf'] } });
  });
  afterAll(async () => { await reset(); });

  it('forms and the API: a create and an update are refused with field errors', async () => {
    const created = await t.api.post('/api/test-parcels', { name: 'Lunch box', status: 'delivered' });
    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe('validation');
    expect(created.body.error.fields.status).toBe('A new parcel cannot start as "Delivered". It may start as "Received", "Sorting", "Held".');
    const p = await make();
    const moved = await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'delivered' });
    expect(moved.status).toBe(400);
    expect(moved.body.error.fields.status).toBe('Status cannot move from "Received" to "Delivered". It may move to "Sorting", "Held", "Archived".');
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'sorting' })).status).toBe(200);
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'delivered' })).status).toBe(200);
    // Other changes to a record are not moves.
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { notes: 'Collected at the counter' })).status).toBe(200);
  });

  it('required fields: on a move, when cleared while the record has the status, and custom fields too', async () => {
    const p = await make();
    const refused = await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'held' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields).toEqual({ shelf: 'Shelf is required when status is "Held".' });
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'held', shelf: 'B4' })).status).toBe(200);
    const cleared = await t.api.patch(`/api/test-parcels/${p.id}`, { shelf: null });
    expect(cleared.body.error.fields).toEqual({ shelf: 'Shelf is required when status is "Held".' });
    // Already stored: a later move back to the status needs nothing more.
    await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'sorting' });
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'held' })).status).toBe(200);
    // Created straight into the status.
    expect((await t.api.post('/api/test-parcels', { name: 'Scarf', status: 'held' })).body.error.fields).toEqual({ shelf: 'Shelf is required when status is "Held".' });

    const cf = await t.api.post('/api/admin/custom-fields', { record_type: 'test_parcel', label: 'Claim number', type: 'text' });
    expect(cf.status, JSON.stringify(cf.body)).toBe(201);
    const fields = (await t.api.get('/api/admin/lifecycles/test_parcel')).body.fields as Row[];
    expect(fields.map((f) => f.name)).toEqual(expect.arrayContaining(['notes', 'owner_id', 'shelf', 'cf_claim_number']));
    expect(fields.map((f) => f.name)).not.toEqual(expect.arrayContaining(['ref']));
    await rules({ blocked: [['received', 'delivered'], [NEW, 'delivered'], [NEW, 'archived']], required: { held: ['shelf', 'cf_claim_number'] } });
    const q = await make();
    expect((await t.api.patch(`/api/test-parcels/${q.id}`, { status: 'held', shelf: 'C1' })).body.error.fields).toEqual({ cf_claim_number: 'Claim number is required when status is "Held".' });
    expect((await t.api.patch(`/api/test-parcels/${q.id}`, { status: 'held', shelf: 'C1', cf_claim_number: 'LP-77' })).status).toBe(200);
    expect((await t.api.patch(`/api/test-parcels/${q.id}`, { cf_claim_number: null })).body.error.fields).toEqual({ cf_claim_number: 'Claim number is required when status is "Held".' });
    await rules({ blocked: [['received', 'delivered'], [NEW, 'delivered'], [NEW, 'archived']], required: { held: ['shelf'] } });
  });

  it('imports: each row is checked, in the dry run and for real', async () => {
    const p = await make({ name: 'Blue backpack' });
    const csv = 'Reference,Status\n' + `${p.ref},Delivered\n`;
    const body = { fileName: 'parcels.csv', content: Buffer.from(csv).toString('base64'), mapping: { Reference: 'ref', Status: 'status' }, mode: 'update', matchKey: 'ref' };
    const dry = await t.api.post('/api/import/test_parcel', { ...body, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.rows[0].errors.status).toMatch(/cannot move from "Received" to "Delivered"/);
    const run = await t.api.post('/api/import/test_parcel', body);
    expect(run.body.rows[0].errors.status).toMatch(/cannot move/);
    expect((await t.api.get(`/api/test-parcels/${p.id}`)).body.status).toBe('received');
  });

  it('bulk edit (one PATCH per record) and AI assistants (through the API) follow the same rules', async () => {
    const p = await make({ name: 'Bike helmet' });
    expect((await agent.patch(`/api/test-parcels/${p.id}`, { status: 'delivered' })).status).toBe(400);

    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
    const token = (await t.api.post('/api/mcp/tokens', { name: 'Lifecycle test', access: 'write', expiresInDays: 7 })).body.token as string;
    const client = new Client({ name: 'lifecycle-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    try {
      const res: any = await client.callTool({ name: 'update_record', arguments: { type: 'test_parcel', id: p.id, changes: { status: 'delivered' } } });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/cannot move from/);
      expect((await t.api.get(`/api/test-parcels/${p.id}`)).body.status).toBe('received');
    } finally {
      await client.close();
    }
  });

  it('system work (seeding, automation) is not checked', async () => {
    const p = await make();
    const row = await t.ctx.resources.update('test_parcel', p.id, { status: 'delivered' });
    expect(row.status).toBe('delivered');
  });
});

describe('who may move a record to a status', () => {
  afterAll(async () => { await reset(); });
  it('limits a status to a role or a permission, and tells the web app which statuses each person may not set', async () => {
    await rules({ who: { held: { permission: null, roles: ['administrator'] }, archived: { permission: 'tickets.administer', roles: [] } } });
    const p = await make();
    const refused = await agent.patch(`/api/test-parcels/${p.id}`, { status: 'held' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.status).toBe('You may not set status to "Held". Only the role Administrator may do this.');
    expect((await agent.patch(`/api/test-parcels/${p.id}`, { status: 'sorting' })).status).toBe(200);
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'held' })).status).toBe(200);
    expect((await agent.get('/api/meta')).body.resources.test_parcel.lifecycle.denied).toEqual(['held']); // agents hold tickets.*
    expect((await t.api.get('/api/meta')).body.resources.test_parcel.lifecycle.denied).toEqual([]);
  });
});

describe('the data rules can only restrict', () => {
  afterAll(async () => { await reset(); });
  it("never allow a move the module's own rule refuses, with the defaults or with rules that allow it", async () => {
    const p = await make();
    // Defaults: everything allowed by the data, still refused by the module.
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'archived' })).body.error.fields.status).toBe('Only a delivered parcel can be archived.');
    // Rules that say nothing about the move: still refused by the module.
    await rules({ blocked: [['sorting', 'held']] });
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'archived' })).body.error.fields.status).toBe('Only a delivered parcel can be archived.');
    // And the data adds its own refusal on top of the module's.
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'sorting' })).status).toBe(200);
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'held' })).body.error.fields.status).toMatch(/cannot move from "Sorting" to "Held"/);
  });
});

describe('the status list changes', () => {
  afterAll(async () => { await reset(); });
  it('a status added later is reachable and marked as new; a retired one breaks no record', async () => {
    await rules({ blocked: [['received', 'archived']] });
    const added = await t.api.post('/api/lookups', { list_key: 'test_parcel_status', value: 'returned', label: 'Returned to owner', sort: 60 });
    expect(added.status).toBe(201);
    const detail = (await t.api.get('/api/admin/lifecycles/test_parcel')).body;
    expect(detail.newStatuses).toEqual(['returned']);
    expect((await t.api.get('/api/admin/lifecycles')).body.types.find((x: Row) => x.type === 'test_parcel').newStatuses).toBe(1);
    const p = await make();
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'returned' })).status).toBe(200);
    expect((await t.api.patch(`/api/test-parcels/${p.id}`, { status: 'received' })).status).toBe(200);

    // Retire "Sorting" while a parcel has it, with a rule naming it.
    await rules({ blocked: [['sorting', 'held']], required: { sorting: ['shelf'] } });
    const q = await make();
    await t.api.patch(`/api/test-parcels/${q.id}`, { status: 'sorting', shelf: 'A1' });
    const sorting = await t.db.one<{ id: string }>(`select id from lookups where list_key = 'test_parcel_status' and value = 'sorting'`);
    expect((await t.api.del(`/api/lookups/${sorting!.id}`)).status).toBe(200);
    expect((await t.api.patch(`/api/test-parcels/${q.id}`, { notes: 'Still on the shelf', shelf: null })).status).toBe(200);
    expect((await t.api.patch(`/api/test-parcels/${q.id}`, { status: 'held' })).status).toBe(200);
    const after = (await t.api.get('/api/admin/lifecycles/test_parcel')).body;
    expect(after.rules).toEqual({ blocked: [], required: {}, who: {}, approvals: [] }); // rules naming it are no longer shown or used
    await t.api.patch(`/api/lookups/${sorting!.id}`, { active: true });
  });
});

describe('upgrading an existing database', () => {
  it('adds the table, keeps every record, and changes nothing about what may be saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grc-lifecycle-'));
    try {
      const first = await buildApp({ dataDir: dir, serveWeb: false, extraModules: [parcels] });
      await first.ctx.resources.create('test_parcel', { name: 'Gloves', status: 'held' });
      await first.ctx.resources.create('test_parcel', { name: 'Keys', status: 'delivered' });
      // As before E14-31: no table, migration 015 not applied.
      await first.db.exec(`drop table lifecycle_rules; delete from schema_migrations where name in ('core/015_lifecycle_rules.sql', 'core/018_lifecycle_approvals.sql')`);
      await first.close();

      const second = await buildApp({ dataDir: dir, serveWeb: false, extraModules: [parcels] });
      try {
        expect((await second.db.one<{ c: number }>('select count(*)::int c from lifecycle_rules'))!.c).toBe(0);
        expect((await second.db.one<{ c: number }>('select count(*)::int c from test_parcels'))!.c).toBe(2);
        const setup = await second.app.inject({ method: 'POST', url: '/api/setup', headers: { 'x-grc-csrf': '1' }, payload: ADMIN });
        const cookie = setup.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
        const headers = { cookie: `${SESSION_COOKIE}=${cookie}`, 'x-grc-csrf': '1' };
        const rows = (await second.app.inject({ method: 'GET', url: '/api/test-parcels', headers })).json().rows as Row[];
        for (const r of rows) {
          for (const to of ['received', 'archived', 'sorting']) {
            const res = await second.app.inject({ method: 'PATCH', url: `/api/test-parcels/${r.id}`, headers, payload: { status: to } });
            // Only the module's own rule (archived needs delivered) refuses anything.
            expect(res.statusCode, `${r.name} -> ${to}: ${res.body}`).toBe(to === 'archived' && r.status !== 'delivered' ? 400 : 200);
            if (res.statusCode === 200) r.status = to;
          }
        }
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
