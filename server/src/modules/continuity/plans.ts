// Continuity and emergency plans (E31-03, E31-04): plan records with an owner, scope, activation
// criteria and recovery strategies, the processes each covers, a call tree, a checklist by phase,
// a review cycle and approval through the `continuity_plan` approval kind. Exercises that tested a
// plan are linked with the relation `exercised_by` (contract C7).
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { UUID_RE } from '../../core/errors.ts';
import { PDF_TYPE, PdfBuilder } from '../../core/export/pdf.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { printBranding } from '../../core/organization.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { actorOf } from '../../core/dataload.ts';
import { addMonths, EXERCISED_BY, invalid, text, ymd } from './shared.ts';
import { PLAN_TEMPLATES, templateOf } from './templates.ts';

export const PLAN_KIND = 'continuity_plan';
export const PHASES = ['activate', 'respond', 'recover', 'stand_down'] as const;

export const DEFAULT_PLAN_WORKFLOW = {
  name: 'Continuity plan approval',
  description: 'A continuity or emergency plan is approved by someone who may approve continuity records. Approval sets the next review date; rejection sends the plan back to draft.',
  steps: [{ key: 'approve', name: 'Plan approval', approvers: { kind: 'permission', permission: 'continuity.approve' }, quorum: 'any', due_hours: 240 }],
};

export async function planFor(ctx: ModuleContext, req: FastifyRequest): Promise<Row> {
  return (await ctx.resources.find('continuity_plan', (req.params as { id: string }).id, req.user))
    ?? ctx.fail(404, 'not_found', 'Plan not found.');
}

/** A call tree entry as shown: names and phones come from the linked person (or account) when there is one. */
export interface CallTreeNode {
  id: string; parent_id: string | null; sort: number; role: string | null;
  user_id: string | null; person_id: string | null; name: string | null; phone: string | null; alternate_phone: string | null; notes: string | null;
  linked: 'person' | 'user' | null;
}

export async function callTreeOf(ctx: ModuleContext, planId: string): Promise<CallTreeNode[]> {
  const people = Boolean(ctx.resources.get('person'));
  const rows = await ctx.db.query<Row>(
    `select n.id, n.parent_id, n.sort, n.role, n.user_id, n.person_id, n.name, n.phone, n.alternate_phone, n.notes,
            u.display_name as user_name,
            ${people ? `p.full_name as person_name, p.phone as person_phone, pu.phone as user_person_phone` : 'null as person_name, null as person_phone, null as user_person_phone'}
     from call_tree_nodes n
     left join users u on u.id = n.user_id
     ${people ? `left join people p on p.id = n.person_id and p.deleted_at is null
     left join people pu on pu.user_id = n.user_id and pu.deleted_at is null` : ''}
     where n.plan_id = $1 order by n.sort, n.created_at`, [planId]);
  return rows.map((r) => {
    const linked = r.person_id && people ? 'person' : r.user_id ? 'user' : null;
    return {
      id: r.id, parent_id: r.parent_id, sort: r.sort, role: r.role, user_id: r.user_id, person_id: r.person_id, notes: r.notes, linked,
      name: linked === 'person' ? r.person_name : linked === 'user' ? r.user_name : r.name,
      phone: linked === 'person' ? r.person_phone : linked === 'user' ? r.user_person_phone : r.phone,
      alternate_phone: r.alternate_phone,
    };
  });
}

/** The tree in reading order (parents before their children), with each entry's depth. */
export function inTreeOrder(nodes: CallTreeNode[]): (CallTreeNode & { depth: number })[] {
  const out: (CallTreeNode & { depth: number })[] = [];
  const ids = new Set(nodes.map((n) => n.id));
  const walk = (parent: string | null, depth: number) => {
    for (const n of nodes.filter((x) => (parent === null ? !x.parent_id || !ids.has(x.parent_id) : x.parent_id === parent))) {
      if (out.some((o) => o.id === n.id)) continue;
      out.push({ ...n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Exercises linked to a plan that `user` may see, newest first. */
export async function exercisesOf(ctx: ModuleContext, planId: string, user: SessionUser | null): Promise<Row[]> {
  if (!ctx.resources.get('exercise') || (user && !ctx.can(user, 'exercises.view'))) return [];
  return ctx.db.query<Row>(
    `select l.id as link_id, e.id, e.ref, e.title, e.exercise_date::text as exercise_date, e.status, e.type
     from record_links l join exercises e on e.id = l.to_id and e.deleted_at is null
     where l.from_type = 'continuity_plan' and l.from_id = $1 and l.to_type = 'exercise' and l.relation = $2
       and ${ctx.resources.visibleWhere('exercise', user, 'e')}
     order by e.exercise_date desc nulls last`, [planId, EXERCISED_BY]);
}

export function registerPlans(ctx: ModuleContext) {
  const { app, db } = ctx;
  const engine = () => approvalEngine(app);

  async function check(req: FastifyRequest | null, data: Row, existing: Row | null): Promise<Row> {
    const errors: Record<string, string> = {};
    if (data.review_months !== undefined && data.review_months !== null && data.review_months !== '') {
      const n = Number(data.review_months);
      if (!Number.isInteger(n) || n < 1 || n > 60) errors.review_months = 'Give a number of months from 1 to 60.';
    }
    if (req && data.status !== undefined && data.status !== existing?.status && ['approved', 'in_review'].includes(String(data.status))) {
      errors.status = 'A plan is approved through "Submit for approval".';
    }
    if (req && data.policy_id && !(await ctx.resources.find('policy', String(data.policy_id), req.user))) errors.policy_id = 'That policy was not found.';
    // Wave 26: a plan started from a template takes the template's sections where none are given.
    if ('template_key' in data && data.template_key !== null && data.template_key !== '') {
      const t = templateOf(data.template_key);
      if (existing && data.template_key !== existing.template_key) errors.template_key = 'The template a plan was started from cannot be changed.';
      else if (!t) errors.template_key = `Choose a template: ${PLAN_TEMPLATES.map((x) => x.key).join(', ')}.`;
      else if (!existing) {
        for (const f of ['plan_type', 'scope', 'activation_criteria', 'recovery_strategies', 'body', 'review_months'] as const) {
          if (data[f] === undefined || data[f] === null || data[f] === '') data[f] = t[f];
        }
      }
    } else if ('template_key' in data && existing?.template_key && data.template_key !== existing.template_key) {
      errors.template_key = 'The template a plan was started from cannot be changed.';
    } else if (data.template_key === '') data.template_key = null;
    if (Object.keys(errors).length) invalid(ctx, errors);
    if (existing && 'next_review_on' in data && ymd(data.next_review_on) !== ymd(existing.next_review_on)) data.review_reminded_for = null;
    return data;
  }

  ctx.defineResource({
    type: 'continuity_plan', table: 'continuity_plans', module: 'continuity', label: 'Continuity plan', plural: 'Continuity plans',
    path: '/api/continuity-plans', route: '/continuity/plans', titleField: 'title',
    ref: { field: 'ref', prefix: 'CPL-' },
    searchable: ['title', 'scope', 'activation_criteria', 'recovery_strategies', 'body'],
    defaultSort: { field: 'title', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      plan_type: { label: 'Type of plan', type: 'lookup', list: 'continuity_plan_type' },
      owner_id: { label: 'Owner', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'continuity_plan_status', default: 'draft' },
      scope: { label: 'Scope', type: 'longtext', personal: false },
      activation_criteria: { label: 'When to activate it', type: 'longtext', personal: false },
      recovery_strategies: { label: 'Recovery strategies', type: 'longtext', personal: false },
      body: {
        label: 'Plan sections', type: 'longtext', personal: false,
        help: 'The rest of the plan as Markdown: roles, communications, recovery objectives, alternate sites, return to normal, maintenance and exercising.',
      },
      template_key: {
        label: 'Started from template', type: 'text', personal: false,
        help: `Only when creating: a built-in template that fills the empty sections and adds a starter checklist (${PLAN_TEMPLATES.map((t) => `${t.key} = ${t.label}`).join('; ')}).`,
      },
      policy_id: { label: 'Full text (policy document)', type: 'ref', to: 'policy' },
      review_months: { label: 'Review every (months)', type: 'number', default: 12 },
      next_review_on: { label: 'Next review', type: 'date' },
      approved_on: { label: 'Approved on', type: 'date', readOnly: true },
      approved_by_name: { label: 'Approved by', type: 'text', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => check(req, data, null),
      beforeUpdate: (req, existing, patch) => check(req, patch, existing),
      // The template's starter checklist, unless the plan already has one.
      afterCreate: async (req, row) => {
        const t = templateOf(row.template_key);
        if (!t || await db.one('select 1 from continuity_checklist_items where plan_id = $1 limit 1', [row.id])) return;
        const by = actorOf(req).id;
        for (const [i, [phase, item, role]] of t.checklist.entries()) {
          await db.query('insert into continuity_checklist_items (plan_id, phase, item, role, sort, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$6)',
            [row.id, phase, item, role, (i + 1) * 10, by]);
        }
      },
    },
  });

  app.get('/api/continuity/plan-templates', { preHandler: ctx.requirePerm('continuity.view') }, async () =>
    PLAN_TEMPLATES.map((t) => ({ ...t, checklist: t.checklist.map(([phase, item, role]) => ({ phase, item, role })) })));
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity/plan-templates', tag: 'Continuity', permission: 'continuity.view',
    summary: 'The built-in plan templates; create a plan with `template_key` to start from one (its empty sections and a starter checklist are filled in)',
    response: '[{ key, label, description, plan_type, review_months, scope, activation_criteria, recovery_strategies, body, checklist: [{ phase, item, role }] }]',
  });

  // ---------- approval ----------

  defineApprovalKind(app, {
    key: PLAN_KIND, recordType: 'continuity_plan', label: 'Continuity plan',
    startsWhen: 'The plan\'s owner (or anyone who may edit plans) submits it for approval',
    outcome: 'Approved: the plan becomes Approved, with the approval date and the next review date (its review cycle from today); rejected: it goes back to Draft, with the reason in its history',
    approverPermission: 'continuity.approve',
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_PLAN_WORKFLOW);
    },
    async onFinish(e) {
      const plan = await db.one<Row>('select * from continuity_plans where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!plan) throw new Error('The plan no longer exists.');
      const who = `${e.approverName ?? 'an approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome !== 'approved') {
        if (plan.status === 'in_review') await ctx.resources.update('continuity_plan', plan.id, { status: 'draft' }, null);
        if (e.outcome === 'rejected') {
          await ctx.audit(e.req, {
            action: 'continuity_plan.rejected', recordType: 'continuity_plan', recordId: plan.id,
            summary: `${plan.ref} sent back by ${who}: ${e.comment ?? 'no reason given'}`, after: { reason: e.comment },
          });
        }
        return;
      }
      const today = dayInZone();
      const next = addMonths(today, Number(plan.review_months) || 12);
      await ctx.resources.update('continuity_plan', plan.id, {
        status: 'approved', approved_on: today, approved_by_name: e.approverName ?? null, next_review_on: next, review_reminded_for: null,
      }, null);
      await ctx.audit(e.req, {
        action: 'continuity_plan.approved', recordType: 'continuity_plan', recordId: plan.id,
        summary: `${plan.ref} approved by ${who}; next review ${displayDate(next)}`,
      });
    },
  });

  app.post('/api/continuity-plans/:id/submit', { preHandler: ctx.requirePerm('continuity.edit') }, async (req, reply) => {
    const plan = await planFor(ctx, req);
    const eng = engine();
    if (!eng) ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available in this installation.');
    if (plan.status === 'retired') ctx.fail(409, 'retired', 'The plan is retired.');
    if (await eng!.running(PLAN_KIND, plan.id)) ctx.fail(409, 'already_submitted', 'The plan is already waiting for approval.');
    const missing: Record<string, string> = {};
    if (!String(plan.scope ?? '').trim()) missing.scope = 'Say what the plan covers before submitting it.';
    if (!String(plan.activation_criteria ?? '').trim()) missing.activation_criteria = 'Say when the plan is activated before submitting it.';
    if (Object.keys(missing).length) invalid(ctx, missing);
    const note = text((req.body as Row | null)?.note, 2000);
    const started = await eng!.start(PLAN_KIND, plan, { requester: req.user!.id, req, note });
    if (!started) ctx.fail(409, 'no_workflow', 'No active Continuity plan approval workflow applies. An administrator can set one up under Administration > Approval workflows.');
    if (started!.status === 'running') await ctx.resources.update('continuity_plan', plan.id, { status: 'in_review' }, null);
    await ctx.audit(req, {
      action: 'continuity_plan.submitted', recordType: 'continuity_plan', recordId: plan.id,
      summary: `${plan.ref} submitted for approval`, after: { workflow: started!.name, note },
    });
    reply.code(201);
    return { instance_id: started!.id, workflow: started!.name, status: started!.status };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/continuity-plans/:id/submit', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Submit a plan for approval (starts the Continuity plan approval workflow; the plan is In review until it is decided)',
    description: 'Needs a scope and activation criteria. 409 `already_submitted` while one is waiting; 409 `no_workflow` when no active workflow applies.',
    body: '{ note? }', response: '{ instance_id, workflow, status }',
  });

  // ---------- processes covered ----------

  const processesOf = (planId: string, user: SessionUser | null) => db.query<Row>(
    `select p.id, p.ref, p.name, p.criticality, p.status, p.mtd_hours from continuity_plan_processes cp
     join business_processes p on p.id = cp.process_id and p.deleted_at is null
     where cp.plan_id = $1 and ${ctx.resources.visibleWhere('business_process', user, 'p')} order by p.name`, [planId]);

  app.get('/api/continuity-plans/:id/processes', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => processesOf((await planFor(ctx, req)).id, req.user));
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity-plans/:id/processes', tag: 'Continuity', permission: 'continuity.view',
    summary: 'The business processes a plan covers', response: '[{ id, ref, name, criticality, status, mtd_hours }]',
  });

  app.put('/api/continuity-plans/:id/processes', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const plan = await planFor(ctx, req);
    const ids = (req.body as Row | null)?.process_ids;
    if (!Array.isArray(ids) || ids.length > 500) invalid(ctx, { process_ids: 'Send the list of processes.' });
    const unique = [...new Set((ids as unknown[]).map(String))];
    for (const id of unique) {
      if (!UUID_RE.test(id) || !(await ctx.resources.find('business_process', id, req.user))) invalid(ctx, { process_ids: 'One of the processes was not found.' });
    }
    const before = (await processesOf(plan.id, req.user)).map((p) => p.id as string);
    await db.tx(async (tx) => {
      await tx.query('delete from continuity_plan_processes where plan_id = $1', [plan.id]);
      for (const id of unique) await tx.query('insert into continuity_plan_processes (plan_id, process_id, created_by) values ($1,$2,$3)', [plan.id, id, req.user!.id]);
    });
    await ctx.audit(req, {
      action: 'continuity_plan.processes', recordType: 'continuity_plan', recordId: plan.id,
      summary: `Processes covered: ${unique.length}`, before, after: unique,
    });
    return processesOf(plan.id, req.user);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/continuity-plans/:id/processes', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Set the business processes a plan covers', body: '{ process_ids: [id, ...] }',
  });

  app.get('/api/business-processes/:id/plans', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    const p = (await ctx.resources.find('business_process', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Business process not found.');
    return db.query<Row>(
      `select c.id, c.ref, c.title, c.plan_type, c.status, c.next_review_on::text as next_review_on from continuity_plan_processes cp
       join continuity_plans c on c.id = cp.plan_id and c.deleted_at is null
       where cp.process_id = $1 and ${ctx.resources.visibleWhere('continuity_plan', req.user, 'c')} order by c.title`, [p.id]);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/business-processes/:id/plans', tag: 'Continuity', permission: 'continuity.view',
    summary: 'The plans that cover a business process', response: '[{ id, ref, title, plan_type, status, next_review_on }]',
  });

  // ---------- call tree ----------

  async function nodeInput(req: FastifyRequest, planId: string, body: Row, existing: Row | null): Promise<Row> {
    const out: Row = {};
    for (const [k, max] of [['role', 160], ['name', 200], ['phone', 60], ['alternate_phone', 60], ['notes', 1000]] as const) {
      if (body[k] !== undefined) out[k] = text(body[k], max);
    }
    if (body.parent_id !== undefined) {
      const parent = body.parent_id ? String(body.parent_id) : null;
      if (parent) {
        if (!UUID_RE.test(parent) || !(await db.one('select 1 from call_tree_nodes where id = $1 and plan_id = $2', [parent, planId]))) {
          invalid(ctx, { parent_id: 'That entry is not in this call tree.' });
        }
        // An entry cannot sit under itself or under one of the entries it calls.
        if (existing) {
          let at: string | null = parent;
          for (let i = 0; at && i < 500; i++) {
            if (at === existing.id) invalid(ctx, { parent_id: 'An entry cannot be placed under one of the people it calls.' });
            at = (await db.one<{ parent_id: string | null }>('select parent_id from call_tree_nodes where id = $1', [at]))?.parent_id ?? null;
          }
        }
      }
      out.parent_id = parent;
    }
    if (body.sort !== undefined) {
      const n = Number(body.sort);
      if (!Number.isInteger(n) || Math.abs(n) > 1_000_000) invalid(ctx, { sort: 'Give a whole number.' });
      out.sort = n;
    }
    if (body.user_id !== undefined) {
      const id = body.user_id ? String(body.user_id) : null;
      if (id && !(UUID_RE.test(id) && await db.one('select 1 from users where id = $1', [id]))) invalid(ctx, { user_id: 'That account was not found.' });
      out.user_id = id;
    }
    if (body.person_id !== undefined) {
      const id = body.person_id ? String(body.person_id) : null;
      if (id && !(ctx.resources.get('person') && UUID_RE.test(id) && await ctx.resources.find('person', id, req.user))) invalid(ctx, { person_id: 'That person was not found.' });
      out.person_id = id;
    }
    const merged = { ...(existing ?? {}), ...out };
    // Typed names and phones are kept only for an entry linked to nobody: a linked one reads them from the person or account.
    if (merged.user_id || merged.person_id) { out.name = null; out.phone = null; }
    else if (!merged.name) invalid(ctx, { name: 'Give a name, or choose a person or an account.' });
    return out;
  }

  const nodeOf = async (planId: string, nodeId: string): Promise<Row> =>
    (UUID_RE.test(nodeId) ? await db.one<Row>('select * from call_tree_nodes where id = $1 and plan_id = $2', [nodeId, planId]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Call tree entry not found.');

  app.get('/api/continuity-plans/:id/call-tree', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => inTreeOrder(await callTreeOf(ctx, (await planFor(ctx, req)).id)));
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity-plans/:id/call-tree', tag: 'Continuity', permission: 'continuity.view',
    summary: 'A plan\'s call tree in reading order, each entry with its depth (names and phones from the linked person or account)',
    response: '[{ id, parent_id, depth, sort, role, user_id, person_id, linked: person | user | null, name, phone, alternate_phone, notes }]',
  });

  app.post('/api/continuity-plans/:id/call-tree', { preHandler: ctx.requirePerm('continuity.edit') }, async (req, reply) => {
    const plan = await planFor(ctx, req);
    const input = await nodeInput(req, plan.id, (req.body ?? {}) as Row, null);
    if (input.sort === undefined) {
      input.sort = (await db.one<{ n: number }>('select coalesce(max(sort), 0)::int + 10 as n from call_tree_nodes where plan_id = $1', [plan.id]))!.n;
    }
    const keys = Object.keys(input);
    const row = (await db.one<Row>(
      `insert into call_tree_nodes (plan_id, ${keys.join(', ')}, created_by, updated_by) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}, $${keys.length + 2}, $${keys.length + 2}) returning id`,
      [plan.id, ...keys.map((k) => input[k]), req.user!.id]))!;
    const node = (await callTreeOf(ctx, plan.id)).find((n) => n.id === row.id)!;
    await ctx.audit(req, { action: 'continuity_plan.call_tree_add', recordType: 'continuity_plan', recordId: plan.id, summary: `Call tree: ${node.name ?? 'an entry'} added${node.role ? ` as ${node.role}` : ''}`, after: input });
    reply.code(201);
    return node;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/continuity-plans/:id/call-tree', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Add an entry to a plan\'s call tree (a person, an account, or a typed name and phone)',
    body: '{ parent_id?, role?, person_id?, user_id?, name?, phone?, alternate_phone?, notes?, sort? }',
  });

  app.patch('/api/continuity-plans/:id/call-tree/:nodeId', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const plan = await planFor(ctx, req);
    const before = await nodeOf(plan.id, (req.params as { nodeId: string }).nodeId);
    const input = await nodeInput(req, plan.id, (req.body ?? {}) as Row, before);
    const keys = Object.keys(input);
    if (keys.length) {
      await db.query(`update call_tree_nodes set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${keys.length + 2} where id = $1`,
        [before.id, ...keys.map((k) => input[k]), req.user!.id]);
      await ctx.audit(req, {
        action: 'continuity_plan.call_tree_change', recordType: 'continuity_plan', recordId: plan.id, summary: 'Call tree entry changed',
        before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: input,
      });
    }
    return (await callTreeOf(ctx, plan.id)).find((n) => n.id === before.id);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/continuity-plans/:id/call-tree/:nodeId', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Change a call tree entry, or move it (parent_id, sort)', body: '{ parent_id?, sort?, role?, person_id?, user_id?, name?, phone?, alternate_phone?, notes? }',
  });

  app.delete('/api/continuity-plans/:id/call-tree/:nodeId', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const plan = await planFor(ctx, req);
    const before = await nodeOf(plan.id, (req.params as { nodeId: string }).nodeId);
    const shown = (await callTreeOf(ctx, plan.id)).find((n) => n.id === before.id);
    await db.tx(async (tx) => {
      // The people this entry called are now called by whoever called it.
      await tx.query('update call_tree_nodes set parent_id = $2 where parent_id = $1', [before.id, before.parent_id]);
      await tx.query('delete from call_tree_nodes where id = $1', [before.id]);
    });
    await ctx.audit(req, { action: 'continuity_plan.call_tree_remove', recordType: 'continuity_plan', recordId: plan.id, summary: `Call tree: ${shown?.name ?? 'an entry'} removed`, before });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/continuity-plans/:id/call-tree/:nodeId', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Remove a call tree entry; the people it called move up to whoever called it',
  });

  app.get('/api/continuity-plans/:id/call-tree.pdf', { preHandler: [ctx.requirePerm('continuity.view'), ctx.requirePerm('continuity.export')] }, async (req, reply) => {
    const plan = await planFor(ctx, req);
    const nodes = inTreeOrder(await callTreeOf(ctx, plan.id));
    const appName = String(await ctx.settings.get('app.name', 'Sandpiper GRC'));
    const pdf = new PdfBuilder({
      title: `Call tree: ${plan.title}`, subtitle: plan.ref,
      meta: [`Produced ${displayDate(dayInZone())} by ${req.user!.displayName}`, 'Each person calls the people listed under them. Keep a printed copy where it can be reached without the network.'],
      appName, author: appName, branding: await printBranding(db),
    });
    if (!nodes.length) pdf.paragraph('This plan has no call tree yet.', { muted: true });
    else {
      pdf.table(
        [{ header: 'Who', weight: 3 }, { header: 'Role', weight: 2 }, { header: 'Phone', weight: 2 }, { header: 'Other phone', weight: 2 }],
        nodes.map((n) => [`${'    '.repeat(n.depth)}${n.depth ? '- ' : ''}${n.name ?? ''}`, n.role ?? '', n.phone ?? '', n.alternate_phone ?? '']),
      );
    }
    const file = await pdf.finish();
    await ctx.audit(req, { action: 'continuity_plan.call_tree_export', recordType: 'continuity_plan', recordId: plan.id, summary: `Call tree of ${plan.ref} printed` });
    reply.header('content-type', PDF_TYPE);
    reply.header('content-disposition', `attachment; filename="call-tree-${String(plan.ref ?? 'plan').replace(/[^A-Za-z0-9-]/g, '')}.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(file);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity-plans/:id/call-tree.pdf', tag: 'Continuity', permission: 'continuity.export',
    summary: 'A plan\'s call tree as a PDF to print (audited; also needs continuity.view)',
  });

  // ---------- checklist ----------

  const checklistOf = (planId: string) => db.query<Row>(
    'select id, phase, item, role, sort from continuity_checklist_items where plan_id = $1 order by sort, created_at', [planId]);

  app.get('/api/continuity-plans/:id/checklist', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => checklistOf((await planFor(ctx, req)).id));
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity-plans/:id/checklist', tag: 'Continuity', permission: 'continuity.view',
    summary: 'A plan\'s checklist (copied into each activation of the plan)', response: '[{ id, phase: activate | respond | recover | stand_down, item, role, sort }]',
  });

  app.put('/api/continuity-plans/:id/checklist', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const plan = await planFor(ctx, req);
    const items = (req.body as Row | null)?.items;
    if (!Array.isArray(items) || items.length > 300) invalid(ctx, { items: 'Send the list of checklist items (at most 300).' });
    const clean = (items as Row[]).map((it, i) => {
      const item = text(it?.item, 500);
      if (!item) invalid(ctx, { items: `Item ${i + 1}: write what to do.` });
      if (!PHASES.includes(it.phase)) invalid(ctx, { items: `Item ${i + 1}: choose its phase.` });
      return { id: it.id && UUID_RE.test(String(it.id)) ? String(it.id) : null, phase: it.phase as string, item: item!, role: text(it.role, 160), sort: (i + 1) * 10 };
    });
    const before = await checklistOf(plan.id);
    await db.tx(async (tx) => {
      const keep = clean.filter((c) => c.id && before.some((b) => b.id === c.id)).map((c) => c.id);
      await tx.query('delete from continuity_checklist_items where plan_id = $1 and not (id = any($2::uuid[]))', [plan.id, keep]);
      for (const c of clean) {
        if (c.id && keep.includes(c.id)) {
          await tx.query('update continuity_checklist_items set phase = $2, item = $3, role = $4, sort = $5, updated_at = now(), updated_by = $6 where id = $1',
            [c.id, c.phase, c.item, c.role, c.sort, req.user!.id]);
        } else {
          await tx.query('insert into continuity_checklist_items (plan_id, phase, item, role, sort, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$6)',
            [plan.id, c.phase, c.item, c.role, c.sort, req.user!.id]);
        }
      }
    });
    const after = await checklistOf(plan.id);
    await ctx.audit(req, {
      action: 'continuity_plan.checklist', recordType: 'continuity_plan', recordId: plan.id, summary: `Checklist saved: ${after.length} items`,
      before: before.map(({ phase, item, role }) => ({ phase, item, role })), after: after.map(({ phase, item, role }) => ({ phase, item, role })),
    });
    return after;
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/continuity-plans/:id/checklist', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Replace a plan\'s checklist (activations already declared keep their own copy)',
    body: '{ items: [{ id?, phase: activate | respond | recover | stand_down, item, role? }] }',
  });

  // ---------- exercises ----------

  app.get('/api/continuity-plans/:id/exercises', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    const plan = await planFor(ctx, req);
    const list = await exercisesOf(ctx, plan.id, req.user);
    // The last exercise date is a fact about the plan, so it counts every exercise linked to it.
    const last = ctx.resources.get('exercise') ? await db.one<{ d: string | null }>(
      `select max(e.exercise_date)::text as d from record_links l join exercises e on e.id = l.to_id and e.deleted_at is null
       where l.from_type = 'continuity_plan' and l.from_id = $1 and l.to_type = 'exercise' and l.relation = $2
         and e.exercise_date <= $3::date and coalesce(e.status, '') not in ('cancelled', 'canceled')`, [plan.id, EXERCISED_BY, dayInZone()]) : null;
    return { available: Boolean(ctx.resources.get('exercise')), last_exercised_on: last?.d ?? null, exercises: list };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity-plans/:id/exercises', tag: 'Continuity', permission: 'continuity.view',
    summary: 'Exercises that tested a plan (relation exercised_by), and the date of the last one held',
    response: '{ available, last_exercised_on, exercises: [{ link_id, id, ref, title, exercise_date, status, type }] }',
  });

  app.post('/api/continuity-plans/:id/exercises', { preHandler: ctx.requirePerm('continuity.edit') }, async (req, reply) => {
    const plan = await planFor(ctx, req);
    const id = String((req.body as Row | null)?.exercise_id ?? '');
    if (!ctx.resources.get('exercise')) ctx.fail(409, 'exercises_unavailable', 'Exercises are not available in this installation.');
    if (!ctx.can(req.user, 'exercises.view') || !UUID_RE.test(id) || !(await ctx.resources.find('exercise', id, req.user))) invalid(ctx, { exercise_id: 'That exercise was not found.' });
    await db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('continuity_plan', $1, 'exercise', $2, $3, $4) on conflict do nothing`,
      [plan.id, id, EXERCISED_BY, req.user!.id]);
    await ctx.audit(req, { action: 'link.create', recordType: 'continuity_plan', recordId: plan.id, summary: `Linked to exercise (${EXERCISED_BY})`, after: { to_type: 'exercise', to_id: id, relation: EXERCISED_BY } });
    reply.code(201);
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/continuity-plans/:id/exercises', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Record that an exercise tested this plan (a record link, relation exercised_by; also needs exercises.view)', body: '{ exercise_id }',
  });
}
