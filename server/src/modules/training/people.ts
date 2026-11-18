import type { ModuleContext, Row } from '../../core/module.ts';
import type { Queryable } from '../../core/db.ts';
import { addDays, text, UUID } from './dates.ts';
import { DEFAULT_DUE_DAYS } from './sync.ts';

/**
 * Training records with the person, department and status worked out. `$1` is today's date.
 * `rec` is every record; `latest` keeps one per person per course: the open record when
 * there is one, otherwise the most recent completion.
 */
export const RECORDS_CTE = `
  with rec as (
    select r.id, r.course_id, r.user_id, r.person_key, r.assigned_on, r.due_on, r.completed_on, r.score, r.result,
           r.evidence_note, r.source, r.created_at,
           c.title as course_title, c.ref as course_ref, c.mandatory, c.recurrence_months,
           coalesce(c.status, 'active') as course_status,
           coalesce(u.display_name, r.person_name, r.person_email) as person,
           coalesce(u.email, r.person_email) as email,
           coalesce(d.name, r.person_department) as department,
           (r.user_id is not null) as has_account,
           case when r.completed_on is not null then 'complete'
                when r.due_on < $1::date then 'overdue' else 'due' end as status
    from training_records r
    join courses c on c.id = r.course_id and c.deleted_at is null
    left join users u on u.id = r.user_id
    left join departments d on d.id = u.department_id and d.deleted_at is null
    where r.deleted_at is null
  ),
  latest as (
    select distinct on (course_id, person_key) * from rec
    order by course_id, person_key, (completed_on is null) desc, completed_on desc nulls last, created_at desc
  )`;

export interface Person {
  user_id: string | null;
  name: string | null;
  email: string | null;
  department: string | null;
  key: string;
  label: string;
}

export interface UserIndex {
  byId: Map<string, Row>;
  byEmail: Map<string, Row>;
  byUsername: Map<string, Row>;
}

export async function loadUsers(ctx: ModuleContext): Promise<UserIndex> {
  const rows = await ctx.db.query<Row>('select id, username, email, display_name from users where deleted_at is null');
  return {
    byId: new Map(rows.map((r) => [r.id, r])),
    byEmail: new Map(rows.map((r) => [String(r.email).toLowerCase(), r])),
    byUsername: new Map(rows.map((r) => [String(r.username).toLowerCase(), r])),
  };
}

/**
 * Works out who a record is about. Someone whose email matches an account becomes that
 * user; anyone else is kept by name and email. Returns a message when it cannot tell.
 */
export function resolvePerson(input: Row, users: UserIndex): Person | string {
  const userId = text(input.user_id);
  if (userId) {
    const u = UUID.test(userId) ? users.byId.get(userId) : undefined;
    if (!u) return 'That user was not found.';
    return { user_id: u.id, name: null, email: null, department: null, key: `u:${u.id}`, label: u.display_name };
  }
  const name = text(input.name);
  const email = text(input.email);
  const department = text(input.department);
  if (email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return `"${email}" is not an email address.`;
    const u = users.byEmail.get(email.toLowerCase());
    if (u) return { user_id: u.id, name: null, email: null, department: null, key: `u:${u.id}`, label: u.display_name };
    return { user_id: null, name: name ?? email, email, department, key: `e:${email.toLowerCase()}`, label: name ?? email };
  }
  if (name) {
    const u = users.byUsername.get(name.toLowerCase());
    if (u) return { user_id: u.id, name: null, email: null, department: null, key: `u:${u.id}`, label: u.display_name };
    return { user_id: null, name, email: null, department, key: `n:${name.toLowerCase()}`, label: name };
  }
  return 'Give a name or an email address.';
}

export interface Completion {
  assigned_on?: string | null;
  due_on?: string | null;
  completed_on?: string | null;
  score?: number | null;
  result?: string | null;
  evidence_note?: string | null;
}

export type Outcome = 'created' | 'completed' | 'assigned' | 'duplicate' | 'exists';

/**
 * Writes one person's training for one course.
 * - With a completion date: an open record is completed; otherwise a completed record is
 *   added, unless the same completion (same person, course and date) is already there.
 * - Without one: a record to be completed is added, unless one is already open.
 */
export async function saveTraining(
  q: Queryable, course: Row, person: Person, c: Completion, source: 'manual' | 'import', today: string, actorId: string | null,
): Promise<{ outcome: Outcome; id: string }> {
  const open = await q.one<Row>(
    `select id, assigned_on from training_records
     where course_id = $1 and person_key = $2 and deleted_at is null and completed_on is null
     order by created_at limit 1`,
    [course.id, person.key],
  );
  if (!c.completed_on) {
    if (open) return { outcome: 'exists', id: open.id };
    const n = Number(course.due_days);
    const assigned = c.assigned_on ?? today;
    const row = await q.one<Row>(
      `insert into training_records
         (course_id, user_id, person_name, person_email, person_department, person_key, assigned_on, due_on, evidence_note, source, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$11) returning id`,
      [course.id, person.user_id, person.name, person.email, person.department, person.key, assigned,
        c.due_on ?? addDays(assigned, Number.isInteger(n) && n >= 0 ? n : DEFAULT_DUE_DAYS), c.evidence_note ?? null, source, actorId],
    );
    return { outcome: 'assigned', id: row!.id };
  }
  const same = await q.one<Row>(
    `select id from training_records where course_id = $1 and person_key = $2 and deleted_at is null and completed_on = $3::date limit 1`,
    [course.id, person.key, c.completed_on],
  );
  if (same) return { outcome: 'duplicate', id: same.id };
  // A completion from before the open record was raised is history, not an answer to it.
  if (open && (!open.assigned_on || c.completed_on >= open.assigned_on)) {
    await q.query(
      `update training_records set completed_on = $2::date, score = $3, result = $4, evidence_note = coalesce($5, evidence_note),
         person_department = coalesce($6, person_department), updated_at = now(), updated_by = $7 where id = $1`,
      [open.id, c.completed_on, c.score ?? null, c.result ?? null, c.evidence_note ?? null, person.department, actorId],
    );
    return { outcome: 'completed', id: open.id };
  }
  const row = await q.one<Row>(
    `insert into training_records
       (course_id, user_id, person_name, person_email, person_department, person_key, assigned_on, due_on, completed_on, score, result,
        evidence_note, source, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::date,$10,$11,$12,$13,$14,$14) returning id`,
    [course.id, person.user_id, person.name, person.email, person.department, person.key, c.assigned_on ?? c.completed_on,
      c.due_on ?? null, c.completed_on, c.score ?? null, c.result ?? null, c.evidence_note ?? null, source, actorId],
  );
  return { outcome: 'created', id: row!.id };
}
