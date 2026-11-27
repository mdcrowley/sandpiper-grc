// Distribution groups (E43): named lists of readers ("Network operations on-call", "Maintenance
// supervisors") used in documents' access lists. A group holds people, and may also take in every
// holder of some roles and everyone in some departments (and below them). Kept in the module: core
// has no user-group concept. Managed by document controllers (policies.administer); the list is
// readable by editors for the access editor.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { reviewerSql } from '../../core/reviewers.ts';
import { tablesFor } from './access.ts';
import { closeUnreadable } from './documents.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const T = 'Documents';
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function registerGroups(ctx: ModuleContext): void {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const admin = { preHandler: ctx.requirePerm('policies.administer') };
  const mayList = (req: FastifyRequest) => ctx.can(req.user, 'policies.edit') || ctx.can(req.user, 'policies.administer');

  const LIST = `select g.id, g.name, g.description, g.owner_id, u.display_name as owner_name, g.roles, g.departments, g.created_at, g.updated_at,
      (select count(*)::int from document_group_members m join users mu on mu.id = m.user_id and mu.deleted_at is null where m.group_id = g.id) as member_count,
      (select count(*)::int from policies p where p.deleted_at is null and p.access_groups @> jsonb_build_array(g.id::text)) as document_count
    from document_groups g left join users u on u.id = g.owner_id where g.deleted_at is null`;

  async function groupView(id: string): Promise<Row> {
    const g = await db.one<Row>(`${LIST} and g.id = $1`, [id]);
    if (!g) return ctx.fail(404, 'not_found', 'Distribution group not found.');
    const members = await db.query<Row>(
      `select m.user_id, u.display_name as name, m.added_at from document_group_members m
       join users u on u.id = m.user_id and u.deleted_at is null where m.group_id = $1 order by lower(u.display_name)`, [id]);
    return { ...g, members };
  }
  const needId = (req: FastifyRequest): string => {
    const id = String((req.params as Row).id ?? '');
    return UUID.test(id) ? id : ctx.fail(404, 'not_found', 'Distribution group not found.');
  };

  /** Cleans the group's fields from a body (only the keys given). */
  async function input(b: Row, mode: 'create' | 'update', id?: string): Promise<Row> {
    const out: Row = {};
    const fields: Record<string, string> = {};
    if (b.name !== undefined || mode === 'create') {
      const name = String(b.name ?? '').trim();
      if (!name) fields.name = 'Name the group.';
      else if (name.length > 120) fields.name = 'The name is too long.';
      else if (await db.one('select 1 from document_groups where lower(name) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)', [name, id ?? null])) fields.name = 'Another group has this name.';
      else out.name = name;
    }
    if (b.description !== undefined) out.description = b.description === null ? null : String(b.description).trim().slice(0, 2000) || null;
    if (b.owner_id !== undefined) {
      if (b.owner_id === null || b.owner_id === '') out.owner_id = null;
      else if (!UUID.test(String(b.owner_id)) || !(await db.one('select 1 from users where id = $1 and deleted_at is null', [b.owner_id]))) fields.owner_id = 'Choose a person.';
      else out.owner_id = b.owner_id;
    }
    if (b.roles !== undefined) {
      const wanted = [...new Set(list(b.roles))];
      const known = await db.query('select key from roles where key = any($1::text[])', [wanted]);
      if (known.length !== wanted.length) fields.roles = 'One of the roles does not exist.';
      else out.roles = JSON.stringify(wanted);
    }
    if (b.departments !== undefined) {
      const wanted = [...new Set(list(b.departments))];
      const known = wanted.every((w) => UUID.test(w)) ? await db.query('select id from departments where deleted_at is null and id = any($1::uuid[])', [wanted]) : [];
      if (known.length !== wanted.length) fields.departments = 'One of the departments does not exist.';
      else out.departments = JSON.stringify(wanted);
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  /** People who may be members: active staff accounts (outside reviewers never). */
  async function checkMembers(ids: unknown): Promise<string[]> {
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string' || !UUID.test(i))) invalid({ members: 'Choose people from the list.' });
    const wanted = [...new Set(ids as string[])];
    if (wanted.length > 5000) invalid({ members: 'A group can have at most 5,000 people.' });
    const known = await db.query<{ id: string }>(
      `select u.id from users u where u.deleted_at is null and u.id = any($1::uuid[]) and not ${await reviewerSql(db, 'u.id')}`, [wanted]);
    if (known.length !== wanted.length) invalid({ members: 'One of the people does not exist or cannot be added.' });
    return wanted;
  }

  /** A group that lost readers: open requests of people who can no longer read its documents close. */
  async function narrowed(req: FastifyRequest, groupId: string): Promise<void> {
    const docs = await db.query<Row>(`select * from policies where deleted_at is null and access = 'restricted' and access_groups @> jsonb_build_array($1::text)`, [groupId]);
    for (const d of docs) await closeUnreadable(ctx, tablesFor(ctx), req, d);
  }

  async function setMembers(req: FastifyRequest, groupId: string, ids: string[]): Promise<{ added: number; removed: number }> {
    const before = (await db.query<{ user_id: string }>('select user_id from document_group_members where group_id = $1', [groupId])).map((r) => r.user_id);
    const add = ids.filter((i) => !before.includes(i));
    const remove = before.filter((i) => !ids.includes(i));
    await db.tx(async (tx) => {
      if (remove.length) await tx.query('delete from document_group_members where group_id = $1 and user_id = any($2::uuid[])', [groupId, remove]);
      for (const u of add) await tx.query('insert into document_group_members (group_id, user_id, added_by) values ($1, $2, $3) on conflict do nothing', [groupId, u, req.user!.id]);
    });
    if (remove.length) await narrowed(req, groupId);
    return { added: add.length, removed: remove.length };
  }

  app.get('/api/documents/groups', async (req) => {
    if (!mayList(req)) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
    return db.query<Row>(`${LIST} order by lower(g.name)`);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/documents/groups', tag: T, permission: 'policies.edit',
    summary: 'Distribution groups (policies.edit or policies.administer)',
    response: '[{ id, name, description, owner_id, owner_name, roles, departments, member_count, document_count }]',
  });

  app.get('/api/documents/groups/:id', async (req) => {
    if (!mayList(req)) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
    return groupView(needId(req));
  });
  ctx.describeRoute({ method: 'GET', path: '/api/documents/groups/:id', tag: T, permission: 'policies.edit', summary: 'One distribution group with its members', response: 'group + { members: [{ user_id, name, added_at }] }' });

  app.post('/api/documents/groups', admin, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const data = await input(b, 'create');
    const members = b.members === undefined ? [] : await checkMembers(b.members);
    const row = (await db.one<Row>(
      `insert into document_groups (name, description, owner_id, roles, departments, created_by, updated_by)
       values ($1, $2, $3, coalesce($4::jsonb, '[]'), coalesce($5::jsonb, '[]'), $6, $6) returning id`,
      [data.name, data.description ?? null, data.owner_id ?? null, data.roles ?? null, data.departments ?? null, req.user!.id]))!;
    await setMembers(req, row.id, members);
    const view = await groupView(row.id);
    await ctx.audit(req, {
      action: 'policy.group_create', recordType: 'document_group', recordId: row.id, summary: `Distribution group "${data.name}" created with ${members.length} ${members.length === 1 ? 'person' : 'people'}`,
      after: { name: view.name, roles: view.roles, departments: view.departments, members },
    });
    reply.code(201);
    return view;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/documents/groups', tag: T, permission: 'policies.administer', summary: 'Create a distribution group',
    body: '{ name, description?, owner_id?, roles?: [key], departments?: [uuid], members?: [user id] }', response: 'group with members',
  });

  app.patch('/api/documents/groups/:id', admin, async (req) => {
    const id = needId(req);
    const before = await groupView(id);
    const b = (req.body ?? {}) as Row;
    const data = await input(b, 'update', id);
    const keys = Object.keys(data);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 3}${k === 'roles' || k === 'departments' ? '::jsonb' : ''}`);
      await db.query(`update document_groups set ${sets.join(', ')}, updated_at = now(), updated_by = $2 where id = $1`, [id, req.user!.id, ...keys.map((k) => data[k])]);
    }
    let changed = { added: 0, removed: 0 };
    if (b.members !== undefined) changed = await setMembers(req, id, await checkMembers(b.members));
    if (data.roles !== undefined || data.departments !== undefined) await narrowed(req, id);
    const after = await groupView(id);
    await ctx.audit(req, {
      action: 'policy.group_update', recordType: 'document_group', recordId: id, summary: `Distribution group "${after.name}" changed`,
      before: { name: before.name, description: before.description, roles: before.roles, departments: before.departments, members: before.members.map((m: Row) => m.user_id) },
      after: { name: after.name, description: after.description, roles: after.roles, departments: after.departments, members: after.members.map((m: Row) => m.user_id), ...changed },
    });
    return after;
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/documents/groups/:id', tag: T, permission: 'policies.administer', summary: 'Change a distribution group',
    body: '{ name?, description?, owner_id?, roles?, departments?, members? }', response: 'group with members',
  });

  app.delete('/api/documents/groups/:id', admin, async (req) => {
    const id = needId(req);
    const g = await groupView(id);
    if (Number(g.document_count) > 0) ctx.fail(409, 'in_use', `${g.document_count} document${g.document_count === 1 ? ' uses' : 's use'} this group. Take it out of their readers first.`);
    await db.query('update document_groups set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [id, req.user!.id]);
    await ctx.audit(req, { action: 'policy.group_delete', recordType: 'document_group', recordId: id, summary: `Distribution group "${g.name}" deleted`, before: { name: g.name, members: g.members.map((m: Row) => m.user_id) } });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/documents/groups/:id', tag: T, permission: 'policies.administer', summary: 'Delete a distribution group (409 in_use while a document uses it)', response: '{ ok }' });

  app.put('/api/documents/groups/:id/members', admin, async (req) => {
    const id = needId(req);
    const g = await groupView(id);
    const ids = await checkMembers(((req.body ?? {}) as Row).user_ids);
    const changed = await setMembers(req, id, ids);
    await ctx.audit(req, { action: 'policy.group_members', recordType: 'document_group', recordId: id, summary: `Members of distribution group "${g.name}" replaced (${changed.added} added, ${changed.removed} removed)`, before: g.members.map((m: Row) => m.user_id), after: ids });
    return groupView(id);
  });
  ctx.describeRoute({ method: 'PUT', path: '/api/documents/groups/:id/members', tag: T, permission: 'policies.administer', summary: 'Replace the members of a distribution group', body: '{ user_ids: [uuid] }', response: 'group with members' });

  app.post('/api/documents/groups/:id/members', admin, async (req, reply) => {
    const id = needId(req);
    const g = await groupView(id);
    const [uid] = await checkMembers([((req.body ?? {}) as Row).user_id]);
    await db.query('insert into document_group_members (group_id, user_id, added_by) values ($1, $2, $3) on conflict do nothing', [id, uid, req.user!.id]);
    await ctx.audit(req, { action: 'policy.group_members', recordType: 'document_group', recordId: id, summary: `A person was added to distribution group "${g.name}"`, after: { added: uid } });
    reply.code(201);
    return groupView(id);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/documents/groups/:id/members', tag: T, permission: 'policies.administer', summary: 'Add one person to a distribution group', body: '{ user_id }', response: 'group with members' });

  app.delete('/api/documents/groups/:id/members/:userId', admin, async (req) => {
    const id = needId(req);
    const g = await groupView(id);
    const uid = String((req.params as Row).userId ?? '');
    if (!UUID.test(uid)) ctx.fail(404, 'not_found', 'Not a member of this group.');
    const gone = await db.query('delete from document_group_members where group_id = $1 and user_id = $2 returning user_id', [id, uid]);
    if (!gone.length) ctx.fail(404, 'not_found', 'Not a member of this group.');
    await narrowed(req, id);
    await ctx.audit(req, { action: 'policy.group_members', recordType: 'document_group', recordId: id, summary: `A person was removed from distribution group "${g.name}"`, before: { removed: uid } });
    return groupView(id);
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/documents/groups/:id/members/:userId', tag: T, permission: 'policies.administer', summary: 'Take one person out of a distribution group', response: 'group with members' });
}
