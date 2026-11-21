import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { MASKED_LABEL } from '../../core/resource.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { PENDING_VERIFICATION, verifiedNow } from './actions-resource.ts';
import { makeActionExtras } from './actions.ts';

// Corrective action plans (E23, GP-02).
//
// A corrective action plan (CAP, contract C1) groups the actions that answer one finding, event,
// failed test or deficiency from any module. It names its source record (source_type, source_id),
// takes that record's restriction, and its actions carry `cap_id`. A plan is approved through the
// shared approval workflows (kind `cap_approval`), then follows its actions: in progress, verifying
// once every action waits for verification, and closed only when every action is done (verified).
//
// Actions that need verification (contract C2) wait in `pending_verification` once their work is
// finished; POST /api/actions/:id/verify records the method and result: effective (or partly
// effective) finishes the action, not effective reopens it and moves its plan back to in progress.
// An action owner who needs more time asks for an extension (kind `action_extension`).
//
// Other modules raise plans with `ctx.resources.create('cap', { title, source, source_type,
// source_id, problem_statement, root_cause?, responsible_id?, due_on? })`, then add actions with
// `cap_id`; on the web they show `CapPanel` from web/src/modules/risks/CapPanel.tsx.

export const CAP_KIND = 'cap_approval';
export const EXTENSION_KIND = 'action_extension';
export const VERIFICATION_REMINDER_SETTING = 'actions.verification_reminder_days';
export const DEFAULT_VERIFICATION_REMINDER_DAYS = 7;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(v));
/** Plan statuses set only by submitting and by the approval workflow, never by hand. */
const WORKFLOW_STATUSES = ['submitted', 'approved', 'rejected'];
/** Plan statuses before approval: actions do not move the plan on yet. */
const BEFORE_APPROVAL = ['draft', 'submitted', 'rejected'];

export const DEFAULT_CAP_WORKFLOW = {
  name: 'Corrective action plan approval',
  description: 'One approval from someone who may approve actions, before work on a corrective action plan starts.',
  steps: [{ key: 'approve', name: 'Plan approval', approvers: { kind: 'permission', permission: 'actions.approve' }, quorum: 'any', due_hours: 120 }],
};

export const DEFAULT_EXTENSION_WORKFLOW = {
  name: 'Action due date extension',
  description: 'One approval from someone who may approve actions, when an action owner asks for a later due date.',
  steps: [{ key: 'approve', name: 'Extension approval', approvers: { kind: 'permission', permission: 'actions.approve' }, quorum: 'any', due_hours: 72 }],
};

const statusesWith = async (ctx: ModuleContext, list: string, flag: string) =>
  (await ctx.lookups.values(list)).filter((v) => v.meta?.[flag]).map((v) => v.value);

/** Counts of a plan's actions (deleted ones left out); canceled actions count for nothing. */
async function actionCounts(ctx: ModuleContext, capId: string) {
  const done = await statusesWith(ctx, 'action_status', 'done');
  const closed = await statusesWith(ctx, 'action_status', 'closed');
  return (await ctx.db.one<{ total: number; live: number; done: number; pending: number; started: number }>(
    `select count(*)::int as total,
            count(*) filter (where not (coalesce(status, '') = any($2::text[])) or status = any($3::text[]))::int as live,
            count(*) filter (where status = any($3::text[]))::int as done,
            count(*) filter (where status = $4)::int as pending,
            count(*) filter (where status = $4 or status = any($3::text[]) or status = 'in_progress' or completed_on is not null)::int as started
     from actions where cap_id = $1 and deleted_at is null`, [capId, closed, done, PENDING_VERIFICATION]))!;
}

/**
 * Moves an approved plan on from its actions: closed when every action is done, verifying when the
 * rest wait for verification, in progress once work has started (or again after a reopen). Plans
 * not yet approved are left alone. System work, audited by the resource engine.
 */
export async function syncCap(ctx: ModuleContext, capId: string): Promise<void> {
  if (!ctx.resources.get('cap')) return;
  const cap = await ctx.db.one<Row>('select id, status, closed_on from caps where id = $1 and deleted_at is null', [capId]);
  if (!cap) return;
  const c = await actionCounts(ctx, capId);
  // Computed counts for list filters ("awaiting verification"): not a change anyone made, so not audited.
  await ctx.db.query('update caps set actions_total = $2, actions_done = $3, actions_awaiting = $4 where id = $1', [capId, c.live, c.done, c.pending]);
  if (BEFORE_APPROVAL.includes(String(cap.status ?? 'draft'))) return;
  let next: string = cap.status;
  if (c.live > 0 && c.done === c.live) next = 'closed';
  else if (c.pending > 0 && c.pending + c.done === c.live) next = 'verifying';
  else if (c.started > 0 || cap.status === 'closed' || cap.status === 'verifying') next = 'in_progress';
  if (next !== cap.status) await ctx.resources.update('cap', capId, { status: next }, null);
}

/** The lists the plan and verification fields use. Idempotent. */
export async function seedCapDefaults(ctx: ModuleContext): Promise<void> {
  const own = { module: 'actions' };
  // Contract C2: not a closed status, so every "no open actions" rule waits for the verification.
  await ctx.lookups.ensure('action_status', [
    { value: PENDING_VERIFICATION, label: 'Awaiting verification', color: 'purple', sort: 35, meta: {} },
  ], own);
  await ctx.lookups.ensure('cap_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'submitted', label: 'Awaiting approval', color: 'amber', sort: 20, meta: { pending: true } },
    { value: 'approved', label: 'Approved', color: 'blue', sort: 30 },
    { value: 'in_progress', label: 'In progress', color: 'blue', sort: 40 },
    { value: 'verifying', label: 'Verifying', color: 'purple', sort: 50 },
    { value: 'closed', label: 'Closed', color: 'green', sort: 60, meta: { closed: true } },
    { value: 'rejected', label: 'Rejected', color: 'red', sort: 70 },
  ], own);
  await ctx.lookups.ensure('cap_root_cause_category', [
    { value: 'people', label: 'People and human factors', sort: 10 },
    { value: 'process', label: 'Process or procedure', sort: 20 },
    { value: 'training', label: 'Training or competence', sort: 30 },
    { value: 'equipment', label: 'Equipment, vehicle or system', sort: 40 },
    { value: 'design', label: 'Design or configuration', sort: 50 },
    { value: 'communication', label: 'Communication', sort: 60 },
    { value: 'environment', label: 'Environment', sort: 70 },
    { value: 'third_party', label: 'Third party', sort: 80 },
    { value: 'other', label: 'Other', sort: 90 },
  ], own);
  await ctx.lookups.ensure('verification_result', [
    { value: 'effective', label: 'Effective', color: 'green', sort: 10 },
    { value: 'partly_effective', label: 'Partly effective', color: 'amber', sort: 20 },
    { value: 'not_effective', label: 'Not effective', color: 'red', sort: 30, meta: { reopen: true } },
  ], own);
  await ctx.lookups.ensure('verification_method', [
    { value: 'record_review', label: 'Record review', sort: 10 },
    { value: 'observation', label: 'Observation', sort: 20 },
    { value: 're_inspection', label: 'Re-inspection', sort: 30 },
    { value: 'data_trend', label: 'Data trend', sort: 40 },
    { value: 'interview', label: 'Interview', sort: 50 },
  ], own);
}

export async function verificationReminderDays(ctx: ModuleContext): Promise<number> {
  const n = Math.round(Number(await ctx.settings.get<unknown>(VERIFICATION_REMINDER_SETTING, DEFAULT_VERIFICATION_REMINDER_DAYS)));
  return Number.isFinite(n) ? Math.min(365, Math.max(0, n)) : DEFAULT_VERIFICATION_REMINDER_DAYS;
}

/**
 * E23-08: tells the verifier (else the plan's responsible person, else everyone who may approve
 * actions) once when a verification comes within the reminder window, and once when it is due or
 * past due (up to 30 days afterwards). Each reminder is claimed by its `once` key before it is sent.
 */
export async function runVerificationReminders(ctx: ModuleContext): Promise<{ available: boolean; soon: number; due: number; notified: number }> {
  const run = { available: ctx.app.hasDecorator('notify'), soon: 0, due: 0, notified: 0 };
  if (!run.available) return run;
  const today = dayInZone();
  const rows = await ctx.db.query<Row>(
    `select a.id, a.ref, a.title, a.verifier_id, c.responsible_id, a.verification_due::text as due_on
     from actions a left join caps c on c.id = a.cap_id and c.deleted_at is null
     where a.deleted_at is null and a.status = $1 and a.verification_due is not null
       and a.verification_due >= $2::date and a.verification_due <= $3::date
     order by a.verification_due, a.ref limit 2000`,
    [PENDING_VERIFICATION, dayInZone(-30), dayInZone(await verificationReminderDays(ctx))],
  );
  for (const a of rows) {
    const due = a.due_on <= today;
    const name = [a.ref, a.title].filter(Boolean).join(' ');
    const who = a.verifier_id ?? a.responsible_id;
    const res = await ctx.app.notify({
      ...(who ? { userIds: [who] } : { permission: 'actions.approve' }),
      kind: 'due',
      title: a.due_on === today ? `Verification due today: ${name}` : due ? `Verification past due: ${name}` : `Verification due on ${displayDate(a.due_on)}: ${name}`,
      body: 'Check whether the action worked, then record the method and the result on the action.',
      recordType: 'action', recordId: a.id,
      once: `action.verify.${due ? 'due' : 'soon'}:${a.id}:${a.due_on}`,
    });
    if (due) run.due += 1; else run.soon += 1;
    run.notified += res.sent;
  }
  return run;
}

/** Registers the `cap` record type, verification, extensions, the approval kinds, routes, job and metrics. */
export async function registerCaps(ctx: ModuleContext): Promise<void> {
  const { app, db } = ctx;
  const extras = makeActionExtras(ctx);
  const engine = () => approvalEngine(app);
  const today = () => dayInZone();
  const lookupLabel = async (list: string, value: unknown) =>
    (await ctx.lookups.values(list)).find((v) => v.value === value)?.label ?? (value == null ? null : String(value));

  async function prepareCap(req: FastifyRequest | null, existing: Row | null, data: Row): Promise<Row> {
    if (!existing) {
      if (data.source === undefined || data.source === null || data.source === '') {
        data.source = (data.source_type ? await extras.sourceFor(data.source_type) : undefined) ?? 'other';
      }
      if (!data.status) data.status = 'draft';
    }
    const errors: Record<string, string> = {};
    if (data.source_type && !/^[a-z_][a-z0-9_]*$/.test(String(data.source_type))) errors.source_type = 'Source record type is not valid.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (data.status !== undefined && data.status !== (existing?.status ?? null)) {
      const closed = (await statusesWith(ctx, 'cap_status', 'closed')).includes(data.status);
      if (req) {
        // People move a plan only after approval, and close it only once every action is done.
        if (!existing && data.status !== 'draft') ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: 'A new plan starts as a draft.' });
        if (WORKFLOW_STATUSES.includes(data.status)) {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: 'Submit the plan for approval instead: the approval workflow sets this status.' });
        }
        if (existing && data.status === 'draft' && existing.status !== 'rejected') {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: 'Only a rejected plan goes back to draft.' });
        }
        if (existing && data.status !== 'draft' && BEFORE_APPROVAL.includes(String(existing.status ?? 'draft'))) {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: 'The plan needs to be approved first.' });
        }
        if (closed && existing) {
          const c = await actionCounts(ctx, existing.id);
          if (c.live === 0 || c.done !== c.live) {
            ctx.fail(409, 'actions_open', 'A plan closes only when every action is done: an action that needs verification is done once it has been verified.');
          }
        }
      }
      if (closed && !data.closed_on) data.closed_on = today();
      if (!closed && existing?.closed_on && data.closed_on === undefined) data.closed_on = null;
    }
    return data;
  }

  ctx.defineResource({
    type: 'cap', table: 'caps', module: 'actions', label: 'Corrective action plan', plural: 'Corrective action plans',
    path: '/api/caps', route: '/caps', titleField: 'title', ref: { field: 'ref', prefix: 'CAP-' },
    // A plan raised on a restricted record (a security incident, a restricted finding) is itself restricted.
    restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
    searchable: ['title', 'problem_statement', 'root_cause', 'effectiveness_summary'],
    defaultSort: { field: 'due_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      status: { label: 'Status', type: 'lookup', list: 'cap_status', default: 'draft' },
      source: { label: 'Source', type: 'lookup', list: 'action_source' },
      source_type: { label: 'Source record type', type: 'text' },
      source_id: { label: 'Source record', type: 'text' },
      problem_statement: { label: 'Problem statement', type: 'longtext', required: true },
      root_cause: { label: 'Root cause', type: 'longtext' },
      root_cause_category: { label: 'Root cause category', type: 'lookup', list: 'cap_root_cause_category' },
      responsible_id: { label: 'Responsible', type: 'user' },
      due_on: { label: 'Due', type: 'date' },
      approved_on: { label: 'Approved on', type: 'date', readOnly: true },
      approved_by_name: { label: 'Approved by', type: 'text', readOnly: true },
      closed_on: { label: 'Closed on', type: 'date', readOnly: true },
      effectiveness_summary: { label: 'Effectiveness summary', type: 'longtext' },
      actions_total: { label: 'Actions', type: 'number', readOnly: true },
      actions_done: { label: 'Actions done', type: 'number', readOnly: true },
      actions_awaiting: { label: 'Actions awaiting verification', type: 'number', readOnly: true },
      restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => prepareCap(req, null, data),
      beforeUpdate: (req, existing, patch) => prepareCap(req, existing, patch),
    },
  });

  // A deleted action no longer counts on its plan.
  ctx.resources.onChange?.(async (change) => {
    if (change.def.type === 'action' && change.action === 'delete' && change.row.cap_id) await syncCap(ctx, String(change.row.cap_id));
  });

  const visibleCap = async (req: FastifyRequest) =>
    (await ctx.resources.find('cap', String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Corrective action plan not found.');
  const visibleAction = async (req: FastifyRequest) =>
    (await ctx.resources.find('action', String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Action not found.');
  const approver = (e: { approverName: string | null; onBehalfOfName: string | null }) =>
    `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;

  // ------------------------------------------------------------------ plan approval (E23-02)

  async function approveCap(capId: string, byName: string | null): Promise<void> {
    await ctx.resources.update('cap', capId, { status: 'approved', approved_on: today(), approved_by_name: byName }, null);
    await syncCap(ctx, capId);
  }

  defineApprovalKind(app, {
    key: CAP_KIND, recordType: 'cap', label: 'Corrective action plan approval',
    startsWhen: 'Someone submits a corrective action plan for approval',
    outcome: 'Approved: the plan becomes Approved, with who approved it and when; rejected: the plan becomes Rejected, with the reason in its history, and can be reworked and submitted again',
    approverPermission: 'actions.approve',
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_CAP_WORKFLOW);
    },
    async onFinish(e) {
      const cap = await db.one<Row>('select * from caps where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!cap) throw new Error('The corrective action plan no longer exists.');
      if (e.outcome === 'canceled') {
        if (cap.status === 'submitted') await ctx.resources.update('cap', cap.id, { status: 'draft' }, null);
        return;
      }
      if (e.outcome === 'rejected') {
        await ctx.resources.update('cap', cap.id, { status: 'rejected' }, null);
        await ctx.audit(e.req, {
          action: 'cap.rejected', recordType: 'cap', recordId: cap.id,
          summary: `Corrective action plan ${cap.ref} rejected by ${approver(e)}: ${e.comment ?? 'no reason given'}`,
          after: { workflow: e.instance.name, reason: e.comment },
        });
        return;
      }
      await approveCap(cap.id, approver(e));
      await ctx.audit(e.req, {
        action: 'cap.approved', recordType: 'cap', recordId: cap.id,
        summary: `Corrective action plan ${cap.ref} approved by ${approver(e)}`, after: { workflow: e.instance.name },
      });
    },
  });

  app.post('/api/caps/:id/submit', { preHandler: ctx.requirePerm('actions.edit') }, async (req) => {
    const cap = await visibleCap(req);
    if (!['draft', 'rejected'].includes(String(cap.status ?? 'draft'))) ctx.fail(409, 'not_draft', 'Only a draft or rejected plan can be submitted for approval.');
    const errors: Record<string, string> = {};
    if (!String(cap.problem_statement ?? '').trim()) errors.problem_statement = 'Describe the problem.';
    if (!String(cap.root_cause ?? '').trim()) errors.root_cause = 'Give the root cause before submitting the plan.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if ((await actionCounts(ctx, cap.id)).live === 0) ctx.fail(409, 'no_actions', 'Add at least one action to the plan before submitting it.');
    await ctx.resources.update('cap', cap.id, { status: 'submitted' }, null);
    await ctx.audit(req, { action: 'cap.submitted', recordType: 'cap', recordId: cap.id, summary: `Corrective action plan ${cap.ref} submitted for approval` });
    const eng = engine();
    const started = eng ? await eng.start(CAP_KIND, { ...cap, status: 'submitted' }, { requester: req.user!.id, req, note: String(cap.title).slice(0, 500) }) : null;
    if (!started) {
      // No workflow applies (or approval workflows are not part of this installation): nothing to wait for.
      await approveCap(cap.id, null);
      await ctx.audit(req, { action: 'cap.approved', recordType: 'cap', recordId: cap.id, summary: `Corrective action plan ${cap.ref} approved: no approval workflow applies` });
    }
    const now = (await ctx.resources.find('cap', cap.id))!;
    return { status: now.status, instance_id: started?.id ?? null, workflow: started?.name ?? null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/caps/:id/submit', tag: 'Actions', permission: 'actions.edit',
    summary: 'Submit a corrective action plan for approval: starts the "Corrective action plan approval" workflow (approved at once when none applies)',
    description: 'The plan needs a problem statement, a root cause and at least one action. Restricted plans also need security.view.',
    response: '{ status, instance_id, workflow }',
  });

  app.get('/api/caps/:id/approval', { preHandler: ctx.requirePerm('actions.view') }, async (req) => {
    const cap = await visibleCap(req);
    const eng = engine();
    const latest = eng ? await eng.latest(CAP_KIND, cap.id) : null;
    return {
      available: Boolean(eng && (await eng.definitions(CAP_KIND)).length),
      status: cap.status, approved_on: cap.approved_on ?? null, approved_by_name: cap.approved_by_name ?? null,
      request: latest ? { id: latest.id, workflow: latest.name, status: latest.status, started_at: latest.startedAt, finished_at: latest.finishedAt } : null,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/caps/:id/approval', tag: 'Actions', permission: 'actions.view',
    summary: 'Approval of one corrective action plan: who approved it and when, and its newest approval workflow',
    response: '{ available, status, approved_on, approved_by_name, request: { id, workflow, status, started_at, finished_at } | null }',
  });

  // ------------------------------------------------------------------ verification (E23-03)

  app.post('/api/actions/:id/verify', { preHandler: ctx.requirePerm('actions.edit') }, async (req) => {
    const action = await visibleAction(req);
    if (action.status !== PENDING_VERIFICATION) ctx.fail(409, 'not_awaiting_verification', 'This action is not waiting for verification.');
    const cap = action.cap_id ? await db.one<Row>('select responsible_id from caps where id = $1', [action.cap_id]) : null;
    const uid = req.user!.id;
    if (!(uid === action.verifier_id || (!action.verifier_id && uid === cap?.responsible_id) || ctx.can(req.user ?? null, 'actions.approve'))) {
      ctx.fail(403, 'forbidden', 'Only the verifier named on the action, or someone who may approve actions, can record its verification.');
    }
    const b = (req.body ?? {}) as Row;
    const method = String(b.method ?? '').trim();
    const result = String(b.result ?? '').trim();
    const note = String(b.note ?? '').trim().slice(0, 4000);
    const results = await ctx.lookups.values('verification_result');
    const chosen = results.find((r) => r.value === result);
    const errors: Record<string, string> = {};
    if (!(await ctx.lookups.values('verification_method')).some((m) => m.value === method)) errors.method = 'Choose how the action was verified.';
    if (!chosen) errors.result = 'Choose the result.';
    else if (chosen.meta?.reopen && !note) errors.note = 'Say why the action was not effective: the action is reopened with this reason.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const recorded = { verified_by: uid, verified_on: today(), verification_method: method, verification_result: result, verification_note: note || null };
    if (chosen!.meta?.reopen) {
      const row = await ctx.resources.update('action', action.id, { ...recorded, status: 'in_progress', completed_on: null }, null);
      await ctx.audit(req, {
        action: 'action.verification_failed', recordType: 'action', recordId: action.id,
        summary: `${action.ref} verified as not effective and reopened: ${note}`, after: recorded,
      });
      if (row.owner_id && row.owner_id !== uid && app.hasDecorator('notify')) {
        await app.notify({ userIds: [row.owner_id], kind: 'assignment', title: `Action reopened after verification: ${row.title}`, body: note, recordType: 'action', recordId: row.id });
      }
      return row;
    }
    const doneValue = (await statusesWith(ctx, 'action_status', 'done'))[0] ?? 'done';
    verifiedNow.add(action.id);
    let row: Row;
    try {
      row = await ctx.resources.update('action', action.id, { ...recorded, status: doneValue }, null);
    } finally {
      verifiedNow.delete(action.id);
    }
    await ctx.audit(req, {
      action: 'action.verified', recordType: 'action', recordId: action.id,
      summary: `${action.ref} verified as ${String(chosen!.label).toLowerCase()} (${await lookupLabel('verification_method', method)})`, after: recorded,
    });
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/actions/:id/verify', tag: 'Actions', permission: 'actions.edit',
    summary: 'Record the verification of an action awaiting verification: effective finishes it, not effective reopens it',
    description: 'Only the verifier named on the action (else the plan\'s responsible person) or someone with actions.approve may record it. A not-effective result needs a note, reopens the action and moves its plan back to in progress.',
    body: '{ method: verification_method value, result: verification_result value, note?: string }', response: 'the action',
  });

  // ------------------------------------------------------------------ extensions (E23-05)

  defineApprovalKind(app, {
    key: EXTENSION_KIND, recordType: 'action', label: 'Action due date extension',
    startsWhen: 'An action owner asks for a later due date',
    outcome: 'Approved: the action gets the new due date, keeps its original one and counts the extension; rejected: the due date stays, with the reason in the history',
    approverPermission: 'actions.approve',
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_EXTENSION_WORKFLOW);
    },
    async onFinish(e) {
      const ext = await db.one<Row>('select * from action_extensions where id = $1', [String(e.instance.data.extension_id ?? '')]);
      if (!ext || ext.status !== 'pending') return;
      await decideExtension(ext, e.outcome, approver(e), e.comment, e.req);
    },
  });

  async function decideExtension(ext: Row, outcome: 'approved' | 'rejected' | 'canceled', byName: string, comment: string | null, req: FastifyRequest | null) {
    await db.query(
      `update action_extensions set status = $2, decided_by_name = $3, decided_on = $4, decision_note = $5 where id = $1`,
      [ext.id, outcome, byName, today(), comment],
    );
    const action = await db.one<Row>('select id, ref, due_on::text as due_on, original_due_on::text as original_due_on, extension_count from actions where id = $1', [ext.action_id]);
    if (!action) return;
    const newDue = typeof ext.new_due_on === 'string' ? ext.new_due_on : dayFrom(ext.new_due_on);
    if (outcome === 'approved') {
      await ctx.resources.update('action', action.id, {
        due_on: newDue, original_due_on: action.original_due_on ?? action.due_on ?? null, extension_count: Number(action.extension_count ?? 0) + 1,
      }, null);
    }
    await ctx.audit(req, {
      action: `action.extension_${outcome}`, recordType: 'action', recordId: action.id,
      summary: `Extension of ${action.ref} to ${displayDate(newDue)} ${outcome} by ${byName}${comment ? `: ${comment}` : ''}`,
      after: { new_due_on: newDue, reason: ext.reason, decision_note: comment },
    });
  }
  const dayFrom = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));

  app.post('/api/actions/:id/extension-request', { preHandler: ctx.requirePerm('actions.edit') }, async (req, reply) => {
    const action = await visibleAction(req);
    if ((await statusesWith(ctx, 'action_status', 'closed')).includes(action.status)) ctx.fail(409, 'closed', 'This action is finished, so its due date cannot be extended.');
    const b = (req.body ?? {}) as Row;
    const newDue = String(b.new_due_on ?? '').trim();
    const reason = String(b.reason ?? '').trim().slice(0, 2000);
    const oldDue = action.due_on ? dayFrom(action.due_on) : null;
    const errors: Record<string, string> = {};
    if (!validDate(newDue)) errors.new_due_on = 'Give the new due date (YYYY-MM-DD).';
    else if (newDue <= (oldDue && oldDue > today() ? oldDue : today())) errors.new_due_on = 'The new due date must be later than the current one and after today.';
    if (!reason) errors.reason = 'Say why more time is needed.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (await db.one(`select 1 from action_extensions where action_id = $1 and status = 'pending'`, [action.id])) {
      ctx.fail(409, 'already_requested', 'An extension of this action has already been asked for and is waiting for a decision.');
    }
    const eng = engine();
    if (!eng || !(await eng.definitions(EXTENSION_KIND)).length) {
      ctx.fail(409, 'no_workflow', 'No action extension workflow is set up. Someone who may approve actions can change the due date directly, or an administrator can set one up under Administration > Approval workflows.');
    }
    const ext = (await db.one<Row>(
      `insert into action_extensions (action_id, requested_by, requested_on, old_due_on, new_due_on, reason)
       values ($1,$2,$3,$4,$5,$6) returning id`, [action.id, req.user!.id, today(), oldDue, newDue, reason],
    ))!;
    await ctx.audit(req, {
      action: 'action.extension_requested', recordType: 'action', recordId: action.id,
      summary: `Extension of ${action.ref} to ${displayDate(newDue)} asked for: ${reason}`, after: { old_due_on: oldDue, new_due_on: newDue, reason },
    });
    const started = await eng!.start(EXTENSION_KIND, action, {
      requester: req.user!.id, req, note: reason, data: { extension_id: ext.id, new_due_on: newDue, old_due_on: oldDue, reason },
    });
    if (started) await db.query('update action_extensions set workflow_instance_id = $2 where id = $1', [ext.id, started.id]);
    else {
      const pending = await db.one<Row>(`select * from action_extensions where id = $1 and status = 'pending'`, [ext.id]);
      if (pending) await decideExtension(pending, 'approved', 'No approval needed (no workflow applies)', null, req);
    }
    reply.code(201);
    return (await db.one<Row>('select id, status, old_due_on::text as old_due_on, new_due_on::text as new_due_on, reason from action_extensions where id = $1', [ext.id]))!;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/actions/:id/extension-request', tag: 'Actions', permission: 'actions.edit',
    summary: 'Ask for a later due date on an action: starts the "Action due date extension" approval workflow',
    body: '{ new_due_on: date, reason: string }', response: '{ id, status, old_due_on, new_due_on, reason }',
  });

  app.get('/api/actions/:id/extension-requests', { preHandler: ctx.requirePerm('actions.view') }, async (req) => {
    const action = await visibleAction(req);
    const eng = engine();
    return {
      available: Boolean(eng && (await eng.definitions(EXTENSION_KIND)).length),
      original_due_on: action.original_due_on ? dayFrom(action.original_due_on) : null,
      extension_count: Number(action.extension_count ?? 0),
      requests: await db.query<Row>(
        `select x.id, x.status, x.requested_on::text as requested_on, x.old_due_on::text as old_due_on, x.new_due_on::text as new_due_on,
                x.reason, x.decided_by_name, x.decided_on::text as decided_on, x.decision_note, u.display_name as requested_by_name
         from action_extensions x left join users u on u.id = x.requested_by
         where x.action_id = $1 order by x.created_at desc`, [action.id]),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/actions/:id/extension-requests', tag: 'Actions', permission: 'actions.view',
    summary: 'The due-date extension requests of one action and their decisions, newest first',
    response: '{ available, original_due_on, extension_count, requests: [{ id, status, requested_on, old_due_on, new_due_on, reason, decided_by_name, decided_on, decision_note, requested_by_name }] }',
  });

  // ------------------------------------------------------------------ register and figures (E23-06)

  const CAP_ACTION_COUNTS = `
    (select count(*) from actions a where a.cap_id = c.id and a.deleted_at is null)::int as actions_total,
    (select count(*) from actions a where a.cap_id = c.id and a.deleted_at is null and a.status = any($2::text[]))::int as actions_done,
    (select count(*) from actions a where a.cap_id = c.id and a.deleted_at is null and a.status = '${PENDING_VERIFICATION}')::int as actions_awaiting_verification,
    (select count(*) from actions a where a.cap_id = c.id and a.deleted_at is null and a.due_on < current_date and a.completed_on is null
       and not (coalesce(a.status, '') = any($1::text[])))::int as actions_overdue`;

  app.get('/api/caps/register', { preHandler: ctx.requirePerm('actions.view') }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>;
    const closed = await statusesWith(ctx, 'action_status', 'closed');
    const done = await statusesWith(ctx, 'action_status', 'done');
    const capClosed = await statusesWith(ctx, 'cap_status', 'closed');
    const params: unknown[] = [closed, done, capClosed];
    const where = [`c.deleted_at is null`, ctx.resources.visibleWhere('cap', req.user, 'c')];
    if (q.source) { params.push(q.source); where.push(`c.source = $${params.length}`); }
    if (q.status) { params.push(q.status); where.push(`c.status = $${params.length}`); }
    if (q.source_type) { params.push(q.source_type); where.push(`c.source_type = $${params.length}`); }
    if (q.source_id) {
      if (!UUID.test(q.source_id)) return { rows: [], total: 0 };
      params.push(q.source_id); where.push(`c.source_id = $${params.length}::uuid`);
    }
    if (q.overdue === '1' || q.overdue === 'true') where.push(`c.due_on < current_date and not (coalesce(c.status, '') = any($3::text[])) and c.status <> 'rejected'`);
    if (q.awaiting === '1' || q.awaiting === 'true') where.push(`exists (select 1 from actions a where a.cap_id = c.id and a.deleted_at is null and a.status = '${PENDING_VERIFICATION}')`);
    if (q.q) { params.push(`%${String(q.q).slice(0, 200)}%`); where.push(`(c.title ilike $${params.length} or c.ref ilike $${params.length} or c.problem_statement ilike $${params.length})`); }
    const rows = await db.query<Row>(
      `select c.id, c.ref, c.title, c.status, c.source, c.source_type, c.source_id, c.responsible_id, u.display_name as responsible_name,
              c.due_on::text as due_on, c.approved_on::text as approved_on, c.closed_on::text as closed_on, c.restricted,
              (c.due_on < current_date and not (coalesce(c.status, '') = any($3::text[])) and c.status <> 'rejected') as overdue,
              ${CAP_ACTION_COUNTS}
       from caps c left join users u on u.id = c.responsible_id
       where ${where.join(' and ')}
       order by c.due_on nulls last, c.ref limit 1000`, params);
    return { rows, total: rows.length };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/caps/register', tag: 'Actions', permission: 'actions.view',
    summary: 'Corrective action plans across every source, with counts of their actions (restricted plans need security.view)',
    query: { source: 'action_source value', source_type: 'Source record type', source_id: 'Source record id', status: 'cap_status value', overdue: '1: only plans past their due date', awaiting: '1: only plans with actions awaiting verification', q: 'Text in the reference, title or problem statement' },
    response: '{ rows: [{ id, ref, title, status, source, responsible_name, due_on, overdue, actions_total, actions_done, actions_awaiting_verification, actions_overdue, ... }], total }',
  });

  app.get('/api/caps/summary', { preHandler: ctx.requirePerm('actions.view') }, async () => {
    // Figures are the same for everyone (docs/security.md): every plan counts, restricted or not;
    // no words or people are shown, so nothing is masked.
    const capClosed = await statusesWith(ctx, 'cap_status', 'closed');
    const head = (await db.one<Row>(
      `select count(*) filter (where not (coalesce(status, '') = any($1::text[])) and status <> 'rejected')::int as open,
              count(*) filter (where due_on < current_date and not (coalesce(status, '') = any($1::text[])) and status <> 'rejected')::int as overdue,
              count(*) filter (where status = 'submitted')::int as awaiting_approval,
              count(*) filter (where status = 'verifying')::int as verifying,
              count(*) filter (where restricted)::int as restricted
       from caps where deleted_at is null`, [capClosed]))!;
    const actions = (await db.one<Row>(
      `select count(*) filter (where status = $1)::int as awaiting_verification,
              count(*) filter (where status = $1 and verification_due < current_date)::int as verification_overdue
       from actions where deleted_at is null and cap_id is not null`, [PENDING_VERIFICATION]))!;
    const statuses = await ctx.lookups.values('cap_status');
    const sources = await ctx.lookups.values('action_source');
    const byStatus = await db.query<Row>('select status as value, count(*)::int as count from caps where deleted_at is null group by 1', []);
    const bySource = await db.query<Row>(
      `select source as value, count(*)::int as count from caps where deleted_at is null and not (coalesce(status, '') = any($1::text[])) and status <> 'rejected' group by 1 order by 2 desc, 1`, [capClosed]);
    return {
      ...head,
      actions_awaiting_verification: actions.awaiting_verification,
      verification_overdue: actions.verification_overdue,
      by_status: statuses.map((s) => ({ value: s.value, label: s.label, color: s.color ?? 'gray', count: byStatus.find((b) => b.value === s.value)?.count ?? 0 })),
      by_source: bySource.map((s) => {
        const lv = sources.find((x) => x.value === s.value);
        return { value: s.value, label: lv?.label ?? s.value ?? 'None', color: lv?.color ?? 'gray', count: s.count };
      }),
      restricted_label: MASKED_LABEL,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/caps/summary', tag: 'Actions', permission: 'actions.view',
    summary: 'Figures for corrective action plans: open, overdue, awaiting approval, verifying, actions awaiting verification, by status and by source',
    description: 'Figures are the same for everyone: every plan counts, restricted ones included.',
    response: '{ open, overdue, awaiting_approval, verifying, restricted, actions_awaiting_verification, verification_overdue, by_status: [{ value, label, color, count }], by_source: [{ value, label, color, count }] }',
  });

  // ------------------------------------------------------------------ reminders and metrics (E23-08, E23-09)

  await scheduleWork(ctx, 'actions.verification_due', () => runVerificationReminders(ctx), { every: 6 * 3_600_000, firstRunInMs: 110_000 });

  /** The last day counted for a month: its last day, or today for the month still running. */
  const asOf = `least((date_trunc('month', $1::date) + interval '1 month - 1 day')::date, current_date)`;
  defineMetric(app, {
    key: 'actions.overdue', label: 'Overdue actions', unit: 'count', recordType: 'action',
    description: 'Actions past their due date and not yet finished at the end of the month (today for the current month). Canceled actions are left out.',
    async compute(c, month) {
      const closed = (await c.lookups.values('action_status')).filter((v) => v.meta?.closed && !v.meta?.done).map((v) => v.value);
      return (await c.db.one<{ n: number }>(
        `select count(*)::int as n from actions where deleted_at is null and created_at::date <= ${asOf}
           and due_on < ${asOf} and (completed_on is null or completed_on > ${asOf}) and not (coalesce(status, '') = any($2::text[]))`, [month, closed]))!.n;
    },
  });
  defineMetric(app, {
    key: 'actions.caps_overdue', label: 'Overdue corrective action plans', unit: 'count', recordType: 'cap',
    description: 'Corrective action plans past their due date and not closed at the end of the month (today for the current month). Rejected plans are left out.',
    async compute(c, month) {
      return (await c.db.one<{ n: number }>(
        `select count(*)::int as n from caps where deleted_at is null and created_at::date <= ${asOf} and coalesce(status, '') <> 'rejected'
           and due_on < ${asOf} and (closed_on is null or closed_on > ${asOf})`, [month]))!.n;
    },
  });
  defineMetric(app, {
    key: 'actions.awaiting_verification', label: 'Actions awaiting verification', unit: 'count', recordType: 'action',
    description: 'Actions whose work was finished but whose effectiveness had not been verified at the end of the month (today for the current month).',
    async compute(c, month) {
      return (await c.db.one<{ n: number }>(
        `select count(*)::int as n from actions where deleted_at is null and verification_required
           and completed_on <= ${asOf} and (verified_on is null or verified_on > ${asOf} or status = $2)`, [month, PENDING_VERIFICATION]))!.n;
    },
  });
}
