import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { featureState } from '../../core/features.ts';
import { testApp } from '../../test/helpers.ts';
import { seedCivilRights } from './seed.ts';

// Sample data: invented, labeled "[Sample]", dev profile only, and idempotent.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await t.db.query('update sessions set confirmed_at = now()');
  expect((await t.api.patch('/api/admin/features', { features: { civilrights: true } })).status).toBe(200);
}, 60_000);
afterAll(async () => { await t?.close(); });

const opts = (profile: 'dev' | 'pilot') => ({ profile, seedDir: 'none', organization: {} });

describe('sample civil rights data', () => {
  it('loads nothing for the pilot profile', async () => {
    expect(await seedCivilRights(t.ctx, opts('pilot'))).toMatch(/nothing/);
    expect((await t.db.one<{ n: number }>('select count(*)::int n from civil_rights_programs'))!.n).toBe(0);
  });

  it('loads programs, complaints and a goal, once', async () => {
    await featureState(t.ctx.db); // as the seed command reads the switches first
    await t.api.get('/api/auth/state'); // and the fields of the area that was just switched on are back
    expect(await seedCivilRights(t.ctx, opts('dev'))).toMatch(/sample/);
    await seedCivilRights(t.ctx, opts('dev'));
    const n = async (sql: string) => (await t.db.one<{ n: number }>(sql))!.n;
    expect(await n(`select count(*)::int n from civil_rights_programs where name like '[Sample] %'`)).toBe(4);
    expect(await n(`select count(*)::int n from civil_rights_complaints where subject like '[Sample] %'`)).toBe(4);
    expect(await n(`select count(*)::int n from civil_rights_goals where title like '[Sample] %'`)).toBe(1);
    expect(await n(`select count(*)::int n from civil_rights_program_items where kind = 'element'`)).toBeGreaterThanOrEqual(8);
    const summary = (await t.api.get('/api/civil-rights/summary')).body;
    expect(summary.complaints.open).toBe(3);
    expect(summary.complaints.overdue).toBeGreaterThanOrEqual(1);
    expect(summary.programs.reports_overdue).toBeGreaterThanOrEqual(1);
    expect(summary.goal.attainment_pct).toBeGreaterThan(0);
    // The administrator is a named handler, so the sample complaints can be opened.
    expect((await t.api.get('/api/civil-rights/complaints')).body.total).toBe(4);
  });
});
