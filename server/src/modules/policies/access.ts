// Controlled distribution of documents (E43): who may read a document.
//
// A document is either for everyone in the organization (`access = 'organization'`) or for named
// readers only (`access = 'restricted'`): departments (and every department below them), roles,
// distribution groups (document_groups: members, and the group's roles and departments) and people.
// The owner, the person who created it, the authors of its versions and document controllers
// (`policies.administer`, so administrators with `*` too) can always read it.
//
// The rule is the policy type's row rule (ResourceDef.rowRule), part of the visibility rule core
// applies everywhere: lists, record pages, search, pickers, labels, links, comments, files, exports,
// the report builder, dashboards and the MCP tools. Figures are the same for everyone: restricted
// documents are counted, but never matched, grouped or labeled by their words or people
// (figures 'mask'). The library and acknowledgment routes use `readableSql`, the same rule without
// department scope (scope narrows what a person works on, not what they may read).
import type { ModuleContext, Row, RowRule, SessionUser } from '../../core/module.ts';
import { can } from '../../core/services.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ACCESS_VALUES = ['organization', 'restricted'] as const;
export const ACCESS_LISTS = ['access_departments', 'access_roles', 'access_groups', 'access_users'] as const;

const literal = (value: string) => `'${String(value).replace(/'/g, "''")}'`;
const textArray = (values: readonly string[]) => (values.length ? `array[${values.map(literal).join(', ')}]::text[]` : `array[]::text[]`);

/** Whether a person is a document controller: holds policies.administer (or policies.* or *), area on. */
export const isController = (user: SessionUser | null | undefined): boolean => !!user && can(user, 'policies.administer');

/** Which optional tables the rule may read (the roster belongs to the people module). */
export interface AccessTables { people: () => boolean }

/** The tables of this installation: the roster is there when the people module is loaded and on. */
export const tablesFor = (ctx: ModuleContext): AccessTables => ({ people: () => !!ctx.resources.get('person') });

/**
 * SQL over a policies row (`col` gives its columns): whether `user` may read it. Built synchronously
 * from the session; departments and groups are sub-selects.
 */
export function readerSql(user: SessionUser, col: (name: string) => string, t: AccessTables): string {
  if (isController(user)) return 'true';
  if (!UUID.test(user.id)) return `${col('access')} = 'organization'`;
  const uid = user.id;
  const roles = textArray(user.roles ?? []);
  const mine = myDepartmentsUpSql(uid, t.people());
  return `(${col('access')} = 'organization'
    or ${col('owner_id')} = '${uid}' or ${col('created_by')} = '${uid}'
    or ${col('access_users')} @> '["${uid}"]'::jsonb
    or exists (select 1 from jsonb_array_elements_text(${col('access_roles')}) ar_(k) where ar_.k = any(${roles}))
    or exists (select 1 from jsonb_array_elements_text(${col('access_departments')}) ad_(d) where ad_.d in (select id::text from (${mine}) md_))
    or exists (select 1 from document_groups dg_
               where dg_.deleted_at is null and ${col('access_groups')} @> jsonb_build_array(dg_.id::text)
                 and (exists (select 1 from document_group_members dm_ where dm_.group_id = dg_.id and dm_.user_id = '${uid}')
                      or exists (select 1 from jsonb_array_elements_text(dg_.roles) gr_(k) where gr_.k = any(${roles}))
                      or exists (select 1 from jsonb_array_elements_text(dg_.departments) gd_(d) where gd_.d in (select id::text from (${mine}) mg_))))
    or exists (select 1 from policy_versions av_ where av_.policy_id = ${col('id')} and av_.created_by = '${uid}'))`;
}

/**
 * SQL giving the ids of a person's departments and every department above them: a document for a
 * department is for the people of the departments below it too. A person's departments are their
 * account's department, the departments they manage and their roster department (as
 * core/scope.ts myDepartmentsSql works them out).
 */
export function myDepartmentsUpSql(uid: string, people: boolean): string {
  const mine = [
    `select department_id from users where id = '${uid}' and department_id is not null`,
    `select id from departments where manager_id = '${uid}' and deleted_at is null`,
    ...(people ? [`select department_id from people where user_id = '${uid}' and deleted_at is null and status <> 'left' and department_id is not null`] : []),
  ];
  return `with recursive doc_mine(id) as (${mine.join(' union ')}),
    doc_up(id, depth) as (select id, 0 from doc_mine
      union select d.parent_id, u.depth + 1 from departments d join doc_up u on d.id = u.id where d.parent_id is not null and u.depth < 30)
    select id from doc_up`;
}

/** The policy type's row rule. */
export function accessRule(t: AccessTables): RowRule {
  return {
    where: (user, col) => readerSql(user, col, t),
    figures: 'mask',
    hidden: (col) => `${col('access')} <> 'organization'`,
  };
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
/** The rule for a table alias (hand-written queries): `readableSql(user, 'p')`. System work (no user) reads everything. */
export function readableSql(user: SessionUser | null | undefined, alias: string, t: AccessTables): string {
  if (!IDENT.test(alias)) throw new Error(`Bad table alias: ${alias}`);
  if (!user) return 'true';
  return readerSql(user, (name) => `${alias}.${name}`, t);
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * SQL giving the ids of the active people who may read a document with these settings. Used for
 * reader counts, to keep acknowledgment requests inside the distribution, and to close requests of
 * people who can no longer read. Parameters: $1 access, $2 departments, $3 roles, $4 groups,
 * $5 users, $6 owner, $7 creator, $8 policy id (version authors; may be null).
 */
export function readerIdsSql(t: AccessTables): string {
  const people = t.people();
  // A person's departments, as myDepartmentsSql works them out, seen from the other side: the
  // department of their account, the departments they manage, their roster department.
  const personDepts = (u: string) => `(select ${u}.department_id where ${u}.department_id is not null
      union select dm.id from departments dm where dm.manager_id = ${u}.id and dm.deleted_at is null
      ${people ? `union select pp.department_id from people pp where pp.user_id = ${u}.id and pp.deleted_at is null and pp.status <> 'left' and pp.department_id is not null` : ''})`;
  // Departments listed, and every department below them.
  const below = (ids: string) => `(with recursive dn(id) as (select d.id from departments d where d.deleted_at is null and d.id::text in (select jsonb_array_elements_text(${ids}))
      union select d.id from departments d join dn on d.parent_id = dn.id where d.deleted_at is null) select id from dn)`;
  const holdsRole = (keys: string) => `exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = u.id and r.enabled and r.key in (select jsonb_array_elements_text(${keys})))`;
  const controller = `exists (select 1 from user_roles ur join roles r on r.id = ur.role_id join role_permissions rp on rp.role_id = r.id
      where ur.user_id = u.id and r.enabled and rp.permission in ('policies.administer', 'policies.*', '*'))`;
  return `select u.id from users u
    where u.deleted_at is null and u.status = 'active' and (
      $1::text = 'organization'
      or u.id = $6::uuid or u.id = $7::uuid
      or ${controller}
      or $5::jsonb @> jsonb_build_array(u.id::text)
      or ${holdsRole('$3::jsonb')}
      or exists (select 1 from ${personDepts('u')} pd(id) where pd.id in ${below('$2::jsonb')})
      or exists (select 1 from document_groups g where g.deleted_at is null and $4::jsonb @> jsonb_build_array(g.id::text) and (
           exists (select 1 from document_group_members m where m.group_id = g.id and m.user_id = u.id)
           or ${holdsRole('g.roles')}
           or exists (select 1 from ${personDepts('u')} pd2(id) where pd2.id in ${below('g.departments')})))
      or exists (select 1 from policy_versions v where v.policy_id = $8::uuid and v.created_by = u.id))`;
}

/** The parameters of readerIdsSql for a document (or the settings of one being edited). */
export function readerParams(p: Row): unknown[] {
  return [
    p.access === 'restricted' ? 'restricted' : 'organization',
    JSON.stringify(list(p.access_departments)), JSON.stringify(list(p.access_roles)),
    JSON.stringify(list(p.access_groups)), JSON.stringify(list(p.access_users)),
    p.owner_id ?? null, p.created_by ?? null, p.id ?? null,
  ];
}

export async function readerIds(ctx: ModuleContext, t: AccessTables, p: Row): Promise<string[]> {
  return (await ctx.db.query<{ id: string }>(readerIdsSql(t), readerParams(p))).map((r) => r.id);
}

/**
 * The acknowledgment audience entries that reach outside the distribution: an audience of everyone
 * on a restricted document, a department not inside a listed department (or a group's), a role not
 * listed (directly or by a group). Positions (roster people) are checked when requests are made.
 * Returns field keys with a message, empty when the audience lies inside.
 */
export async function audienceOutside(ctx: ModuleContext, p: Row): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (p.access !== 'restricted') return out;
  const wantsAck = p.ack_required !== false;
  if (!wantsAck) return out;
  if (p.audience_everyone === true) out.audience_everyone = 'This document is not for everyone, so everyone cannot be asked to acknowledge it. Ask its readers instead.';
  const groups = list(p.access_groups).filter((g) => UUID.test(g));
  const groupRows = groups.length
    ? await ctx.db.query<Row>('select roles, departments from document_groups where deleted_at is null and id = any($1::uuid[])', [groups]) : [];
  const roles = new Set([...list(p.access_roles), ...groupRows.flatMap((g) => list(g.roles))]);
  const missingRoles = list(p.audience_roles).filter((r) => !roles.has(r));
  if (missingRoles.length) out.audience_roles = 'Some of these roles cannot read this document. Add them to its readers first.';
  const depts = [...new Set([...list(p.access_departments), ...groupRows.flatMap((g) => list(g.departments))])].filter((d) => UUID.test(d));
  const wanted = list(p.audience_departments).filter((d) => UUID.test(d));
  if (wanted.length) {
    const inside = depts.length ? await ctx.db.query<{ id: string }>(
      `with recursive dn(id) as (select id from departments where id = any($1::uuid[]) and deleted_at is null
         union select d.id from departments d join dn on d.parent_id = dn.id where d.deleted_at is null)
       select id::text as id from dn where id = any($2::uuid[])`, [depts, wanted]) : [];
    if (inside.length < wanted.length) out.audience_departments = 'Some of these departments cannot read this document. Add them to its readers first.';
  }
  return out;
}

/** Cleans and checks the access settings in `data` (only the keys present). Throws a validation error. */
export async function checkAccessInput(ctx: ModuleContext, data: Row): Promise<void> {
  const fields: Record<string, string> = {};
  if ('access' in data) {
    if (data.access === null || data.access === undefined || data.access === '') data.access = 'organization';
    if (!ACCESS_VALUES.includes(data.access)) fields.access = 'Choose who may read this document.';
  }
  const uniq = (key: string): string[] | null => {
    const v = data[key] ?? [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { fields[key] = 'Choose from the list.'; return null; }
    return [...new Set(v as string[])];
  };
  if ('access_roles' in data) {
    const wanted = uniq('access_roles');
    if (wanted) {
      const known = await ctx.db.query<{ k: string }>('select key as k from roles where key = any($1::text[])', [wanted]);
      if (known.length !== wanted.length) fields.access_roles = 'One of the roles does not exist.';
      data.access_roles = wanted;
    }
  }
  for (const [key, table, message] of [
    ['access_departments', 'departments', 'One of the departments does not exist.'],
    ['access_groups', 'document_groups', 'One of the distribution groups does not exist.'],
    ['access_users', 'users', 'One of the people does not exist.'],
  ] as const) {
    if (!(key in data)) continue;
    const wanted = uniq(key);
    if (!wanted) continue;
    if (wanted.some((w) => !UUID.test(w))) { fields[key] = message; continue; }
    const known = await ctx.db.query<{ k: string }>(`select id::text as k from ${table} where deleted_at is null and id = any($1::uuid[])`, [wanted]);
    if (known.length !== wanted.length) fields[key] = message;
    data[key] = wanted;
  }
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
}

/** Who may change a document's access: its owner or a document controller. */
export const mayChangeAccess = (user: SessionUser | null | undefined, policy: Row): boolean =>
  !!user && (isController(user) || (!!policy.owner_id && policy.owner_id === user.id));

/** Whether two documents' access settings differ. */
export function accessDiffers(a: Row, b: Row): boolean {
  if ((a.access ?? 'organization') !== (b.access ?? 'organization')) return true;
  return ACCESS_LISTS.some((k) => JSON.stringify([...list(a[k])].sort()) !== JSON.stringify([...list(b[k])].sort()));
}

export const accessOf = (p: Row) => ({
  access: p.access ?? 'organization',
  access_departments: list(p.access_departments), access_roles: list(p.access_roles),
  access_groups: list(p.access_groups), access_users: list(p.access_users),
});
