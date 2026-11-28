import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { seedAudits } from './seed.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  process.env.GRC_MODULES = 'audits,inventory,workflows,notifications';
  t = await testApp();
});
afterAll(async () => { delete process.env.GRC_MODULES; await t.close(); });

const counts = async () => (await t.db.one<any>(
  `select (select count(*)::int from audit_areas where deleted_at is null) as areas,
          (select count(*)::int from checklist_templates where deleted_at is null) as templates,
          (select count(*)::int from audits where deleted_at is null) as audits,
          (select count(*)::int from audit_requests where deleted_at is null) as requests,
          (select count(*)::int from inspection_schedules where deleted_at is null) as schedules,
          (select count(*)::int from inspections where deleted_at is null) as inspections,
          (select count(*)::int from inspections where result = 'fail') as failed,
          (select count(*)::int from inspections where status = 'missed') as missed,
          (select count(*)::int from audit_findings where deleted_at is null) as findings`))!;

describe('sample data', () => {
  it('loads the invented sample set in the dev profile only, once', async () => {
    expect(await seedAudits(t.ctx, { profile: 'pilot', seedDir: 'unused' })).toMatch(/dev profile only/);
    const note = await seedAudits(t.ctx, { profile: 'dev', seedDir: 'unused' });
    expect(note).toMatch(/audit areas 8, checklist templates 3, audits 3/);
    const first = await counts();
    expect(first).toMatchObject({ areas: 8, templates: 3, audits: 3, requests: 5, schedules: 5, failed: 2, missed: 1 });
    expect(first.findings).toBeGreaterThanOrEqual(7);
    expect(first.inspections).toBeGreaterThanOrEqual(30);
    expect(first.inspections).toBeLessThanOrEqual(35);
    const audits = (await t.api.get('/api/audits?pageSize=10')).body.rows;
    expect(audits.map((a: any) => a.status).sort()).toEqual(['closed', 'fieldwork', 'planned']);
    expect((await t.api.get('/api/checklist-templates')).body.rows.every((r: any) => r.name.startsWith('[Sample]'))).toBe(true);
    // The defects the failed sample inspections raised are marked as sample data too.
    const defects = await t.db.query<{ title: string }>('select title from defects where deleted_at is null');
    expect(defects.length).toBeGreaterThan(0);
    expect(defects.every((d) => d.title.startsWith('[Sample] '))).toBe(true);
    expect(await seedAudits(t.ctx, { profile: 'dev', seedDir: 'unused' })).toMatch(/already loaded/);
    expect(await counts()).toEqual(first);
  });
});
