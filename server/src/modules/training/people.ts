import type { ModuleContext, Row } from '../../core/module.ts';
import type { Queryable } from '../../core/db.ts';
import { addDays, text, UUID } from './dates.ts';
import { DEFAULT_DUE_DAYS } from './sync.ts';

/**
 * Training records with the person, department and status worked out. `$1` is today's date.
 * `rec` is every record; `latest` keeps one per person per course: the open record when
 * there is one, otherwise the most recent completion.
 */
/** Whether the roster (people module, table `people`) is there for this database (set in register). */
const rosterDbs = new WeakSet<object>();
export function setRoster(db: object, on: boolean): void { if (on) rosterDbs.add(db); else rosterDbs.delete(db); }
export const rosterOn = (db: object): boolean => rosterDbs.has(db);

/** RECORDS_CTE with roster people's names and departments when the roster is there (E29-05). */
export function recordsCte(db: object): string {
  if (!rosterOn(db)) return RECORDS_CTE;
  return RECORDS_CTE
    .replace('coalesce(u.display_name, r.person_name, r.person_email) as person', 'coalesce(u.display_name, pp.full_name, r.person_name, r.person_email) as person')
    .replace('coalesce(u.email, r.person_email) as email', 'coalesce(u.email, pp.email, r.person_email) as email')
    .replace('coalesce(d.name, r.person_department) as department', 'coalesce(d.name, pd.name, r.person_department) as department')
    .replace('left join departments d on d.id = u.department_id and d.deleted_at is null',
      `left join departments d on d.id = u.department_id and d.deleted_at is null
    left join people pp on pp.id = r.person_id
    left join departments pd on pd.id = pp.department_id and pd.deleted_at is null`);
}

export const RECORDS_CTE = `
  with rec as (
    select r.id, r.course_id, r.user_id, r.person_id, r.person_key, r.assigned_on, r.due_on, r.completed_on, r.score, r.result,
           r.evidence_note, r.source, r.created_at, r.attempted_on, r.self_certified,
           c.title as course_title, c.ref as course_ref, c.mandatory, c.recurrence_months, c.self_certify,
           coalesce(c.status, 'active') as course_status,
           coalesce(u.display_name, r.person_name, r.person_email) as person,
           coalesce(u.email, r.person_email) as email,
           coalesce(d.name, r.person_department) as department,
           (r.user_id is not null) as has_account,
           -- A "did not pass" row kept from before failed results were attempts is history, never complete.
           case when r.completed_on is not null and r.result is distinct from 'failed' then 'complete'
                when r.completed_on is not null then 'not_passed'
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
  /** The roster person (people module), when known. */
  person_id?: string | null;
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
  /** Roster people (empty without the people module): by id, by email and by employee number. */
  people?: { byId: Map<string, Row>; byEmail: Map<string, Row>; byNumber: Map<string, Row>; byUser: Map<string, Row> };
}

/** The training identity of a roster person: their account when they have one, else `p:<id>`. */
export function personFromRoster(p: Row, users: UserIndex): Person {
  const u = p.user_id ? users.byId.get(p.user_id) : undefined;
  if (u) return { user_id: u.id, person_id: p.id, name: null, email: null, department: null, key: `u:${u.id}`, label: u.display_name };
  return { user_id: null, person_id: p.id, name: null, email: null, department: null, key: `p:${p.id}`, label: p.full_name };
}

export async function loadUsers(ctx: ModuleContext): Promise<UserIndex> {
  const rows = await ctx.db.query<Row>('select id, username, email, display_name from users where deleted_at is null');
  const roster = rosterOn(ctx.db)
    ? await ctx.db.query<Row>(`select id, full_name, email, employee_number, user_id from people where deleted_at is null`) : [];
  return {
    byId: new Map(rows.map((r) => [r.id, r])),
    byEmail: new Map(rows.map((r) => [String(r.email).toLowerCase(), r])),
    byUsername: new Map(rows.map((r) => [String(r.username).toLowerCase(), r])),
    people: {
      byId: new Map(roster.map((p) => [p.id, p])),
      byEmail: new Map(roster.filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p])),
      byNumber: new Map(roster.filter((p) => p.employee_number).map((p) => [String(p.employee_number).toLowerCase(), p])),
      byUser: new Map(roster.filter((p) => p.user_id).map((p) => [p.user_id, p])),
    },
  };
}

/**
 * Works out who a record is about. Someone whose email matches an account becomes that
 * user; anyone else is kept by name and email. Returns a message when it cannot tell.
 */
export function resolvePerson(input: Row, users: UserIndex): Person | string {
  const roster = users.people;
  const personId = text(input.person_id);
  if (personId) {
    const p = UUID.test(personId) ? roster?.byId.get(personId) : undefined;
    if (!p) return 'That person is not on the roster.';
    return personFromRoster(p, users);
  }
  const number = text(input.employee_number);
  if (number) {
    const p = roster?.byNumber.get(number.toLowerCase());
    if (!p) return `No one on the roster has employee number ${number}.`;
    return personFromRoster(p, users);
  }
  const userId = text(input.user_id);
  if (userId) {
    const u = UUID.test(userId) ? users.byId.get(userId) : undefined;
    if (!u) return 'That user was not found.';
    return { user_id: u.id, person_id: roster?.byUser.get(u.id)?.id ?? null, name: null, email: null, department: null, key: `u:${u.id}`, label: u.display_name };
  }
  const name = text(input.name);
  const email = text(input.email);
  const department = text(input.department);
  if (email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return `"${email}" is not an email address.`;
    const u = users.byEmail.get(email.toLowerCase());
    if (u) return { user_id: u.id, person_id: roster?.byUser.get(u.id)?.id ?? null, name: null, email: null, department: null, key: `u:${u.id}`, label: u.display_name };
    // The same email as a roster person is that person (one person, never two).
    const rp = roster?.byEmail.get(email.toLowerCase());
    if (rp) return personFromRoster(rp, users);
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
  /** Set by the caller when `result` is one that does not pass (see failingResults). */
  failed?: boolean;
  /** The person recorded the completion themselves. */
  self_certified?: boolean;
}

export type Outcome = 'created' | 'completed' | 'assigned' | 'duplicate' | 'exists' | 'attempted';

/**
 * Results that do not count as completing a course: "failed", and any value of the
 * `training_result` list whose meta says `{ "complete": false }`.
 */
export async function failingResults(ctx: ModuleContext): Promise<Set<string>> {
  const out = new Set<string>(['failed']);
  for (const v of await ctx.lookups.values('training_result')) if ((v.meta as Row | undefined)?.complete === false) out.add(v.value);
  return out;
}

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
  // An attempt that did not pass: noted on the record to complete (raised when there is none). The training stays due.
  if (c.completed_on && c.failed) {
    if (open) {
      await q.query(
        `update training_records set attempted_on = $2::date, score = $3, result = $4, evidence_note = coalesce($5, evidence_note),
           updated_at = now(), updated_by = $6 where id = $1`,
        [open.id, c.completed_on, c.score ?? null, c.result ?? null, c.evidence_note ?? null, actorId],
      );
      return { outcome: 'attempted', id: open.id };
    }
    const n = Number(course.due_days);
    const row = await q.one<Row>(
      `insert into training_records
         (course_id, user_id, person_name, person_email, person_department, person_key, assigned_on, due_on, attempted_on, score, result,
          evidence_note, source, created_by, updated_by, person_id)
       values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::date,$10,$11,$12,$13,$14,$14,$15) returning id`,
      [course.id, person.user_id, person.name, person.email, person.department, person.key, c.assigned_on ?? c.completed_on,
        c.due_on ?? addDays(today, Number.isInteger(n) && n >= 0 ? n : DEFAULT_DUE_DAYS), c.completed_on, c.score ?? null, c.result ?? null,
        c.evidence_note ?? null, source, actorId, person.person_id ?? null],
    );
    return { outcome: 'attempted', id: row!.id };
  }
  if (!c.completed_on) {
    if (open) return { outcome: 'exists', id: open.id };
    const n = Number(course.due_days);
    const assigned = c.assigned_on ?? today;
    const row = await q.one<Row>(
      `insert into training_records
         (course_id, user_id, person_name, person_email, person_department, person_key, assigned_on, due_on, evidence_note, source, created_by, updated_by, person_id)
       values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$11,$12) returning id`,
      [course.id, person.user_id, person.name, person.email, person.department, person.key, assigned,
        c.due_on ?? addDays(assigned, Number.isInteger(n) && n >= 0 ? n : DEFAULT_DUE_DAYS), c.evidence_note ?? null, source, actorId, person.person_id ?? null],
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
         person_department = coalesce($6, person_department), self_certified = $8, person_id = coalesce(person_id, $9),
         updated_at = now(), updated_by = $7 where id = $1`,
      [open.id, c.completed_on, c.score ?? null, c.result ?? null, c.evidence_note ?? null, person.department, actorId, c.self_certified === true, person.person_id ?? null],
    );
    return { outcome: 'completed', id: open.id };
  }
  const row = await q.one<Row>(
    `insert into training_records
       (course_id, user_id, person_name, person_email, person_department, person_key, assigned_on, due_on, completed_on, score, result,
        evidence_note, source, created_by, updated_by, self_certified, assigned_notified_at, person_id)
     values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::date,$10,$11,$12,$13,$14,$14,$15,now(),$16) returning id`,
    [course.id, person.user_id, person.name, person.email, person.department, person.key, c.assigned_on ?? c.completed_on,
      c.due_on ?? null, c.completed_on, c.score ?? null, c.result ?? null, c.evidence_note ?? null, source, actorId, c.self_certified === true, person.person_id ?? null],
  );
  return { outcome: 'created', id: row!.id };
}
