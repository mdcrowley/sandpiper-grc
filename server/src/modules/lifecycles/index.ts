// Administration > Lifecycles (E14-31): view and change, per record type, which moves between
// statuses are allowed, which fields must be filled in before a status, and who may move a record
// to a status. The rules themselves, and their enforcement on every save, are core
// (core/lifecycle.ts, checked by core/resource.ts); this module only offers the administrators'
// routes. It is always on (not a feature area); types of switched-off areas are not listed.
import type { FastifyRequest } from 'fastify';
import { featureState, rolesShown } from '../../core/features.ts';
import { APPLICATION_RULES, lifecycleField, lifecycleManaged, NEW, type LifecycleRules, type LifecycleWho } from '../../core/lifecycle.ts';
import type { ModuleContext, ModuleDef, ResourceDef, Row } from '../../core/module.ts';

const ADMIN = 'admin.administer';
const TAG = 'Lifecycles';
const PERMISSION_RE = /^[a-z_]+\.(view|create|edit|delete|approve|administer|export)$/;

/** Permissions offered for "who may move a record to this status". */
const permissionChoices = (def: ResourceDef) => [
  { value: `${def.module}.approve`, label: `May approve (${def.module}.approve)` },
  { value: `${def.module}.administer`, label: `May administer (${def.module}.administer)` },
  { value: `${def.module}.delete`, label: `May delete (${def.module}.delete)` },
  { value: ADMIN, label: `Administrators (${ADMIN})` },
];

export function registerLifecycleRoutes(ctx: ModuleContext) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm(ADMIN) };
  const lc = () => app.lifecycles;

  /** Record types with a status field that this administrator may see (switched-off areas left out). */
  const visibleTypes = (req: FastifyRequest) => ctx.resources.all()
    .filter((d) => lifecycleField(d) !== null)
    .filter((d) => ctx.can(req.user, `${d.module}.view`) && (d.restricted !== true || ctx.can(req.user, 'security.view')))
    .sort((a, b) => a.plural.localeCompare(b.plural));

  function typeOf(req: FastifyRequest): ResourceDef {
    const type = String((req.params as Row).type ?? '');
    const def = visibleTypes(req).find((d) => d.type === type);
    if (!def) ctx.fail(404, 'not_found', 'There is no record type with a status by that name.');
    return def!;
  }

  async function statusesOf(def: ResourceDef, field: string) {
    return (await ctx.lookups.values(def.fields[field].list!)).map((v) => ({ value: v.value, label: v.label, color: v.color ?? 'gray' }));
  }

  /** Rules without entries for statuses no longer on the list. */
  function current(rules: LifecycleRules, values: Set<string>) {
    const blocked = rules.blocked.filter(([a, b]) => (a === NEW || values.has(a)) && values.has(b) && a !== b);
    const required = Object.fromEntries(Object.entries(rules.required).filter(([s, f]) => values.has(s) && Array.isArray(f) && f.length));
    const who = Object.fromEntries(Object.entries(rules.who).filter(([s, w]) => values.has(s) && w && (w.permission || w.roles?.length)));
    // Moves that wait for an approval workflow (E14-37); a move since blocked waits for nothing.
    const approvals = (rules.approvals ?? []).filter(([a, b]) => values.has(a) && values.has(b) && a !== b && !blocked.some(([x, y]) => x === a && y === b));
    return { blocked, required, who, approvals };
  }

  /** Workflows that can hold this type's moves (none when the workflows module is not loaded). */
  const workflowChoices = async (def: ResourceDef) => (lc().holder ? await lc().holder!.choices(def.type) : []);

  async function detail(req: FastifyRequest, def: ResourceDef) {
    const field = lifecycleField(def)!;
    const rules = (await lc().rulesFor(def))!;
    const statuses = await statusesOf(def, field);
    const values = new Set(statuses.map((s) => s.value));
    const by = rules.updatedBy ? await db.one<{ display_name: string }>('select display_name from users where id = $1', [rules.updatedBy]) : undefined;
    // Roles of switched-off areas are not offered (E18-64).
    const roles = rolesShown(await featureState(db), await db.query<{ key: string; name: string; enabled: boolean }>('select key, name, enabled from roles order by name'));
    return {
      type: def.type, label: def.label, plural: def.plural, route: def.route,
      field, fieldLabel: def.fields[field].label, list: def.fields[field].list,
      managed: lifecycleManaged(def, field),
      notes: APPLICATION_RULES[def.type] ?? [],
      customized: rules.customized, updatedAt: rules.updatedAt, updatedBy: by?.display_name ?? null,
      statuses,
      rules: current(rules, values),
      newStatuses: rules.customized ? statuses.filter((s) => !rules.known.includes(s.value)).map((s) => s.value) : [],
      fields: await lc().requirableFields(def, field),
      roles,
      permissions: permissionChoices(def),
      // Approval workflows a move may wait for (E14-37): the type's own, active or not; null when
      // approval workflows are not available on this server.
      workflows: lc().holder ? await workflowChoices(def) : null,
    };
  }

  /** Reads and checks the rules sent for a type; 400 `validation` naming what is wrong. */
  async function parse(req: FastifyRequest, def: ResourceDef, field: string) {
    const body = (req.body ?? {}) as Row;
    const statuses = await statusesOf(def, field);
    const values = new Set(statuses.map((s) => s.value));
    const fields = new Set((await lc().requirableFields(def, field)).map((f) => f.name));
    const roleKeys = new Set((await db.query<{ key: string }>('select key from roles')).map((r) => r.key));
    const errors: Record<string, string> = {};

    const blocked: [string, string][] = [];
    if (body.blocked !== undefined && !Array.isArray(body.blocked)) errors.blocked = 'Send the moves that are not allowed as a list of [from, to] pairs.';
    for (const p of Array.isArray(body.blocked) ? body.blocked : []) {
      const [from, to] = Array.isArray(p) ? p.map((x: unknown) => String(x ?? '')) : [];
      if (!Array.isArray(p) || p.length !== 2 || (from !== NEW && !values.has(from)) || !values.has(to)) {
        errors.blocked = `"${Array.isArray(p) ? p.join(' → ') : String(p)}" is not a move between statuses of this list.`;
        continue;
      }
      if (from !== to && !blocked.some(([a, b]) => a === from && b === to)) blocked.push([from, to]);
    }

    const required: Record<string, string[]> = {};
    if (body.required !== undefined && (typeof body.required !== 'object' || body.required === null || Array.isArray(body.required))) errors.required = 'Send the required fields as { status: [field, ...] }.';
    for (const [status, list] of Object.entries((body.required ?? {}) as Row)) {
      if (!values.has(status)) { errors.required = `"${status}" is not a status of this list.`; continue; }
      if (!Array.isArray(list)) { errors.required = `Send the fields required for "${status}" as a list.`; continue; }
      const names = [...new Set(list.map(String))];
      const bad = names.find((n) => !fields.has(n));
      if (bad) { errors.required = `"${bad}" is not a field that can be required for ${def.plural.toLowerCase()}.`; continue; }
      if (names.length) required[status] = names;
    }

    const who: Record<string, LifecycleWho> = {};
    if (body.who !== undefined && (typeof body.who !== 'object' || body.who === null || Array.isArray(body.who))) errors.who = 'Send who may set each status as { status: { permission, roles } }.';
    for (const [status, w] of Object.entries((body.who ?? {}) as Row)) {
      if (!values.has(status)) { errors.who = `"${status}" is not a status of this list.`; continue; }
      const permission = w?.permission ? String(w.permission) : null;
      const roles = Array.isArray(w?.roles) ? [...new Set<string>(w.roles.map(String))] : [];
      if (permission && !PERMISSION_RE.test(permission)) { errors.who = `"${permission}" is not a permission.`; continue; }
      const unknown = roles.find((r) => !roleKeys.has(r));
      if (unknown) { errors.who = `There is no role "${unknown}".`; continue; }
      if (permission || roles.length) who[status] = { permission, roles };
    }
    // Moves that wait for an approval workflow (E14-37): [from, to, workflow id], an allowed move
    // between two statuses (a new record never waits) and an active workflow of this type.
    const approvals: [string, string, string][] = [];
    if (body.approvals !== undefined && !Array.isArray(body.approvals)) errors.approvals = 'Send the moves that wait for approval as a list of [from, to, workflow] entries.';
    const choices = Array.isArray(body.approvals) && body.approvals.length ? await workflowChoices(def) : [];
    for (const p of Array.isArray(body.approvals) ? body.approvals : []) {
      const [from, to, wf] = Array.isArray(p) ? p.map((x: unknown) => String(x ?? '')) : [];
      if (!Array.isArray(p) || p.length !== 3 || !values.has(from) || !values.has(to) || from === to) {
        errors.approvals = `"${Array.isArray(p) ? p.slice(0, 2).join(' → ') : String(p)}" is not a move between two statuses of this list (a new record cannot wait for approval).`;
        continue;
      }
      if (blocked.some(([a, b]) => a === from && b === to)) { errors.approvals = `The move from "${from}" to "${to}" is not allowed, so it cannot wait for approval.`; continue; }
      const w = choices.find((c) => c.id === wf);
      if (!w) { errors.approvals = `Choose an approval workflow of ${def.plural.toLowerCase()} for the move from "${from}" to "${to}".`; continue; }
      if (!w.active) { errors.approvals = `"${w.name}" is not active; switch it on or choose another workflow.`; continue; }
      if (!approvals.some(([a, b]) => a === from && b === to)) approvals.push([from, to, wf]);
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    return { blocked, required, who, approvals, known: [...values] };
  }

  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const summaryOf = (r: { blocked: unknown[]; required: Record<string, string[]>; who: Record<string, unknown>; approvals?: unknown[] }) =>
    `${count(r.blocked.length, 'move')} not allowed, ${count(Object.values(r.required).flat().length, 'required field')}, `
    + `${count(Object.keys(r.who).length, 'status', 'statuses')} limited to some people`
    + `${r.approvals?.length ? `, ${count(r.approvals.length, 'move')} waiting for approval` : ''}`;

  app.get('/api/admin/lifecycles', admin, async (req) => {
    const out = [];
    for (const def of visibleTypes(req)) {
      const field = lifecycleField(def)!;
      const rules = (await lc().rulesFor(def))!;
      const statuses = await statusesOf(def, field);
      const r = current(rules, new Set(statuses.map((s) => s.value)));
      out.push({
        type: def.type, label: def.label, plural: def.plural, field, fieldLabel: def.fields[field].label, list: def.fields[field].list,
        managed: lifecycleManaged(def, field), hasNotes: Boolean(APPLICATION_RULES[def.type]?.length),
        customized: rules.customized, statuses: statuses.length,
        blocked: r.blocked.length, required: Object.values(r.required).flat().length, limited: Object.keys(r.who).length, approvals: r.approvals.length,
        newStatuses: rules.customized ? statuses.filter((s) => !rules.known.includes(s.value)).length : 0,
      });
    }
    return { types: out };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/lifecycles', tag: TAG, permission: ADMIN,
    summary: 'Record types with a status field and a summary of their lifecycle rules (E14-31)',
    description: 'Types of switched-off areas, and restricted types without `security.view`, are left out.',
    response: '{ types: [{ type, label, plural, field, fieldLabel, list, managed, hasNotes, customized, statuses, blocked, required, limited, approvals, newStatuses }] }',
  });

  app.get('/api/admin/lifecycles/:type', admin, async (req) => detail(req, typeOf(req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/lifecycles/:type', tag: TAG, permission: ADMIN,
    summary: 'The lifecycle rules of one record type, with its statuses, the fields that can be required, roles and permissions',
    response: '{ type, label, plural, route, field, fieldLabel, list, managed, notes: [string], customized, updatedAt, updatedBy, statuses: [{ value, label, color }], '
      + 'rules: { blocked: [[from, to]], required: { [status]: [field] }, who: { [status]: { permission, roles } }, approvals: [[from, to, workflow id]] }, newStatuses: [status], '
      + 'fields: [{ name, label, custom }], roles: [{ key, name, enabled }], permissions: [{ value, label }], workflows: [{ id, name, active }] | null }',
    description: '`blocked` lists the moves that are not allowed (from `""` is a new record); everything else is allowed. `managed`: the application alone sets the status, so the rules cannot be changed. `notes`: what the module\'s own rules do. `newStatuses`: statuses added to the list since the rules were saved (every move to and from them is allowed). `approvals`: moves that wait for an approval workflow before the record takes the new status (E14-37); `workflows`: the approval workflows of the type a move may name (null when approval workflows are not available).',
  });

  app.put('/api/admin/lifecycles/:type', admin, async (req) => {
    const def = typeOf(req);
    const field = lifecycleField(def)!;
    if (lifecycleManaged(def, field)) ctx.fail(409, 'set_by_application', `The application sets the ${def.fields[field].label.toLowerCase()} of ${def.plural.toLowerCase()}; its moves cannot be changed here.`);
    const before = (await lc().rulesFor(def))!;
    const next = await parse(req, def, field);
    const empty = !next.blocked.length && !Object.keys(next.required).length && !Object.keys(next.who).length && !next.approvals.length;
    if (empty) await lc().remove(def.type);
    else await lc().store(def.type, { field, ...next }, req.user!.id);
    const was = current(before, new Set(next.known));
    await ctx.audit(req, {
      action: 'lifecycle.update',
      summary: `Lifecycle of ${def.plural.toLowerCase()} changed: ${empty ? 'back to every move allowed' : summaryOf(next)}`,
      before: { record_type: def.type, field, ...(before.customized ? was : { defaults: true }) },
      after: { record_type: def.type, field, ...(empty ? { defaults: true } : { blocked: next.blocked, required: next.required, who: next.who, approvals: next.approvals }) },
    });
    return detail(req, def);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/admin/lifecycles/:type', tag: TAG, permission: ADMIN,
    summary: 'Replace the lifecycle rules of one record type (audited)',
    body: '{ blocked: [[from, to]], required: { [status]: [field] }, who: { [status]: { permission: string | null, roles: [role key] } }, approvals?: [[from, to, workflow id]] }',
    response: 'The same as GET /api/admin/lifecycles/:type',
    description: 'Every status must be a value of the type\'s status list (from may also be `""`, a new record); fields must be ones a person fills in; roles must exist. Rules with nothing in them are the defaults. 409 `set_by_application` for a type whose status only the application sets. 400 `validation` otherwise.',
  });

  app.delete('/api/admin/lifecycles/:type', admin, async (req) => {
    const def = typeOf(req);
    const before = (await lc().rulesFor(def))!;
    const removed = await lc().remove(def.type);
    if (removed) {
      const statuses = await statusesOf(def, before.field);
      await ctx.audit(req, {
        action: 'lifecycle.restore',
        summary: `Lifecycle of ${def.plural.toLowerCase()} restored to the defaults (every move allowed, nothing required)`,
        before: { record_type: def.type, field: before.field, ...current(before, new Set(statuses.map((s) => s.value))) },
        after: { record_type: def.type, field: before.field, defaults: true },
      });
    }
    return detail(req, def);
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/admin/lifecycles/:type', tag: TAG, permission: ADMIN,
    summary: 'Restore the default lifecycle of one record type: every move allowed, nothing required (audited)',
    response: 'The same as GET /api/admin/lifecycles/:type',
  });
}

const mod: ModuleDef = {
  key: 'lifecycles',
  async register(ctx: ModuleContext) {
    registerLifecycleRoutes(ctx);
  },
};
export default mod;
