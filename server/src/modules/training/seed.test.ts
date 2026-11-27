import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { seedTraining } from './seed.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const counts = async () => (await t.db.one<any>(
  `select (select count(*)::int from courses where deleted_at is null) as courses,
          (select count(*)::int from training_assignments where deleted_at is null) as rules,
          (select count(*)::int from training_records where deleted_at is null and source <> 'rule') as records,
          (select count(*)::int from exercises where deleted_at is null) as exercises,
          (select count(*)::int from exercise_findings where deleted_at is null) as findings,
          (select count(*)::int from exercise_participants where deleted_at is null) as participants`))!;

describe('sample data', () => {
  it('adds nothing in the pilot profile (E18-69)', async () => {
    expect(await seedTraining(t.ctx, { profile: 'pilot', seedDir: 'unused' })).toMatch(/dev profile only/);
    expect(await counts()).toEqual({ courses: 0, rules: 0, records: 0, exercises: 0, findings: 0, participants: 0 });
  });

  it('adds invented, marked sample data in the dev profile and is idempotent', async () => {
    const opts = { profile: 'dev' as const, seedDir: 'unused' };
    const note = await seedTraining(t.ctx, opts);
    expect(note).toMatch(/6 sample courses, .* 40 records; 4 sample exercises, 7 findings/);
    const first = await counts();
    expect(first).toMatchObject({ courses: 6, records: 40, exercises: 4, findings: 7, participants: 15 });
    expect(first.rules).toBeGreaterThanOrEqual(3);

    const courses = (await t.api.get('/api/courses')).body.rows;
    const exercises = (await t.api.get('/api/exercises')).body.rows;
    expect([...courses, ...exercises].every((r: any) => r.title.startsWith('[Sample]'))).toBe(true);
    expect(exercises.map((e: any) => e.type).sort()).toEqual(['continuity_test', 'restore_test', 'restore_test', 'tabletop']);

    // A realistic spread: most completed, some to do, some overdue; the administrator is picked up by the "everyone" rules.
    const s = (await t.api.get('/api/training/summary')).body;
    expect(s.totals.overdue).toBe(7);
    expect(s.totals.complete).toBe(27);
    expect(s.totals.due).toBeGreaterThanOrEqual(6);
    expect((await t.api.get('/api/training/mine')).body.rows.length).toBe(3);
    expect((await t.api.get('/api/exercises/calendar')).body.overdue.length).toBe(1);

    expect(await seedTraining(t.ctx, opts)).toMatch(/already present.*already present/);
    expect(await counts()).toEqual(first);
  });
});
