// HTTP routes of the approval workflows (E14-06). Administrators define workflows; everyone sees
// and decides the approvals waiting for them, and sees the workflows on records they may view.
import type { FastifyRequest } from 'fastify';
import { approvalKind, approvalKinds } from '../../core/approval-kinds.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { FieldDef, ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { checkDefinition, type DefinitionContext, type WorkflowDef } from './engine.ts';
import { stepPeople, type Service } from './service.ts';
import { registerStandinRoutes } from './standins.ts';

const ADMIN = 'admin.administer';
const DEF_COLUMNS = ['record_type', 'kind', 'name', 'description', 'active', 'trigger', 'trigger_field', 'trigger_value', 'conditions', 'steps', 'on_approve', 'on_reject'] as const;
/** Field types offered for conditions and outcomes (json fields are not). */
const USABLE = new Set(['text', 'longtext', 'number', 'currency', 'date', 'datetime', 'boolean', 'lookup', 'user', 'ref']);

const asJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const uuids = (v: unknown): string[] => [...new Set((JSON.stringify(v ?? null).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []))];
const text = (v: unknown, max = 2000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function registerRoutes(ctx: ModuleContext, svc: Service) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm(ADMIN) };
  const param = (req: FastifyRequest, name = 'id') => {
    const v = String((req.params as Row)[name] ?? '');
    if (!UUID_RE.test(v)) ctx.fail(404, 'not_found', 'Not found.');
    return v;
  };

  /** Names of people by id (for definitions and decisions). */
  async function names(list: string[]): Promise<Record<string, string>> {
    if (!list.length) return {};
    const rows = await db.query<{ id: string; display_name: string }>('select id, display_name from users where id = any($1::uuid[])', [list]);
    return Object.fromEntries(rows.map((r) => [r.id, r.display_name]));
  }

  const usableFields = (def: ResourceDef): Record<string, FieldDef> =>
    Object.fromEntries(Object.entries(def.fields).filter(([, f]) => USABLE.has(f.type)));

  // ---------- definitions (administrators) ----------

  async function definitionContext(input: Row): Promise<DefinitionContext> {
    const types: DefinitionContext['types'] = {};
    for (const d of ctx.resources.all()) types[d.type] = { fields: usableFields(d) };
    const lists = new Map<string, string[]>();
    const def = ctx.resources.get(String(input.record_type ?? ''));
    for (const f of Object.values(def?.fields ?? {})) {
      if (f.type === 'lookup' && f.list && !lists.has(f.list)) lists.set(f.list, (await ctx.lookups.values(f.list)).map((v) => v.value));
    }
    const roles = (await db.query<{ key: string }>('select key from roles')).map((r) => r.key);
    const mentioned = uuids(input);
    const users = mentioned.length
      ? (await db.query<{ id: string }>(`select id from users where id = any($1::uuid[]) and status = 'active' and deleted_at is null`, [mentioned])).map((r) => r.id)
      : [];
    const kinds = Object.fromEntries(approvalKinds(app).filter((k) => ctx.resources.get(k.recordType)).map((k) => [k.key, k.recordType]));
    return { types, lookup: (list) => lists.get(list) ?? [], roles, users, kinds, permissions: await permissionKeys() };
  }

  /** Permission keys roles grant, and those approval kinds ask for (for steps approved by a permission). */
  async function permissionKeys(): Promise<string[]> {
    const granted = (await db.query<{ permission: string }>('select distinct permission from role_permissions')).map((r) => r.permission);
    const asked = approvalKinds(app).map((k) => k.approverPermission).filter(Boolean) as string[];
    return [...new Set([...granted, ...asked])].filter((p) => /^[a-z_]+.[a-z_]+$/.test(p)).sort();
  }

  async function present(row: Row): Promise<Row> {
    const def = ctx.resources.get(row.record_type);
    const kind = approvalKind(app, row.kind);
    const counts = await db.one<{ running: number; total: number }>(
      `select count(*) filter (where status = 'running')::int as running, count(*)::int as total from workflow_instances where definition_id = $1`, [row.id]);
    return {
      ...row,
      record_type_label: def?.label ?? row.record_type,
      kind_label: kind?.label ?? null, kind_starts_when: kind?.startsWhen ?? null, kind_outcome: kind?.outcome ?? null,
      // The record type's area is switched off (or its module is not loaded): the workflow does nothing meanwhile.
      available: Boolean(def),
      running: counts?.running ?? 0,
      started: counts?.total ?? 0,
      people: await names(uuids([row.steps, row.on_approve, row.on_reject])),
    };
  }

  async function save(req: FastifyRequest, existing: Row | null): Promise<Row> {
    const input = { ...(existing ?? {}), ...((req.body ?? {}) as Row) };
    // A workflow's approval kind is chosen when it is made and never changes.
    if (existing) input.kind = existing.kind ?? null;
    const { def, errors } = checkDefinition(input, await definitionContext(input));
    if (errors) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const d = def as WorkflowDef;
    const values = DEF_COLUMNS.map((c) => (['conditions', 'steps', 'on_approve', 'on_reject'].includes(c) ? JSON.stringify(d[c]) : d[c]));
    let row: Row;
    if (existing) {
      row = (await db.one<Row>(
        `update workflow_definitions set ${DEF_COLUMNS.map((c, i) => `${c} = $${i + 2}${['conditions', 'steps', 'on_approve', 'on_reject'].includes(c) ? '::jsonb' : ''}`).join(', ')},
           version = version + 1, updated_at = now(), updated_by = $${DEF_COLUMNS.length + 2}
         where id = $1 returning *`, [existing.id, ...values, req.user!.id]))!;
      await ctx.audit(req, { action: 'workflow_definition.update', summary: `Approval workflow "${row.name}" changed`, before: pick(existing), after: pick(row) });
    } else {
      row = (await db.one<Row>(
        `insert into workflow_definitions (${DEF_COLUMNS.join(', ')}, created_by, updated_by)
         values (${DEF_COLUMNS.map((c, i) => `$${i + 1}${['conditions', 'steps', 'on_approve', 'on_reject'].includes(c) ? '::jsonb' : ''}`).join(', ')}, $${DEF_COLUMNS.length + 1}, $${DEF_COLUMNS.length + 1}) returning *`,
        [...values, req.user!.id]))!;
      await ctx.audit(req, { action: 'workflow_definition.create', summary: `Approval workflow "${row.name}" created for ${ctx.resources.get(row.record_type)?.plural.toLowerCase() ?? row.record_type}`, after: pick(row) });
    }
    svc.forget();
    return present(row);
  }
  const pick = (row: Row) => Object.fromEntries(DEF_COLUMNS.map((c) => [c, row[c]]));

  async function definition(req: FastifyRequest): Promise<Row> {
    const row = await db.one<Row>('select * from workflow_definitions where id = $1 and deleted_at is null', [param(req)]);
    // A workflow of a switched-off record type is hidden with its area (E14-34).
    if (!row || !ctx.resources.get(row.record_type)) ctx.fail(404, 'not_found', 'Workflow not found.');
    return row!;
  }

  app.get('/api/workflows/options', admin, async () => {
    const types = ctx.resources.all().map((d) => ({
      type: d.type, label: d.label, plural: d.plural, module: d.module, restricted: d.restricted ?? false,
      fields: Object.entries(usableFields(d)).map(([name, f]) => ({ name, label: f.label, type: f.type, list: f.list ?? null, readOnly: Boolean(f.readOnly) })),
    })).sort((a, b) => a.plural.localeCompare(b.plural));
    const listNames = [...new Set(types.flatMap((t) => t.fields.filter((f) => f.list).map((f) => f.list as string)))];
    const lookups: Record<string, Row[]> = {};
    for (const l of listNames) lookups[l] = (await ctx.lookups.values(l)).map((v) => ({ value: v.value, label: v.label, color: v.color ?? null }));
    const roles = await db.query<Row>('select key, name, enabled from roles order by name');
    const departments = await db.query<Row>(
      `select d.id, d.name, h.user_id as head_id, u.display_name as head_name
       from departments d left join workflow_department_heads h on h.department_id = d.id left join users u on u.id = h.user_id
       where d.deleted_at is null order by d.name`);
    const kinds = approvalKinds(app).filter((k) => ctx.resources.get(k.recordType))
      .map((k) => ({ key: k.key, record_type: k.recordType, label: k.label, starts_when: k.startsWhen, outcome: k.outcome, approver_permission: k.approverPermission ?? null }));
    return { types, lookups, roles, departments, kinds, permissions: await permissionKeys() };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/workflows/options', tag: 'Workflows', permission: ADMIN,
    summary: 'What a workflow can use: record types and their fields, list values, roles and departments with their heads',
    response: '{ types: [{ type, label, plural, module, restricted, fields: [{ name, label, type, list, readOnly }] }], lookups: { [list]: [{ value, label, color }] }, roles: [{ key, name, enabled }], departments: [{ id, name, head_id, head_name }], kinds: [{ key, record_type, label, starts_when, outcome, approver_permission }], permissions: [string] }',
  });

  app.get('/api/workflows/definitions', admin, async (req) => {
    const type = text((req.query as Row).record_type, 60);
    const rows = await db.query<Row>(
      `select * from workflow_definitions where deleted_at is null and ($1::text is null or record_type = $1) order by record_type, name`, [type]);
    // Workflows of switched-off record types are hidden with their area (E14-34).
    return { rows: await Promise.all(rows.filter((r) => ctx.resources.get(r.record_type)).map(present)) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/workflows/definitions', tag: 'Workflows', permission: ADMIN,
    summary: 'Approval workflows, with how many are running (those of switched-off record types are left out)', query: { record_type: 'Only the workflows of this record type' },
    response: '{ rows: [workflow definition with kind, kind_label, record_type_label, available, running, started, people] }',
  });

  const DEF_BODY = {
    type: 'object',
    description: 'A workflow definition. `kind` (set when it is made, never changed): the approval kind it serves, from GET /api/workflows/options; its module starts it and `trigger` is then `module`. `trigger`: create | status | manual (with `trigger_field` and `trigger_value` for status). '
      + '`conditions`: [{ field, op: eq|ne|gt|gte|lt|lte|in|empty|set, value }]. `steps`: [{ name, approvers: { kind: users, users: [id] } | '
      + '{ kind: role, role } | { kind: people, users, roles } | { kind: permission, permission } | { kind: field, field } | { kind: department_head, from: requester|field, field }, quorum: any|all|n, conditions, '
      + 'due_hours, escalate_to: { users, role } }]. `on_approve`, `on_reject`: [{ field, value }] (value `today` for a date, `approver` or `requester` for a person).',
  };

  app.post('/api/workflows/definitions', admin, async (req, reply) => reply.code(201).send(await save(req, null)));
  ctx.describeRoute({ method: 'POST', path: '/api/workflows/definitions', tag: 'Workflows', permission: ADMIN, summary: 'Define an approval workflow', body: DEF_BODY, response: 'The workflow' });

  app.get('/api/workflows/definitions/:id', admin, async (req) => present(await definition(req)));
  ctx.describeRoute({ method: 'GET', path: '/api/workflows/definitions/:id', tag: 'Workflows', permission: ADMIN, summary: 'One approval workflow', response: 'The workflow' });

  app.patch('/api/workflows/definitions/:id', admin, async (req) => save(req, await definition(req)));
  ctx.describeRoute({ method: 'PATCH', path: '/api/workflows/definitions/:id', tag: 'Workflows', permission: ADMIN, summary: 'Change an approval workflow (running ones keep the version they started with)', body: DEF_BODY, response: 'The workflow' });

  app.delete('/api/workflows/definitions/:id', admin, async (req) => {
    const row = await definition(req);
    await db.query('update workflow_definitions set deleted_at = now(), active = false, updated_by = $2 where id = $1', [row.id, req.user!.id]);
    await ctx.audit(req, { action: 'workflow_definition.delete', summary: `Approval workflow "${row.name}" removed`, before: pick(row) });
    svc.forget();
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/workflows/definitions/:id', tag: 'Workflows', permission: ADMIN, summary: 'Remove an approval workflow (running ones finish as they are)', response: '{ ok: true }' });

  app.put('/api/workflows/department-heads/:id', admin, async (req) => {
    const dept = await db.one<Row>('select id, name from departments where id = $1 and deleted_at is null', [param(req)]) ?? ctx.fail(404, 'not_found', 'Department not found.');
    const userId = text((req.body as Row)?.user_id, 40);
    const before = await db.one<Row>('select user_id from workflow_department_heads where department_id = $1', [dept.id]);
    if (userId) {
      const user = await db.one<Row>(`select id, display_name from users where id = $1 and status = 'active' and deleted_at is null`, [UUID_RE.test(userId) ? userId : null]);
      if (!user) ctx.fail(400, 'validation', 'Choose an active person.', { user_id: 'Choose an active person.' });
      await db.query(
        `insert into workflow_department_heads (department_id, user_id, updated_by) values ($1, $2, $3)
         on conflict (department_id) do update set user_id = excluded.user_id, updated_by = excluded.updated_by, updated_at = now()`,
        [dept.id, userId, req.user!.id]);
      await ctx.audit(req, { action: 'workflow_department_head.set', summary: `${user!.display_name} is now the head of ${dept.name} for approvals`, before: { head: before?.user_id ?? null }, after: { head: userId } });
    } else {
      await db.query('delete from workflow_department_heads where department_id = $1', [dept.id]);
      await ctx.audit(req, { action: 'workflow_department_head.clear', summary: `${dept.name} no longer has a head for approvals`, before: { head: before?.user_id ?? null } });
    }
    return { department_id: dept.id, head_id: userId };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/workflows/department-heads/:id', tag: 'Workflows', permission: ADMIN,
    summary: 'Set (or clear, with null) the head of a department, who approves "department head" steps', body: '{ user_id: uuid | null }', response: '{ department_id, head_id }',
  });

  app.get('/api/workflows/running', admin, async (req) => {
    const rows = await db.query<Row>(
      `select i.*, u.display_name as requested_by_name, s.name as step_name, s.due_at, s.note as step_note
       from workflow_instances i left join users u on u.id = i.requested_by
       left join workflow_steps s on s.instance_id = i.id and s.position = i.current_step
       where i.status = 'running' order by i.started_at desc limit 500`);
    const out: Row[] = [];
    for (const r of rows) {
      const def = ctx.resources.get(r.record_type);
      if (!def) continue;
      out.push({
        id: r.id, workflow: r.name, record_type: r.record_type, record_type_label: def.label, record_id: r.record_id,
        // Administrators may not hold security.view: a restricted record is named only for those who may see it.
        record_label: (await svc.maySee(req.user!, def, r.record_id)) ? await svc.recordName(def.type, r.record_id) : null,
        route: `${def.route}/${r.record_id}`, requested_by_name: r.requested_by_name, started_at: r.started_at,
        step_name: r.step_name, due_at: r.due_at, problem: r.step_note,
      });
    }
    return { rows: out };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/workflows/running', tag: 'Workflows', permission: ADMIN,
    summary: 'Every workflow running now, with its current step (records the administrator may not see are not named)',
    response: '{ rows: [{ id, workflow, record_type, record_type_label, record_id, record_label, route, requested_by_name, started_at, step_name, due_at, problem }] }',
  });

  // ---------- approvals (everyone) ----------

  /** The record behind a workflow, if its type is on and the person may see it. */
  async function visible(req: FastifyRequest, type: string, id: string): Promise<{ def: ResourceDef; label: string; ref: string | null; title: string } | null> {
    const def = ctx.resources.get(type);
    if (!def || !(await svc.maySee(req.user!, def, id))) return null;
    const row = (await ctx.resources.find(type, id))!;
    return { def, label: await svc.recordName(type, id), ref: def.ref ? row[def.ref.field] ?? null : null, title: String(row[def.titleField] ?? '') };
  }

  async function approvalItem(req: FastifyRequest, r: Row): Promise<Row | null> {
    const rec = await visible(req, r.record_type, r.record_id);
    if (!rec) return null;
    const total = asJson<WorkflowDef>(r.definition).steps.length;
    return {
      step_id: r.step_id, instance_id: r.instance_id, workflow: r.workflow_name, step: r.step_name, position: r.position, steps_total: total,
      record_type: r.record_type, record_type_label: rec.def.label, record_id: r.record_id, record_ref: rec.ref, record_title: rec.title,
      route: `${rec.def.route}/${r.record_id}`, requested_by: r.requested_by, requested_by_name: r.requested_by_name, started_at: r.step_started_at,
      due_at: r.due_at, overdue: Boolean(r.due_at && new Date(r.due_at).getTime() < Date.now()), escalated: Boolean(r.escalated_at),
      approvals: r.approvals ?? 0, required: r.required, status: r.instance_status, step_status: r.step_status,
      decision: r.my_decision ?? null, decided_at: r.my_decided_at ?? null, comment: r.my_comment ?? null,
      kind: r.kind ?? null, kind_label: approvalKind(app, r.kind)?.label ?? null,
      // E14-32: the approver this person stands in for here (waiting), or decided for (decided).
      on_behalf_of: r.on_behalf_of ?? null, on_behalf_of_name: r.on_behalf_of ? (await names([r.on_behalf_of]))[r.on_behalf_of] ?? 'Someone' : null,
    };
  }

  const STEP_SELECT = `select s.id as step_id, s.instance_id, s.name as step_name, s.position, s.status as step_status, s.required, s.due_at,
      s.escalated_at, s.started_at as step_started_at, s.approvers, s.principals, s.standins, i.kind, i.name as workflow_name, i.definition, i.record_type, i.record_id, i.requested_by,
      i.status as instance_status, u.display_name as requested_by_name,
      (select count(*)::int from workflow_decisions d where d.step_id = s.id and d.decision = 'approved') as approvals
    from workflow_steps s join workflow_instances i on i.id = s.instance_id left join users u on u.id = i.requested_by`;

  /** Steps waiting for this person's decision, soonest due first. */
  async function waiting(req: FastifyRequest): Promise<Row[]> {
    const me = req.user!.id;
    const rows = await db.query<Row>(
      `${STEP_SELECT}
       where s.status = 'pending' and i.status = 'running' and s.approvers @> $1::jsonb and i.requested_by is distinct from $2
         and not exists (select 1 from workflow_decisions d where d.step_id = s.id and d.user_id = $2)
       order by s.due_at nulls last, s.started_at limit 200`, [JSON.stringify([me]), me]);
    const out: Row[] = [];
    for (const r of rows) {
      // A stand-in sees a step only while their period runs and someone they stand in for has not decided.
      const ds = await db.query<{ user_id: string; on_behalf_of: string | null }>('select user_id, on_behalf_of from workflow_decisions where step_id = $1', [r.step_id]);
      const may = await svc.mayDecide({ status: 'pending', approvers: r.approvers, principals: r.principals, standins: r.standins }, r.requested_by, me, ds);
      if (!may.ok) continue;
      const item = await approvalItem(req, { ...r, on_behalf_of: may.onBehalfOf });
      if (item) out.push(item);
    }
    return out;
  }

  app.get('/api/workflows/approvals', async (req) => {
    const view = String((req.query as Row).view ?? 'waiting');
    const me = req.user!.id;
    if (view === 'decided') {
      const rows = await db.query<Row>(
        `${STEP_SELECT.replace('from workflow_steps s', ', d.decision as my_decision, d.created_at as my_decided_at, d.comment as my_comment, d.on_behalf_of from workflow_steps s')}
         join workflow_decisions d on d.step_id = s.id and d.user_id = $1 order by d.created_at desc limit 100`, [me]);
      return { rows: (await Promise.all(rows.map((r) => approvalItem(req, r)))).filter(Boolean) };
    }
    if (view === 'requested') {
      const rows = await db.query<Row>(
        `select i.*, s.name as step_name, s.due_at, s.required, s.id as step_id,
           (select count(*)::int from workflow_decisions d where d.step_id = s.id and d.decision = 'approved') as approvals
         from workflow_instances i left join workflow_steps s on s.instance_id = i.id and s.position = i.current_step
         where i.requested_by = $1 order by i.started_at desc limit 100`, [me]);
      const out: Row[] = [];
      for (const r of rows) {
        const rec = await visible(req, r.record_type, r.record_id);
        if (!rec) continue;
        out.push({
          instance_id: r.id, workflow: r.name, status: r.status, record_type: r.record_type, record_type_label: rec.def.label, record_id: r.record_id,
          record_ref: rec.ref, record_title: rec.title, route: `${rec.def.route}/${r.record_id}`, started_at: r.started_at, finished_at: r.finished_at,
          step: r.step_name, step_id: r.step_id, due_at: r.due_at, approvals: r.approvals ?? 0, required: r.required, steps_total: asJson<WorkflowDef>(r.definition).steps.length,
          position: r.current_step, outcome_note: r.outcome_note, outcome_error: r.outcome_error,
        });
      }
      return { rows: out };
    }
    return { rows: await waiting(req) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/workflows/approvals', tag: 'Workflows',
    summary: 'Approvals for the signed-in person: waiting for their decision (default), decided by them, or requested by them',
    query: { view: '`waiting` (default), `decided` or `requested`' },
    response: '{ rows: [{ step_id, instance_id, workflow, step, position, steps_total, record_type, record_type_label, record_id, record_ref, record_title, route, requested_by_name, due_at, overdue, escalated, approvals, required, kind, kind_label, on_behalf_of, on_behalf_of_name, decision?, comment? }] }',
  });

  app.get('/api/workflows/approvals/count', async (req) => ({ waiting: (await waiting(req)).length }));
  ctx.describeRoute({ method: 'GET', path: '/api/workflows/approvals/count', tag: 'Workflows', summary: 'How many approvals are waiting for the signed-in person', response: '{ waiting: integer }' });

  // ---------- one record ----------

  async function recordDef(req: FastifyRequest): Promise<ResourceDef> {
    const { type } = req.params as Row;
    const id = param(req);
    const def = ctx.resources.get(String(type));
    if (!def || !(await svc.maySee(req.user!, def, id))) ctx.fail(404, 'not_found', 'Record not found.');
    return def!;
  }

  app.get('/api/workflows/records/:type/:id', async (req) => {
    const def = await recordDef(req);
    const id = param(req);
    const me = req.user!.id;
    const instances = await db.query<Row>(
      'select * from workflow_instances where record_type = $1 and record_id = $2 order by started_at desc limit 20', [def.type, id]);
    const steps = instances.length ? await db.query<Row>('select * from workflow_steps where instance_id = any($1::uuid[]) order by position', [instances.map((i) => i.id)]) : [];
    const decisions = steps.length ? await db.query<Row>('select * from workflow_decisions where step_id = any($1::uuid[]) order by created_at', [steps.map((s) => s.id)]) : [];
    const people = await names([...new Set([...instances.map((i) => i.requested_by), ...steps.flatMap((s) => [...asJson<string[]>(s.approvers), ...stepPeople(s).principals]),
      ...decisions.flatMap((d) => [d.user_id, d.on_behalf_of])].filter(Boolean))]);
    const deciding = new Map<string, { ok: boolean; onBehalfOf: string | null }>();
    for (const s of steps) {
      const inst = instances.find((i) => i.id === s.instance_id)!;
      if (inst.status !== 'running' || s.status !== 'pending') continue;
      deciding.set(s.id, await svc.mayDecide(s, inst.requested_by ?? null, me, decisions.filter((d) => d.step_id === s.id) as { user_id: string; on_behalf_of: string | null }[]));
    }
    const isAdmin = ctx.can(req.user, ADMIN);
    const out = instances.map((i) => {
      const wf = asJson<WorkflowDef>(i.definition);
      const kind = approvalKind(app, i.kind);
      const mine = steps.filter((s) => s.instance_id === i.id);
      return {
        id: i.id, workflow: i.name, status: i.status, current_step: i.current_step, started_at: i.started_at, finished_at: i.finished_at,
        requested_by: i.requested_by, requested_by_name: i.requested_by ? people[i.requested_by] ?? 'Someone' : null, note: i.note,
        outcome_note: i.outcome_note, outcome_error: i.outcome_error,
        kind: i.kind ?? null, kind_label: kind?.label ?? null,
        can_cancel: i.status === 'running' && (i.requested_by === me || isAdmin),
        can_reassign: i.status === 'running' && isAdmin,
        steps: wf.steps.map((sd, position) => {
          const s = mine.find((x) => x.position === position);
          const sp = s ? stepPeople(s) : { approvers: [] as string[], principals: [] as string[], standins: {} as Record<string, string[]> };
          const ds = s ? decisions.filter((d) => d.step_id === s.id) : [];
          const mayI = s ? deciding.get(s.id) : undefined;
          return {
            position, key: sd.key, name: sd.name, id: s?.id ?? null,
            status: s?.status ?? (i.status === 'running' ? 'waiting' : 'not_reached'),
            approvers: sp.principals.map((a) => ({ id: a, name: people[a] ?? 'Someone' })),
            // E14-32: stand-ins added beside the approvers they stand in for.
            standins: Object.entries(sp.standins).map(([sid, forWhom]) => ({ id: sid, name: people[sid] ?? 'Someone', for: forWhom.map((f) => ({ id: f, name: people[f] ?? 'Someone' })) })),
            required: s?.required ?? null, quorum: sd.quorum, due_at: s?.due_at ?? null, escalated_at: s?.escalated_at ?? null, note: s?.note ?? null,
            has_conditions: (sd.conditions ?? []).length > 0,
            decisions: ds.map((d) => ({
              user_id: d.user_id, name: people[d.user_id] ?? 'Someone', decision: d.decision, comment: d.comment, at: d.created_at,
              on_behalf_of: d.on_behalf_of ?? null, on_behalf_of_name: d.on_behalf_of ? people[d.on_behalf_of] ?? 'Someone' : null, adopted: d.origin === 'adopted',
            })),
            can_decide: Boolean(mayI?.ok),
            on_behalf_of_name: mayI?.ok && mayI.onBehalfOf ? people[mayI.onBehalfOf] ?? 'Someone' : null,
          };
        }),
      };
    });
    const startable = ctx.can(req.user, `${def.module}.edit`)
      // A kind's workflows are started by their module (submitting a change, asking for a disposal).
      ? (await db.query<Row>('select id, name, description, trigger from workflow_definitions where record_type = $1 and kind is null and active and deleted_at is null order by name', [def.type]))
        .filter((w) => !instances.some((i) => i.status === 'running' && i.definition_id === w.id))
      : [];
    return { instances: out, startable };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/workflows/records/:type/:id', tag: 'Workflows',
    summary: 'The approval workflows on one record (needs view on it), and those the caller may start',
    response: '{ instances: [{ id, workflow, kind, kind_label, status, steps: [{ position, name, status, approvers, standins: [{ id, name, for }], required, due_at, decisions: [{ name, decision, comment, at, on_behalf_of_name }], can_decide, on_behalf_of_name }], can_cancel, can_reassign }], startable: [{ id, name, description, trigger }] }',
  });

  app.post('/api/workflows/records/:type/:id/start', async (req, reply) => {
    const def = await recordDef(req);
    const id = param(req);
    if (!ctx.can(req.user, `${def.module}.edit`)) ctx.fail(403, 'forbidden', `You need permission to edit ${def.plural.toLowerCase()} to ask for an approval.`);
    const body = (req.body ?? {}) as Row;
    const w = await db.one<Row>('select * from workflow_definitions where id = $1 and record_type = $2 and kind is null and active and deleted_at is null',
      [UUID_RE.test(String(body.workflow_id ?? '')) ? body.workflow_id : null, def.type]);
    if (!w) ctx.fail(400, 'validation', 'Choose a workflow.', { workflow_id: 'Choose a workflow.' });
    const record = (await ctx.resources.find(def.type, id))!;
    const started = await svc.start(w!, def, record, req.user!.id, req, text(body.note));
    return reply.code(201).send({ instance_id: started!.id, status: (await svc.loadInstance(started!.id))!.status });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/workflows/records/:type/:id/start', tag: 'Workflows',
    summary: 'Ask for approval: start a workflow on a record by hand (needs edit on the record type)',
    body: '{ workflow_id: uuid, note?: string }', response: '{ instance_id, status }',
  });

  app.post('/api/workflows/steps/:id/decision', async (req) => {
    const body = (req.body ?? {}) as Row;
    return svc.decide(param(req), req, String(body.decision ?? ''), text(body.comment));
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/workflows/steps/:id/decision', tag: 'Workflows',
    summary: 'Approve or reject a step waiting for you (the person who asked can never decide; a rejection needs a comment)',
    body: '{ decision: "approved" | "rejected", comment?: string }', response: '{ stepOutcome: approved | rejected | pending, approvalsReceived, approvalsRequired, onBehalfOf, onBehalfOfName, instance }',
  });

  app.post('/api/workflows/steps/:id/reassign', admin, async (req) => {
    const body = (req.body ?? {}) as Row;
    const from = String(body.from_user_id ?? '');
    const to = String(body.to_user_id ?? '');
    if (!UUID_RE.test(from) || !UUID_RE.test(to)) ctx.fail(400, 'validation', 'Choose the approver and the person to hand the step to.', { to_user_id: 'Choose a person.' });
    return svc.reassign(param(req), req, from, to);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/workflows/steps/:id/reassign', tag: 'Workflows', permission: ADMIN,
    summary: 'Hand a waiting step from one approver to another (administrators; audited, and the new approver is told)',
    body: '{ from_user_id: uuid, to_user_id: uuid }', response: 'The step',
  });

  registerStandinRoutes(ctx, svc);

  app.post('/api/workflows/instances/:id/cancel', async (req) => svc.cancel(param(req), req, text((req.body as Row)?.reason)));
  ctx.describeRoute({
    method: 'POST', path: '/api/workflows/instances/:id/cancel', tag: 'Workflows',
    summary: 'Cancel a running workflow (the person who asked, or an administrator)', body: '{ reason?: string }', response: 'The workflow',
  });
}
