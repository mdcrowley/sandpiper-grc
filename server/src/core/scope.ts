// Departments and sites as access scope (E41-01).
//
// A role's grants for a permission module may be scoped (roles.scopes, `{ <module>: 'department' |
// 'site' }`, set under Administration > Roles): its members then see only the records of that
// module that belong to one of their departments or sites, or to one below them, plus the records
// they created themselves. A record type says where its records belong with `ResourceDef.scope`; a
// scope applies only to types that carry that kind of place, so a site scope leaves a type with no
// site alone. One unscoped role granting the module's view (or a module wildcard, or `*`) lifts the
// scope, and so does holding no role that grants it at all (the self-service portal and other
// on-behalf routes).
//
// The rule is part of the visibility rule (`visibilitySql` in core/resource.ts), so it reaches
// lists, record pages, search, pickers, labels, links, exports, imports, the assistant (MCP, which
// calls the same routes) and every hand-written query that uses `visibleWhere`. Figures (counts,
// totals, charts) count every record for everyone, as for restricted records; scope narrows what a
// person works with, it does not make records confidential: that is the restricted flag's job.
//
// A person's departments: their account's department (Administration > Users), their department on
// the staff roster, and the departments they manage; their sites: their work site on the roster
// and the sites they manage. Each includes the departments or sites below it (`parent_id`).
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { ResourceDef, SessionUser } from './module.ts';

export const SCOPE_KINDS = ['department', 'site'] as const;
export type ScopeKind = typeof SCOPE_KINDS[number];
export const SCOPE_LABELS: Record<ScopeKind, string> = { department: 'Their departments', site: 'Their sites' };

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** The kinds of place a record type carries (ResourceDef.scope). */
export function scopeKinds(def: ResourceDef): ScopeKind[] {
  return SCOPE_KINDS.filter((k) => def.scope?.[k] !== undefined);
}

/** Permission modules that have a scoped record type, with the kinds of place their types carry. */
export function scopableModules(defs: ResourceDef[]): Record<string, ScopeKind[]> {
  const out: Record<string, Set<ScopeKind>> = {};
  for (const d of defs) for (const k of scopeKinds(d)) (out[d.module] ??= new Set()).add(k);
  return Object.fromEntries(Object.entries(out).map(([m, s]) => [m, SCOPE_KINDS.filter((k) => s.has(k))]));
}

/** Which optional tables exist (modules loaded): the roster (`people`) and the sites (`sites`). */
export interface ScopeTables { people: boolean; sites: boolean }

/** SQL giving the ids of the person's departments and every department below them. */
export function myDepartmentsSql(uid: string, t: ScopeTables): string {
  const mine = [
    `select department_id from users where id = '${uid}' and department_id is not null`,
    `select id from departments where manager_id = '${uid}' and deleted_at is null`,
    ...(t.people ? [`select department_id from people where user_id = '${uid}' and deleted_at is null and status <> 'left' and department_id is not null`] : []),
  ];
  return `with recursive scope_mine(id) as (${mine.join(' union ')}),
    scope_below(id) as (select id from scope_mine
      union select d.id from departments d join scope_below b on d.parent_id = b.id where d.deleted_at is null)
    select id from scope_below`;
}

/** SQL giving the ids of the person's sites and every site below them. */
export function mySitesSql(uid: string, t: ScopeTables): string {
  const mine = [
    ...(t.sites ? [`select id from sites where manager_id = '${uid}' and deleted_at is null`] : []),
    ...(t.people ? [`select work_site_id from people where user_id = '${uid}' and deleted_at is null and status <> 'left' and work_site_id is not null`] : []),
  ];
  if (!mine.length) return 'select null::uuid where false';
  if (!t.sites) return mine.join(' union ');
  return `with recursive scope_mine(id) as (${mine.join(' union ')}),
    scope_below(id) as (select id from scope_mine
      union select s.id from sites s join scope_below b on s.parent_id = b.id where s.deleted_at is null)
    select id from scope_below`;
}

/**
 * The scope rule of a record type for one person, as SQL over the row (`col` gives its columns):
 * 'true' when it hides nothing. System work (no user) and administrators see every row.
 */
export function scopeSql(def: ResourceDef, user: SessionUser | null | undefined, col: (name: string) => string, t: ScopeTables): string {
  const kinds = scopeKinds(def);
  if (!kinds.length || !user) return 'true';
  if (!IDENT.test(def.module)) throw new Error(`Bad module name: ${def.module}`);
  // Loaded with the session: none of the person's roles scopes this module.
  if (user.scoped && !user.scoped.includes(def.module)) return 'true';
  if (user.permissions.includes('*')) return 'true';
  if (!UUID_RE.test(user.id)) return 'false';
  const uid = user.id.toLowerCase();
  const m = def.module;
  const grants = `'*', '${m}.*', '${m}.view'`;
  const roleWith = (cond: string) =>
    `exists (select 1 from user_roles sur join roles sr on sr.id = sur.role_id and sr.enabled
      join role_permissions srp on srp.role_id = sr.id
      where sur.user_id = '${uid}' and srp.permission in (${grants}) and ${cond})`;
  const carried = kinds.map((k) => `'${k}'`).join(', ');
  const place = (k: ScopeKind) => {
    const s = def.scope![k]!;
    return typeof s === 'function' ? `(${s(col)})` : col(s);
  };
  const parts = [
    // No role scopes this type (or none grants its view at all), or one grants it unscoped.
    `not ${roleWith(`sr.scopes ->> '${m}' in (${carried})`)}`,
    roleWith(`coalesce(sr.scopes ->> '${m}', '') not in (${carried})`),
    `${col('created_by')} = '${uid}'`,
  ];
  if (kinds.includes('department')) parts.push(`(${roleWith(`sr.scopes ->> '${m}' = 'department'`)} and ${place('department')} in (${myDepartmentsSql(uid, t)}))`);
  if (kinds.includes('site')) parts.push(`(${roleWith(`sr.scopes ->> '${m}' = 'site'`)} and ${place('site')} in (${mySitesSql(uid, t)}))`);
  return `(${parts.join(' or ')})`;
}

/**
 * Whether a person may change the facts a scope is worked out from (wave 23 A1): a department's or
 * site's manager and the department or site it sits under, and a roster row linked to their own
 * account. Someone whose roles scope any module could otherwise widen their own reach. Allowed for
 * system work, administrators (`admin.administer`), and people none of whose roles is scoped (they
 * see every record already, so nothing they change here widens what they reach).
 */
export function mayChangeScopeSources(user: SessionUser | null | undefined): boolean {
  if (!user) return true;
  if (user.permissions.some((p) => p === '*' || p === 'admin.*' || p === 'admin.administer')) return true;
  return !(user.scoped?.length);
}

/** The refusal given for such a change. */
export const SCOPE_SOURCE_MESSAGE = 'Your roles are limited to your departments or sites, so only an administrator can change this.';

/** SQL (for the user queries in core/auth.ts) giving the modules one of the person's enabled roles scopes. */
export const SCOPED_MODULES_SQL = (userCol: string) =>
  `coalesce((select array_agg(distinct sk.key) from user_roles sur join roles sr on sr.id = sur.role_id and sr.enabled
     cross join lateral jsonb_object_keys(coalesce(sr.scopes, '{}'::jsonb)) as sk(key) where sur.user_id = ${userCol}), '{}')`;

// ---------- departments ----------

/**
 * The department a value names: its id, or its name in any case (as an import or an earlier
 * version's text field gives it). null for an empty value; undefined when nothing matches, unless
 * `create` is set (system work, such as seeding), which adds a department of that name.
 */
export async function departmentIdFor(db: Db, value: unknown, opts: { create?: boolean } = {}): Promise<string | null | undefined> {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const v = String(value).trim();
  if (UUID_RE.test(v)) {
    return (await db.one<{ id: string }>('select id from departments where id = $1 and deleted_at is null', [v]))?.id;
  }
  const found = await db.one<{ id: string }>(
    'select id from departments where lower(name) = lower($1) and deleted_at is null order by created_at limit 1', [v]);
  if (found || !opts.create || v.length > 80) return found?.id;
  // The name is unique among every department, removed ones included: bring a removed one back.
  return (await db.one<{ id: string }>(
    `insert into departments (name) values ($1)
     on conflict (name) do update set deleted_at = null, updated_at = now() returning id`, [v]))!.id;
}

/**
 * A `prepare` hook (ResourceDef.hooks.prepare) for a record type that used to keep its department
 * as text (E41-01): `department` (a name) is still accepted and becomes `department_id`, and
 * `department_id` may also give a name. The `department` column keeps the name, set by the
 * database (`grc_department_name`, core migration 031), for the readers that group or search by it. A name that is not in the list is refused for a person
 * and added to the list for system work (seeding, automation).
 */
export function departmentPrepare(db: Db, fieldLabel = 'Department') {
  return async (req: { user?: unknown } | null, input: Record<string, any>): Promise<Record<string, any>> => {
    const out = { ...input };
    const given = 'department_id' in out && out.department_id !== undefined ? out.department_id
      : 'department' in out && out.department !== undefined ? out.department : undefined;
    delete out.department;
    if (given === undefined) return out;
    const id = await departmentIdFor(db, given, { create: !req?.user });
    if (id === undefined) {
      fail(400, 'validation', 'Check the highlighted fields.', { department_id: `${fieldLabel}: "${String(given)}" is not in the department list.` });
    }
    out.department_id = id;
    return out;
  };
}
