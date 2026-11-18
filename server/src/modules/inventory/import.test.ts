import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { parseAmount, parseCsv, parseDate } from './importer.ts';

// Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await t.api.post('/api/sites', { name: 'Import Site' });
  await t.api.post('/api/assets', { name: 'Already here', serial: 'SER-EXISTING' });
});
afterAll(async () => { await t.close(); });

const mapping = {
  name: 'Asset Name', tag: 'Tag', serial: 'Serial No', asset_type: 'Kind', status: 'State',
  site_id: 'Where', cost: 'Price', purchase_date: 'Bought', funder_interest: 'Funder',
};
const csv = [
  'Asset Name,Tag,Serial No,Kind,State,Where,Price,Bought,Funder',
  'Import laptop A,IMP-1,SER-A,Workstation,In use,Import Site,"$1,200.50",3/15/2025,yes',
  '"Import router, spare",IMP-2,SER-B,network_device,in_stock,,400,2025-04-01,no',
  'Import copy of existing,IMP-3,ser-existing,Printer,,,,,',
  'Import repeat tag,imp-1,SER-C,Printer,,,,,',
  ',IMP-5,SER-D,Spaceship,,Moon Base,abc,31/31/2025,maybe',
  'Import camera,,SER-E,Other,,,,,',
].join('\r\n');

describe('helpers', () => {
  it('parses quoted CSV and dates', () => {
    expect(parseCsv('a,b\r\n"x, ""y""",2\n\n3,"line\nbreak"')).toEqual([['a', 'b'], ['x, "y"', '2'], ['3', 'line\nbreak']]);
    expect(parseDate('3/5/2025')).toBe('2025-03-05');
    expect(parseDate('2025-02-30')).toBeNull();
  });

  it('reads amounts in the configured currency, not only dollars (E18-20)', () => {
    // Tests run with the default currency (USD).
    expect(parseAmount('$1,200.50')).toBe(1200.5);
    expect(parseAmount('USD 400')).toBe(400);
    expect(parseAmount('400')).toBe(400);
    expect(parseAmount('£400')).toBeNull();
    expect(parseAmount('£1,200.50', 'GBP')).toBe(1200.5);
    expect(parseAmount('1 200 EUR', 'EUR')).toBe(1200);
    expect(parseAmount('$400', 'EUR')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('asset import', () => {
  it('previews without writing on a dry run', async () => {
    const before = (await t.api.get('/api/assets')).body.total;
    const res = await t.api.post('/api/assets/import', { csv, mapping, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, total: 6, valid: 5, errors: 1, duplicates: 2, wouldCreate: 3, created: 0 });
    const [a, b, existing, repeat, bad, camera] = res.body.rows;
    expect(a).toMatchObject({ line: 2, action: 'create', duplicate: null });
    expect(a.data).toMatchObject({ asset_type: 'workstation', status: 'in_use', cost: 1200.5, purchase_date: '2025-03-15', funder_interest: true });
    expect(a.data.site_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.data.name).toBe('Import router, spare');
    expect(existing).toMatchObject({ action: 'skip', duplicate: { by: 'serial', of: 'existing' } });
    expect(repeat).toMatchObject({ action: 'skip', duplicate: { by: 'tag', of: 'file', line: 2 } });
    expect(bad.action).toBe('error');
    expect(Object.keys(bad.errors).sort()).toEqual(['asset_type', 'cost', 'funder_interest', 'name', 'purchase_date', 'site_id']);
    expect(camera.action).toBe('create');
    expect((await t.api.get('/api/assets')).body.total).toBe(before);
    expect((await t.db.query(`select 1 from audit_events where action = 'asset.import'`)).length).toBe(0);
  });

  it('writes the valid rows on a real run, skips duplicates and audits', async () => {
    const before = (await t.api.get('/api/assets')).body.total;
    const res = await t.api.post('/api/assets/import', { csv, mapping, dryRun: false });
    expect(res.body).toMatchObject({ dryRun: false, total: 6, created: 3, skipped: 2, errors: 1, duplicates: 2 });
    expect((await t.api.get('/api/assets')).body.total).toBe(before + 3);
    const laptop = (await t.api.get('/api/assets?q=Import laptop A')).body.rows[0];
    expect(laptop).toMatchObject({ tag: 'IMP-1', serial: 'SER-A', funder_interest: true });
    expect(laptop._display.site_id).toBe('Import Site');
    expect((await t.api.get('/api/assets?q=Import camera')).body.rows[0].tag).toMatch(/^AST-/);
    const audit = await t.db.query<{ summary: string }>(`select summary from audit_events where action = 'asset.import'`);
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).toContain('3 created');

    // Running the same file again creates nothing.
    const again = await t.api.post('/api/assets/import', { csv, mapping, dryRun: false });
    expect(again.body).toMatchObject({ created: 0, skipped: 5, errors: 1 });
  });

  it('can update existing matches instead of skipping them', async () => {
    const res = await t.api.post('/api/assets/import', {
      csv: 'Asset Name,Serial No,Where\nAlready here,SER-EXISTING,Import Site', mapping: { name: 'Asset Name', serial: 'Serial No', site_id: 'Where' },
      dryRun: false, onDuplicate: 'update',
    });
    expect(res.body).toMatchObject({ updated: 1, created: 0 });
    expect((await t.api.get('/api/assets?q=Already here')).body.rows[0]._display.site_id).toBe('Import Site');
  });

  it('rejects a bad mapping and callers without permission', async () => {
    const res = await t.api.post('/api/assets/import', { csv, mapping: { name: 'No Such Column', bogus: 'Tag' } });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['bogus', 'name']);
    expect((await t.api.post('/api/assets/import', { csv, mapping: { tag: 'Tag' } })).body.error.fields.name).toBeTruthy();
    expect((await (await t.as('auditor')).post('/api/assets/import', { csv, mapping })).status).toBe(403);
  });
});

describe('asset ingest', () => {
  it('upserts by serial then tag', async () => {
    const first = await t.api.post('/api/assets/ingest', [
      { name: 'Ingest node 1', serial: 'ING-1', asset_type: 'Server', os: 'Linux', os_version: '6.1' },
      { name: 'Ingest node 2', tag: 'ING-TAG-2', status: 'in_use' },
      { serial: 'ING-3' },
      'not an object',
    ]);
    expect(first.body).toMatchObject({ received: 4, created: 2, updated: 0 });
    expect(first.body.errors.map((e: any) => e.index)).toEqual([2, 3]);

    const second = await t.api.post('/api/assets/ingest', { assets: [
      { serial: 'ing-1', os_version: '6.6' },
      { name: 'Ingest node 2', tag: 'ING-TAG-2', status: 'in_use' },
    ] });
    expect(second.body).toMatchObject({ created: 0, updated: 1, unchanged: 1, errors: [] });
    const node = (await t.api.get('/api/assets?q=ING-1')).body.rows[0];
    expect(node).toMatchObject({ name: 'Ingest node 1', os_version: '6.6', asset_type: 'server' });
    expect((await t.db.query(`select 1 from audit_events where action = 'asset.ingest'`)).length).toBe(2);
    expect((await t.api.post('/api/assets/ingest', { nope: true })).status).toBe(400);
  });
});
