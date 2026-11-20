import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E13-21: assets are imported with the generic import (core/import). The asset rules are the asset
// type's hooks (unique tag, funder percentage, the disposal gate), so the check reports them, and
// it does so by really writing each row in a transaction that is rolled back (E13-22).
// Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
const file = (text: string) => ({ fileName: 'assets.csv', content: Buffer.from(text).toString('base64') });

beforeAll(async () => {
  t = await testApp();
  await t.api.post('/api/assets', { name: 'Depot router', tag: 'AST-EXIST', serial: 'SER-EXISTING' });
});
afterAll(async () => { await t.close(); });

describe('asset import on the generic import', () => {
  const csv = [
    'Tag,Name,Serial number,Status,Funder interest (%),Disposal approved by,Disposal approved on',
    'NEW-1,Farebox tester,SER-1,In stock,,,',
    'NEW-2,Platform display,SER-2,Disposed,,,',
    'NEW-3,Radio spare,SER-3,In stock,140,,',
    'NEW-4,Old validator,SER-4,Disposed,,Pat Example,2026-01-05',
  ].join('\n');
  const mapping = {
    Tag: 'tag', Name: 'name', 'Serial number': 'serial', Status: 'status', 'Funder interest (%)': 'funder_interest_pct',
    'Disposal approved by': 'disposal_approved_by', 'Disposal approved on': 'disposal_approved_on',
  };

  it('the check refuses what the asset rules refuse, and keeps nothing', async () => {
    const before = (await t.api.get('/api/assets')).body.total;
    const dry = await t.api.post('/api/import/asset', { ...file(csv), mapping, mode: 'create', matchKey: 'tag' });
    expect(dry.status).toBe(200);
    expect(dry.body.rows.map((r: { action: string }) => r.action)).toEqual(['create', 'error', 'error', 'create']);
    expect(Object.keys(dry.body.rows[1].errors).sort()).toEqual(['disposal_approved_by', 'disposal_approved_on']);
    expect(dry.body.rows[2].errors.funder_interest_pct).toMatch(/between 0 and 100/);
    expect((await t.api.get('/api/assets')).body.total).toBe(before);

    const real = await t.api.post('/api/import/asset', { ...file(csv), mapping, mode: 'create', matchKey: 'tag', dryRun: false });
    expect(real.body).toMatchObject({ created: 2, errors: 2 });
    expect((await t.api.get('/api/assets?q=Old validator')).body.rows[0]).toMatchObject({ status: 'disposed', tag: 'NEW-4' });
  });

  it('a tag already in use (any capitals) is refused by the asset rule in the check, as by hand', async () => {
    const text = 'Tag,Name\nast-exist,Second router\n';
    const dry = await t.api.post('/api/import/asset', { ...file(text), mapping: { Tag: 'tag', Name: 'name' }, mode: 'create' });
    expect(dry.body.rows[0]).toMatchObject({ action: 'error', errors: { tag: 'Tag ast-exist is already in use.' } });
  });

  it('updates existing assets found by serial number', async () => {
    const text = 'Serial number,Location\nser-existing,Rack 4\n';
    const res = await t.api.post('/api/import/asset', {
      ...file(text), mapping: { 'Serial number': 'serial', Location: 'location' }, mode: 'update', matchKey: 'serial', dryRun: false,
    });
    expect(res.body).toMatchObject({ updated: 1, errors: 0 });
    expect((await t.api.get('/api/assets?q=Depot router')).body.rows[0].location).toBe('Rack 4');
  });

  it('keeps the old asset import route working, marked as deprecated', async () => {
    const res = await t.api.post('/api/assets/import', { csv: 'Name\nSpare handset\n', mapping: { name: 'Name' } });
    expect(res.status).toBe(200);
    expect(res.body.wouldCreate).toBe(1);
  });
});
