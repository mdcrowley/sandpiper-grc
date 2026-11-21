import type { ModuleContext, Row } from '../../core/module.ts';
import { addDays, localDate } from './dates.ts';
import { rosterOn } from './people.ts';

export const DEFAULT_DUE_DAYS = 30;

export interface SyncResult {
  /** First records raised because a person matches an assignment rule. */
  created: number;
  /** Records raised because an earlier completion is older than the course's repeat period. */
  renewed: number;
}

const dueDays = (course: Row) => {
  const n = Number(course.due_days);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DUE_DAYS;
};

const running = new WeakMap<object, Promise<SyncResult>>();

/**
 * Brings training records in line with the assignment rules. Safe to run at any time and
 * any number of times: a person gets a record for a course only when they have none, and a
 * completion raises its follow-up record once.
 *
 * 1. Rules: every active user matched by a rule of an active course gets a record
 *    (assigned today, due after the course's days allowed) unless they already have one.
 * 2. Recurrence: when a person's latest completion of a repeating course is older than
 *    the repeat period, a new record becomes due. This also covers people without an
 *    account. Users who are no longer active are left alone.
 */
export function syncTrainingAssignments(ctx: ModuleContext, now: Date = new Date()): Promise<SyncResult> {
  const busy = running.get(ctx.db);
  if (busy) return busy;
  const run = doSync(ctx, now).finally(() => running.delete(ctx.db));
  running.set(ctx.db, run);
  return run;
}

async function doSync(ctx: ModuleContext, now: Date): Promise<SyncResult> {
  const today = localDate(now);
  const result: SyncResult = { created: 0, renewed: 0 };
  const courses = await ctx.db.query<Row>(
    `select * from courses where deleted_at is null and coalesce(status, 'active') = 'active' order by created_at`,
  );

  for (const course of courses) {
    const due = addDays(today, dueDays(course));
    const made = await ctx.db.query<Row>(
      `with matched as (
         select distinct on (u.id) u.id as user_id, a.id as assignment_id
         from training_assignments a
         join users u on u.status = 'active' and u.deleted_at is null and (
           a.audience_type = 'everyone'
           or (a.audience_type = 'user' and u.id = a.user_id)
           or (a.audience_type = 'department' and u.department_id = a.department_id)
           or (a.audience_type = 'role' and exists (
                 select 1 from user_roles ur where ur.user_id = u.id and ur.role_id = a.role_id)))
         where a.course_id = $1 and a.deleted_at is null
         order by u.id, a.created_at
       )
       insert into training_records (course_id, user_id, person_key, assigned_on, due_on, source, assignment_id)
       select $1, m.user_id, 'u:' || m.user_id::text, $2::date, $3::date, 'rule', m.assignment_id
       from matched m
       where not exists (
         select 1 from training_records r
         where r.course_id = $1 and r.user_id = m.user_id and r.deleted_at is null)
       returning id`,
      [course.id, today, due],
    );

    // Rules by position (E29-05): active roster people in the position, with or without an account.
    if (rosterOn(ctx.db)) {
      const roster = await ctx.db.query<Row>(
        `with matched as (
           select distinct on (p.id) p.id as person_id, a.id as assignment_id,
                  u.id as user_id,
                  case when u.id is not null then 'u:' || u.id::text else 'p:' || p.id::text end as person_key
           from training_assignments a
           join people p on p.position_id = a.position_id and p.deleted_at is null and p.status = 'active'
           left join users u on u.id = p.user_id and u.deleted_at is null
           where a.course_id = $1 and a.deleted_at is null and a.audience_type = 'position'
           order by p.id, a.created_at
         )
         insert into training_records (course_id, user_id, person_id, person_key, assigned_on, due_on, source, assignment_id)
         select $1, m.user_id, m.person_id, m.person_key, $2::date, $3::date, 'rule', m.assignment_id
         from matched m
         where not exists (
           select 1 from training_records r
           where r.course_id = $1 and r.deleted_at is null and (r.person_key = m.person_key or r.person_id = m.person_id))
         returning id`,
        [course.id, today, due],
      );
      made.push(...roster);
    }
    // Roster people who have left are not asked again.
    const leftRoster = rosterOn(ctx.db)
      ? `and (r.person_id is null or exists (select 1 from people p where p.id = r.person_id and p.deleted_at is null and p.status <> 'left'))`
      : '';

    let renewed = 0;
    const months = Number(course.recurrence_months);
    if (Number.isInteger(months) && months > 0) {
      const lapsed = await ctx.db.query<Row>(
        `select r.* from training_records r
         left join users u on u.id = r.user_id
         where r.course_id = $1 and r.deleted_at is null and r.completed_on is not null and r.renewal_id is null
           and (r.completed_on + make_interval(months => $2::int))::date <= $3::date
           and (r.user_id is null or (u.status = 'active' and u.deleted_at is null))
           ${leftRoster}
           and not exists (
             select 1 from training_records o
             where o.course_id = r.course_id and o.person_key = r.person_key and o.deleted_at is null and o.id <> r.id
               and (o.completed_on is null or o.completed_on > r.completed_on
                    or (o.completed_on = r.completed_on and o.created_at > r.created_at)))`,
        [course.id, months, today],
      );
      for (const old of lapsed) {
        const next = await ctx.db.one<Row>(
          `insert into training_records
             (course_id, user_id, person_name, person_email, person_department, person_key, assigned_on, due_on, source, assignment_id, person_id)
           values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,'rule',$9,$10) returning id`,
          [course.id, old.user_id, old.person_name, old.person_email, old.person_department, old.person_key, today, due, old.assignment_id, old.person_id ?? null],
        );
        // The guard keeps a completion from raising two follow-ups if runs ever overlap.
        const claimed = await ctx.db.one<Row>(
          'update training_records set renewal_id = $2 where id = $1 and renewal_id is null returning id', [old.id, next!.id],
        );
        if (claimed) renewed++;
        else await ctx.db.query('update training_records set deleted_at = now() where id = $1', [next!.id]);
      }
    }

    if (made.length || renewed) {
      result.created += made.length;
      result.renewed += renewed;
      const parts = [
        made.length ? `${made.length} assigned by rule` : '',
        renewed ? `${renewed} due again after ${months} months` : '',
      ].filter(Boolean).join(', ');
      await ctx.audit(null, {
        action: 'training.sync', recordType: 'course', recordId: course.id,
        summary: `Training records raised for ${[course.ref, course.title].filter(Boolean).join(' ')}: ${parts} (due ${due})`,
        after: { assigned: made.length, renewed, due_on: due },
      });
    }
  }
  return result;
}
