// The approval workflow service (E14-06): starts workflows on records, routes each step to its
// approvers (and their stand-ins, E14-32), records decisions, escalates overdue steps and applies
// the outcome. Approval kinds (core/approval-kinds.ts) let a module hand its own approvals to it:
// the module starts the workflow and is called back on every decision and at the end. The rules
// themselves are in engine.ts; this file stores and tells people.
import type { FastifyRequest } from 'fastify';
import {
  approvalKind, approvalKinds, type ApprovalEngine, type ApprovalInstance, type ApprovalKind, type InstallHelpers,
} from '../../core/approval-kinds.ts';
import { loadUser } from '../../core/auth.ts';
import type { Queryable } from '../../core/db.ts';
import { fail, UUID_RE as UUID } from '../../core/errors.ts';
import type { MoveHolder } from '../../core/lifecycle.ts';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { emitWebhookEvent, WEBHOOK_EVENTS } from '../../core/webhooks.ts';
import {
  allHold, applicableBranches, eligible, isGroup, nextStep, outcomePatch, required, routeAfter, slotFor, tally, unitAt,
  type ApprovalUnit, type ApproverSpec, type Standins, type StepDef, type WorkflowDef,
} from './engine.ts';

const HOUR = 3_600_000;
/** How long the list of automatic workflows is kept before it is read again (other processes may change it). */
const TRIGGER_CACHE_MS = 5_000;

export type Service = ReturnType<typeof makeService>;

const asJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const asDef = (row: unknown): WorkflowDef => asJson<WorkflowDef>(row);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? JSON.parse(v) : []);
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

/** The columns of a definition copied into a running workflow (later edits do not change it). */
export function snapshotOf(w: Row): WorkflowDef {
  return {
    record_type: w.record_type, kind: w.kind ?? null, name: w.name, description: w.description, active: w.active, trigger: w.trigger,
    trigger_field: w.trigger_field, trigger_value: w.trigger_value, conditions: asJson(w.conditions), steps: asJson(w.steps),
    on_approve: asJson(w.on_approve), on_reject: asJson(w.on_reject),
  };
}

/** A running workflow as a module sees it. */
export function instanceView(r: Row): ApprovalInstance {
  return {
    id: r.id, kind: r.kind, definitionId: r.definition_id, name: r.name, recordType: r.record_type, recordId: r.record_id,
    status: r.status, requestedBy: r.requested_by ?? null, note: r.note ?? null, data: asJson<Row>(r.data ?? {}) ?? {},
    startedAt: iso(r.started_at)!, finishedAt: iso(r.finished_at),
  };
}

/** A step's people: the approvers it needs approvals from, and the stand-ins added beside them. */
export function stepPeople(s: Row): { approvers: string[]; principals: string[]; standins: Standins } {
  const approvers = ids(s.approvers);
  const standins = asJson<Standins>(s.standins ?? {}) ?? {};
  const principals = s.principals ? ids(s.principals) : approvers.filter((a) => !(a in standins));
  return { approvers, principals, standins };
}

export function makeService(ctx: ModuleContext) {
  const { db, app } = ctx;
  /** Records whose outcome the engine is writing right now: their changes start no workflow. */
  const applying = new Set<string>();
  let triggerCache: { at: number; rows: Row[] } | null = null;

  const typeDef = (type: string): ResourceDef | undefined => ctx.resources.get(type);
  const recordKey = (type: string, id: string) => `${type}:${id}`;
  const kindOf = (row: Row | null | undefined): ApprovalKind | undefined => approvalKind(app, row?.kind);

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

  async function nameOf(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    return (await db.one<{ display_name: string }>('select display_name from users where id = $1', [id]))?.display_name ?? null;
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

  /** Active people who hold a permission (switched-off areas applied), by name. */
  async function usersWith(permission: string): Promise<string[]> {
    const rows = await db.query<Row>(
      `select u.id, coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
          coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
       from users u left join user_roles ur on ur.user_id = u.id left join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
       where u.status = 'active' and u.deleted_at is null group by u.id, u.display_name order by u.display_name`);
    return rows.filter((r) => ctx.can({ id: r.id, roles: r.roles, permissions: r.permissions } as SessionUser, permission)).map((r) => r.id as string);
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
      case 'people': {
        const out = [...(spec.users ?? [])];
        for (const r of spec.roles ?? []) out.push(...(await roleMembers(r)));
        return out;
      }
      case 'permission': return usersWith(spec.permission);
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

  /**
   * The people who may decide: named, active, not the requester, able to see the record, and
   * holding the approval kind's permission when it names one.
   */
  async function approversFor(list: string[], def: ResourceDef, recordId: string, requester: string | null, kind?: ApprovalKind, exclude: string[] = []): Promise<string[]> {
    list = list.filter((id) => !exclude.includes(id));
    const loaded = await people(list.filter((id) => id !== requester));
    const ok = new Set<string>();
    for (const [id, u] of loaded) {
      if (kind?.approverPermission && !ctx.can(u, kind.approverPermission)) continue;
      if (await maySee(u, def, recordId)) ok.add(id);
    }
    return eligible(list, requester, (id) => ok.has(id));
  }

  // ---------- stand-ins (E14-32) ----------

  /** Stand-in periods running today for these approvers: [{ user_id, standin_id }]. */
  async function activeStandins(principals: string[]): Promise<{ user_id: string; standin_id: string }[]> {
    if (!principals.length) return [];
    return db.query<{ user_id: string; standin_id: string }>(
      `select user_id, standin_id from workflow_standins
       where deleted_at is null and user_id = any($1::uuid[]) and starts_on <= $2::date and ends_on >= $2::date
       order by created_at`, [principals, dayInZone(0)]);
  }

  /**
   * Adds the stand-ins of a step's approvers (also a stand-in may decide; no chains: a stand-in's
   * own stand-in is not added). A stand-in is left out when they asked for the approval, cannot
   * see the record or lack the kind's permission. Answers the new stand-ins only.
   */
  async function standinsFor(principals: string[], current: Standins, def: ResourceDef, recordId: string, requester: string | null, kind?: ApprovalKind, exclude: string[] = []): Promise<Standins> {
    const added: Standins = {};
    const rows = await activeStandins(principals);
    const fit = new Set(await approversFor([...new Set(rows.map((r) => r.standin_id))], def, recordId, requester, kind, exclude));
    for (const r of rows) {
      if (principals.includes(r.standin_id) || !fit.has(r.standin_id)) continue;
      if ((current[r.standin_id] ?? []).includes(r.user_id)) continue;
      (added[r.standin_id] ??= []).push(r.user_id);
    }
    return added;
  }

  const merge = (a: Standins, b: Standins): Standins => {
    const out: Standins = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = [...new Set([...(out[k] ?? []), ...v])];
    return out;
  };

  /** The approval unit (a step, or one branch) a stored step row stands for, from the workflow's snapshot. */
  const unitOf = (instance: Row, step: Row): ApprovalUnit | null =>
    unitAt(asDef(instance.definition).steps ?? [], Number(step.position), step.branch ?? null);

  /**
   * A different person per step (AZ-7): when the unit asks for it, the people who decided another
   * step (or branch) of the request, who may not decide this one. `stepId` is this step (null before
   * it is stored).
   */
  async function otherDeciders(instanceId: string, unit: ApprovalUnit | null, stepId: string | null, q: Queryable = db): Promise<string[]> {
    if (!unit?.distinct_approvers) return [];
    const rows = await q.query<{ user_id: string }>(
      'select distinct user_id from workflow_decisions where instance_id = $1 and ($2::uuid is null or step_id <> $2::uuid)', [instanceId, stepId]);
    return rows.map((r) => r.user_id);
  }

  /**
   * Why `user` may not decide this step besides the step's own list (null when they may): the
   * approval kind's permission, checked again at decision time because roles change while a step
   * waits (BS-2), and the "different person per step" rule (AZ-7).
   */
  async function extraRefusal(instance: Row, step: Row, user: SessionUser | null): Promise<string | null> {
    const kind = kindOf(instance);
    if (kind?.approverPermission && (!user || !ctx.can(user, kind.approverPermission))) {
      return 'You no longer hold the permission this approval needs, so you cannot decide it.';
    }
    if (user && (await otherDeciders(instance.id, unitOf(instance, step), step.id ?? null)).includes(user.id)) {
      return 'You decided another step of this request, so someone else must decide this one.';
    }
    return null;
  }

  /**
   * Writes a step's people only when nobody changed them since `seen` was read (BS-10): a sweep and
   * an administrator's reassignment at the same time cannot undo each other. Answers whether it wrote.
   */
  async function writePeople(seen: Row, next: { approvers: string[]; principals: string[]; standins: Standins }, also: { escalate?: boolean; clearNote?: boolean } = {}): Promise<boolean> {
    const raw = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v));
    const row = await db.one(
      `update workflow_steps set approvers = $2::jsonb, principals = $3::jsonb, standins = $4::jsonb
         ${also.escalate ? ', escalated_at = now()' : ''}${also.clearNote ? ', note = null' : ''}
       where id = $1 and status = 'pending' ${also.escalate ? 'and escalated_at is null' : ''}
         and approvers is not distinct from $5::jsonb and principals is not distinct from $6::jsonb and standins is not distinct from $7::jsonb
       returning id`,
      [seen.id, JSON.stringify(next.approvers), JSON.stringify(next.principals), JSON.stringify(next.standins), raw(seen.approvers), raw(seen.principals), raw(seen.standins)]);
    return Boolean(row);
  }

  /** Whether `standin` stands in for `principal` today. */
  async function standsInToday(standin: string, principal: string): Promise<boolean> {
    return Boolean(await db.one(
      `select 1 from workflow_standins where deleted_at is null and user_id = $1 and standin_id = $2 and starts_on <= $3::date and ends_on >= $3::date`,
      [principal, standin, dayInZone(0)]));
  }

  /**
   * Gives running steps the stand-ins whose period has started (a period saved after the step began,
   * or starting today). Runs from the sweep and when a stand-in is saved; tells each new stand-in.
   */
  async function applyStandins(onlyFor?: string): Promise<number> {
    const steps = await db.query<Row>(
      `select s.*, i.record_type, i.record_id, i.requested_by, i.kind, i.definition, i.name as workflow_name
       from workflow_steps s join workflow_instances i on i.id = s.instance_id and i.status = 'running'
       where s.status = 'pending' ${onlyFor ? 'and s.approvers @> $1::jsonb' : ''} limit 500`, onlyFor ? [JSON.stringify([onlyFor])] : []);
    let added = 0;
    for (const s of steps) {
      const def = typeDef(s.record_type);
      if (!def) continue;
      const { approvers, principals, standins } = stepPeople(s);
      const exclude = await otherDeciders(s.instance_id, unitOf(s, s), s.id);
      const extra = await standinsFor(principals, standins, def, s.record_id, s.requested_by, kindOf(s), exclude);
      if (!Object.keys(extra).length) continue;
      const all = merge(standins, extra);
      const newcomers = Object.keys(extra).filter((u) => !approvers.includes(u));
      // Written only if the step's people did not change meanwhile (a reassignment); the next sweep tries again.
      if (!(await writePeople(s, { approvers: [...new Set([...approvers, ...Object.keys(extra)])], principals, standins: all }))) continue;
      added += newcomers.length;
      await tellStandins(extra, def, s.record_id, `${s.workflow_name}: ${s.name}`);
    }
    return added;
  }

  async function tellStandins(added: Standins, def: ResourceDef, recordId: string, body: string) {
    const name = await recordName(def.type, recordId);
    for (const [standin, forWhom] of Object.entries(added)) {
      const whom = (await Promise.all(forWhom.map(nameOf))).filter(Boolean).join(', ');
      await tell({
        userIds: [standin], recordType: def.type, recordId,
        title: `Approval needed (standing in for ${whom || 'an approver'}): ${def.label.toLowerCase()} ${name}`, body,
      });
    }
  }

  // ---------- telling people ----------

  async function tell(input: { userIds: string[]; title: string; body?: string; recordType: string; recordId: string; route?: string }) {
    if (!input.userIds.length || !app.hasDecorator('notify')) return;
    // A kind may send people to its own screen (the change's approvals tab) instead of the record page.
    const route = input.route ?? approvalKinds(app).find((k) => k.recordType === input.recordType && k.route)?.route?.(input.recordId);
    await app.notify({ kind: 'approval', ...input, ...(route ? { route } : {}) });
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
        rows: await db.query<Row>(`select * from workflow_definitions where active and deleted_at is null and trigger in ('create', 'status') order by created_at`),
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
      // A held move this workflow just approved (E14-37) does not start it again.
      if (moving.get(recordKey(def.type, after.id)) === w.id) continue;
      const f = w.trigger_field as string;
      if (String(before[f] ?? '') === String(after[f] ?? '') || String(after[f] ?? '') !== w.trigger_value) continue;
      if (!allHold(w.conditions, after, def.fields)) continue;
      await start(w, def, after, req?.user?.id ?? null, req, null, true);
    }
  }

  // ---------- running a workflow ----------

  /**
   * Starts a definition on a record. `quiet` (automatic starts) skips a definition that is already
   * running on the record instead of refusing. `data` is what the module keeps with it.
   */
  async function start(w: Row, def: ResourceDef, record: Row, requester: string | null, req: FastifyRequest | null, note: string | null, quiet = false, data: Row = {}): Promise<Row | null> {
    const running = await db.one('select id from workflow_instances where definition_id = $1 and record_id = $2 and status = $3', [w.id, record.id, 'running']);
    if (running) {
      if (quiet) return null;
      fail(409, 'already_running', 'This workflow is already running on this record.');
    }
    let instance: Row | undefined;
    try {
      instance = await db.one<Row>(
        `insert into workflow_instances (definition_id, definition, name, record_type, record_id, requested_by, note, kind, data)
         values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb) returning *`,
        [w.id, JSON.stringify(snapshotOf(w)), w.name, def.type, record.id, requester, note, w.kind ?? null, JSON.stringify(data ?? {})]);
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
  async function advance(instance: Row, from: number, last: { id: string; onBehalfOf: string | null; comment: string | null } | null, req: FastifyRequest | null): Promise<void> {
    const wf = asDef(instance.definition);
    const def = typeDef(instance.record_type);
    const record = def ? await ctx.resources.find(def.type, instance.record_id) : undefined;
    if (!def || !record) {
      await finish(instance, 'canceled', null, req, 'The record is no longer available.');
      return;
    }
    const { next, skipped } = nextStep(wf.steps, from, record, def.fields);
    for (const i of skipped) await skip(instance, wf.steps[i], i, 'Its conditions did not hold for this record.');
    if (next === null) {
      await finish(instance, 'approved', last, req, null);
      return;
    }
    const step = wf.steps[next];
    if (isGroup(step)) {
      // Branches side by side (E14-32): each that applies starts now; with none, the step is skipped.
      const branches = applicableBranches(step, record, def.fields) as number[];
      if (!branches.length) {
        await skip(instance, step, next, 'None of its branches applied to this record.');
        await advance(instance, next + 1, last, req);
        return;
      }
      for (let b = 0; b < step.branches!.length; b += 1) {
        const branch = step.branches![b];
        if (branches.includes(b)) await activate(instance, branch, next, def, record, b, step.name);
        else {
          await db.query(
            `insert into workflow_steps (instance_id, position, branch, group_name, step_key, name, status, required, note, finished_at)
             values ($1, $2, $3, $4, $5, $6, 'skipped', 0, $7, now()) on conflict do nothing`,
            [instance.id, next, b, step.name, branch.key, branch.name, 'Its conditions did not hold for this record.']);
        }
      }
      return;
    }
    await activate(instance, step as ApprovalUnit, next, def, record);
  }

  /** Records a step as skipped (`note` says why). */
  async function skip(instance: Row, step: StepDef, position: number, note: string): Promise<void> {
    await db.query(
      `insert into workflow_steps (instance_id, position, step_key, name, status, required, note, finished_at)
       values ($1, $2, $3, $4, 'skipped', 0, $5, now()) on conflict do nothing`,
      [instance.id, position, step.key, step.name, note]);
  }

  /**
   * The step at `position` was approved (every branch, for a step that runs side by side): follows
   * the first of its routes that holds (E14-32), recording the steps it passes over, then moves on.
   */
  async function proceed(instance: Row, position: number, last: { id: string; onBehalfOf: string | null; comment: string | null } | null, req: FastifyRequest | null): Promise<void> {
    const wf = asDef(instance.definition);
    const def = typeDef(instance.record_type);
    const record = def ? await ctx.resources.find(def.type, instance.record_id) : undefined;
    const target = def && record ? routeAfter(wf.steps, position, record, def.fields) : position + 1;
    for (let i = position + 1; i < Math.min(target, wf.steps.length); i += 1) {
      await skip(instance, wf.steps[i], i, `Not on this record's route: after "${wf.steps[position].name}" it went ${target >= wf.steps.length ? 'to the end' : `to "${wf.steps[target].name}"`}.`);
    }
    await advance(instance, target, last, req);
  }

  async function activate(instance: Row, step: ApprovalUnit, position: number, def: ResourceDef, record: Row, branch: number | null = null, groupName: string | null = null): Promise<void> {
    const requester = instance.requested_by ?? null;
    const kind = kindOf(instance);
    // A different person per step (AZ-7): whoever decided another step of this request is left out.
    const exclude = await otherDeciders(instance.id, step, null);
    let principals = await approversFor(await candidates(step.approvers, record, def, requester), def, record.id, requester, kind, exclude);
    let note: string | null = null;
    let escalatedAt: Date | null = null;
    if (!principals.length && step.escalate_to) {
      // Nobody can approve the step itself: it goes straight to the people it escalates to.
      principals = await approversFor(await escalationPeople(step), def, record.id, requester, kind, exclude);
      if (principals.length) { escalatedAt = new Date(); note = 'Nobody named by the step could approve it, so it went to the people it escalates to.'; }
    }
    if (!principals.length) {
      note = `Nobody named by this step can approve it (they may be inactive, the requester, ${exclude.length ? 'someone who decided another step of this request, ' : ''}or unable to see the record). An administrator can reassign it or cancel the workflow.`;
    }
    const need = required(step.quorum, principals.length);
    const standins = await standinsFor(principals, {}, def, record.id, requester, kind, exclude);
    const approvers = [...new Set([...principals, ...Object.keys(standins)])];
    const due = step.due_hours ? new Date(Date.now() + step.due_hours * HOUR) : null;
    const row = (await db.one<Row>(
      `insert into workflow_steps (instance_id, position, branch, group_name, step_key, name, status, approvers, principals, standins, required, due_at, escalated_at, note)
       values ($1, $2, $3, $4, $5, $6, 'pending', $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13) returning *`,
      [instance.id, position, branch, groupName, step.key, step.name, JSON.stringify(approvers), JSON.stringify(principals), JSON.stringify(standins), need, due, escalatedAt, note]))!;
    await db.query('update workflow_instances set current_step = $2 where id = $1', [instance.id, position]);
    const name = await recordName(def.type, record.id);
    const body = `${instance.name}: ${groupName ? `${groupName}: ` : ''}${step.name}${need > 1 ? ` (${need} approvals needed)` : ''}`;
    await tell({ userIds: principals, recordType: def.type, recordId: record.id, title: `Approval needed: ${def.label.toLowerCase()} ${name}`, body });
    await tellStandins(standins, def, record.id, body);
    if (due && app.hasDecorator('jobs') && !escalatedAt) {
      await app.jobs.enqueue('workflows.escalate', { stepId: row.id }, { key: `workflows.escalate:${row.id}`, runAt: due });
    }
  }

  async function escalationPeople(step: Pick<StepDef, 'escalate_to'>): Promise<string[]> {
    const e = step.escalate_to;
    if (!e) return [];
    return [...e.users, ...(e.role ? await roleMembers(e.role) : [])];
  }

  /**
   * Ends a workflow: records the outcome, calls the module back (approval kinds) and sets the fields
   * the definition names. `last` is the decision that ended it.
   */
  async function finish(instance: Row, status: 'approved' | 'rejected' | 'canceled', last: { id: string; onBehalfOf: string | null; comment: string | null } | null, req: FastifyRequest | null, reason: string | null, byModule = false): Promise<void> {
    const done = await db.one<Row>(
      `update workflow_instances set status = $2, finished_at = now(), current_step = null, outcome_note = $3
       where id = $1 and status = 'running' returning *`, [instance.id, status, reason]);
    if (!done) return; // finished by someone else meanwhile
    await db.query(`update workflow_steps set status = 'canceled', finished_at = now() where instance_id = $1 and status = 'pending'`, [instance.id]);
    const wf = asDef(instance.definition);
    const def = typeDef(instance.record_type);
    const label = def ? def.label.toLowerCase() : 'record';
    const name = await recordName(instance.record_type, instance.record_id);
    const key = recordKey(instance.record_type, instance.record_id);
    const errors: string[] = [];
    const approver = last?.id ?? null;
    const kind = kindOf(done);
    applying.add(key);
    try {
      if (kind) {
        try {
          await kind.onFinish({
            instance: instanceView(done), outcome: status, approverId: approver, approverName: await nameOf(approver),
            onBehalfOf: last?.onBehalfOf ?? null, onBehalfOfName: await nameOf(last?.onBehalfOf), comment: status === 'approved' ? last?.comment ?? null : reason, byModule, req,
          });
        } catch (err) {
          errors.push((err as Error).message || `The ${kind.label.toLowerCase()} could not be recorded.`);
        }
      }
      const sets = status === 'approved' ? wf.on_approve : status === 'rejected' ? wf.on_reject : [];
      if (def && sets?.length) {
        const patch = outcomePatch(sets, def.fields, { today: dayInZone(0), approver, requester: instance.requested_by ?? null });
        try {
          await ctx.resources.update(def.type, instance.record_id, patch, null);
        } catch (err) {
          errors.push((err as Error).message || 'The record could not be changed.');
        }
      }
    } finally {
      applying.delete(key);
    }
    // A status move that waited for this workflow (E14-37): approval makes it, through the resource
    // engine (hooks, audit and webhooks run); rejection or cancel leaves the record as it was.
    const move = asJson<Row>(done.data ?? {})?.move as { field: string; from: string; to: string } | undefined;
    if (move && def) await settleMove(done, def, move, status, req, errors);
    const error = errors.length ? errors.join(' ').slice(0, 500) : null;
    if (error) await db.query('update workflow_instances set outcome_error = $2 where id = $1', [instance.id, error]);
    const word = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'canceled';
    await ctx.audit(req, {
      action: `workflow.${status === 'canceled' ? 'cancel' : 'finish'}`, recordType: instance.record_type, recordId: instance.record_id,
      summary: `Approval workflow "${instance.name}" ${word} on ${label} ${name}${error ? ` (the outcome could not be applied: ${error})` : ''}`,
      after: { workflow: instance.name, instance: instance.id, outcome: status, reason, error },
    });
    // A kind that tells the requester itself (with its own wording) is left to do so.
    if (instance.requested_by && status !== 'canceled' && kind?.tellsRequester !== false) {
      await tell({
        userIds: [instance.requested_by], recordType: instance.record_type, recordId: instance.record_id,
        title: `${status === 'approved' ? 'Approved' : 'Rejected'}: ${label} ${name}`,
        body: `${instance.name}${error ? '. The record could not be updated; an administrator should check it.' : ''}`,
      });
    }
    await webhook('workflow.finished', { workflow: instance.name, kind: instance.kind ?? null, outcome: status, reason, outcomeError: error }, { type: instance.record_type, id: instance.record_id }, req);
  }

  // ---------- status moves waiting for approval (E14-37) ----------

  /** Records whose held move is being made now, and the workflow that approved it (it does not start again). */
  const moving = new Map<string, string>();

  async function statusLabel(def: ResourceDef, field: string, value: string): Promise<string> {
    const list = def.fields[field]?.list;
    return (list ? (await ctx.lookups.values(list)).find((v) => v.value === value)?.label : null) ?? value;
  }

  async function settleMove(instance: Row, def: ResourceDef, move: { field: string; from: string; to: string }, outcome: 'approved' | 'rejected' | 'canceled', req: FastifyRequest | null, errors: string[]): Promise<void> {
    const key = recordKey(def.type, instance.record_id);
    const fieldLabel = (def.fields[move.field]?.label ?? move.field).toLowerCase();
    const [fromLabel, toLabel] = [await statusLabel(def, move.field, move.from), await statusLabel(def, move.field, move.to)];
    const name = await recordName(def.type, instance.record_id);
    let made = false;
    if (outcome === 'approved') {
      const now = await ctx.resources.find(def.type, instance.record_id);
      if (!now) errors.push('The record is no longer available, so the status move was not made.');
      else if ((now[move.field] ?? null) !== move.from) {
        errors.push(`The ${fieldLabel} changed meanwhile (it is no longer "${fromLabel}"), so the move to "${toLabel}" was not made.`);
      } else {
        moving.set(key, instance.definition_id);
        try {
          // System work: the person's rules were checked when they asked; the module's own rules apply now.
          await ctx.resources.update(def.type, instance.record_id, { [move.field]: move.to }, null);
          made = true;
        } catch (err) {
          errors.push(`The move to "${toLabel}" could not be made: ${(err as Error).message || 'the record refused it.'}`);
        } finally {
          moving.delete(key);
        }
      }
    }
    const word = made ? `moved from "${fromLabel}" to "${toLabel}" after approval` : outcome === 'approved' ? `stays "${fromLabel}": the approved move to "${toLabel}" could not be made`
      : `stays "${fromLabel}": the move to "${toLabel}" was ${outcome === 'rejected' ? 'rejected' : 'canceled'}`;
    await ctx.audit(req, {
      action: made ? 'lifecycle.move_approved' : outcome === 'approved' ? 'lifecycle.move_failed' : `lifecycle.move_${outcome}`,
      recordType: def.type, recordId: instance.record_id,
      summary: `${def.label} ${name}: ${fieldLabel} ${word} ("${instance.name}")`,
      after: { field: move.field, from: move.from, to: move.to, workflow: instance.name, instance: instance.id, outcome, made },
    });
  }

  /** What the resource engine uses to hold a move until a workflow approves it (core/lifecycle.ts). */
  const holder: MoveHolder = {
    async choices(type) {
      if (!typeDef(type)) return [];
      return db.query<{ id: string; name: string; active: boolean }>(
        'select id, name, active from workflow_definitions where record_type = $1 and kind is null and deleted_at is null order by name', [type]);
    },
    async pending(type, id) {
      if (!UUID.test(String(id))) return null;
      const r = await db.one<Row>(
        `select id, name, data from workflow_instances where record_type = $1 and record_id = $2 and status = 'running' and (data -> 'move') is not null
         order by started_at desc limit 1`, [type, id]);
      const m = r ? asJson<Row>(r.data)?.move : null;
      return m ? { field: String(m.field), from: String(m.from), to: String(m.to), workflow: r!.name, instanceId: r!.id } : null;
    },
    async usable(type, workflowId, row) {
      const def = typeDef(type);
      if (!def || !UUID.test(workflowId)) return null;
      const w = await db.one<Row>(
        'select id, name, conditions from workflow_definitions where id = $1 and record_type = $2 and kind is null and active and deleted_at is null', [workflowId, type]);
      if (!w) return null;
      // The workflow's own "which records" conditions: a record they do not hold for needs no approval.
      if (row && !allHold(asJson(w.conditions), row, def.fields)) return null;
      return { id: w.id, name: w.name };
    },
    async hold(def, record, move, req) {
      const w = await db.one<Row>('select * from workflow_definitions where id = $1', [move.workflowId]);
      if (!w) return;
      const [fromLabel, toLabel] = [await statusLabel(def, move.field, move.from), await statusLabel(def, move.field, move.to)];
      const fieldLabel = (def.fields[move.field]?.label ?? move.field).toLowerCase();
      await ctx.audit(req, {
        action: 'lifecycle.move_held', recordType: def.type, recordId: record.id,
        summary: `${def.label} ${await recordName(def.type, record.id)}: the move of its ${fieldLabel} from "${fromLabel}" to "${toLabel}" waits for approval ("${w.name}")`,
        after: { field: move.field, from: move.from, to: move.to, workflow: w.name },
      });
      try {
        await start(w, def, record, req.user?.id ?? null, req, `Move ${fieldLabel} from ${fromLabel} to ${toLabel}`, false, { move: { field: move.field, from: move.from, to: move.to } });
      } catch (err) {
        if ((err as { code?: string }).code === 'already_running') {
          fail(409, 'already_running', `"${w.name}" is already running on this ${def.label.toLowerCase()}, so the move to "${toLabel}" cannot wait for it now. The other changes were saved; try the move again once that approval ends.`);
        }
        throw err;
      }
    },
  };

  // ---------- decisions ----------

  /**
   * One person's decision on a step. Refuses the requester, anyone not named, and second decisions.
   * A stand-in decides on behalf of the first approver they stand in for who has not decided.
   */
  async function decide(stepId: string, req: FastifyRequest | null, decision: string, comment: string | null, via?: string, actor?: SessionUser): Promise<Row> {
    const user = actor ?? req?.user;
    if (!user) fail(401, 'unauthorized', 'Sign in to decide.');
    if (decision !== 'approved' && decision !== 'rejected') fail(400, 'validation', 'Choose approve or reject.', { decision: 'Choose approve or reject.' });
    if (decision === 'rejected' && !comment) fail(400, 'validation', 'Say why you reject it.', { comment: 'Say why you reject it.' });
    const step = await db.one<Row>('select * from workflow_steps where id = $1', [stepId]);
    const instance = step ? await loadInstance(step.instance_id) : undefined;
    const def = instance ? typeDef(instance.record_type) : undefined;
    if (!step || !instance || !def || !(await maySee(user, def, instance.record_id))) fail(404, 'not_found', 'Approval not found.');
    // The kind's permission is checked again now (BS-2): it may have been taken away while the step waited.
    const kind0 = kindOf(instance);
    if (kind0?.approverPermission && !ctx.can(user, kind0.approverPermission)) {
      fail(403, 'not_allowed', 'You no longer hold the permission this approval needs, so you cannot decide it.');
    }
    const unit = unitOf(instance!, step!);

    // Stand-in periods running today, checked before the transaction (only the database is used inside it).
    const { standins } = stepPeople(step!);
    const covering = new Set<string>();
    for (const p of standins[user.id] ?? []) if (await standsInToday(user.id, p)) covering.add(p);

    const outcome = await db.tx(async (tx) => {
      // The step row is locked so two last approvals at once cannot both move the workflow on.
      const locked = (await tx.one<Row>('select * from workflow_steps where id = $1 for update', [stepId]))!;
      // The workflow is locked too, so the last branches of a step side by side, approved at once, move it on exactly once.
      const inst = (await tx.one<{ status: string; requested_by: string | null }>('select status, requested_by from workflow_instances where id = $1 for update', [locked.instance_id]))!;
      if (inst.status !== 'running') fail(409, 'not_allowed', 'This workflow has already finished.');
      if (locked.status !== 'pending') fail(409, 'not_allowed', 'This step is not waiting for decisions.');
      if (inst.requested_by === user.id) fail(403, 'not_allowed', 'You asked for this approval, so someone else must decide it.');
      const sp = stepPeople(locked);
      if (!sp.approvers.includes(user.id)) fail(403, 'not_allowed', 'You are not one of the approvers of this step.');
      // A different person per step (AZ-7), checked under the workflow's lock.
      if ((await otherDeciders(locked.instance_id, unit, stepId, tx)).includes(user.id)) {
        fail(403, 'not_allowed', 'You decided another step of this request, so someone else must decide this one.');
      }
      const before = await tx.query<{ user_id: string; on_behalf_of: string | null }>('select user_id, on_behalf_of from workflow_decisions where step_id = $1', [stepId]);
      const slot = slotFor(sp, user.id, before, (p) => covering.has(p));
      if ('error' in slot) fail(409, 'not_allowed', slot.error);
      const onBehalfOf = (slot as { onBehalfOf: string | null }).onBehalfOf;
      await tx.query(
        'insert into workflow_decisions (step_id, instance_id, user_id, decision, comment, via, on_behalf_of) values ($1,$2,$3,$4,$5,$6,$7)',
        [stepId, locked.instance_id, user.id, decision, comment, via ?? (req?.apiToken ? 'api' : req ? 'web' : 'system'), onBehalfOf]);
      const all = await tx.query<{ decision: string }>('select decision from workflow_decisions where step_id = $1', [stepId]);
      const result = tally(all, locked.required);
      if (result !== 'pending') await tx.query('update workflow_steps set status = $2, finished_at = now() where id = $1', [stepId, result]);
      // A branch of a step side by side: the step is done once no other branch is still waiting.
      const othersWaiting = result === 'approved' && locked.branch !== null && locked.branch !== undefined
        ? (await tx.one<{ n: number }>(`select count(*)::int as n from workflow_steps where instance_id = $1 and position = $2 and status = 'pending' and id <> $3`,
          [locked.instance_id, locked.position, stepId]))!.n
        : 0;
      const total = (await tx.one<{ n: number }>(`select count(*)::int as n from workflow_decisions where instance_id = $1 and decision = 'approved'`, [locked.instance_id]))!.n;
      return { result, stepDone: othersWaiting === 0, approvals: all.filter((d) => d.decision === 'approved').length, total, required: locked.required as number, position: locked.position as number, onBehalfOf };
    });

    const name = await recordName(def!.type, instance!.record_id);
    const behalfName = await nameOf(outcome.onBehalfOf);
    const behalf = behalfName ? ` on behalf of ${behalfName}` : '';
    await ctx.audit(req, {
      action: 'workflow.decide', recordType: def!.type, recordId: instance!.record_id,
      summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} step "${step!.name}" of approval workflow "${instance!.name}" on ${def!.label.toLowerCase()} ${name}${behalf}`,
      after: { workflow: instance!.name, step: step!.name, decision, comment, on_behalf_of: outcome.onBehalfOf, on_behalf_of_name: behalfName },
    });
    await webhook('workflow.decided', {
      workflow: instance!.name, kind: instance!.kind ?? null, step: step!.name, decision, approver: user.displayName, onBehalfOf: behalfName, comment,
      approvalsReceived: outcome.approvals, approvalsRequired: outcome.required, stepOutcome: outcome.result,
    }, { type: def!.type, id: instance!.record_id }, req);

    const kind = kindOf(instance);
    if (kind?.onDecision) {
      try {
        await kind.onDecision({
          instance: instanceView(instance!), decision: decision as 'approved' | 'rejected', userId: user.id, userName: user.displayName,
          onBehalfOf: outcome.onBehalfOf, onBehalfOfName: behalfName, comment, approvals: outcome.total, stepOutcome: outcome.result, req,
        });
      } catch (err) {
        console.error(`[workflows] ${kind.key} decision:`, err);
      }
    }

    const last = { id: user.id, onBehalfOf: outcome.onBehalfOf, comment };
    if (outcome.result === 'rejected') await finish(instance!, 'rejected', last, req, comment);
    else if (outcome.result === 'approved' && outcome.stepDone) await proceed(instance!, outcome.position, last, req);
    return {
      stepOutcome: outcome.result, approvalsReceived: outcome.approvals, approvalsRequired: outcome.required,
      onBehalfOf: outcome.onBehalfOf, onBehalfOfName: behalfName, instance: await loadInstance(instance!.id),
    };
  }

  async function cancel(instanceId: string, req: FastifyRequest, reason: string | null): Promise<Row> {
    const instance = await loadInstance(instanceId);
    const def = instance ? typeDef(instance.record_type) : undefined;
    if (!instance || !def) fail(404, 'not_found', 'Workflow not found.');
    // A workflow whose record was deleted (BS-1) can still be ended, by an administrator.
    const gone = !(await ctx.resources.find(def!.type, instance!.record_id));
    if (gone ? !ctx.can(req.user, 'admin.administer') : !(await maySee(req.user!, def!, instance!.record_id))) fail(404, 'not_found', 'Workflow not found.');
    if (instance!.status !== 'running') fail(409, 'finished', 'This workflow has already finished.');
    if (instance!.requested_by !== req.user!.id && !ctx.can(req.user, 'admin.administer')) {
      fail(403, 'forbidden', 'Only the person who asked, or an administrator, can cancel this workflow.');
    }
    await finish(instance!, 'canceled', null, req, reason ?? 'Canceled.');
    return (await loadInstance(instanceId))!;
  }

  /**
   * A record was deleted (soft or for good) through the resource engine (BS-1): its running
   * workflows end as canceled, so none waits forever on a record nobody can open.
   */
  async function recordDeleted(type: string, recordId: string, req: FastifyRequest | null): Promise<number> {
    const rows = await db.query<Row>(`select * from workflow_instances where record_type = $1 and record_id = $2 and status = 'running'`, [type, recordId]);
    for (const r of rows) await finish(r, 'canceled', null, req, 'The record was deleted.');
    return rows.length;
  }

  /**
   * An administrator hands a waiting step from one approver to another (E14-32): the new person
   * must be able to decide (active, not the requester, able to see the record). Audited and told.
   */
  async function reassign(stepId: string, req: FastifyRequest, from: string, to: string): Promise<Row> {
    const step = await db.one<Row>('select * from workflow_steps where id = $1', [stepId]);
    const instance = step ? await loadInstance(step.instance_id) : undefined;
    const def = instance ? typeDef(instance.record_type) : undefined;
    if (!step || !instance || !def) fail(404, 'not_found', 'Approval not found.');
    if (instance!.status !== 'running' || step!.status !== 'pending') fail(409, 'finished', 'This step is not waiting for decisions.');
    const sp = stepPeople(step!);
    if (!sp.principals.includes(from)) fail(400, 'validation', 'Choose one of the approvers of this step.', { from: 'Choose one of the approvers of this step.' });
    if (await db.one('select 1 from workflow_decisions where step_id = $1 and (user_id = $2 or on_behalf_of = $2)', [stepId, from])) {
      fail(409, 'decided', 'That approver has already decided this step.');
    }
    if (sp.principals.includes(to)) fail(400, 'validation', 'That person is already an approver of this step.', { to: 'That person is already an approver of this step.' });
    const exclude = await otherDeciders(instance!.id, unitOf(instance!, step!), step!.id);
    const fit = await approversFor([to], def!, instance!.record_id, instance!.requested_by ?? null, kindOf(instance), exclude);
    if (!fit.length) {
      fail(400, 'validation', `That person cannot decide this step (inactive, the requester, ${exclude.includes(to) ? 'someone who decided another step of this request, ' : ''}or unable to see the record).`, { to: 'That person cannot decide this step.' });
    }
    const principals = sp.principals.map((p) => (p === from ? to : p));
    const standins: Standins = {};
    for (const [k, v] of Object.entries(sp.standins)) { const rest = v.filter((p) => p !== from); if (rest.length) standins[k] = rest; }
    const approvers = [...new Set([...principals, ...Object.keys(standins)])];
    // Only if the step's people did not change since they were read (BS-10: a sweep adding stand-ins or escalating).
    if (!(await writePeople(step!, { approvers, principals, standins }, { clearNote: true }))) {
      fail(409, 'changed', 'The approvers of this step changed meanwhile. Reload and try again.');
    }
    const name = await recordName(def!.type, instance!.record_id);
    const [fromName, toName] = [await nameOf(from), await nameOf(to)];
    await ctx.audit(req, {
      action: 'workflow.reassign', recordType: def!.type, recordId: instance!.record_id,
      summary: `Step "${step!.name}" of approval workflow "${instance!.name}" on ${def!.label.toLowerCase()} ${name} reassigned from ${fromName ?? 'someone'} to ${toName ?? 'someone'}`,
      before: { approver: from }, after: { approver: to },
    });
    await tell({ userIds: [to], recordType: def!.type, recordId: instance!.record_id, title: `Approval needed: ${def!.label.toLowerCase()} ${name}`, body: `${instance!.name}: ${step!.name} (reassigned to you)` });
    await applyStandins(to);
    return (await db.one<Row>('select * from workflow_steps where id = $1', [stepId]))!;
  }

  // ---------- escalation ----------

  /**
   * Overdue steps (past their due time, not yet escalated) go to the people they escalate to, who may
   * then decide too; the approvers still waiting are reminded. Runs from the job queue, which also
   * gives running steps the stand-ins whose period has started.
   */
  async function escalateDue(): Promise<{ escalated: number; standins: number; canceled: number; stuck: number }> {
    const due = await db.query<Row>(
      `select s.*, i.definition, i.record_type, i.record_id, i.requested_by, i.kind, i.name as workflow_name
       from workflow_steps s join workflow_instances i on i.id = s.instance_id and i.status = 'running'
       where s.status = 'pending' and s.escalated_at is null and s.due_at is not null and s.due_at <= now()
       order by s.due_at limit 200`);
    let escalated = 0;
    let canceled = 0;
    for (const first of due) {
      const def = typeDef(first.record_type);
      if (!def) continue; // its area is switched off: nothing happens until it is back on
      // The record was deleted some other way (BS-1): the workflow ends instead of escalating.
      if (!(await ctx.resources.find(def.type, first.record_id))) {
        const inst = await loadInstance(first.instance_id);
        if (inst?.status === 'running') { await finish(inst, 'canceled', null, null, 'The record was deleted.'); canceled += 1; }
        continue;
      }
      const step = unitAt(asDef(first.definition).steps, first.position, first.branch);
      const exclude = await otherDeciders(first.instance_id, step, first.id);
      const extra = step ? await approversFor(await escalationPeople(step), def, first.record_id, first.requested_by, kindOf(first), exclude) : [];
      // The step's people are written only if nobody changed them since they were read (BS-10): on a
      // clash (a reassignment meanwhile) the step is read again and the escalation added to it.
      let s = first;
      let changed = false;
      for (let attempt = 0; attempt < 3 && !changed; attempt += 1) {
        if (attempt > 0) {
          const again = await db.one<Row>(`select * from workflow_steps where id = $1 and status = 'pending' and escalated_at is null`, [first.id]);
          if (!again) break;
          s = { ...first, ...again };
        }
        const { approvers: was, principals, standins } = stepPeople(s);
        changed = await writePeople(s, { approvers: [...new Set([...was, ...extra])], principals: [...new Set([...principals, ...extra])], standins }, { escalate: true });
      }
      if (!changed) continue;
      const before = stepPeople(s).approvers;
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
    // The people it escalated to may have stand-ins too, and periods may have started since.
    const standins = await applyStandins();
    const stuck = await flagStuck();
    return { escalated, standins, canceled, stuck };
  }

  /** The note a step gets when the people left cannot give the approvals it needs (BS-5). */
  const STUCK_NOTE = 'Approvers this step still needs can no longer decide (they were deactivated or removed), so it cannot get the approvals it needs. An administrator can reassign it or cancel the workflow.';

  /**
   * Steps that can no longer be approved because approvers they still need were deactivated or
   * removed (BS-5): the step gets a note (shown as a problem on Administration > Running workflows)
   * and administrators are told, once. Runs from the sweep.
   */
  async function flagStuck(): Promise<number> {
    const steps = await db.query<Row>(
      `select s.*, i.record_type, i.record_id, i.name as workflow_name
       from workflow_steps s join workflow_instances i on i.id = s.instance_id and i.status = 'running'
       where s.status = 'pending' and s.note is distinct from $1 limit 500`, [STUCK_NOTE]);
    let flagged = 0;
    for (const s of steps) {
      const def = typeDef(s.record_type);
      if (!def) continue;
      const { principals, standins } = stepPeople(s);
      if (!principals.length) continue; // already noted when it started ("Nobody named by this step can approve it")
      const ds = await db.query<{ user_id: string; on_behalf_of: string | null; decision: string }>('select user_id, on_behalf_of, decision from workflow_decisions where step_id = $1', [s.id]);
      const taken = new Set(ds.map((d) => d.on_behalf_of ?? d.user_id));
      const approvals = ds.filter((d) => d.decision === 'approved').length;
      const people = [...new Set([...principals, ...Object.keys(standins)])];
      const active = new Set((await db.query<{ id: string }>(
        `select id from users where id = any($1::uuid[]) and status = 'active' and deleted_at is null`, [people])).map((r) => r.id));
      // A principal who has not decided can still count when they, or one of their stand-ins, is active.
      const reachable = principals.filter((p) => !taken.has(p)
        && (active.has(p) || Object.entries(standins).some(([sid, forWhom]) => forWhom.includes(p) && active.has(sid)))).length;
      if (approvals + reachable >= Number(s.required ?? 1)) continue;
      const noted = await db.one(`update workflow_steps set note = $2 where id = $1 and status = 'pending' and note is distinct from $2 returning id`, [s.id, STUCK_NOTE]);
      if (!noted) continue;
      flagged += 1;
      // Not named: an administrator may not be allowed to see a restricted record (Running workflows names it for those who may).
      await tell({
        userIds: await usersWith('admin.administer'), recordType: def.type, recordId: s.record_id,
        title: `Approval stuck: "${s.workflow_name}" on a ${def.label.toLowerCase()}`, route: '/admin/workflows?tab=running',
        body: `${s.workflow_name}: ${s.group_name ? `${s.group_name}: ` : ''}${s.name}. ${STUCK_NOTE}`,
      });
      await ctx.audit(null, {
        action: 'workflow.stuck', recordType: def.type, recordId: s.record_id,
        summary: `Step "${s.name}" of approval workflow "${s.workflow_name}" can no longer get the approvals it needs`,
        after: { step: s.name, required: s.required, approvals, reachable },
      });
    }
    return flagged;
  }

  // ---------- approval kinds (modules' own approvals) ----------

  async function kindDefinitions(kind: string): Promise<Row[]> {
    return db.query<Row>('select * from workflow_definitions where kind = $1 and active and deleted_at is null order by created_at', [kind]);
  }

  /** The kinds install once per process, before the first start (normally at onReady). */
  let installing: Promise<string[]> | null = null;
  const installed = () => (installing ??= installKinds());

  const engine: ApprovalEngine = {
    async start(key, record, opts) {
      await installed(); // a command (seeding) may start one before the server is ready
      const kind = approvalKind(app, key);
      const def = kind ? typeDef(kind.recordType) : undefined;
      if (!kind || !def) fail(409, 'approvals_unavailable', 'Approvals of this kind are not available.');
      let chosen: Row | undefined;
      if (opts.definitionId) {
        chosen = (await kindDefinitions(key)).find((w) => w.id === opts.definitionId);
        if (!chosen) fail(409, 'workflow_unavailable', 'The approval workflow named for this record is no longer active. An administrator should choose another one.');
        if (!allHold(asJson(chosen!.conditions), record, def!.fields)) return null;
      } else {
        // The workflow with the most conditions that all hold; ties go to the oldest.
        const fitting = (await kindDefinitions(key)).filter((w) => allHold(asJson(w.conditions), record, def!.fields));
        chosen = fitting.sort((a, b) => asJson<unknown[]>(b.conditions).length - asJson<unknown[]>(a.conditions).length)[0];
      }
      if (!chosen) return null;
      const row = await start(chosen, def!, record, opts.requester, opts.req, opts.note ?? null, false, opts.data ?? {});
      return row ? instanceView((await loadInstance(row.id))!) : null;
    },
    async latest(key, recordId) {
      const row = await db.one<Row>('select * from workflow_instances where kind = $1 and record_id = $2 order by started_at desc, id desc limit 1', [key, recordId]);
      return row ? instanceView(row) : null;
    },
    async running(key, recordId) {
      const row = await db.one<Row>(`select * from workflow_instances where kind = $1 and record_id = $2 and status = 'running' order by started_at desc limit 1`, [key, recordId]);
      return row ? instanceView(row) : null;
    },
    async cancel(key, recordId, reason, req) {
      const rows = await db.query<Row>(`select * from workflow_instances where kind = $1 and record_id = $2 and status = 'running'`, [key, recordId]);
      for (const r of rows) await finish(r, 'canceled', null, req, reason, true);
      return rows.length > 0;
    },
    async decide(key, recordId, req, decision, comment, opts) {
      // Several branches may wait side by side (E14-32): the one this person may decide, else the first.
      const pending = await db.query<Row>(
        `select s.*, i.requested_by as instance_requester, i.kind, i.definition from workflow_steps s join workflow_instances i on i.id = s.instance_id
         where i.kind = $1 and i.record_id = $2 and i.status = 'running' and s.status = 'pending' order by s.position, s.branch nulls first`, [key, recordId]);
      if (!pending.length) fail(409, 'not_awaiting_approval', 'Nothing on this record is waiting for approval.');
      let actor: SessionUser | undefined;
      if (!req && opts?.userId) actor = (await loadUser(db, opts.userId)) ?? undefined;
      const who = actor?.id ?? req?.user?.id ?? '';
      let step = pending[0];
      for (const s of pending) {
        const ds = await db.query<{ user_id: string; on_behalf_of: string | null }>('select user_id, on_behalf_of from workflow_decisions where step_id = $1', [s.id]);
        const inst = { id: s.instance_id, kind: s.kind, definition: s.definition };
        if ((await mayDecide(s, s.instance_requester ?? null, who, ds, inst, actor ?? req?.user ?? null)).ok) { step = s; break; }
      }
      return decide(step.id, req, decision, comment, opts?.via, actor);
    },
    async waiting(key, userId) {
      const rows = await db.query<Row>(
        `select s.*, i.record_id, i.requested_by, i.kind, i.definition from workflow_steps s join workflow_instances i on i.id = s.instance_id
         where i.kind = $1 and i.status = 'running' and s.status = 'pending' and s.approvers @> $2::jsonb and i.requested_by is distinct from $3`,
        [key, JSON.stringify([userId]), userId]);
      const out: string[] = [];
      const user = rows.length ? await loadUser(db, userId) : null;
      for (const s of rows) {
        const ds = await db.query<{ user_id: string; on_behalf_of: string | null }>('select user_id, on_behalf_of from workflow_decisions where step_id = $1', [s.id]);
        if ((await mayDecide(s, s.requested_by ?? null, userId, ds, { id: s.instance_id, kind: s.kind, definition: s.definition }, user)).ok) out.push(s.record_id);
      }
      return out;
    },
    async definitions(key) {
      await installed();
      return (await kindDefinitions(key)).map((w) => ({ id: w.id, name: w.name, description: w.description ?? null }));
    },
    async progress(key, recordId, userId) {
      const inst = await db.one<Row>('select * from workflow_instances where kind = $1 and record_id = $2 order by started_at desc, id desc limit 1', [key, recordId]);
      if (!inst) return { instance: null, approvals: 0, required: 0, waitingFor: [], canDecide: false, stepId: null };
      const approvals = (await db.one<{ n: number }>(`select count(*)::int as n from workflow_decisions where instance_id = $1 and decision = 'approved'`, [inst.id]))!.n;
      const steps = await db.query<Row>('select * from workflow_steps where instance_id = $1 order by position', [inst.id]);
      const required = steps.reduce((n, s) => n + Number(s.required ?? 0), 0);
      // Every branch waiting side by side counts (E14-32); a plain step is one of them.
      const current = inst.status === 'running' ? steps.filter((s) => s.status === 'pending') : [];
      const waitingFor: string[] = [];
      let canDecide = false;
      let stepId: string | null = current[0]?.id ?? null;
      for (const s of current) {
        const sp = stepPeople(s);
        const ds = await db.query<{ user_id: string; on_behalf_of: string | null }>('select user_id, on_behalf_of from workflow_decisions where step_id = $1', [s.id]);
        const taken = new Set(ds.map((d) => d.on_behalf_of ?? d.user_id));
        for (const n of (await Promise.all(sp.principals.filter((p) => !taken.has(p)).map(nameOf))).filter(Boolean) as string[]) if (!waitingFor.includes(n)) waitingFor.push(n);
        if (!canDecide && userId && userId !== inst.requested_by && sp.approvers.includes(userId)) {
          const covering = new Set<string>();
          for (const p of sp.standins[userId] ?? []) if (await standsInToday(userId, p)) covering.add(p);
          if (!('error' in slotFor(sp, userId, ds, (p) => covering.has(p)))
            && !(await extraRefusal(inst, s, kindOf(inst)?.approverPermission ? await loadUser(db, userId) : ({ id: userId } as SessionUser)))) { canDecide = true; stepId = s.id; }
        }
      }
      return { instance: instanceView(inst), approvals, required, waitingFor, canDecide, stepId };
    },
  };

  /** Whether `userId` may decide the step now (for lists and the record panel). */
  // `instance` (its id, kind and definition) adds the checks made at decision time: the kind's
  // permission (BS-2) and a different person per step (AZ-7); `user` saves loading the person again.
  async function mayDecide(step: Row, instanceRequester: string | null, userId: string, decisions: { user_id: string; on_behalf_of: string | null }[], instance?: Row, user?: SessionUser | null): Promise<{ ok: boolean; onBehalfOf: string | null }> {
    if (step.status !== 'pending' || instanceRequester === userId) return { ok: false, onBehalfOf: null };
    const sp = stepPeople(step);
    if (!sp.approvers.includes(userId)) return { ok: false, onBehalfOf: null };
    if (instance) {
      const who = user && user.id === userId ? user : kindOf(instance)?.approverPermission ? await loadUser(db, userId) : ({ id: userId } as SessionUser);
      if (await extraRefusal(instance, step, who ?? null)) return { ok: false, onBehalfOf: null };
    }
    const covering = new Set<string>();
    for (const p of sp.standins[userId] ?? []) if (await standsInToday(userId, p)) covering.add(p);
    const slot = slotFor(sp, userId, decisions, (p) => covering.has(p));
    return 'error' in slot ? { ok: false, onBehalfOf: null } : { ok: true, onBehalfOf: slot.onBehalfOf };
  }

  /**
   * Runs each approval kind's one-time install (its workflows, and the approvals that were waiting
   * when its module moved to workflows). Called once every module is registered; `force` reruns one
   * (tests of the upgrade).
   */
  async function installKinds(force?: string): Promise<string[]> {
    const done: string[] = [];
    for (const kind of approvalKinds(app)) {
      if (!kind.install) continue;
      if (force !== kind.key && await db.one('select 1 from workflow_kind_installs where kind = $1', [kind.key])) continue;
      const def = ctx.resources.all().find((d) => d.type === kind.recordType) ?? null;
      const helpers: InstallHelpers = {
        db,
        async hasDefinitions() {
          return Boolean(await db.one('select 1 from workflow_definitions where kind = $1 limit 1', [kind.key]));
        },
        async define(input) {
          const steps = (input.steps as Row[] ?? []).map((s, i) => ({
            key: s.key ?? `step-${i + 1}`, name: s.name, approvers: s.approvers, quorum: s.quorum ?? 'any',
            conditions: s.conditions ?? [], due_hours: s.due_hours ?? null, escalate_to: s.escalate_to ?? null,
            ...(s.distinct_approvers ? { distinct_approvers: true } : {}),
            ...(s.branches ? { branches: s.branches } : {}), ...(s.routes ? { routes: s.routes } : {}),
          }));
          const row = (await db.one<{ id: string }>(
            `insert into workflow_definitions (record_type, kind, name, description, active, trigger, conditions, steps, on_approve, on_reject)
             values ($1, $2, $3, $4, $5, 'module', $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb) returning id`,
            [kind.recordType, kind.key, String(input.name).slice(0, 120), input.description ?? null, input.active !== false,
              JSON.stringify(input.conditions ?? []), JSON.stringify(steps), JSON.stringify(input.on_approve ?? []), JSON.stringify(input.on_reject ?? [])]))!;
          forget();
          return row.id;
        },
        async adopt(input) {
          if (await db.one(`select 1 from workflow_instances where kind = $1 and record_id = $2 and status = 'running'`, [kind.key, input.recordId])) return null;
          const w = await db.one<Row>('select * from workflow_definitions where id = $1', [input.definitionId]);
          if (!w) return null;
          const inst = (await db.one<Row>(
            `insert into workflow_instances (definition_id, definition, name, record_type, record_id, requested_by, note, kind, data, started_at, current_step)
             values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb, coalesce($10::timestamptz, now()), $11) returning *`,
            [w.id, JSON.stringify(snapshotOf(w)), w.name, kind.recordType, input.recordId, input.requestedBy, input.note ?? null, kind.key,
              JSON.stringify(input.data ?? {}), input.startedAt ?? null, input.position ?? 0]))!;
          const steps = asJson<StepDef[]>(w.steps);
          for (let i = 0; i < (input.position ?? 0); i += 1) {
            await db.query(`insert into workflow_steps (instance_id, position, step_key, name, status, required, note, finished_at)
              values ($1, $2, $3, $4, 'approved', 0, 'Decided before approvals moved to workflows.', now())`, [inst.id, i, steps[i]?.key ?? `step-${i + 1}`, steps[i]?.name ?? 'Approval']);
          }
          const pos = input.position ?? 0;
          const step = (await db.one<Row>(
            `insert into workflow_steps (instance_id, position, step_key, name, status, approvers, principals, required, started_at, note)
             values ($1, $2, $3, $4, 'pending', $5::jsonb, $5::jsonb, $6, coalesce($7::timestamptz, now()), $8) returning *`,
            [inst.id, pos, steps[pos]?.key ?? 'step-1', steps[pos]?.name ?? 'Approval', JSON.stringify(input.approvers), Math.max(1, input.required),
              input.startedAt ?? null, input.approvers.length ? null : 'Nobody named by this step can approve it. An administrator can reassign it or cancel the workflow.']))!;
          for (const d of input.decisions ?? []) {
            await db.query(
              `insert into workflow_decisions (step_id, instance_id, user_id, decision, comment, via, origin, created_at)
               values ($1, $2, $3, $4, $5, 'web', 'adopted', coalesce($6::timestamptz, now())) on conflict (step_id, user_id) do nothing`,
              [step.id, inst.id, d.userId, d.decision, d.comment ?? null, d.at ?? null]);
          }
          return inst.id as string;
        },
        usersWith,
        definitions: async () => (await kindDefinitions(kind.key)).map((w) => ({ id: w.id as string, name: w.name as string, description: (w.description ?? null) as string | null })),
      };
      try {
        await kind.install(helpers);
        await db.query(`insert into workflow_kind_installs (kind, summary) values ($1, $2) on conflict (kind) do update set installed_at = now()`,
          [kind.key, `${kind.label}${def ? '' : ' (its area was switched off)'}`]);
        done.push(kind.key);
      } catch (err) {
        // Tried again at the next start; the module's own approvals are untouched meanwhile.
        console.error(`[workflows] installing ${kind.key}:`, err);
      }
    }
    if (done.length) forget();
    return done;
  }

  return {
    start, decide, cancel, reassign, escalateDue, applyStandins, recordDeleted, flagStuck, writePeople, recordCreated, recordUpdated, forget, maySee, people, roleMembers,
    typeDef, recordName, loadInstance, engine, installKinds, installed, mayDecide, usersWith, approversFor, nameOf, holder,
  };
}
