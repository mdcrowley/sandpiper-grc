import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
