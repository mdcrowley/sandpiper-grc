import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AREAS } from '../../core/features.ts';
import { DEFAULT_ROLES } from '../../core/services.ts';
import { testApp } from '../../test/helpers.ts';

// Feature switches, E14-34: a switched-off area is not shown anywhere except Administration >
// Features. Besides its own record types and pages: fields of other types that refer to it, values
// of shared lists that belong to it, its configurable lists, its notification kinds and
// notifications, its AI assistant tools, its background jobs and its retention category. Nothing
// is deleted: switching the area back on brings each back as it was.
let t: Awaited<ReturnType<typeof testApp>>;
const setFeatures = (features: Record<string, boolean>) => t.api.patch('/api/admin/features', { features });
const meta = async () => (await t.api.get('/api/meta')).body;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('what a switched-off area leaves behind', () => {
  it('hides the fields of other record types that refer to it, and keeps their values', async () => {
    const vendor = await t.api.post('/api/vendors', { name: 'Quillfeather Signals' });
    expect(vendor.status).toBe(201);
    const sys = await t.api.post('/api/systems', { name: 'Harborline Dispatch', vendor_id: vendor.body.id, vendor_name: 'Quillfeather', agreement_on_file: 'Signed 2024' });
    expect(sys.status).toBe(201);
    expect(Object.keys((await meta()).resources.system.fields)).toEqual(expect.arrayContaining(['vendor_id', 'contract_id', 'vendor_name', 'agreement_on_file']));

    expect((await setFeatures({ vendors: false })).status).toBe(200);
    const fields = (await meta()).resources.system.fields;
    for (const f of ['vendor_id', 'contract_id', 'vendor_name', 'agreement_on_file']) expect(fields[f], f).toBeUndefined();
    expect((await meta()).resources.asset.fields.vendor_id).toBeUndefined();
    // Saving the system while vendors are off leaves the stored values alone.
    expect((await t.api.patch(`/api/systems/${sys.body.id}`, { name: 'Harborline Dispatch 2', vendor_name: 'Changed' })).status).toBe(200);
    const stored = await t.db.one<any>('select vendor_id, vendor_name, agreement_on_file from systems where id = $1', [sys.body.id]);
    expect(stored).toEqual({ vendor_id: vendor.body.id, vendor_name: 'Quillfeather', agreement_on_file: 'Signed 2024' });
    // The relationship map has no vendors lane.
    expect((await t.api.get('/api/systems/graph')).body.nodes.some((n: any) => n.type === 'vendor')).toBe(false);

    expect((await setFeatures({ vendors: true })).status).toBe(200);
    expect((await meta()).resources.system.fields.vendor_id).toMatchObject({ type: 'ref', to: 'vendor' });
    expect((await t.api.get(`/api/systems/${sys.body.id}`)).body).toMatchObject({ vendor_id: vendor.body.id, vendor_name: 'Quillfeather' });
    expect((await t.api.get('/api/systems/graph')).body.nodes.some((n: any) => n.type === 'vendor')).toBe(true);
  });

  it('hides the values of shared lists that belong to it, and its own lists', async () => {
    const sources = async () => ((await meta()).lookups.action_source ?? []).map((v: any) => v.value);
    expect(await sources()).toEqual(expect.arrayContaining(['risk', 'project', 'safety']));
    expect((await meta()).lookups.ticket_status).toBeDefined();

    expect((await setFeatures({ portal: false, tickets: false, projects: false, safety: false })).status).toBe(200);
    const now = await sources();
    for (const v of ['problem', 'project', 'safety']) expect(now, v).not.toContain(v);
    expect(now).toEqual(expect.arrayContaining(['risk', 'other']));
    expect((await meta()).lookups.ticket_status).toBeUndefined();
    // Administration > Lists leaves them out too.
    const lists = (await t.api.get('/api/lookups')).body.map((r: any) => r.list_key);
    expect(lists).not.toContain('ticket_status');
    expect(lists).toContain('action_source');
    expect((await t.api.get('/api/lookups/ticket_status')).body).toEqual([]);
    expect((await t.api.get('/api/lookups/action_source')).body.map((v: any) => v.value)).not.toContain('project');
    // An existing action keeps its source.
    const action = await t.api.post('/api/actions', { title: 'Check the depot gate', source: 'other' });
    expect(action.status).toBe(201);

    expect((await setFeatures({ tickets: true, projects: true, safety: true })).status).toBe(200);
    expect(await sources()).toEqual(expect.arrayContaining(['problem', 'project', 'safety']));
    expect((await meta()).lookups.ticket_status).toBeDefined();
  });

  it('hides a list offered only by fields the area hides on types that stay on (asset condition rating)', async () => {
    const lists = async () => (await t.api.get('/api/lookups')).body.map((r: any) => r.list_key);
    expect(await lists()).toContain('condition_rating');
    expect((await setFeatures({ condition: false })).status).toBe(200);
    expect(await lists()).not.toContain('condition_rating');
    expect((await meta()).lookups.condition_rating).toBeUndefined();
    expect((await t.api.get('/api/lookups/condition_rating')).body).toEqual([]);
    // Lists of the inventory the area does not hide stay.
    expect(await lists()).toContain('asset_status');
    expect((await setFeatures({ condition: true })).status).toBe(200);
    expect(await lists()).toContain('condition_rating');
  });

  it('hides its notification kinds and its notifications, and keeps both', async () => {
    const me = (await t.api.get('/api/auth/state')).body.user.id;
    const vehicle = await t.ctx.resources.create('vehicle', { fleet_number: 'ORCHARD-77', mode: (await t.ctx.lookups.values('vehicle_mode'))[0].value });
    await t.app.notify({ userIds: [me], kind: 'general', title: 'Vehicle ORCHARD-77 changed', recordType: 'vehicle', recordId: vehicle.id } as any);
    await t.app.notify({ userIds: [me], kind: 'general', title: 'Something about an asset' } as any);
    const titles = async () => (await t.api.get('/api/notifications?pageSize=100')).body.rows.map((n: any) => n.title);
    const unread = async () => (await t.api.get('/api/notifications/unread-count')).body.unread;
    expect(await titles()).toContain('Vehicle ORCHARD-77 changed');
    const unreadBefore = await unread();

    // Mute the service-level kind, then switch the service desk off.
    expect((await t.api.patch('/api/notifications/preferences', { kinds: { sla: false } })).status).toBe(200);
    expect((await setFeatures({ fleet: false, tickets: false })).status).toBe(200);
    expect(await titles()).not.toContain('Vehicle ORCHARD-77 changed');
    expect(await titles()).toContain('Something about an asset');
    expect(await unread()).toBe(unreadBefore - 1);
    const kinds = (await t.api.get('/api/notifications/preferences')).body.kinds.map((k: any) => k.value);
    expect(kinds).not.toContain('sla');
    expect(kinds).toContain('assignment');
    // Saving other preferences while it is off keeps the choice for the hidden kind.
    expect((await t.api.patch('/api/notifications/preferences', { dailyDigest: true })).status).toBe(200);

    expect((await setFeatures({ fleet: true, tickets: true })).status).toBe(200);
    expect(await titles()).toContain('Vehicle ORCHARD-77 changed');
    const sla = (await t.api.get('/api/notifications/preferences')).body.kinds.find((k: any) => k.value === 'sla');
    expect(sla).toMatchObject({ enabled: false });
  });

  it('hides vehicle models with Fleet and services and keeps asset models (E39)', async () => {
    const model = await t.api.post('/api/vehicle-models', { name: 'Invented Quarrybank 8', mode: (await t.ctx.lookups.values('vehicle_mode'))[0].value });
    expect(model.status).toBe(201);
    expect((await setFeatures({ fleet: false })).status).toBe(200);
    const m = await meta();
    expect(m.resources.vehicle_model).toBeUndefined();
    expect(m.resources.asset_model.fields.model_id).toBeUndefined();
    expect(m.resources.asset.fields.model_id).toMatchObject({ type: 'ref', to: 'asset_model' });
    for (const path of ['/api/vehicle-models', `/api/vehicle-models/${model.body.id}/summary`, '/api/vehicle-models/suggestions']) {
      const res = await t.api.get(path);
      expect([res.status, res.body.error?.code], path).toEqual([404, 'switched_off']);
    }
    expect((await t.api.get('/api/records/lookup?type=vehicle_model&q=Quarrybank')).status).toBe(404);
    const tools = (await t.api.get('/api/mcp/admin')).body.tools.map((x: any) => x.name);
    expect(tools).not.toContain('vehicle_model_members');
    expect(tools).toContain('asset_model_members');
    expect((await setFeatures({ fleet: true })).status).toBe(200);
    expect((await t.api.get(`/api/vehicle-models/${model.body.id}`)).body.name).toBe('Invented Quarrybank 8');
  });

  it('leaves its AI assistant tools, background jobs and retention category out of the administration pages', async () => {
    const tools = async () => (await t.api.get('/api/mcp/admin')).body.tools.map((x: any) => x.name);
    expect(await tools()).toContain('fleet_equipment_gaps');
    const schedules = async (): Promise<string[]> => (await t.api.get('/api/admin/jobs')).body.schedules.map((s: any) => s.type as string);
    const categories = async () => (await t.api.get('/api/admin/retention')).body.categories.map((c: any) => c.value);
    expect((await schedules()).some((s) => s.startsWith('vendors.'))).toBe(true);
    expect(await categories()).toContain('contractual');

    expect((await setFeatures({ fleet: false, vendors: false })).status).toBe(200);
    expect(await tools()).not.toContain('fleet_equipment_gaps');
    expect((await t.api.get('/api/mcp/status')).body.tools.map((x: any) => x.name)).not.toContain('fleet_equipment_gaps');
    expect((await schedules()).some((s) => s.startsWith('vendors.') || s.startsWith('fleet.'))).toBe(false);
    expect(await categories()).not.toContain('contractual');

    expect((await setFeatures({ fleet: true, vendors: true })).status).toBe(200);
    expect(await tools()).toContain('fleet_equipment_gaps');
    expect((await schedules()).some((s) => s.startsWith('vendors.'))).toBe(true);
    expect(await categories()).toContain('contractual');
  });
});

// E18-64 (wave 17 interface review): set-up rows that belong to an area (`owns` in core/features.ts),
// role descriptions, risk scales and asset classes follow the switches too.
describe('roles, risk scales and asset classes of a switched-off area', () => {
  const OFF = { fleet: false, safety: false, funding: false };
  const ON = { fleet: true, safety: true, funding: true };
  const roles = async () => (await t.api.get('/api/admin/roles')).body.roles as { id: string; key: string; name: string; description: string }[];

  it('words each default description, with every area on, exactly as stored', () => {
    for (const r of DEFAULT_ROLES) if (r.describe) expect(r.describe(() => true), r.key).toBe(r.description);
    // Every area off: still a sentence, naming none of them.
    for (const r of DEFAULT_ROLES) if (r.describe) expect(r.describe(() => false), r.key).toMatch(/^[A-Z][^]*\.$/);
    // Roles an area owns are default roles.
    for (const a of AREAS) for (const k of a.owns?.role ?? []) expect(DEFAULT_ROLES.some((r) => r.key === k), k).toBe(true);
  });

  it("leaves the area's roles out and words the default descriptions for the areas that are on", async () => {
    const safety = (await roles()).find((r) => r.key === 'safety_manager')!;
    expect(safety).toBeDefined();
    expect((await roles()).find((r) => r.key === 'asset_manager')!.description).toMatch(/vehicles/);
    const person = await t.api.post('/api/admin/users', { username: 'rowan.vale', email: 'rowan.vale@example.org', displayName: 'Rowan Vale', roles: ['safety_manager', 'agent'] });
    expect(person.status).toBe(201);
    const userId = person.body.user.id;
    expect((await t.api.put('/api/mcp/admin/settings', { allowedRoles: ['agent', 'safety_manager'], roleTools: { safety_manager: ['search'] } })).status).toBe(200);

    expect((await setFeatures(OFF)).status).toBe(200);
    const now = await roles();
    expect(now.map((r) => r.key)).not.toContain('safety_manager');
    for (const r of now) expect(`${r.name}: ${r.description}`).not.toMatch(/\b(vehicles?|fleet|safety|hazards?|funding|grants?)\b/i);
    expect(now.find((r) => r.key === 'asset_manager')!.description).toBe('Assets and sites, their tags, inventory counts, condition and replacement.');
    expect(now.find((r) => r.key === 'compliance_officer')!.description).toBe('Compliance obligations, controls and committees.');
    // The role itself answers as switched off and cannot be switched; given through the API, it is kept unseen.
    expect((await t.api.get(`/api/admin/roles/${safety.id}`)).status).toBe(404);
    expect((await t.api.post(`/api/admin/roles/${safety.id}/disable`)).status).toBe(404);
    const kai = await t.api.post('/api/admin/users', { username: 'kai.moss', email: 'kai.moss@example.org', displayName: 'Kai Moss', roles: ['safety_manager'] });
    expect(kai.status).toBe(201);
    expect(kai.body.user.roles).toEqual([]);
    // A person keeps it, unseen, when their other roles change.
    expect((await t.api.get(`/api/admin/users/${userId}`)).body.roles.map((r: any) => r.key)).toEqual(['agent']);
    await t.db.query(`update roles set enabled = true where key = 'auditor'`); // a switched-off role cannot be given (E18-78)
    expect((await t.api.patch(`/api/admin/users/${userId}`, { roles: ['agent', 'auditor'] })).status).toBe(200);
    // AI assistant access: not offered, not shown, kept when saved.
    const mcp = (await t.api.get('/api/mcp/admin')).body;
    expect(mcp.roles.map((r: any) => r.key)).not.toContain('safety_manager');
    expect(mcp.settings.allowedRoles).toEqual(['agent']);
    expect(mcp.settings.roleTools).toEqual({});
    expect((await t.api.put('/api/mcp/admin/settings', { allowedRoles: ['agent', 'auditor'], roleTools: {} })).status).toBe(200);
    // Saving a role with its description as shown keeps the stored default (which names every area).
    const asset = now.find((r) => r.key === 'asset_manager')!;
    expect((await t.api.patch(`/api/admin/roles/${asset.id}`, { description: asset.description })).status).toBe(200);
    // Role pickers elsewhere (a lifecycle's "who may move it", report sharing) leave it out too.
    expect((await t.api.get('/api/admin/lifecycles/action')).body.roles.map((r: any) => r.key)).not.toContain('safety_manager');
    expect((await t.api.get('/api/reports/roles')).body.map((r: any) => r.key)).not.toContain('safety_manager');
    // The default-grants notice names no role or permission of the area.
    expect(JSON.stringify((await t.api.get('/api/admin/roles/default-grants')).body)).not.toMatch(/safety|fleet|funding/i);

    expect((await setFeatures(ON)).status).toBe(200);
    expect((await roles()).map((r) => r.key)).toContain('safety_manager');
    expect((await roles()).find((r) => r.key === 'asset_manager')!.description).toMatch(/vehicles/);
    expect((await t.api.get(`/api/admin/users/${userId}`)).body.roles.map((r: any) => r.key).sort()).toEqual(['agent', 'auditor', 'safety_manager']);
    const back = (await t.api.get('/api/mcp/admin')).body.settings;
    expect(back.allowedRoles).toEqual(['agent', 'auditor', 'safety_manager']);
    expect(back.roleTools).toEqual({ safety_manager: ['search'] });
    await t.api.put('/api/mcp/admin/settings', { allowedRoles: null, roleTools: {} });
  });

  it('does not offer the safety hazard matrix while safety is off, and keeps the risks scored on it', async () => {
    const offered = async () => (await t.api.get('/api/risks/scales')).body.filter((s: any) => s.offered).map((s: any) => s.key);
    expect(await offered()).toEqual(expect.arrayContaining(['cyber_5x5', 'hazard_4x5']));
    const before = await t.api.post('/api/risks', { title: 'Platform edge crowding', category: 'safety' });
    expect(before.body.scale_key).toBe('hazard_4x5');

    expect((await setFeatures({ safety: false })).status).toBe(200);
    expect(await offered()).toEqual(['enterprise_5x5', 'cyber_5x5']);
    expect((await t.api.get('/api/risks/summary')).body.scales.map((s: any) => s.key)).toEqual(['enterprise_5x5', 'cyber_5x5']);
    expect((await t.api.get('/api/risks/heatmap?scale=hazard_4x5')).status).toBe(404);
    expect((await t.api.get('/api/risks/appetite')).body.categories.map((c: any) => c.scale_name ?? '').join(' ')).not.toMatch(/hazard|safety/i);
    // A new risk in a category scored on it uses the default scale; the earlier one keeps its scale.
    expect((await t.api.post('/api/risks', { title: 'Wet stair treads', category: 'safety' })).body.scale_key).toBe('cyber_5x5');
    expect((await t.api.get(`/api/risks/${before.body.id}`)).body.scale_key).toBe('hazard_4x5');
    expect((await t.api.get('/api/risks/scales/hazard_4x5')).status).toBe(200);

    expect((await setFeatures({ safety: true })).status).toBe(200);
    expect(await offered()).toContain('hazard_4x5');
  });

  it('hides asset classes that rate vehicles while fleet is off', async () => {
    const bus = await t.api.post('/api/asset-classes', { name: 'Forty-foot coach', applies_to: 'vehicle', useful_life_years: 12 });
    expect(bus.status).toBe(201);
    const pump = await t.api.post('/api/asset-classes', { name: 'Sump pump', applies_to: 'asset', useful_life_years: 10 });
    expect(pump.status).toBe(201);
    const names = async () => (await t.api.get('/api/asset-classes?pageSize=200')).body.rows.map((r: any) => r.name);
    const dash = async () => (await t.api.get('/api/condition/dashboard')).body.classes.map((c: any) => c.name);
    expect(await names()).toEqual(expect.arrayContaining(['Forty-foot coach', 'Sump pump']));

    expect((await setFeatures({ fleet: false })).status).toBe(200);
    expect(await names()).not.toContain('Forty-foot coach');
    expect(await names()).toContain('Sump pump');
    expect(await dash()).not.toContain('Forty-foot coach');
    expect((await t.api.get(`/api/asset-classes/${bus.body.id}`)).status).toBe(404);

    expect((await setFeatures({ fleet: true })).status).toBe(200);
    expect(await names()).toContain('Forty-foot coach');
    expect(await dash()).toContain('Forty-foot coach');
  });
});
