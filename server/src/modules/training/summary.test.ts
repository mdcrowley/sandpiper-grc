import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, addMonths, localDate, monthEnd } from './dates.ts';

// A fixed, invented data set: two active courses, one retired, five people.
let t: Awaited<ReturnType<typeof testApp>>;
const today = localDate();
const ids: Record<string, string> = {};

const P = {
  one: { name: 'Person One', email: 'one@example.test', department: 'Finance' },
  two: { name: 'Person Two', email: 'two@example.test', department: 'Finance' },
  three: { name: 'Person Three', email: 'three@example.test', department: 'Operations' },
  four: { name: 'Person Four', email: 'four@example.test', department: 'Operations' },
  five: { name: 'Person Five', email: 'five@example.test' },
};

beforeAll(async () => {
  t = await testApp();
  for (const [key, title] of [['a', 'Course A'], ['b', 'Course B'], ['old', 'Old course']]) {
    ids[key] = (await t.api.post('/api/courses', { title })).body.id;
  }
  const record = (course: string, people: object[], extra: object = {}) =>
    t.api.post('/api/training/records', { course_id: ids[course], people, ...extra });
  // Course A: two completed (five days late), one still to do, one overdue.
  await record('a', [P.one, P.two], { completed_on: addDays(today, -40), assigned_on: addDays(today, -70), due_on: addDays(today, -45) });
  await record('a', [P.three], { due_on: addDays(today, 10) });
  await record('a', [P.four], { assigned_on: addDays(today, -50), due_on: addDays(today, -20) });
  // Course B: one overdue, one completed.
  await record('b', [P.one], { assigned_on: addDays(today, -80), due_on: addDays(today, -45) });
  await record('b', [P.five], { completed_on: addDays(today, -5) });
  // A retired course does not count.
  await record('old', [P.one, P.two], { assigned_on: addDays(today, -300), due_on: addDays(today, -270) });
  await t.api.patch(`/api/courses/${ids.old}`, { status: 'retired' });
});
afterAll(async () => { await t.close(); });

describe('training summary', () => {
  it('counts each person once per active course', async () => {
    const s = (await t.api.get('/api/training/summary')).body;
    expect(s.today).toBe(today);
    expect(s.totals).toEqual({ people: 5, courses: 2, total: 6, complete: 3, due: 1, overdue: 2, rate: 50 });

    expect(s.by_course.map((c: any) => [c.title, c.total, c.complete, c.due, c.overdue, c.rate])).toEqual([
      ['Course A', 4, 2, 1, 1, 50],
      ['Course B', 2, 1, 0, 1, 50],
    ]);
    expect(s.by_department.map((d: any) => [d.label, d.total, d.complete, d.due, d.overdue, d.rate])).toEqual([
      ['Finance', 3, 2, 0, 1, 67],
      ['Operations', 2, 0, 1, 1, 0],
      ['No department', 1, 1, 0, 0, 100],
    ]);
    // Longest overdue first.
    expect(s.overdue.map((r: any) => [r.person, r.course_title, r.due_on])).toEqual([
      ['Person One', 'Course B', addDays(today, -45)],
      ['Person Four', 'Course A', addDays(today, -20)],
    ]);
  });

  it('gives the overdue trend month by month', async () => {
    const s = (await t.api.get('/api/training/summary')).body;
    expect(s.trend.length).toBe(12);
    const last = s.trend[11];
    expect(last).toEqual({ month: today.slice(0, 7), as_of: today, overdue: 2 });
    expect(s.trend[0].month).toBe(addMonths(`${today.slice(0, 7)}-01`, -11).slice(0, 7));
    // Each point matches the drill-down list for that day. The two late completions of
    // course A count while they were late, and stop counting once completed.
    for (const p of s.trend) {
      const list = (await t.api.get(`/api/training/records?active=true&overdue_at=${p.as_of}`)).body;
      expect(list.total).toBe(p.overdue);
    }
    const whileLate = (await t.api.get(`/api/training/records?active=true&overdue_at=${addDays(today, -42)}`)).body.rows;
    expect(whileLate.map((r: any) => r.person).sort()).toEqual(['Person One', 'Person One', 'Person Two']);
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
  });

  it('filters the record list the way the charts drill down', async () => {
    const get = async (query: string) => (await t.api.get(`/api/training/records?active=true&${query}`)).body;
    expect((await get(`course_id=${ids.a}`)).total).toBe(4);
    expect((await get(`course_id=${ids.a}&status=overdue`)).rows.map((r: any) => r.person)).toEqual(['Person Four']);
    expect((await get('department=Finance')).total).toBe(3);
    expect((await get('department=none')).rows.map((r: any) => r.person)).toEqual(['Person Five']);
    expect((await get('status=complete,due')).total).toBe(4);
    expect((await get('q=three')).total).toBe(1);
    expect((await t.api.get('/api/training/records')).body.total).toBe(8); // the retired course too
    expect((await t.api.get('/api/training/records?status=late')).status).toBe(400);
    expect((await t.api.get('/api/training/audiences')).body.department_names).toEqual(['Finance', 'Operations']);
  });
});
