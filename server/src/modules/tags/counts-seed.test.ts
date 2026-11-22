import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { seedTagSamples } from './counts-seed.ts';

// Sample data of the Asset tags area (E37-10): dev profile only, once.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  process.env.GRC_MODULES ??= 'tags,inventory,fleet,notifications,workflows';
  t = await testApp();
});
afterAll(async () => { await t.close(); });

describe('asset tag samples', () => {
  it('loads a bought range, tag values, a finished and an open count, in the dev profile only, once', async () => {
    expect(await seedTagSamples(t.ctx, { profile: 'pilot', seedDir: 'unused' })).toMatch(/dev profile only/);
    const note = await seedTagSamples(t.ctx, { profile: 'dev', seedDir: 'unused' });
    expect(note).toMatch(/bought range TA-100000 to TA-100999, tag values \d+, inventory counts 2/);
    const range = await t.db.one<any>(`select * from tag_ranges where note like '[Sample]%'`);
    expect(range).toMatchObject({ kind: 'sequence', source: 'bought', first_key: 'TA100000', last_key: 'TA100999' });
    const tagged = await t.db.one<any>(
      `select (select count(*)::int from vehicles where tag_number like 'TA-1%') as vehicles,
              (select count(*)::int from sites where tag_number like 'TA-1%') as sites,
              (select count(*)::int from assets where tag like 'TA-1%') as assets,
              (select count(*)::int from tag_assignments where status = 'active' and value_key like 'TA1%') as active`);
    expect(tagged.vehicles).toBeGreaterThan(10);
    expect(tagged.sites).toBeGreaterThan(3);
    expect(tagged.assets).toBeGreaterThan(10);
    expect(tagged.active).toBe(tagged.vehicles + tagged.sites + tagged.assets);
    const counts = (await t.api.get('/api/inventory-counts?sort=title&dir=asc')).body.rows;
    expect(counts.map((c: any) => c.status).sort()).toEqual(['finished', 'open']);
    const finished = counts.find((c: any) => c.status === 'finished');
    expect(finished.summary.missing).toBe(3);
    expect(finished.summary.unexpected).toBe(1);
    const report = (await t.api.get('/api/inventory-counts/report?days=90')).body;
    expect(report.sites.find((s: any) => s.siteLabel === 'Example Depot North').verified).toBeGreaterThan(10);
    expect(await seedTagSamples(t.ctx, { profile: 'dev', seedDir: 'unused' })).toMatch(/already loaded/);
  });
});
