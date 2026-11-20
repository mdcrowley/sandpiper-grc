// The approval workflow service (E14-06): starts workflows on records, routes each step to its
// approvers, records decisions, escalates overdue steps and applies the outcome. The rules
// themselves are in engine.ts; this file stores and tells people.
import type { FastifyRequest } from 'fastify';
import { loadUser } from '../../core/auth.ts';
import { fail } from '../../core/errors.ts';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { emitWebhookEvent, WEBHOOK_EVENTS } from '../../core/webhooks.ts';
import {
  allHold, eligible, nextStep, outcomePatch, refusal, required, tally,
  type ApproverSpec, type StepDef, type WorkflowDef,
} from './engine.ts';

const HOUR = 3_600_000;
/** How long the list of automatic workflows is kept before it is read again (other processes may change it). */
const TRIGGER_CACHE_MS = 5_000;

export type Service = ReturnType<typeof makeService>;

const asDef = (row: Row): WorkflowDef => (typeof row === 'string' ? JSON.parse(row) : row) as WorkflowDef;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? JSON.parse(v) : []);

export function makeService(ctx: ModuleContext) {
  const { db, app } = ctx;
  /** Records whose outcome the engine is writing right now: their changes start no workflow. */
  const applying = new Set<string>();
  let triggerCache: { at: number; rows: Row[] } | null = null;

  const typeDef = (type: string): ResourceDef | undefined => ctx.resources.get(type);
  const recordKey = (type: string, id: string) => `${type}:${id}`;

  // ---------- people ----------

  /** People by id, loaded with their permissions (switched-off areas applied). Missing = inactive. */
  async function people(list: string[]): Promise<Map<string, SessionUser>> {
    const out = new Map<string, SessionUser>();
    for (const id of new Set(list)) {
      const u = await loadUser(db, id);
      if (u) out.set(id, u);
    }
    return out;
  }

  /** Whether a person may see the record: view permission on its type and the restricted-record rule. */
  async function maySee(user: SessionUser, def: ResourceDef, id: string): Promise<boolean> {
    if (!ctx.can(user, `${def.module}.view`)) return false;
    if (def.restricted === true && !ctx.can(user, 'security.view')) return false;
    return Boolean(await ctx.resources.find(def.type, id, user));
  }

  async function roleMembers(role: string): Promise<string[]> {
    const rows = await db.query<{ id: string }>(
      `select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id and r.enabled
       where r.key = $1 and u.status = 'active' and u.deleted_at is null order by u.display_name`, [role]);
    return rows.map((r) => r.id);
  }

  async function departmentHead(departmentId: string | null | undefined): Promise<string | null> {
    if (!departmentId) return null;
    return (await db.one<{ user_id: string }>('select user_id from workflow_department_heads where department_id = $1', [departmentId]))?.user_id ?? null;
  }

  async function departmentOfUser(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    return (await db.one<{ department_id: string | null }>('select department_id from users where id = $1', [userId]))?.department_id ?? null;
  }

  /** Everyone a step names, before the requester and people who cannot see the record are taken out. */
  async function candidates(spec: ApproverSpec, record: Row, def: ResourceDef, requester: string | null): Promise<string[]> {
    switch (spec.kind) {
      case 'users': return spec.users;
      case 'role': return roleMembers(spec.role);
      case 'field': return def.fields[spec.field]?.type === 'user' && record[spec.field] ? [String(record[spec.field])] : [];
      case 'department_head': {
        if (spec.from === 'requester') return [await departmentHead(await departmentOfUser(requester))].filter(Boolean) as string[];
        const field = spec.field ?? '';
        const value = record[field];
        if (!value) return [];
        if (def.fields[field]?.type === 'user') return [await departmentHead(await departmentOfUser(String(value)))].filter(Boolean) as string[];
        const dept = await db.one<{ id: string }>('select id from departments where deleted_at is null and lower(name) = lower($1)', [String(value)]);
        return [await departmentHead(dept?.id)].filter(Boolean) as string[];
      }
      default: return [];
    }
  }

  /** The people who may decide: named, active, not the requester, and able to see the record. */
  async function approversFor(list: string[], def: ResourceDef, recordId: string, requester: string | null): Promise<string[]> {
    const loaded = await people(list.filter((id) => id !== requester));
    const ok = new Set<string>();
    for (const [id, u] of loaded) if (await maySee(u, def, recordId)) ok.add(id);
    return eligible(list, requester, (id) => ok.has(id));
  }

  // ---------- telling people ----------

  async function tell(input: { userIds: string[]; title: string; body?: string; recordType: string; recordId: string; route?: string }) {
    if (!input.userIds.length || !app.hasDecorator('notify')) return;
    await app.notify({ kind: 'approval', ...input });
  }

  async function webhook(event: string, data: Row, record: { type: string; id: string }, req: FastifyRequest | null) {
    if (!WEBHOOK_EVENTS.some((e) => e.event === event)) return;
    await emitWebhookEvent(app, { event, data, record, req });
  }

  const recordName = async (type: string, id: string) => (await ctx.resources.labelFor(type, id)) ?? 'a record';

  // ---------- definitions that start by themselves ----------

  async function automatic(type: string): Promise<Row[]> {
    if (!triggerCache || Date.now() - triggerCache.at > TRIGGER_CACHE_MS) {
      triggerCache = {
        at: Date.now(),
        rows: await db.query<Row>(`select * from workflow_definitions where active and deleted_at is null and trigger <> 'manual' order by created_at`),
      };
    }
    return triggerCache.rows.filter((r) => r.record_type === type);
  }
  const forget = () => { triggerCache = null; };

  /** A record was created: start the workflows that start on creation and whose conditions hold. */
  async function recordCreated(def: ResourceDef, row: Row, req: FastifyRequest | null): Promise<void> {
    if (!typeDef(def.type)) return; // switched off
    for (const w of await automatic(def.type)) {
      if (w.trigger !== 'create' || !allHold(w.conditions, row, def.fields)) continue;
      await start(w, def, row, req?.user?.id ?? null, req, null, true);
    }
  }

  /** A record changed: start the workflows that wait for a field to take a value. */
  async function recordUpdated(def: ResourceDef, before: Row, after: Row, req: FastifyRequest | null): Promise<void> {
    if (applying.has(recordKey(def.type, after.id)) || !typeDef(def.type)) return;
    for (const w of await automatic(def.type)) {
      if (w.trigger !== 'status' || !w.trigger_field) continue;
      const f = w.trigger_field as string;
      if (String(before[f] ?? '') === String(after[f] ?? '') || String(after[f] ?? '') !== w.trigger_value) continue;
      if (!allHold(w.conditions, after, def.fields)) continue;
      await start(w, def, after, req?.user?.id ?? null, req, null, true);
    }
  }

  // ---------- running a workflow ----------

  /**
   * Starts a definition on a record. `quiet` (automatic starts) skips a definition that is already
   * running on the record instead of refusing.
   */
  async function start(w: Row, def: ResourceDef, record: Row, requester: string | null, req: FastifyRequest | null, note: string | null, quiet = false): Promise<Row | null> {
    const running = await db.one('select id from workflow_instances where definition_id = $1 and record_id = $2 and status = $3', [w.id, record.id, 'running']);
    if (running) {
      if (quiet) return null;
      fail(409, 'already_running', 'This workflow is already running on this record.');
    }
    const snapshot: WorkflowDef = {
      record_type: w.record_type, name: w.name, description: w.description, active: w.active, trigger: w.trigger,
      trigger_field: w.trigger_field, trigger_value: w.trigger_value, conditions: w.conditions, steps: w.steps,
      on_approve: w.on_approve, on_reject: w.on_reject,
    };
    let instance: Row | undefined;
    try {
      instance = await db.one<Row>(
        `insert into workflow_instances (definition_id, definition, name, record_type, record_id, requested_by, note)
         values ($1, $2::jsonb, $3, $4, $5, $6, $7) returning *`,
        [w.id, JSON.stringify(snapshot), w.name, def.type, record.id, requester, note]);
    } catch (err) {
      // Two starts at once: the unique index keeps one running.
      if (quiet) return null;
      if (/unique|duplicate/i.test((err as Error).message)) fail(409, 'already_running', 'This workflow is already running on this record.');
      throw err;
    }
    const name = await recordName(def.type, record.id);
    await ctx.audit(req, {
      action: 'workflow.start', recordType: def.type, recordId: record.id,
      summary: `Approval workflow "${w.name}" started on ${def.label.toLowerCase()} ${name}`,
      after: { workflow: w.name, instance: instance!.id, note },
    });
    await advance(instance!, 0, null, req);
    return instance!;
  }

  async function loadInstance(id: string): Promise<Row | undefined> {
    return db.one<Row>('select * from workflow_instances where id = $1', [id]);
  }

  /** Moves a workflow on from step `from`: skips steps whose conditions do not hold and starts the next. */
  async function advance(instance: Row, from: number, lastApprover: string | null, req: FastifyRequest | null): Promise<void> {
    const wf = asDef(instance.definition);
    const def = typeDef(instance.record_type);
    const record = def ? await ctx.resources.find(def.type, instance.record_id) : undefined;
    if (!def || !record) {
      await finish(instance, 'canceled', null, req, 'The record is no longer available.');
      return;
    }
    const { next, skipped } = nextStep(wf.steps, from, record, def.fields);
    for (const i of skipped) {
      await db.query(
        `insert into workflow_steps (instance_id, position, step_key, name, status, required, note, finished_at)
         values ($1, $2, $3, $4, 'skipped', 0, $5, now()) on conflict (instance_id, position) do nothing`,
        [instance.id, i, wf.steps[i].key, wf.steps[i].name, 'Its conditions did not hold for this record.']);
    }
    if (next === null) {
      await finish(instance, 'approved', lastApprover, req, null);
      return;
    }
    await activate(instance, wf.steps[next], next, def, record);
  }

  async function activate(instance: Row, step: StepDef, position: number, def: ResourceDef, record: Row): Promise<void> {
    const requester = instance.requested_by ?? null;
    let approvers = await approversFor(await candidates(step.approvers, record, def, requester), def, record.id, requester);
    let note: string | null = null;
    let escalatedAt: Date | null = null;
    if (!approvers.length && step.escalate_to) {
      // Nobody can approve the step itself: it goes straight to the people it escalates to.
      approvers = await approversFor(await escalationPeople(step), def, record.id, requester);
      if (approvers.length) { escalatedAt = new Date(); note = 'Nobody named by the step could approve it, so it went to the people it escalates to.'; }
    }
    if (!approvers.length) note = 'Nobody named by this step can approve it (they may be inactive, the requester, or unable to see the record). An administrator can cancel the workflow.';
    const need = required(step.quorum, approvers.length);
    const due = step.due_hours ? new Date(Date.now() + step.due_hours * HOUR) : null;
    const row = (await db.one<Row>(
      `insert into workflow_steps (instance_id, position, step_key, name, status, approvers, required, due_at, escalated_at, note)
       values ($1, $2, $3, $4, 'pending', $5::jsonb, $6, $7, $8, $9) returning *`,
      [instance.id, position, step.key, step.name, JSON.stringify(approvers), need, due, escalatedAt, note]))!;
    await db.query('update workflow_instances set current_step = $2 where id = $1', [instance.id, position]);
    const name = await recordName(def.type, record.id);
    await tell({
      userIds: approvers, recordType: def.type, recordId: record.id,
      title: `Approval needed: ${def.label.toLowerCase()} ${name}`,
      body: `${instance.name}: ${step.name}${need > 1 ? ` (${need} approvals needed)` : ''}`,
    });
    if (due && app.hasDecorator('jobs') && !escalatedAt) {
      await app.jobs.enqueue('workflows.escalate', { stepId: row.id }, { key: `workflows.escalate:${row.id}`, runAt: due });
    }
  }

  async function escalationPeople(step: StepDef): Promise<string[]> {
    const e = step.escalate_to;
    if (!e) return [];
    return [...e.users, ...(e.role ? await roleMembers(e.role) : [])];
  }

  /** Ends a workflow: records the outcome and sets the fields the definition names. */
  async function finish(instance: Row, status: 'approved' | 'rejected' | 'canceled', approver: string | null, req: FastifyRequest | null, reason: string | null): Promise<void> {
    const done = await db.one<Row>(
      `update workflow_instances set status = $2, finished_at = now(), current_step = null, outcome_note = $3
       where id = $1 and status = 'running' returning *`, [instance.id, status, reason]);
    if (!done) return; // finished by someone else meanwhile
    await db.query(`update workflow_steps set status = 'canceled', finished_at = now() where instance_id = $1 and status = 'pending'`, [instance.id]);
    const wf = asDef(instance.definition);
    const def = typeDef(instance.record_type);
    const label = def ? def.label.toLowerCase() : 'record';
    const name = await recordName(instance.record_type, instance.record_id);
    let error: string | null = null;
    const sets = status === 'approved' ? wf.on_approve : status === 'rejected' ? wf.on_reject : [];
    if (def && sets?.length) {
      const patch = outcomePatch(sets, def.fields, { today: dayInZone(0), approver, requester: instance.requested_by ?? null });
      const key = recordKey(def.type, instance.record_id);
      applying.add(key);
      try {
        await ctx.resources.update(def.type, instance.record_id, patch, null);
      } catch (err) {
        error = (err as Error).message || 'The record could not be changed.';
        await db.query('update workflow_instances set outcome_error = $2 where id = $1', [instance.id, error.slice(0, 500)]);
      } finally {
        applying.delete(key);
      }
    }
    const word = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'canceled';
    await ctx.audit(req, {
      action: `workflow.${status === 'canceled' ? 'cancel' : 'finish'}`, recordType: instance.record_type, recordId: instance.record_id,
      summary: `Approval workflow "${instance.name}" ${word} on ${label} ${name}${error ? ` (the outcome could not be applied: ${error})` : ''}`,
      after: { workflow: instance.name, instance: instance.id, outcome: status, reason, error },
    });
    if (instance.requested_by && status !== 'canceled') {
      await tell({
        userIds: [instance.requested_by], recordType: instance.record_type, recordId: instance.record_id,
        title: `${status === 'approved' ? 'Approved' : 'Rejected'}: ${label} ${name}`,
        body: `${instance.name}${error ? '. The record could not be updated; an administrator should check it.' : ''}`,
      });
    }
    await webhook('workflow.finished', { workflow: instance.name, outcome: status, reason, outcomeError: error }, { type: instance.record_type, id: instance.record_id }, req);
  }

  // ---------- decisions ----------

  /** One person's decision on a step. Refuses the requester, anyone not named, and second decisions. */
  async function decide(stepId: string, req: FastifyRequest, decision: string, comment: string | null): Promise<Row> {
    const user = req.user!;
    if (decision !== 'approved' && decision !== 'rejected') fail(400, 'validation', 'Choose approve or reject.', { decision: 'Choose approve or reject.' });
    if (decision === 'rejected' && !comment) fail(400, 'validation', 'Say why you reject it.', { comment: 'Say why you reject it.' });
    const step = await db.one<Row>('select * from workflow_steps where id = $1', [stepId]);
    const instance = step ? await loadInstance(step.instance_id) : undefined;
    const def = instance ? typeDef(instance.record_type) : undefined;
    if (!step || !instance || !def || !(await maySee(user, def, instance.record_id))) fail(404, 'not_found', 'Approval not found.');

    const outcome = await db.tx(async (tx) => {
      // The step row is locked so two last approvals at once cannot both move the workflow on.
      const locked = (await tx.one<Row>('select * from workflow_steps where id = $1 for update', [stepId]))!;
      const inst = (await tx.one<{ status: string; requested_by: string | null }>('select status, requested_by from workflow_instances where id = $1', [locked.instance_id]))!;
      const mine = await tx.one('select 1 from workflow_decisions where step_id = $1 and user_id = $2', [stepId, user.id]);
      const why = refusal({ status: locked.status, approvers: ids(locked.approvers) }, inst, user.id, Boolean(mine));
      if (why) fail(inst.requested_by === user.id || !ids(locked.approvers).includes(user.id) ? 403 : 409, 'not_allowed', why);
      await tx.query(
        'insert into workflow_decisions (step_id, instance_id, user_id, decision, comment, via) values ($1,$2,$3,$4,$5,$6)',
        [stepId, locked.instance_id, user.id, decision, comment, req.apiToken ? 'api' : 'web']);
      const all = await tx.query<{ decision: string }>('select decision from workflow_decisions where step_id = $1', [stepId]);
      const result = tally(all, locked.required);
      if (result !== 'pending') await tx.query('update workflow_steps set status = $2, finished_at = now() where id = $1', [stepId, result]);
      return { result, approvals: all.filter((d) => d.decision === 'approved').length, required: locked.required as number, position: locked.position as number };
    });

    const name = await recordName(def!.type, instance!.record_id);
    await ctx.audit(req, {
      action: 'workflow.decide', recordType: def!.type, recordId: instance!.record_id,
      summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} step "${step!.name}" of approval workflow "${instance!.name}" on ${def!.label.toLowerCase()} ${name}`,
      after: { workflow: instance!.name, step: step!.name, decision, comment },
    });
    await webhook('workflow.decided', {
      workflow: instance!.name, step: step!.name, decision, approver: user.displayName, comment,
      approvalsReceived: outcome.approvals, approvalsRequired: outcome.required, stepOutcome: outcome.result,
    }, { type: def!.type, id: instance!.record_id }, req);

    if (outcome.result === 'rejected') await finish(instance!, 'rejected', user.id, req, comment);
    else if (outcome.result === 'approved') await advance(instance!, outcome.position + 1, user.id, req);
    return { stepOutcome: outcome.result, approvalsReceived: outcome.approvals, approvalsRequired: outcome.required, instance: await loadInstance(instance!.id) };
  }

  async function cancel(instanceId: string, req: FastifyRequest, reason: string | null): Promise<Row> {
    const instance = await loadInstance(instanceId);
    const def = instance ? typeDef(instance.record_type) : undefined;
    if (!instance || !def || !(await maySee(req.user!, def, instance.record_id))) fail(404, 'not_found', 'Workflow not found.');
    if (instance!.status !== 'running') fail(409, 'finished', 'This workflow has already finished.');
    if (instance!.requested_by !== req.user!.id && !ctx.can(req.user, 'admin.administer')) {
      fail(403, 'forbidden', 'Only the person who asked, or an administrator, can cancel this workflow.');
    }
    await finish(instance!, 'canceled', null, req, reason ?? 'Canceled.');
    return (await loadInstance(instanceId))!;
  }

  // ---------- escalation ----------

  /**
   * Overdue steps (past their due time, not yet escalated) go to the people they escalate to, who may
   * then decide too; the approvers still waiting are reminded. Runs from the job queue.
   */
  async function escalateDue(): Promise<{ escalated: number }> {
    const due = await db.query<Row>(
      `select s.*, i.definition, i.record_type, i.record_id, i.requested_by, i.name as workflow_name
       from workflow_steps s join workflow_instances i on i.id = s.instance_id and i.status = 'running'
       where s.status = 'pending' and s.escalated_at is null and s.due_at is not null and s.due_at <= now()
       order by s.due_at limit 200`);
    let escalated = 0;
    for (const s of due) {
      const def = typeDef(s.record_type);
      if (!def) continue; // its area is switched off: nothing happens until it is back on
      const step = asDef(s.definition).steps[s.position];
      const before = ids(s.approvers);
      const extra = step ? await approversFor(await escalationPeople(step), def, s.record_id, s.requested_by) : [];
      const approvers = [...new Set([...before, ...extra])];
      const changed = await db.one(
        `update workflow_steps set escalated_at = now(), approvers = $2::jsonb where id = $1 and escalated_at is null and status = 'pending' returning id`,
        [s.id, JSON.stringify(approvers)]);
      if (!changed) continue;
      escalated += 1;
      const decided = new Set((await db.query<{ user_id: string }>('select user_id from workflow_decisions where step_id = $1', [s.id])).map((d) => d.user_id));
      const name = await recordName(def.type, s.record_id);
      await tell({
        userIds: before.filter((u) => !decided.has(u)), recordType: def.type, recordId: s.record_id,
        title: `Overdue approval: ${def.label.toLowerCase()} ${name}`, body: `${s.workflow_name}: ${s.name}`,
      });
      await tell({
        userIds: extra.filter((u) => !before.includes(u)), recordType: def.type, recordId: s.record_id,
        title: `Approval escalated to you: ${def.label.toLowerCase()} ${name}`, body: `${s.workflow_name}: ${s.name} is overdue`,
      });
      await ctx.audit(null, {
        action: 'workflow.escalate', recordType: def.type, recordId: s.record_id,
        summary: `Step "${s.name}" of approval workflow "${s.workflow_name}" was overdue and escalated`,
        after: { step: s.name, added: extra.filter((u) => !before.includes(u)).length },
      });
    }
    return { escalated };
  }

  return {
    start, decide, cancel, escalateDue, recordCreated, recordUpdated, forget, maySee, people, roleMembers,
    typeDef, recordName, loadInstance,
  };
}
