import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { PROGRAM_TOOLS } from './tools-programs.ts';

// The summary tools for the program areas (E21-24), over the real /mcp endpoint. The committee
// figures come from the governance module itself; the wave 11 summary routes (contract C5) are
// stood in for here, so the test does not depend on those modules. Each stand-in remembers who
// asked, to show that a tool reads its route as the token's own user. Invented data only.

const asked: Record<string, string[]> = {};
const SECRET_REQUESTER = 'Invented Requester Quillon';

// Record types in each permission module, so that assistant tokens carry its view scope (as they
// do once the real module is loaded).
const STAND_TYPES: [string, string][] = [['business_process', 'continuity'], ['records_request', 'records'], ['asset_class', 'assets'], ['ot_zone', 'systems'], ['vendor', 'vendors']];

const standIns: ModuleDef = {
  key: 'mcpprogstand',
  async seedDefaults(ctx) {
    for (const [type] of STAND_TYPES) {
      await ctx.db.exec(`create table if not exists t_${type} (id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
    }
  },
  async register(ctx) {
    for (const [type, module] of STAND_TYPES) {
      ctx.defineResource({
        type, table: `t_${type}`, module, label: `Stand-in ${module}`, plural: `Stand-in ${module} records`, path: `/api/t-${type}`, route: `/t-${type}`,
        titleField: 'title', fields: { title: { label: 'Title', type: 'text', required: true } },
      });
    }
    const route = (path: string, perm: string, body: () => unknown) => {
      ctx.app.get(path, { preHandler: ctx.requirePerm(perm) }, async (req: FastifyRequest) => {
        (asked[path] ??= []).push(req.user!.id);
        return body();
      });
      ctx.describeRoute({ method: 'GET', path, summary: 'Test stand-in', permission: perm });
    };
    route('/api/continuity/summary', 'continuity.view', () => ({ processes: 10, with_gap: 2, plans: { total: 3, review_overdue: 1, unapproved: 1 }, activations: { active: 0 } }));
    route('/api/condition/summary', 'assets.view', () => ({
      classes: [{ id: 'c1', name: 'Invented 40-foot bus', total: 20, past_ulb: 5, past_ulb_pct: 25, target_pct: 20 }, { id: 'c2', name: 'Invented farebox', total: 10, past_ulb: 1, past_ulb_pct: 10, target_pct: null }],
      poor_pct: 12.5,
    }));
    route('/api/ot/summary', 'systems.view', () => ({ ot_systems: 4, zones: 5, zones_below_target: 2, conduits_with_remote_access: 2, unpatchable: 1 }));
    // A careless route that also returns a requester: the tool must not pass it on.
    route('/api/records/summary', 'records.view', () => ({
      requests: { open: 4, due_soon: 1, overdue: 1, by_kind: [{ value: 'records', label: 'Records request', count: 3 }, { value: 'access', label: 'Personal-data access', count: 1 }], oldest: { requester_name: SECRET_REQUESTER } },
      holds_active: 1,
    }));
    // No vendor lifecycle route: that module has "not landed" here.
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let base = '';
const clients: Client[] = [];
const settings = (body: unknown) => t.api.put('/api/mcp/admin/settings', body);
const setFeatures = (features: Record<string, boolean>) => t.api.patch('/api/admin/features', { features });

async function connect(token: string) {
  const c = new Client({ name: 'programs-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(c);
  return c;
}
async function tokenFor(api: { post: typeof t.api.post }, name: string) {
  const res = await api.post('/api/mcp/tokens', { name, access: 'read', expiresInDays: 7 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.token as string;
}
const names = async (c: Client) => (await c.listTools()).tools.map((x) => x.name);
const text = (r: any) => (r.content ?? []).map((c: any) => c.text).join('\n');
const PROGRAM_NAMES = PROGRAM_TOOLS.map((x) => x.name);

beforeAll(async () => {
  process.env.GRC_MODULES = 'admin,mcp,governance,notifications';
  t = await testApp({ extraModules: [standIns] });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await settings({ enabled: true });
  const committee = (await t.api.post('/api/committees', { name: 'Invented board Larkspur', kind: 'governing_body' })).body;
  await t.api.post('/api/meetings', { committee_id: committee.id, title: 'Invented meeting Larkspur', scheduled_at: new Date(Date.now() + 5 * 86_400_000).toISOString() });
}, 60_000);
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
  delete process.env.GRC_MODULES;
});

describe('program summary tools', () => {
  it('are eleven read-only tools with a description each', () => {
    expect(PROGRAM_NAMES).toEqual(['audit_summary', 'controls_summary', 'cap_summary', 'funding_summary', 'governance_summary', 'qualifications_summary',
      'continuity_summary', 'asset_condition_summary', 'ot_summary', 'records_requests_summary', 'vendor_lifecycle_summary']);
    for (const tool of PROGRAM_TOOLS) {
      expect(tool.write).toBeFalsy();
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('answers committee figures from the governance route, figures only', async () => {
    const c = await connect(await tokenFor(t.api, 'Admin assistant'));
    const r = await c.callTool({ name: 'governance_summary', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/Meetings: 1 in the next 30 days \(1 without a frozen pack\)/);
    expect((r.structuredContent as any).committees).toEqual({ active: 1, total: 1 });
    expect(JSON.stringify(r)).not.toContain('Larkspur');
  });

  it('reads each route as the token\'s own user, and passes on figures only', async () => {
    const officer = await t.as('records_privacy_officer');
    const c = await connect(await tokenFor(officer, 'Officer assistant'));
    const list = await names(c);
    expect(list).toContain('records_requests_summary');
    expect(list).toContain('ot_summary'); // systems.view
    for (const n of ['continuity_summary', 'asset_condition_summary', 'governance_summary', 'audit_summary']) expect(list).not.toContain(n);
    const r = await c.callTool({ name: 'records_requests_summary', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/Requests: 4 open, 1 due soon, 1 overdue/);
    expect(text(r)).toMatch(/Records request 3, Personal-data access 1/);
    expect((r.structuredContent as any).holds_active).toBe(1);
    expect(JSON.stringify(r)).not.toContain(SECRET_REQUESTER);
    expect(asked['/api/records/summary']).toEqual([officer.userId]);
  });

  it('gives each wave 11 area its figures', async () => {
    const c = await connect(await tokenFor(t.api, 'Admin assistant 2'));
    const call = async (name: string) => {
      const r = await c.callTool({ name, arguments: {} });
      expect(r.isError, text(r)).toBeFalsy();
      return r;
    };
    expect(text(await call('continuity_summary'))).toMatch(/Business processes: 10, 2 with a recovery gap.\nPlans: 3, 1 overdue for review, 1 not approved./);
    const cond = await call('asset_condition_summary');
    expect(text(cond)).toMatch(/1 past their target for useful life\. In poor condition: 12\.5%/);
    expect((cond.structuredContent as any).classes[0]).toMatchObject({ name: 'Invented 40-foot bus', over_target: true });
    expect((cond.structuredContent as any).classes[1].over_target).toBe(false);
    expect(text(await call('ot_summary'))).toMatch(/Zones: 5, 2 below their target level/);
  });

  it('says "not available" when the area\'s route does not answer here, and leaves out areas not installed', async () => {
    const c = await connect(await tokenFor(t.api, 'Admin assistant 3'));
    // The vendors area is here, but its lifecycle route is not (not built in this version).
    const r = await c.callTool({ name: 'vendor_lifecycle_summary', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/not available here/);
    expect((r.structuredContent as any).available).toBe(false);
    // Audits, controls, plans, funding, the roster and training are not loaded in this test.
    const offered = await names(c);
    for (const n of ['audit_summary', 'controls_summary', 'cap_summary', 'funding_summary', 'qualifications_summary']) expect(offered).not.toContain(n);
  });

  it('disappear with their switched-off area, for administrators too', async () => {
    const adminTools = async () => (await t.api.get('/api/mcp/admin')).body.tools.map((x: any) => x.name);
    const here = ['governance_summary', 'continuity_summary', 'asset_condition_summary', 'ot_summary', 'records_requests_summary', 'vendor_lifecycle_summary'];
    expect((await adminTools()).filter((n: string) => PROGRAM_NAMES.includes(n)).sort()).toEqual([...here].sort());
    const areas = { governance: false, continuity: false, condition: false, ot: false, records: false, vendors: false };
    const off = await setFeatures(areas);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect((await adminTools()).filter((n: string) => PROGRAM_NAMES.includes(n))).toEqual([]);
    const c = await connect(await tokenFor(t.api, 'Admin assistant 4'));
    expect((await names(c)).filter((n) => PROGRAM_NAMES.includes(n))).toEqual([]);
    // One area back on brings back its tool alone.
    expect((await setFeatures({ condition: true })).status).toBe(200);
    expect((await adminTools()).filter((n: string) => PROGRAM_NAMES.includes(n))).toEqual(['asset_condition_summary']);
    expect((await setFeatures(Object.fromEntries(Object.keys(areas).map((k) => [k, true])))).status).toBe(200);
    expect((await adminTools()).filter((n: string) => PROGRAM_NAMES.includes(n)).sort()).toEqual([...here].sort());
  });
});
