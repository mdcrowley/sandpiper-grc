import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResourceDef } from './module.ts';
import { statsScope } from './routes.ts';
import { testApp } from '../test/helpers.ts';

// W17-1: the figures cache keeps a type's /stats answer per person when the type's row rule filters
// figures by person (saved reports, dashboards, schedules and packs), so one person's private items
// are never given to another person holding the same permissions.

describe('statsScope', () => {
  const def = (extra: Partial<ResourceDef>) => ({ type: 'x', fields: { name: { label: 'Name', type: 'text' }, report_id: { label: 'Report', type: 'ref', to: 'report_definition' }, owner: { label: 'Owner', type: 'ref', to: 'risk' } }, ...extra }) as unknown as ResourceDef;
  const personal = (t: string | undefined) => t === 'report_definition';
  it('is per person for a filtering row rule, a link to such a type and a custom field', () => {
    expect(statsScope(def({ rowRule: { where: () => 'true', figures: 'filter' } }), 'name', personal)).toBe('person');
    expect(statsScope(def({}), 'report_id', personal)).toBe('person');
    expect(statsScope(def({}), 'cf_anything', personal)).toBe('person');
    expect(statsScope(def({}), 'constructor', personal)).toBe('person');
  });
  it('is per set of permissions otherwise (a masking rule depends only on permissions)', () => {
    expect(statsScope(def({ rowRule: { where: () => 'true', figures: 'mask', hidden: () => 'false' } }), 'name', personal)).toBe('viewer');
    expect(statsScope(def({}), 'owner', personal)).toBe('viewer');
    expect(statsScope(def({}), null, personal)).toBe('viewer');
  });
});

describe('figures cache with personal items (W17-1)', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  const env = process.env.GRC_FIGURES_CACHE_SECONDS;
  beforeAll(async () => {
    process.env.GRC_FIGURES_CACHE_SECONDS = '30';
    t = await testApp();
  });
  afterAll(async () => {
    await t.close();
    if (env === undefined) delete process.env.GRC_FIGURES_CACHE_SECONDS; else process.env.GRC_FIGURES_CACHE_SECONDS = env;
  });

  it('never gives one person\'s private report to another person with the same role', async () => {
    const one = await t.as('security_lead');
    const two = await t.as('security_lead');
    const made = await one.post('/api/reports', { name: 'Private report of one (sample)', spec: { type: 'ticket' }, sharing: 'private' });
    expect(made.status).toBe(201);
    const url = '/api/reports/stats?group=name&x=1';
    const mine = await one.get(url);
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).toContain('Private report of one (sample)');
    const theirs = await two.get(url);
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(theirs.body)).not.toContain('Private report of one (sample)');
    // The first person's answer is still theirs.
    expect(JSON.stringify((await one.get(url)).body)).toContain('Private report of one (sample)');
  });
});
