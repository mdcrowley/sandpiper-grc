// ci: every module (tools/ci/plan.mjs runs this for a change to any server module)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { testApp } from '../../test/helpers.ts';
import { looseShape, shape } from './shape.ts';
import { validateOpenApi } from './validate.ts';
import { versioned } from './versioning.ts';

// Every /api route registered by core and by every loaded module is in the OpenAPI document with a
// description (E13-09): run with every module loaded (the default) and with GRC_MODULES.
// A new route fails this test until it is described, with ctx.describeRoute beside it or in the
// central tables of core/api/docs.

/**
 * Routes deliberately left without a description, as "METHOD /api/path" (OpenAPI form, unversioned).
 * Keep it empty: add a route here only with a reason beside it.
 */
const INTENTIONALLY_UNDOCUMENTED: string[] = [];

let t: Awaited<ReturnType<typeof testApp>>;
// A record type of its own, so the schema checks run whatever modules are loaded.
const probe: ModuleDef = {
  key: 'testprobe',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_probes (
      id uuid primary key default gen_random_uuid(), name text not null, status text, owner_id uuid,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('probe_status', [{ value: 'open', label: 'Open' }], { module: 'tickets' });
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'test_probe', table: 'test_probes', module: 'tickets', label: 'Probe', plural: 'Probes',
      path: '/api/test-probes', route: '/test-probes', titleField: 'name',
      fields: {
        name: { label: 'Name', type: 'text', required: true },
        status: { label: 'Status', type: 'lookup', list: 'probe_status' },
        owner_id: { label: 'Owner', type: 'user' },
      },
    });
  },
};

beforeAll(async () => {
  t = await testApp({ extraModules: [probe] });
  // Every optional part on, the portal and the mobile app included (off by default), so every route is described (E14-34).
  await t.api.patch('/api/admin/features', { features: { portal: true, mobile: true, civilrights: true } });
});
afterAll(async () => { await t.close(); });

describe('API coverage', () => {
  it('describes every registered route, and the whole document passes the structure check', async () => {
    const whole: any = await t.core.openapi.build(null);
    const undocumented = Object.entries<any>(whole.paths).flatMap(([p, ops]) =>
      Object.entries<any>(ops).filter(([, op]) => op['x-undocumented']).map(([m]) => `${m.toUpperCase()} ${p}`));
    expect(undocumented.filter((r) => !INTENTIONALLY_UNDOCUMENTED.includes(r))).toEqual([]);
    expect(validateOpenApi(whole, { allowUndocumented: INTENTIONALLY_UNDOCUMENTED })).toEqual([]);

    // Every registered route is in it.
    const missing = t.core.openapi.routes().filter((r) => {
      const path = r.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\*/g, '{path}');
      return !whole.paths[path]?.[r.method.toLowerCase()];
    });
    expect(missing).toEqual([]);
  });

  it('gives every operation a summary, a tag, an operation id and its error answers', async () => {
    const whole: any = await t.core.openapi.build(null, { version: 'v1' });
    for (const [path, ops] of Object.entries<any>(whole.paths)) {
      expect(path.startsWith('/api/v1/')).toBe(true);
      for (const [method, op] of Object.entries<any>(ops)) {
        const where = `${method.toUpperCase()} ${path}`;
        expect([where, typeof op.summary === 'string' && op.summary !== where]).toEqual([where, true]);
        expect([where, op.tags?.length]).toEqual([where, 1]);
        if (op.security?.length !== 0) expect([where, Boolean(op.responses[401] && op.responses[403])]).toEqual([where, true]);
        const ok = Object.keys(op.responses).find((c) => /^2/.test(c) || c === 'default');
        expect([where, Boolean(ok)]).toEqual([where, true]);
      }
    }
    expect(validateOpenApi(whole)).toEqual([]);
  });

  it('covers the MCP module\'s /api/mcp routes; its /mcp endpoint is outside the REST API and the document', async () => {
    const mcp = t.core.openapi.routes().filter((r) => r.url.startsWith('/api/mcp/'));
    if (!t.modules.some((m) => m.key === 'mcp')) return; // module not loaded
    expect(mcp.length).toBeGreaterThan(0);
    expect(mcp.filter((r) => !t.core.openapi.described(r.method, r.url))).toEqual([]);
    const whole: any = await t.core.openapi.build(null);
    expect(Object.keys(whole.paths).some((p) => p === '/mcp' || p.startsWith('/mcp/'))).toBe(false);
  });

  it('serves /api/v1 through the same routes, with no second copy of any (wave 9: canonical-paths.test.ts walks them)', () => {
    const copies = t.core.openapi.routes().filter((r) => t.app.hasRoute({ method: r.method as 'GET', url: versioned(r.url) }));
    expect(copies).toEqual([]);
  });

  it('describes record rows, list envelopes, stats, errors and exports as schemas', async () => {
    const doc: any = await t.core.openapi.build(null, { version: 'v1' });
    const d = t.ctx.resources.get('test_probe')!;
    const name = 'TestProbe';
    const row = doc.components.schemas[name];
    expect(row.properties).toHaveProperty('_display');
    expect(row.properties).toHaveProperty('_tags');
    expect(row.properties.id.format).toBe('uuid');
    expect(doc.components.schemas[`${name}Page`].properties.rows.items.$ref).toBe(`#/components/schemas/${name}`);
    expect(doc.components.schemas.Stats.properties.groups.type).toBe('array');
    expect(doc.components.schemas.Error.required).toEqual(['error']);
    const list = doc.paths[versioned(d.path)].get;
    expect(Object.keys(list.responses[200].content)).toEqual(expect.arrayContaining(['application/json', 'text/csv', 'application/pdf']));
    expect(list.responses[200].headers).toHaveProperty('Link');
    expect(doc.paths[`${versioned(d.path)}/{id}`].patch.parameters.some((p: any) => p.$ref === '#/components/parameters/IfMatch')).toBe(true);
    expect(doc.paths[versioned(d.path)].post.parameters.some((p: any) => p.$ref === '#/components/parameters/IdempotencyKey')).toBe(true);
  });

  it('lists custom fields in the record schema', async () => {
    const made = await t.api.post('/api/admin/custom-fields', { record_type: 'test_probe', label: 'Depot code', type: 'text' });
    expect(made.status).toBe(201);
    const doc: any = await t.core.openapi.build(null);
    const name = 'TestProbe';
    expect(doc.components.schemas[name].properties.cf_depot_code).toMatchObject({ 'x-custom': true, title: 'Depot code' });
    expect(doc.components.schemas[`${name}Input`].properties).toHaveProperty('cf_depot_code');
  });
});

describe('shape notation', () => {
  it('reads objects, arrays, unions, fixed values, records and descriptions', () => {
    expect(shape('{ id: uuid, n?: integer, tags: [string] }')).toEqual({
      type: 'object', required: ['id', 'tags'],
      properties: { id: { type: 'string', format: 'uuid' }, n: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
    });
    expect(shape("'open' | 'done' | null")).toEqual({ type: ['string', 'null'], enum: ['open', 'done', null] });
    expect(shape('date | null')).toEqual({ type: ['string', 'null'], format: 'date' });
    expect(shape('{ [key]: integer, ... }')).toMatchObject({ additionalProperties: true });
    expect(shape('{ [key]: integer }')).toMatchObject({ additionalProperties: { type: 'integer' } });
    expect(shape('@ticket')).toEqual({ 'x-resource': 'ticket' });
    expect(shape('{ count: integer "Open items only" }').properties).toEqual({ count: { type: 'integer', description: 'Open items only' } });
    expect(shape('{ a: string } | [string]')).toMatchObject({ anyOf: [{ type: 'object' }, { type: 'array' }] });
  });

  it('refuses what it does not understand; the loose form reads older free text or gives up', () => {
    expect(() => shape('{ a: strng }')).toThrow(/Unknown type "strng"/);
    expect(() => shape('{ a: string')).toThrow();
    expect(looseShape('{ ok, minutes }')).toMatchObject({ type: 'object', required: ['ok', 'minutes'] });
    expect(looseShape('{ status: pending | done }')!.properties).toEqual({ status: { type: 'string', enum: ['pending', 'done'] } });
    expect(looseShape('{ a }. With more words')).toBeNull();
    expect(looseShape('Plain words')).toBeNull();
  });
});
