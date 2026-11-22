// Emergency activations (E31-06): a severe-weather, power, service-disruption or other non-cyber
// event run under one or more plans, with an append-only log, the roles people hold, and the plans'
// checklists copied in when it is declared. Standing down needs a summary; closing needs an
// after-action summary, and after-action findings may raise corrective action plans (source
// `continuity`). Security incidents have their own, restricted workspace; nothing is shared with it.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { invalid, text } from './shared.ts';

export const ACTIVATION_DONE = ['stood_down', 'closed'];

export async function activationFor(ctx: ModuleContext, req: FastifyRequest): Promise<Row> {
  return (await ctx.resources.find('emergency_activation', (req.params as { id: string }).id, req.user))
    ?? ctx.fail(404, 'not_found', 'Activation not found.');
}

/** Ids from a JSON list field: unique, each a record of `type` that `req`'s user may see. */
async function idsOf(ctx: ModuleContext, req: FastifyRequest | null, value: unknown, type: string, field: string): Promise<string[]> {
  if (value === null || value === undefined || value === '') return [];
  const list = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  if (!Array.isArray(list) || list.length > 200) invalid(ctx, { [field]: 'Send a list.' });
  const ids = [...new Set((list as unknown[]).map(String))];
  if (!ctx.resources.get(type)) return ids.filter((id) => UUID_RE.test(id)); // kept, not checked, while that part is off
  for (const id of ids) {
    if (!UUID_RE.test(id) || !(await ctx.resources.find(type, id, req?.user ?? null))) invalid(ctx, { [field]: 'One of the records was not found.' });
  }
  return ids;
}

export function registerActivations(ctx: ModuleContext) {
  const { app, db } = ctx;

  async function addLog(activationId: string, entry: string, by: { id: string | null; name: string | null }, at?: string) {
    await db.query('insert into activation_log_entries (activation_id, at, entry, by_id, by_name) values ($1, coalesce($2::timestamptz, now()), $3, $4, $5)',
      [activationId, at ?? null, entry, by.id, by.name]);
  }
  const byOf = (req: FastifyRequest | null) => ({ id: req?.user?.id ?? null, name: req?.user?.displayName ?? 'System' });

  async function beforeCreate(req: FastifyRequest | null, data: Row): Promise<Row> {
    if (req && data.status && data.status !== 'active') invalid(ctx, { status: 'An activation starts active.' });
    data.status = 'active';
    data.plan_ids = await idsOf(ctx, req, data.plan_ids, 'continuity_plan', 'plan_ids');
    data.sites_affected = await idsOf(ctx, req, data.sites_affected, 'site', 'sites_affected');
    data.services_affected = await idsOf(ctx, req, data.services_affected, 'service', 'services_affected');
    if (!data.declared_at) data.declared_at = new Date().toISOString();
    if (!data.declared_by && req) data.declared_by = req.user!.id;
    return data;
  }

  async function beforeUpdate(req: FastifyRequest | null, existing: Row, patch: Row): Promise<Row> {
    if (!req) return patch;
    if (existing.status === 'closed') ctx.fail(409, 'closed', 'The activation is closed, so it can no longer be changed.');
    if ('plan_ids' in patch) {
      const ids = await idsOf(ctx, req, patch.plan_ids, 'continuity_plan', 'plan_ids');
      const had: string[] = Array.isArray(existing.plan_ids) ? existing.plan_ids : [];
      if (had.some((id) => !ids.includes(id))) invalid(ctx, { plan_ids: 'A plan stays with the activation once it was activated; add plans, do not remove them.' });
      patch.plan_ids = ids;
    }
    if ('sites_affected' in patch) patch.sites_affected = await idsOf(ctx, req, patch.sites_affected, 'site', 'sites_affected');
    if ('services_affected' in patch) patch.services_affected = await idsOf(ctx, req, patch.services_affected, 'service', 'services_affected');
    return patch;
  }

  /** Copies the checklists of these plans into the activation (each plan item once). */
  async function copyChecklists(activationId: string, planIds: string[]): Promise<number> {
    if (!planIds.length) return 0;
    const items = await db.query<Row>(
      `select i.id, i.plan_id, i.phase, i.item, i.role, i.sort from continuity_checklist_items i
       where i.plan_id = any($1::uuid[]) and not exists (select 1 from activation_checklist a where a.activation_id = $2 and a.item_id = i.id)
       order by array_position($1::uuid[], i.plan_id), i.sort`, [planIds, activationId]);
    const base = (await db.one<{ n: number }>('select coalesce(max(sort), 0)::int as n from activation_checklist where activation_id = $1', [activationId]))!.n;
    for (const [i, it] of items.entries()) {
      await db.query('insert into activation_checklist (activation_id, item_id, plan_id, phase, item, role, sort) values ($1,$2,$3,$4,$5,$6,$7)',
        [activationId, it.id, it.plan_id, it.phase, it.item, it.role, base + (i + 1) * 10]);
    }
    return items.length;
  }

  ctx.defineResource({
    type: 'emergency_activation', table: 'emergency_activations', module: 'continuity', label: 'Emergency activation', plural: 'Emergency activations',
    path: '/api/emergency-activations', route: '/continuity/activations', titleField: 'title',
    ref: { field: 'ref', prefix: 'EMA-' },
    searchable: ['title', 'summary', 'after_action_summary'],
    defaultSort: { field: 'declared_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, personal: false },
      event_type: { label: 'Kind of event', type: 'lookup', list: 'emergency_event_type', required: true },
      level: { label: 'Level', type: 'lookup', list: 'activation_level', default: 'partial' },
      status: { label: 'Status', type: 'lookup', list: 'activation_status', readOnly: true, default: 'active' },
      declared_at: { label: 'Declared', type: 'datetime' },
      declared_by: { label: 'Declared by', type: 'user', readOnly: true },
      stood_down_at: { label: 'Stood down', type: 'datetime', readOnly: true },
      closed_at: { label: 'Closed', type: 'datetime', readOnly: true },
      plan_ids: { label: 'Plans activated', type: 'json' },
      sites_affected: { label: 'Sites affected', type: 'json' },
      services_affected: { label: 'Services affected', type: 'json' },
      summary: { label: 'Stand-down summary', type: 'longtext', readOnly: true },
      after_action_summary: { label: 'After-action summary', type: 'longtext', readOnly: true },
    },
    hooks: {
      beforeCreate,
      beforeUpdate,
      async afterCreate(req, row) {
        const n = await copyChecklists(row.id, row.plan_ids ?? []);
        await addLog(row.id, `Activation declared${n ? `; ${n} checklist item${n === 1 ? '' : 's'} copied from the plans` : ''}.`, byOf(req));
      },
      async afterUpdate(req, before, after) {
        const added = (after.plan_ids ?? []).filter((id: string) => !(before.plan_ids ?? []).includes(id));
        if (added.length) {
          const n = await copyChecklists(after.id, added);
          await addLog(after.id, `${added.length} more plan${added.length === 1 ? '' : 's'} activated; ${n} checklist item${n === 1 ? '' : 's'} copied.`, byOf(req));
        }
        if (before.level !== after.level && after.level) {
          const label = (await ctx.lookups.values('activation_level')).find((v) => v.value === after.level)?.label ?? after.level;
          await addLog(after.id, `Level changed to ${label}.`, byOf(req));
        }
      },
    },
  });

  const open = (a: Row, what: string) => {
    if (a.status === 'closed') ctx.fail(409, 'closed', `The activation is closed, so ${what}.`);
  };

  // ---------- log ----------

  app.get('/api/emergency-activations/:id/log', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    const a = await activationFor(ctx, req);
    return db.query<Row>('select id, at, entry, by_id, by_name from activation_log_entries where activation_id = $1 order by at desc, created_at desc', [a.id]);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/emergency-activations/:id/log', tag: 'Continuity', permission: 'continuity.view',
    summary: 'An activation\'s log, newest first', response: '[{ id, at, entry, by_id, by_name }]',
  });

  app.post('/api/emergency-activations/:id/log', { preHandler: ctx.requirePerm('continuity.edit') }, async (req, reply) => {
    const a = await activationFor(ctx, req);
    open(a, 'nothing more can be logged');
    const b = (req.body ?? {}) as Row;
    const entry = text(b.entry, 8000);
    if (!entry) invalid(ctx, { entry: 'Write the entry first.' });
    let at: string | undefined;
    if (b.at) {
      const t = Date.parse(String(b.at));
      if (Number.isNaN(t)) invalid(ctx, { at: 'Give the time it happened.' });
      if (t > Date.now() + 5 * 60_000) invalid(ctx, { at: 'The time cannot be in the future.' });
      at = new Date(t).toISOString();
    }
    await addLog(a.id, entry!, byOf(req), at);
    await ctx.audit(req, { action: 'emergency_activation.log', recordType: 'emergency_activation', recordId: a.id, summary: 'Log entry added' });
    reply.code(201);
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/log', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Add a log entry, stamped with your name (entries are never changed or removed)', body: '{ entry, at?: when it happened }',
  });

  // ---------- roles ----------

  const rolesOf = (id: string) => db.query<Row>(
    `select r.id, r.role, r.user_id, r.person_id, r.assigned_at,
            coalesce(${ctx.resources.get('person') ? '(select p.full_name from people p where p.id = r.person_id),' : ''} u.display_name, r.name) as name,
            ${ctx.resources.get('person') ? '(select p.phone from people p where p.id = r.person_id or (r.person_id is null and p.user_id = r.user_id and p.deleted_at is null) limit 1)' : 'null'} as phone
     from activation_roles r left join users u on u.id = r.user_id
     where r.activation_id = $1 order by r.assigned_at, r.role`, [id]);

  app.get('/api/emergency-activations/:id/roles', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => rolesOf((await activationFor(ctx, req)).id));
  ctx.describeRoute({
    method: 'GET', path: '/api/emergency-activations/:id/roles', tag: 'Continuity', permission: 'continuity.view',
    summary: 'Who holds which role in an activation', response: '[{ id, role, user_id, person_id, name, phone, assigned_at }]',
  });

  app.post('/api/emergency-activations/:id/roles', { preHandler: ctx.requirePerm('continuity.edit') }, async (req, reply) => {
    const a = await activationFor(ctx, req);
    open(a, 'roles can no longer be changed');
    const b = (req.body ?? {}) as Row;
    const role = text(b.role, 160);
    const errors: Record<string, string> = {};
    if (!role) errors.role = 'Name the role, for example "Emergency manager".';
    const userId = b.user_id ? String(b.user_id) : null;
    const personId = b.person_id ? String(b.person_id) : null;
    if (userId && !(UUID_RE.test(userId) && await db.one('select 1 from users where id = $1', [userId]))) errors.user_id = 'That account was not found.';
    if (personId && !(ctx.resources.get('person') && UUID_RE.test(personId) && await ctx.resources.find('person', personId, req.user))) errors.person_id = 'That person was not found.';
    const name = userId || personId ? null : text(b.name, 200);
    if (!userId && !personId && !name) errors.name = 'Choose a person or an account, or type a name.';
    if (Object.keys(errors).length) invalid(ctx, errors);
    const row = (await db.one<Row>('insert into activation_roles (activation_id, role, user_id, person_id, name, created_by) values ($1,$2,$3,$4,$5,$6) returning id',
      [a.id, role, userId, personId, name, req.user!.id]))!;
    const shown = (await rolesOf(a.id)).find((r) => r.id === row.id)!;
    await addLog(a.id, `${shown.name ?? 'Someone'} took the role ${role}.`, byOf(req));
    await ctx.audit(req, { action: 'emergency_activation.role', recordType: 'emergency_activation', recordId: a.id, summary: `Role assigned: ${role}`, after: { role, user_id: userId, person_id: personId } });
    reply.code(201);
    return shown;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/roles', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Give someone a role in the activation (logged)', body: '{ role, person_id? | user_id? | name? }',
  });

  app.delete('/api/emergency-activations/:id/roles/:roleId', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const a = await activationFor(ctx, req);
    open(a, 'roles can no longer be changed');
    const roleId = (req.params as { roleId: string }).roleId;
    const before = UUID_RE.test(roleId) ? (await rolesOf(a.id)).find((r) => r.id === roleId) : undefined;
    if (!before) ctx.fail(404, 'not_found', 'Role not found.');
    await db.query('delete from activation_roles where id = $1', [roleId]);
    await addLog(a.id, `${before!.name ?? 'Someone'} handed over the role ${before!.role}.`, byOf(req));
    await ctx.audit(req, { action: 'emergency_activation.role_removed', recordType: 'emergency_activation', recordId: a.id, summary: `Role ended: ${before!.role}` });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/emergency-activations/:id/roles/:roleId', tag: 'Continuity', permission: 'continuity.edit', summary: 'End someone\'s role (logged)' });

  // ---------- checklist ----------

  const checklistOf = (id: string) => db.query<Row>(
    `select c.id, c.item_id, c.plan_id, p.ref as plan_ref, c.phase, c.item, c.role, c.sort, c.done_by, c.done_by_name, c.done_at, c.note
     from activation_checklist c left join continuity_plans p on p.id = c.plan_id
     where c.activation_id = $1 order by c.sort, c.created_at`, [id]);

  app.get('/api/emergency-activations/:id/checklist', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => checklistOf((await activationFor(ctx, req)).id));
  ctx.describeRoute({
    method: 'GET', path: '/api/emergency-activations/:id/checklist', tag: 'Continuity', permission: 'continuity.view',
    summary: 'An activation\'s checklist, copied from its plans', response: '[{ id, item_id, plan_id, plan_ref, phase, item, role, done_by, done_by_name, done_at, note }]',
  });

  app.post('/api/emergency-activations/:id/checklist', { preHandler: ctx.requirePerm('continuity.edit') }, async (req, reply) => {
    const a = await activationFor(ctx, req);
    open(a, 'the checklist can no longer be changed');
    const b = (req.body ?? {}) as Row;
    const item = text(b.item, 500);
    if (!item) invalid(ctx, { item: 'Write what to do.' });
    if (!['activate', 'respond', 'recover', 'stand_down'].includes(b.phase)) invalid(ctx, { phase: 'Choose the phase.' });
    const sort = (await db.one<{ n: number }>('select coalesce(max(sort), 0)::int + 10 as n from activation_checklist where activation_id = $1', [a.id]))!.n;
    await db.query('insert into activation_checklist (activation_id, phase, item, role, sort) values ($1,$2,$3,$4,$5)', [a.id, b.phase, item, text(b.role, 160), sort]);
    await ctx.audit(req, { action: 'emergency_activation.checklist_add', recordType: 'emergency_activation', recordId: a.id, summary: `Checklist step added: ${item}` });
    reply.code(201);
    return checklistOf(a.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/checklist', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Add a checklist step for this activation only', body: '{ phase: activate | respond | recover | stand_down, item, role? }',
  });

  app.post('/api/emergency-activations/:id/checklist/:itemId', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const a = await activationFor(ctx, req);
    open(a, 'the checklist can no longer be changed');
    const itemId = (req.params as { itemId: string }).itemId;
    const it = UUID_RE.test(itemId) ? await db.one<Row>('select * from activation_checklist where id = $1 and activation_id = $2', [itemId, a.id]) : undefined;
    if (!it) ctx.fail(404, 'not_found', 'Checklist step not found.');
    const b = (req.body ?? {}) as Row;
    const done = b.done === true;
    const note = b.note !== undefined ? text(b.note, 1000) : it!.note;
    if (done && !it!.done_at) {
      await db.query('update activation_checklist set done_by = $2, done_by_name = $3, done_at = now(), note = $4 where id = $1', [it!.id, req.user!.id, req.user!.displayName, note]);
      await addLog(a.id, `Checklist: ${it!.item} - done.`, byOf(req));
    } else if (!done && it!.done_at) {
      await db.query('update activation_checklist set done_by = null, done_by_name = null, done_at = null, note = $2 where id = $1', [it!.id, note]);
      await addLog(a.id, `Checklist: ${it!.item} - marked as not done.`, byOf(req));
    } else {
      await db.query('update activation_checklist set note = $2 where id = $1', [it!.id, note]);
    }
    await ctx.audit(req, { action: 'emergency_activation.checklist', recordType: 'emergency_activation', recordId: a.id, summary: `Checklist: ${it!.item} ${done ? 'done' : 'not done'}` });
    return (await checklistOf(a.id)).find((r) => r.id === it!.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/checklist/:itemId', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Mark a checklist step done or not done, with who and when (logged)', body: '{ done: boolean, note? }',
  });

  // ---------- stand down and close ----------

  app.post('/api/emergency-activations/:id/stand-down', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const a = await activationFor(ctx, req);
    if (a.status !== 'active') ctx.fail(409, 'not_active', 'Only an active activation can be stood down.');
    const summary = text((req.body as Row | null)?.summary, 8000);
    if (!summary) invalid(ctx, { summary: 'Summarize what happened and the state things are left in.' });
    await ctx.resources.update('emergency_activation', a.id, { status: 'stood_down', stood_down_at: new Date().toISOString(), summary }, null);
    await addLog(a.id, 'Activation stood down.', byOf(req));
    await ctx.audit(req, { action: 'emergency_activation.stand_down', recordType: 'emergency_activation', recordId: a.id, summary: `${a.ref} stood down`, after: { summary } });
    return ctx.resources.find('emergency_activation', a.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/stand-down', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Stand an active activation down (needs a summary)', body: '{ summary }',
  });

  app.post('/api/emergency-activations/:id/close', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const a = await activationFor(ctx, req);
    if (a.status !== 'stood_down') ctx.fail(409, 'not_stood_down', 'Stand the activation down before closing it.');
    const after = text((req.body as Row | null)?.after_action_summary, 16000);
    if (!after) invalid(ctx, { after_action_summary: 'Write the after-action summary: what went well, what to improve.' });
    await ctx.resources.update('emergency_activation', a.id, { status: 'closed', closed_at: new Date().toISOString(), after_action_summary: after }, null);
    await addLog(a.id, 'Activation closed with its after-action summary.', byOf(req));
    await ctx.audit(req, { action: 'emergency_activation.close', recordType: 'emergency_activation', recordId: a.id, summary: `${a.ref} closed`, after: { after_action_summary: after } });
    return ctx.resources.find('emergency_activation', a.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/close', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Close a stood-down activation (needs the after-action summary)', body: '{ after_action_summary }',
  });

  // ---------- after-action findings raise corrective action plans ----------

  app.post('/api/emergency-activations/:id/cap', { preHandler: ctx.requirePerm('continuity.edit') }, async (req, reply) => {
    const a = await activationFor(ctx, req);
    const cap = ctx.resources.get('cap');
    if (!cap) ctx.fail(409, 'caps_unavailable', 'Corrective action plans are not available on this installation.');
    if (!ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'You need permission to create actions to raise a corrective action plan.');
    if (a.status === 'active') ctx.fail(409, 'still_active', 'Raise after-action plans once the activation is stood down.');
    const b = (req.body ?? {}) as Row;
    const title = text(b.title, 200);
    if (!title) invalid(ctx, { title: 'Say what needs correcting.' });
    const wanted: Row = {
      title, source: 'continuity', source_type: 'emergency_activation', source_id: a.id,
      problem_statement: text(b.problem_statement, 8000) ?? `After-action finding from ${a.ref} ${a.title}.`,
      root_cause: text(b.root_cause, 8000), responsible_id: b.responsible_id ?? null, due_on: b.due_on ?? null,
    };
    const data = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => k in cap!.fields && v !== null && v !== ''));
    const plan = await ctx.resources.create('cap', data, req);
    await db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('emergency_activation', $1, 'cap', $2, 'raised', $3) on conflict do nothing`,
      [a.id, plan.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'emergency_activation.cap', recordType: 'emergency_activation', recordId: a.id,
      summary: `Corrective action plan ${plan.ref ?? ''} raised from ${a.ref}`.replace(/\s+/g, ' '), after: { cap_id: plan.id },
    });
    reply.code(201);
    return { cap: { id: plan.id, ref: plan.ref ?? null, title: plan.title, route: cap!.route ? `${cap!.route}/${plan.id}` : null } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/emergency-activations/:id/cap', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Raise a corrective action plan from an after-action finding (source continuity; also needs actions.create)',
    description: 'Once the activation is stood down. 409 `caps_unavailable` when corrective action plans are not loaded or switched off.',
    body: '{ title, problem_statement?, root_cause?, responsible_id?, due_on? }', response: '{ cap: { id, ref, title, route } }',
  });
}
