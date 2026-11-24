// Departments as a record type (E41-01): the organization's departments (core table `departments`,
// also used by accounts), each with the department it sits under and a manager. People, positions,
// assets, actions, projects and business processes point at one (`department_id`), and a role's
// grants can be scoped to a person's departments (core/scope.ts). A directory: everyone signed in
// may pick a department and read its name; the department pages need people.view.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { UUID_RE } from '../../core/errors.ts';

export function registerDepartments(ctx: ModuleContext): void {
  const { db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  /** Name unique among live departments; the parent is another live department and not one below this one. */
  async function check(patch: Row, existing: Row | null): Promise<Row> {
    const fields: Record<string, string> = {};
    const id = existing?.id ?? null;
    if (typeof patch.name === 'string') patch.name = patch.name.trim();
    if ('name' in patch) {
      if (!patch.name) fields.name = 'Give the department a name.';
      else if (patch.name.length > 80) fields.name = 'Use a name of up to 80 characters.';
      else if (await db.one('select 1 from departments where lower(name) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)', [patch.name, id])) {
        fields.name = `There is already a department called ${patch.name}.`;
      }
    }
    if (patch.parent_id && id) {
      // Walk up from the new parent: meeting this department would make a loop.
      const loop = await db.one(
        `with recursive up(id, parent_id, depth) as (
           select id, parent_id, 0 from departments where id = $1
           union all select d.id, d.parent_id, u.depth + 1 from departments d join up u on d.id = u.parent_id where u.depth < 50)
         select 1 from up where id = $2 limit 1`, [patch.parent_id, id]);
      if (loop) fields.parent_id = 'A department cannot sit under itself or under a department below it.';
    }
    if (Object.keys(fields).length) invalid(fields);
    // The name column is unique among every department, removed ones included: a removed department
    // with this name gives it up (it keeps its records, under a name that says it was removed).
    if (patch.name) {
      await db.query(
        `update departments set name = left(name, 60) || ' (removed ' || left(id::text, 8) || ')'
         where lower(name) = lower($1) and deleted_at is not null`, [patch.name]);
    }
    return patch;
  }

  ctx.defineResource({
    type: 'department', table: 'departments', module: 'people', label: 'Department', plural: 'Departments',
    path: '/api/departments', route: '/people/departments', titleField: 'name',
    directory: true,
    searchable: ['name', 'description'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text', required: true, personal: false },
      parent_id: { label: 'Part of', type: 'ref', to: 'department' },
      manager_id: { label: 'Manager', type: 'user' },
      description: { label: 'Description', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (_req, data) => check(data, null),
      beforeUpdate: (_req, existing, patch) => check(patch, existing),
    },
  });

  // ---------- merging ----------
  // Converting the old text values (E41-01) may give two departments for one ("IT" and
  // "Information Technology"). Merging moves everything that points at one department to another.

  /** Tables with a `department_id` column (accounts, the roster, positions and every record type that carries one). */
  async function referencingTables(): Promise<string[]> {
    const rows = await db.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = current_schema() and c.column_name = 'department_id' order by c.table_name`);
    return rows.map((r) => r.table_name).filter((t) => /^[a-z_][a-z0-9_]*$/.test(t));
  }

  ctx.app.post('/api/departments/:id/merge', { preHandler: ctx.requirePerm('people.delete') }, async (req: FastifyRequest) => {
    const id = String((req.params as Row).id ?? '');
    const into = String(((req.body ?? {}) as Row).into ?? '');
    if (!UUID_RE.test(id)) ctx.fail(404, 'not_found', 'Department not found.');
    if (!UUID_RE.test(into)) invalid({ into: 'Choose the department to merge into.' });
    if (id === into) invalid({ into: 'Choose another department.' });
    const from = await ctx.resources.find('department', id, req.user);
    if (!from) ctx.fail(404, 'not_found', 'Department not found.');
    const target = await ctx.resources.find('department', into, req.user);
    if (!target) invalid({ into: 'That department was not found.' });
    const moved: Record<string, number> = {};
    // Read before the transaction: on the embedded database a query outside it would wait for it.
    const tables = await referencingTables();
    await db.tx(async (tx) => {
      for (const table of tables) {
        const n = (await tx.query(`update ${table} set department_id = $2 where department_id = $1 returning 1`, [id, into])).length;
        if (n) moved[table] = n;
      }
      // Departments below it move under the one it is merged into (never under itself).
      const children = (await tx.query(`update departments set parent_id = $2, updated_at = now() where parent_id = $1 and id <> $2 and deleted_at is null returning 1`, [id, into])).length;
      if (children) moved.departments = children;
      await tx.query('update departments set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [id, req.user!.id]);
    });
    const total = Object.values(moved).reduce((a, b) => a + b, 0);
    await ctx.audit(req, {
      action: 'department.merge', recordType: 'department', recordId: id,
      summary: `Department "${from!.name}" merged into "${target!.name}" (${total} reference(s) moved)`,
      before: { name: from!.name }, after: { merged_into: into, moved },
    });
    return { ok: true, into, moved };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/departments/:id/merge', summary: 'Merge a department into another one',
    description: 'Everything that points at the department (accounts, the roster, positions, assets, actions, projects, business processes and any other record with a department) moves to `into`, departments below it move under `into`, and the department is removed. Audited.',
    permission: 'people.delete', body: '{ into: uuid }', response: '{ ok: true, into: uuid, moved: { <table>: integer } }',
  });
}
