import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { seedPolicies } from '../policies/seed.ts';
import { seedTraining } from '../training/seed.ts';
import { seedPeople } from './seed.ts';

// The invented sample roster with its qualifications and bulletins (E29-12).
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  process.env.GRC_MODULES = 'people,policies,training';
  t = await testApp();
});
afterAll(async () => { await t.close(); });

describe('sample roster', () => {
  it('is dev-only, invented, marked and idempotent', async () => {
    const dev = { profile: 'dev' as const, seedDir: 'none', organization: {} };
    expect(await seedPeople(t.ctx, { ...dev, profile: 'pilot' })).toMatch(/only in the dev profile/);
    expect(await seedPeople(t.ctx, dev)).toBe('8 sample positions, 120 sample people on the roster');
    expect(await seedPeople(t.ctx, dev)).toMatch(/already present/);
    const people = (await t.api.get('/api/people?pageSize=500')).body.rows;
    expect(people).toHaveLength(120);
    expect(people.every((p: any) => p.full_name.startsWith('[Sample] ') && /^S-\d{4}$/.test(p.employee_number))).toBe(true);
    expect(new Set(people.map((p: any) => p.full_name)).size).toBeGreaterThan(100);

    const policyNote = await seedPolicies(t.ctx, dev);
    expect(policyNote).toMatch(/2 sample roster bulletins \(\d+ roster people asked, \d+ acknowledged\)/);
    const note = await seedTraining(t.ctx, dev);
    expect(note).toMatch(/sample requirements, \d+ sample certifications/);
    const certs = (await t.db.one<any>('select count(*)::int as n from certifications'))!.n;
    expect(certs).toBeGreaterThan(150);
    expect(certs).toBeLessThan(260);
    const exp = (await t.api.get('/api/training/certifications/expiring?days=90')).body.counts;
    expect(exp.expired).toBeGreaterThan(0);
    expect(exp.within90).toBeGreaterThan(0);
    const m = (await t.api.get('/api/training/qualifications')).body.counts;
    expect(m.qualified).toBeGreaterThan(0);
    expect(m.qualified).toBeLessThan(m.people);
    expect(await seedTraining(t.ctx, dev)).toMatch(/sample qualifications already present/);
  });
});
