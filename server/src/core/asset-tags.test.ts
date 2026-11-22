import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { allTaggables, defineTaggable, taggable, taggables } from './asset-tags.ts';

// The taggable registry (wave 13, E37-01): record types that can carry an asset tag value.

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

// A request afterwards refreshes the cached switch state the registry reads outside a request.
const setFeatures = async (features: Record<string, boolean>) => {
  const res = await t.api.patch('/api/admin/features', { features });
  await t.api.get('/api/auth/state');
  return res;
};

describe('taggable registry', () => {
  it('holds assets, sites, systems and vehicles, registered by their modules', () => {
    expect(taggables(t.app, t.ctx.resources).map((d) => d.type)).toEqual(['asset', 'site', 'system', 'vehicle']);
    expect(taggable(t.app, t.ctx.resources, 'asset')).toMatchObject({ field: 'tag', siteField: 'site_id' });
    expect(taggable(t.app, t.ctx.resources, 'vehicle')).toMatchObject({ field: 'tag_number', siteField: 'depot_id' });
    expect(taggable(t.app, t.ctx.resources, 'vehicle')!.identifiers.map((i) => i.field)).toContain('fleet_number');
    expect(taggable(t.app, t.ctx.resources, 'ticket')).toBeUndefined();
  });

  it('names fields every type really has', () => {
    for (const d of allTaggables(t.app)) {
      const fields = t.ctx.resources.get(d.type)!.fields;
      for (const f of [d.field, ...d.identifiers.map((i) => i.field), ...(d.facts ?? []), ...(d.quickFields ?? []), ...(d.peopleFields ?? [])]) {
        expect(fields[f], `${d.type}.${f}`).toBeDefined();
      }
      if (d.siteField && d.siteField !== 'id') expect(fields[d.siteField], `${d.type}.${d.siteField}`).toMatchObject({ type: 'ref', to: 'site' });
    }
  });

  it('leaves out a type whose area is switched off', async () => {
    expect((await setFeatures({ fleet: false })).status).toBe(200);
    expect(taggables(t.app, t.ctx.resources).map((d) => d.type)).toEqual(['asset', 'site', 'system']);
    expect(taggable(t.app, t.ctx.resources, 'vehicle')).toBeUndefined();
    expect(allTaggables(t.app).map((d) => d.type)).toContain('vehicle');
    expect((await setFeatures({ fleet: true })).status).toBe(200);
    expect(taggable(t.app, t.ctx.resources, 'vehicle')).toBeDefined();
  });

  it('refuses a duplicate or malformed definition at start-up', () => {
    expect(() => defineTaggable(t.app, { type: 'asset', field: 'tag', identifiers: [], siteField: null })).toThrow(/twice/);
    expect(() => defineTaggable(t.app, { type: 'Bad Type', field: 'tag', identifiers: [], siteField: null })).toThrow(/record type key/);
    expect(() => defineTaggable(t.app, { type: 'gizmo', field: 'tag;drop', identifiers: [], siteField: null })).toThrow(/malformed/);
  });
});

describe('tag number fields', () => {
  it('vehicles, sites and systems carry a Tag number, hidden while asset tags are off; the asset tag stays', async () => {
    const meta = async () => (await t.api.get('/api/meta')).body.resources;
    for (const type of ['vehicle', 'site', 'system']) expect((await meta())[type].fields.tag_number, type).toMatchObject({ label: 'Tag number' });
    expect((await setFeatures({ tags: false })).status).toBe(200);
    for (const type of ['vehicle', 'site', 'system']) expect((await meta())[type].fields.tag_number, type).toBeUndefined();
    expect((await meta()).asset.fields.tag).toBeDefined();
    expect((await setFeatures({ tags: true })).status).toBe(200);
  });

  it('the tables exist: assignments are unique by value key while active', async () => {
    const rec = '00000000-0000-4000-8000-000000000001';
    await t.db.query(`insert into tag_assignments (value, value_key, record_type, record_id) values ('TA-1', 'TA1', 'asset', $1)`, [rec]);
    await expect(t.db.query(`insert into tag_assignments (value, value_key, record_type, record_id) values ('ta 1', 'TA1', 'site', $1)`, [rec])).rejects.toThrow();
    await t.db.query(`update tag_assignments set status = 'replaced' where value_key = 'TA1'`);
    await t.db.query(`insert into tag_assignments (value, value_key, record_type, record_id) values ('ta 1', 'TA1', 'site', $1)`, [rec]);
    await t.db.query(`delete from tag_assignments where value_key = 'TA1'`);
  });
});

describe('permissions and roles', () => {
  it('tags.manage and tags.count are grantable only on the tags module', async () => {
    const roles = (await t.api.get('/api/admin/roles')).body;
    expect(roles.modules).toContain('tags');
    expect(roles.moduleActions).toEqual({ tags: ['manage', 'count'] });
    expect((await t.api.post('/api/admin/roles', { name: 'Tag clerk', grants: ['tags.view', 'tags.count'] })).status).toBe(201);
    expect((await t.api.post('/api/admin/roles', { name: 'Odd clerk', grants: ['assets.count'] })).body.error.fields.grants).toMatch(/Unknown/);
  });

  it('asset managers hold every tags permission; agents may view and count', async () => {
    const roles = (await t.api.get('/api/admin/roles')).body.roles as { key: string; grants: string[] }[];
    expect(roles.find((r) => r.key === 'asset_manager')!.grants).toContain('tags.*');
    expect(roles.find((r) => r.key === 'agent')!.grants).toEqual(expect.arrayContaining(['tags.view', 'tags.count']));
  });
});
