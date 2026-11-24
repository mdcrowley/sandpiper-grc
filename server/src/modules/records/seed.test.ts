import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { SAMPLE_MATTER, seedHolds } from '../holds/seed.ts';
import { seedRecords } from './seed.ts';

// Sample data (E34-08): invented, labeled "[Sample]", dev profile only, and idempotent.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

const opts = (profile: 'dev' | 'pilot') => ({ profile, seedDir: 'none', organization: {} });

describe('sample requests, assessments and hold', () => {
  it('loads nothing for the pilot profile', async () => {
    expect(await seedRecords(t.ctx, opts('pilot'))).toMatch(/nothing/);
    expect(await seedHolds(t.ctx, opts('pilot'))).toMatch(/nothing/);
  });

  it('loads six requests, three assessments, personal categories and one hold, once', async () => {
    await seedHolds(t.ctx, opts('dev'));
    await seedRecords(t.ctx, opts('dev'));
    await seedRecords(t.ctx, opts('dev'));
    await seedHolds(t.ctx, opts('dev'));
    const n = async (sql: string) => (await t.db.one<{ n: number }>(sql))!.n;
    expect(await n(`select count(*)::int n from records_requests where subject like '[Sample] %'`)).toBe(6);
    expect(await n(`select count(*)::int n from records_requests where kind like 'personal_%'`)).toBe(3);
    expect(await n(`select count(*)::int n from records_requests where extended_due_on is not null`)).toBe(1);
    expect(await n(`select count(*)::int n from records_request_items where exemption is not null`)).toBe(1);
    expect(await n(`select count(*)::int n from privacy_assessments where title like '[Sample] %'`)).toBe(3);
    expect(await n(`select count(*)::int n from data_categories where personal_data`)).toBeGreaterThanOrEqual(5);
    expect(await n(`select count(*)::int n from legal_holds where matter = '${SAMPLE_MATTER}'`)).toBe(1);
    expect(await n(`select count(*)::int n from legal_hold_queries`)).toBe(1);
    const clocks = (await t.api.get('/api/records/clocks')).body;
    expect(clocks.some((c: any) => c.state === 'red')).toBe(true);
    const cov = (await t.api.get('/api/privacy/coverage')).body;
    expect(cov.total).toBeGreaterThanOrEqual(4);
    expect(cov.without_current).toBeGreaterThanOrEqual(1);
  });
});
