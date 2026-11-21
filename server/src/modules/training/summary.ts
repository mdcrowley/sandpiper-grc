import type { ModuleContext, Row } from '../../core/module.ts';
import { addMonths, localDate, monthEnd } from './dates.ts';
import { recordsCte } from './people.ts';

export interface Tally { total: number; complete: number; due: number; overdue: number; rate: number | null }

function tally(rows: Row[]): Tally {
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const complete = count('complete');
  return {
    total: rows.length, complete, due: count('due'), overdue: count('overdue'),
    rate: rows.length ? Math.round((complete / rows.length) * 100) : null,
  };
}

const TREND_MONTHS = 12;

/**
 * Completion across active courses. Each person counts once per course, by their latest
 * record: completed, due (not yet completed, not yet late) or overdue. The trend counts the
 * records that were overdue at the end of each of the last twelve months (today for the
 * current month).
 */
export async function trainingSummary(ctx: ModuleContext, now: Date = new Date()) {
  const today = localDate(now);
  const latest = await ctx.db.query<Row>(
    `${recordsCte(ctx.db)} select * from latest where course_status = 'active' order by due_on nulls last, lower(person)`, [today],
  );
  const courses = await ctx.db.query<Row>(
    `select id, ref, title, mandatory, recurrence_months from courses
     where deleted_at is null and coalesce(status, 'active') = 'active' order by lower(title)`,
  );

  const by_course = courses.map((c) => ({
    course_id: c.id, ref: c.ref, title: c.title, mandatory: c.mandatory, recurrence_months: c.recurrence_months,
    ...tally(latest.filter((r) => r.course_id === c.id)),
  }));

  const departments = new Map<string, Row[]>();
  for (const r of latest) {
    const key = r.department ?? '';
    if (!departments.has(key)) departments.set(key, []);
    departments.get(key)!.push(r);
  }
  const by_department = [...departments.entries()]
    .map(([name, rows]) => ({ department: name || null, label: name || 'No department', ...tally(rows) }))
    .sort((a, b) => (a.department === null ? 1 : b.department === null ? -1 : a.label.localeCompare(b.label)));

  const points: { month: string; as_of: string }[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const end = monthEnd(addMonths(`${today.slice(0, 7)}-01`, -i));
    points.push({ month: end.slice(0, 7), as_of: end > today ? today : end });
  }
  const counts = await ctx.db.query<{ as_of: string; overdue: number }>(
    `select p.as_of::text as as_of, count(r.id)::int as overdue
     from unnest($1::date[]) as p(as_of)
     left join training_records r on r.deleted_at is null and r.due_on < p.as_of
       and (r.completed_on is null or r.completed_on > p.as_of) and coalesce(r.assigned_on, r.due_on) <= p.as_of
       and exists (select 1 from courses c where c.id = r.course_id and c.deleted_at is null and coalesce(c.status, 'active') = 'active')
     group by 1`,
    [points.map((p) => p.as_of)],
  );
  const overdueAt = new Map(counts.map((c) => [c.as_of, c.overdue]));

  return {
    today,
    totals: { people: new Set(latest.map((r) => r.person_key)).size, courses: courses.length, ...tally(latest) },
    by_course,
    by_department,
    overdue: latest.filter((r) => r.status === 'overdue'),
    trend: points.map((p) => ({ ...p, overdue: overdueAt.get(p.as_of) ?? 0 })),
  };
}

export function registerSummary(ctx: ModuleContext) {
  ctx.app.get('/api/training/summary', { preHandler: ctx.requirePerm('training.view') }, async () => trainingSummary(ctx));
}
