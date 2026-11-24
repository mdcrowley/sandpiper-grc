// The staff roster (E29-01) and positions (E29-02): one record per member of staff, with or
// without an account, so training, certifications and policy acknowledgments can be recorded
// for frontline staff. Always on (not a feature area): policies, governance and safety use it.
//
// Contract C4 (wave 10): type `person` (table `people`, ref `PER-`, permission module `people`)
// with the fields `full_name`, `employee_number`, `department_id`, `position_id`, `user_id`
// and `status`. Other modules check `ctx.resources.get('person')` before using it.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { departmentPrepare, mayChangeScopeSources, SCOPE_SOURCE_MESSAGE } from '../../core/scope.ts';
import { registerDepartments } from './departments.ts';
import { seedPeople } from './seed.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The department a value names: a department id, or a department's name (any case), as an HR file gives it. */
export async function resolveDepartment(ctx: ModuleContext, value: unknown): Promise<string | null | undefined> {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const v = String(value).trim();
  const row = UUID_RE.test(v)
    ? await ctx.db.one<{ id: string }>('select id from departments where id = $1 and deleted_at is null', [v])
    : await ctx.db.one<{ id: string }>('select id from departments where lower(name) = lower($1) and deleted_at is null', [v]);
  return row?.id;
}

async function seedDefaults(ctx: ModuleContext) {
  await ctx.lookups.ensure('person_status', [
    { value: 'active', label: 'Active', color: 'green', sort: 10 },
    { value: 'on_leave', label: 'On leave', color: 'amber', sort: 20 },
    { value: 'left', label: 'Left', color: 'gray', sort: 30, meta: { final: true } },
  ], { module: 'people' });
  await ctx.lookups.ensure('person_source', [
    { value: 'manual', label: 'Entered by hand', color: 'gray', sort: 10 },
    { value: 'import', label: 'Imported', color: 'blue', sort: 20 },
    { value: 'account', label: 'From an account', color: 'teal', sort: 30 },
  ], { module: 'people' });
}

async function register(ctx: ModuleContext): Promise<void> {
  registerDepartments(ctx);
  // A department may be given by its name, as HR files give it (E41-01: department_id is a reference now).
  const prepareDepartment = departmentPrepare(ctx.db);
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const byImport = (req: FastifyRequest | null) => !!req && /\/api\/(v1\/)?import\//.test(req.url);

  /** Rules that hold however a person is written: one person per account, email and employee number. */
  async function checkPerson(req: FastifyRequest | null, patch: Row, existing: Row | null): Promise<Row> {
    const fields: Record<string, string> = {};
    const id = existing?.id ?? null;
    if ('department_id' in patch) {
      const dep = await resolveDepartment(ctx, patch.department_id);
      if (dep === undefined) fields.department_id = `"${patch.department_id}" is not in the department list.`;
      else patch.department_id = dep;
    }
    for (const k of ['full_name', 'preferred_name', 'employee_number', 'email', 'phone'] as const) {
      if (typeof patch[k] === 'string') patch[k] = patch[k].trim() || null;
    }
    if ('full_name' in patch && !patch.full_name) fields.full_name = 'Give the person\'s name.';
    if (patch.email) {
      if (!EMAIL_RE.test(patch.email)) fields.email = `"${patch.email}" is not an email address.`;
      else if (await ctx.db.one(
        'select 1 from people where lower(email) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)', [patch.email, id])) {
        fields.email = 'Another person on the roster has this email address.';
      }
    }
    if (patch.employee_number && await ctx.db.one(
      'select 1 from people where lower(employee_number) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)',
      [patch.employee_number, id])) {
      fields.employee_number = `Employee number ${patch.employee_number} is already on the roster.`;
    }
    if (patch.user_id) {
      if (!(await ctx.db.one('select 1 from users where id = $1 and deleted_at is null', [patch.user_id]))) fields.user_id = 'That account was not found.';
      else if (await ctx.db.one('select 1 from people where user_id = $1 and deleted_at is null and ($2::uuid is null or id <> $2::uuid)', [patch.user_id, id])) {
        fields.user_id = 'That account already belongs to another person on the roster.';
      }
    }
    if (patch.supervisor_person_id && id && patch.supervisor_person_id === id) fields.supervisor_person_id = 'A person cannot be their own supervisor.';
    if (Object.keys(fields).length) invalid(fields);
    // The same email as an account is the same person: link it (unless that account is someone else's).
    const merged = { ...(existing ?? {}), ...patch };
    if (!merged.user_id && merged.email && ('email' in patch || !existing)) {
      const u = await ctx.db.one<{ id: string }>(
        `select u.id from users u where lower(u.email) = lower($1) and u.deleted_at is null
           and not exists (select 1 from people p where p.user_id = u.id and p.deleted_at is null and ($2::uuid is null or p.id <> $2::uuid))`,
        [merged.email, id]);
      if (u) patch.user_id = u.id;
    }
    if (!existing && byImport(req)) patch.source = 'import';
    // No department given: the position's department, when it has one.
    if (!merged.department_id && patch.position_id) {
      const pos = await ctx.db.one<{ department_id: string | null }>('select department_id from positions where id = $1 and deleted_at is null', [patch.position_id]);
      if (pos?.department_id) patch.department_id = pos.department_id;
    }
    refuseOwnScopeChange(req, patch, existing);
    return patch;
  }

  /**
   * The roster row linked to a person's own account gives them its department and work site as scope
   * (core/scope.ts). Someone whose roles are scoped may not link a row to their own account, nor change
   * the department, work site or status of a row that is (or becomes) theirs: that would widen their
   * own reach. Taking their own account off a row is allowed.
   */
  function refuseOwnScopeChange(req: FastifyRequest | null, patch: Row, existing: Row | null): void {
    const me = req?.user?.id;
    if (!me || mayChangeScopeSources(req?.user)) return;
    const after = { ...(existing ?? {}), ...patch };
    if (after.user_id !== me) return;
    const changed = (k: string) => k in patch && String(patch[k] ?? '') !== String(existing?.[k] ?? '');
    const fields: Record<string, string> = {};
    for (const k of ['user_id', 'department_id', 'work_site_id', 'status']) {
      if (existing ? changed(k) : k === 'user_id') fields[k] = SCOPE_SOURCE_MESSAGE;
    }
    if (Object.keys(fields).length) invalid(fields);
  }

  ctx.defineResource({
    type: 'person', table: 'people', module: 'people', label: 'Person', plural: 'People',
    path: '/api/people', route: '/people', titleField: 'full_name', ref: { field: 'ref', prefix: 'PER-' },
    searchable: ['full_name', 'preferred_name', 'employee_number', 'email'],
    defaultSort: { field: 'full_name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      full_name: { label: 'Full name', type: 'text', required: true, personal: true },
      preferred_name: { label: 'Preferred name', type: 'text', personal: true },
      employee_number: { label: 'Employee number', type: 'text', personal: true },
      email: { label: 'Email', type: 'text', personal: true },
      phone: { label: 'Phone', type: 'text', personal: true },
      // Writes also accept the department's name, as HR files give it.
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      position_id: { label: 'Position', type: 'ref', to: 'position' },
      work_site_id: { label: 'Work site', type: 'ref', to: 'site' },
      user_id: { label: 'Account', type: 'user', personal: true },
      supervisor_person_id: { label: 'Supervisor', type: 'ref', to: 'person', personal: true },
      hire_date: { label: 'Hire date', type: 'date', personal: true },
      status: { label: 'Status', type: 'lookup', list: 'person_status', default: 'active' },
      source: { label: 'Source', type: 'lookup', list: 'person_source', default: 'manual', readOnly: true },
      notes: { label: 'Notes', type: 'longtext', personal: true },
    },
    // Role grants scoped to departments or sites (E41-01) reach the roster by department and work site.
    scope: { department: 'department_id', site: 'work_site_id' },
    hooks: {
      prepare: (req, input) => prepareDepartment(req, input),
      beforeCreate: (req, data) => checkPerson(req, data, null),
      beforeUpdate: (req, existing, patch) => checkPerson(req, patch, existing),
    },
  });

  ctx.defineResource({
    type: 'position', table: 'positions', module: 'people', label: 'Position', plural: 'Positions',
    path: '/api/positions', route: '/people/positions', titleField: 'name', ref: { field: 'ref', prefix: 'POS-' },
    searchable: ['name', 'code', 'description'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true },
      code: { label: 'Code', type: 'text' },
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      description: { label: 'Description', type: 'longtext', personal: false },
      // Hidden while the safety area is off (AREAS safety fields: { position: ['safety_sensitive'] }).
      safety_sensitive: { label: 'Safety-sensitive', type: 'boolean', default: false },
      active: { label: 'Active', type: 'boolean', default: true },
    },
    scope: { department: 'department_id' },
    hooks: {
      prepare: (req, input) => prepareDepartment(req, input),
      beforeCreate: async (_req, data) => checkPosition(data, null),
      beforeUpdate: async (_req, existing, patch) => checkPosition(patch, existing),
    },
  });

  async function checkPosition(patch: Row, existing: Row | null): Promise<Row> {
    const fields: Record<string, string> = {};
    if ('department_id' in patch) {
      const dep = await resolveDepartment(ctx, patch.department_id);
      if (dep === undefined) fields.department_id = `"${patch.department_id}" is not in the department list.`;
      else patch.department_id = dep;
    }
    if (typeof patch.name === 'string') patch.name = patch.name.trim();
    if ('name' in patch && !patch.name) fields.name = 'Give the position a name.';
    if (patch.name && await ctx.db.one(
      'select 1 from positions where lower(name) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)', [patch.name, existing?.id ?? null])) {
      fields.name = `There is already a position called ${patch.name}.`;
    }
    if (Object.keys(fields).length) invalid(fields);
    return patch;
  }

  // The department choice for people and positions (the organization's list; names only).
  ctx.app.get('/api/people/departments', { preHandler: ctx.requirePerm('people.view') }, async () =>
    ctx.db.query('select id, name from departments where deleted_at is null order by lower(name)'));
  ctx.describeRoute({
    method: 'GET', path: '/api/people/departments', summary: 'The organization\'s departments, for the roster and positions',
    permission: 'people.view', response: '[{ id, name }]',
  });

  // Head counts by position and status, for the roster page. Figures: every person counts.
  ctx.app.get('/api/people/summary', { preHandler: ctx.requirePerm('people.view') }, async () => {
    const byStatus = await ctx.db.query<{ status: string; n: number }>(
      'select status, count(*)::int as n from people where deleted_at is null group by status');
    const byPosition = await ctx.db.query<{ position_id: string | null; name: string | null; n: number }>(
      `select p.position_id, pos.name, count(*)::int as n from people p
       left join positions pos on pos.id = p.position_id and pos.deleted_at is null
       where p.deleted_at is null and p.status <> 'left' group by p.position_id, pos.name order by pos.name nulls last`);
    const accounts = await ctx.db.one<{ n: number }>(
      `select count(*)::int as n from people where deleted_at is null and status <> 'left' and user_id is not null`);
    return { byStatus, byPosition, withAccount: accounts?.n ?? 0 };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/people/summary', summary: 'Roster head counts by status and position',
    permission: 'people.view', response: '{ byStatus: [{ status, n }], byPosition: [{ position_id, name, n }], withAccount }',
  });
}

const mod: ModuleDef = {
  key: 'people',
  seedDefaults,
  register,
  seed: seedPeople,
};
export default mod;
