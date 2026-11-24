// Outside reviewer accounts, as core sees them (E41-09, wave 23 A3 and A4).
//
// The outsidereviews module keeps the list of accounts that belong to people outside the
// organization (table `outside_reviewers`) and confines them to their own reviews (its gate). Core
// knows only two things about them, so that they fail closed whatever modules are loaded:
//  - such an account holds no role and no permission anywhere a person is loaded, in a request or
//    not (loadUser, the session, notification and mail recipients), and is never offered in a staff
//    user picker;
//  - while the module is not loaded (GRC_MODULES without it), nothing confines them, so they cannot
//    sign in and their sessions and tokens are not accepted.
// The table is created by the module's migration and is never dropped, so it may exist while the
// module is not loaded; when it does not exist there are no such accounts.
import type { Queryable } from './db.ts';

const TABLE = 'outside_reviewers';
const known = new WeakMap<object, { exists: boolean; at: number }>();
const confined = new WeakSet<object>();

/** Whether the reviewer table exists (kept once seen; a "no" is asked again after a minute). */
export async function reviewerTableExists(q: Queryable): Promise<boolean> {
  const hit = known.get(q);
  if (hit && (hit.exists || Date.now() - hit.at < 60_000)) return hit.exists;
  const exists = Boolean((await q.one<{ t: string | null }>('select to_regclass($1)::text as t', [TABLE]))?.t);
  known.set(q, { exists, at: Date.now() });
  return exists;
}

/** Forgets what was seen of the table (a test that creates it after the start). */
export function forgetReviewerTable(q: Queryable): void {
  known.delete(q);
}

/** SQL that is true when the account `userCol` is an outside reviewer's ('false' when there is no such table). */
export async function reviewerSql(q: Queryable, userCol: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_.]*$/.test(userCol)) throw new Error(`Bad column: ${userCol}`);
  return (await reviewerTableExists(q)) ? `exists (select 1 from ${TABLE} orv where orv.user_id = ${userCol})` : 'false';
}

/** Whether one account is an outside reviewer's. */
export async function isReviewerAccount(q: Queryable, userId: string): Promise<boolean> {
  if (!(await reviewerTableExists(q))) return false;
  return Boolean(await q.one(`select 1 from ${TABLE} where user_id = $1`, [userId]));
}

/** Called by the outsidereviews module when it installs its gate: reviewer accounts may then sign in. */
export function confineReviewerAccounts(db: object): void {
  confined.add(db);
}

/** Whether the outsidereviews module confines reviewer accounts on this database handle. */
export function reviewersConfined(db: object): boolean {
  return confined.has(db);
}

/** The message given when a role is offered to an outside reviewer's account. */
export const REVIEWER_ROLES_MESSAGE = 'This is an outside reviewer\'s account: it cannot hold roles.';
