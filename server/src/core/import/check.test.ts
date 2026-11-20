import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { testApp } from '../../test/helpers.ts';

// E13-10: the import check (dry run) gives the same verdict as the real import, because it runs the
// record type's before-hooks and the source check too, without writing anything.

const sprockets: ModuleDef = {
  key: 'testsprockets',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_sprockets (
        id uuid primary key default gen_random_uuid(),
        name text not null, teeth numeric, source_type text, source_id uuid, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_crates (
        id uuid primary key default gen_random_uuid(), title text not null, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'crate', table: 'test_crates', module: 'tickets', label: 'Crate', plural: 'Crates',
      path: '/api/test-crates', route: '/test-crates', titleField: 'title', restricted: 'flag',
      fields: { title: { label: 'Title', type: 'text', required: true }, restricted: { label: 'Restricted', type: 'boolean' } },
    });
    ctx.defineResource({
      type: 'sprocket', table: 'test_sprockets', module: 'tickets', label: 'Sprocket', plural: 'Sprockets',
      path: '/api/test-sprockets', route: '/test-sprockets', titleField: 'name', restricted: 'flag',
      restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
      fields: {
        name: { label: 'Name', type: 'text', required: true },
        teeth: { label: 'Teeth', type: 'number' },
        source_type: { label: 'Source type', type: 'text' },
        source_id: { label: 'Source', type: 'text' },
        restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      },
      hooks: {
        // A rule only the hook knows: an odd number of teeth is refused.
        beforeCreate: async (_req, data) => {
          if (Number(data.teeth ?? 0) % 2) ctx.fail(400, 'validation', 'Check the highlighted fields.', { teeth: 'Sprockets have an even number of teeth.' });
          return data;
        },
        beforeUpdate: async (_req, existing, patch) => {
          if ('teeth' in patch && Number(patch.teeth) < Number(existing.teeth ?? 0)) {
            ctx.fail(409, 'worn', 'A sprocket never gains teeth back, so its count cannot go down by import.');
          }
          return patch;
        },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
const file = (text: string) => ({ fileName: 'sprockets.csv', content: Buffer.from(text).toString('base64') });

beforeAll(async () => { t = await testApp({ extraModules: [sprockets] }); });
afterAll(async () => { await t.close(); });

describe('the import check runs the hooks', () => {
  it('refuses on the check what a create hook refuses on the real import, and writes nothing', async () => {
    const body = { ...file('Name,Teeth\nDrive sprocket,12\nIdler sprocket,13\n'), mapping: { Name: 'name', Teeth: 'teeth' }, mode: 'create' };
    const dry = await t.api.post('/api/import/sprocket', { ...body, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ created: 1, errors: 1 });
    expect(dry.body.rows[1].errors.teeth).toBe('Sprockets have an even number of teeth.');
    expect((await t.api.get('/api/test-sprockets')).body.total).toBe(0);
    const real = await t.api.post('/api/import/sprocket', { ...body, dryRun: false });
    expect(real.body).toMatchObject({ created: dry.body.created, errors: dry.body.errors });
    expect(real.body.rows[1].errors).toEqual(dry.body.rows[1].errors);
  });

  it('refuses on the check what an update hook refuses', async () => {
    const body = { ...file('Name,Teeth\nDrive sprocket,10\n'), mapping: { Name: 'name', Teeth: 'teeth' }, mode: 'update', matchKey: 'name' };
    const dry = await t.api.post('/api/import/sprocket', { ...body, dryRun: true });
    expect(dry.body.rows[0]).toMatchObject({ action: 'error', errors: { _row: 'A sprocket never gains teeth back, so its count cannot go down by import.' } });
    const real = await t.api.post('/api/import/sprocket', { ...body, dryRun: false });
    expect(real.body.rows[0].errors).toEqual(dry.body.rows[0].errors);
    expect((await t.api.get('/api/test-sprockets?q=Drive')).body.rows[0].teeth).toBe(12);
  });

  it('refuses on the check a source record the person cannot see', async () => {
    const hidden = (await t.api.post('/api/test-crates', { title: 'Sealed crate', restricted: true })).body;
    const agent = await t.as('agent'); // tickets.*, no security.view
    const csv = `Name,Source type,Source\nSpare sprocket,crate,${hidden.id}\n`;
    const body = { ...file(csv), mapping: { Name: 'name', 'Source type': 'source_type', Source: 'source_id' }, mode: 'create' };
    const dry = await agent.post('/api/import/sprocket', { ...body, dryRun: true });
    expect(dry.body.rows[0].errors.source_id).toBe('Source was not found.');
    const real = await agent.post('/api/import/sprocket', { ...body, dryRun: false });
    expect(real.body.rows[0].errors).toEqual(dry.body.rows[0].errors);
    // The administrator sees the crate, so the same row passes the check for them.
    expect((await t.api.post('/api/import/sprocket', { ...body, dryRun: true })).body.rows[0].action).toBe('create');
  });
});
