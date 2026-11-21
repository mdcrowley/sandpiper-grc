// The approval workflow engine's rules, as plain functions with no database (E14-06): reading and
// checking a definition, conditions on record fields, which steps apply, who may approve, how
// many approvals a step needs, and the field values set at the end. service.ts does the storing.
import type { FieldDef, Row } from '../../core/module.ts';

/** `module`: started by the module that owns an approval kind (a change submitted, a disposal asked for). */
export const TRIGGERS = ['create', 'status', 'manual', 'module'] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'set'] as const;
export type Op = (typeof OPS)[number];
export const OP_LABELS: Record<Op, string> = {
  eq: 'is', ne: 'is not', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
  in: 'is one of', empty: 'is empty', set: 'is filled in',
};

export interface Condition { field: string; op: Op; value?: unknown }

export type ApproverSpec =
  | { kind: 'users'; users: string[] }
  | { kind: 'role'; role: string }
  | { kind: 'field'; field: string }
  | { kind: 'department_head'; from: 'requester' | 'field'; field?: string | null }
  /** Named people and the members of roles together (a change approval rule's approvers). */
  | { kind: 'people'; users: string[]; roles: string[] }
  /** Everyone who holds a permission (for example `changes.approve`). */
  | { kind: 'permission'; permission: string };

/** `any`: one approval is enough; `all`: everyone named; a number: that many of them. */
export type Quorum = 'any' | 'all' | number;

export interface StepDef {
  key: string;
  name: string;
  approvers: ApproverSpec;
  quorum: Quorum;
  /** The step applies only when every condition holds (checked when the step is reached). */
  conditions: Condition[];
  /** Hours from the start of the step to its due time; null = no due time. */
  due_hours: number | null;
  /** Who is told, and may then also decide, once the step is overdue. */
  escalate_to: { users: string[]; role: string | null } | null;
}

export interface FieldSet { field: string; value: unknown }

export interface WorkflowDef {
  record_type: string;
  /** The approval kind it serves (started by its module), or null. */
  kind?: string | null;
  name: string;
  description: string | null;
  active: boolean;
  trigger: Trigger;
  trigger_field: string | null;
  trigger_value: string | null;
  conditions: Condition[];
  steps: StepDef[];
  on_approve: FieldSet[];
  on_reject: FieldSet[];
}

/** Special values an outcome may set: the date the workflow ended, and the people involved. */
export const TODAY = 'today';
export const LAST_APPROVER = 'approver';
export const REQUESTER = 'requester';

export const MAX_STEPS = 10;
export const MAX_CONDITIONS = 10;

// ---------- reading fields ----------

/** A field's value on a row; custom fields (`cf_<key>`) live in the row's `custom` column. */
export function fieldValue(row: Row, field: string): unknown {
  if (field.startsWith('cf_')) return ((row.custom ?? {}) as Row)[field.slice(3)] ?? null;
  return row[field] ?? null;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Compares two values the way the field's type means them; null when they cannot be compared. */
function compare(type: string, a: unknown, b: unknown): number | null {
  if (isEmpty(a) || isEmpty(b)) return null;
  if (type === 'number' || type === 'currency') {
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) ? x - y : null;
  }
  if (type === 'datetime') {
    const x = new Date(a as string).getTime();
    const y = new Date(b as string).getTime();
    return Number.isFinite(x) && Number.isFinite(y) ? x - y : null;
  }
  if (type === 'date') {
    const x = String(a).slice(0, 10);
    const y = String(b).slice(0, 10);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return null;
}

/** Whether two values are equal for the field's type (text ignores case; booleans accept yes/no). */
function same(type: string, a: unknown, b: unknown): boolean {
  if (type === 'boolean') {
    const truthy = (v: unknown) => v === true || ['true', 'yes', '1'].includes(String(v).toLowerCase());
    return truthy(a) === truthy(b);
  }
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  const ordered = compare(type, a, b);
  if (ordered !== null) return ordered === 0;
  if (Array.isArray(a)) return a.map(String).includes(String(b)); // a multi-select custom field
  if (type === 'text' || type === 'longtext') return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  return String(a) === String(b);
}

/** Whether one condition holds for a row. A field the type does not have never matches. */
export function conditionHolds(cond: Condition, row: Row, fields: Record<string, FieldDef>): boolean {
  const def = fields[cond.field];
  if (!def) return false;
  const v = fieldValue(row, cond.field);
  switch (cond.op) {
    case 'empty': return def.type === 'boolean' ? v !== true : isEmpty(v);
    case 'set': return def.type === 'boolean' ? v === true : !isEmpty(v);
    case 'eq': return same(def.type, v, cond.value);
    case 'ne': return !same(def.type, v, cond.value);
    case 'in': return (Array.isArray(cond.value) ? cond.value : [cond.value]).some((x) => same(def.type, v, x));
    default: {
      const c = compare(def.type, v, cond.value);
      if (c === null) return false;
      return cond.op === 'gt' ? c > 0 : cond.op === 'gte' ? c >= 0 : cond.op === 'lt' ? c < 0 : c <= 0;
    }
  }
}

/** Every condition holds (an empty list always does). */
export const allHold = (conds: Condition[] | null | undefined, row: Row, fields: Record<string, FieldDef>) =>
  (conds ?? []).every((c) => conditionHolds(c, row, fields));

// ---------- steps and decisions ----------

/**
 * From step `from` on, the steps whose conditions do not hold are skipped; answers the first step
 * that applies (null when none is left, which means the workflow is approved) and those skipped.
 */
export function nextStep(steps: StepDef[], from: number, row: Row, fields: Record<string, FieldDef>): { next: number | null; skipped: number[] } {
  const skipped: number[] = [];
  for (let i = from; i < steps.length; i += 1) {
    if (allHold(steps[i].conditions, row, fields)) return { next: i, skipped };
    skipped.push(i);
  }
  return { next: null, skipped };
}

/**
 * The people who may decide a step: the candidates, once each, without the person who asked
 * (nobody approves their own request) and without anyone `allowed` refuses (for example people
 * who cannot see the record).
 */
export function eligible(candidates: (string | null | undefined)[], requester: string | null, allowed: (id: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const id of candidates) {
    if (!id || id === requester || out.includes(id) || !allowed(id)) continue;
    out.push(id);
  }
  return out;
}

/** Approvals a step needs from `count` eligible people (at least one, never more than there are). */
export function required(quorum: Quorum, count: number): number {
  if (quorum === 'any') return 1;
  if (quorum === 'all') return Math.max(1, count);
  return Math.max(1, Math.min(Math.floor(quorum), Math.max(1, count)));
}

/** Where a step stands after its decisions: one rejection rejects it; enough approvals approve it. */
export function tally(decisions: { decision: string }[], need: number): 'approved' | 'rejected' | 'pending' {
  if (decisions.some((d) => d.decision === 'rejected')) return 'rejected';
  return decisions.filter((d) => d.decision === 'approved').length >= need ? 'approved' : 'pending';
}

/** Why `userId` may not decide a step right now, or null when they may. */
export function refusal(step: { status: string; approvers: string[] }, instance: { status: string; requested_by: string | null }, userId: string, decided: boolean): string | null {
  if (instance.status !== 'running') return 'This workflow has already finished.';
  if (step.status !== 'pending') return 'This step is not waiting for decisions.';
  if (instance.requested_by === userId) return 'You asked for this approval, so someone else must decide it.';
  if (!step.approvers.includes(userId)) return 'You are not one of the approvers of this step.';
  if (decided) return 'You have already decided this step.';
  return null;
}

/** A step's stand-ins: `{ standinId: [approverId, ...] }`. */
export type Standins = Record<string, string[]>;

/**
 * Whose place a decision by `userId` takes on a step (E14-32): their own when they are one of the
 * step's approvers, otherwise the first approver they stand in for (while that stand-in period
 * runs) who has not decided yet, in person or through a stand-in. Answers `{ onBehalfOf }` (null:
 * their own) or `{ error }`.
 */
export function slotFor(
  step: { principals: string[]; standins: Standins },
  userId: string,
  decisions: { user_id: string; on_behalf_of: string | null }[],
  standinActive: (principal: string) => boolean,
): { onBehalfOf: string | null } | { error: string } {
  if (decisions.some((d) => d.user_id === userId)) return { error: 'You have already decided this step.' };
  const taken = new Set(decisions.map((d) => d.on_behalf_of ?? d.user_id));
  if (step.principals.includes(userId)) {
    if (taken.has(userId)) return { error: 'Your stand-in has already decided this step for you.' };
    return { onBehalfOf: null };
  }
  const forWhom = (step.standins[userId] ?? []).filter((p) => standinActive(p));
  if (!forWhom.length) return { error: 'You are not one of the approvers of this step.' };
  const free = forWhom.find((p) => !taken.has(p));
  if (!free) return { error: 'The approvers you stand in for have already decided this step.' };
  return { onBehalfOf: free };
}

/** Whether a stand-in period covers a day (`YYYY-MM-DD`, both ends included). */
export const standinCovers = (s: { starts_on: string; ends_on: string }, day: string) =>
  String(s.starts_on).slice(0, 10) <= day && day <= String(s.ends_on).slice(0, 10);

/** The patch an outcome makes, with the special values filled in. Unknown fields are left out. */
export function outcomePatch(sets: FieldSet[], fields: Record<string, FieldDef>, who: { today: string; approver: string | null; requester: string | null }): Row {
  const patch: Row = {};
  for (const s of sets) {
    const def = fields[s.field];
    if (!def) continue;
    let v = s.value;
    if (def.type === 'date' && v === TODAY) v = who.today;
    if (def.type === 'user' && v === LAST_APPROVER) v = who.approver;
    if (def.type === 'user' && v === REQUESTER) v = who.requester;
    if (def.type === 'boolean' && typeof v === 'string') v = ['true', 'yes', '1'].includes(v.toLowerCase());
    if ((def.type === 'number' || def.type === 'currency') && typeof v === 'string' && v.trim() !== '') v = Number(v);
    patch[s.field] = v === '' ? null : v;
  }
  return patch;
}

// ---------- checking a definition ----------

/** What a definition is checked against: the record type's fields and the choices that exist. */
export interface DefinitionContext {
  types: Record<string, { fields: Record<string, FieldDef> }>;
  /** Values of a lookup list. */
  lookup(list: string): string[];
  roles: string[];
  users: string[];
  /** Approval kinds the modules declared: key to record type. */
  kinds?: Record<string, string>;
  /** Permission keys that exist (for steps approved by everyone holding one). */
  permissions?: string[];
}

const WRITABLE: ReadonlySet<string> = new Set(['text', 'longtext', 'number', 'currency', 'date', 'datetime', 'boolean', 'lookup', 'user', 'ref']);
const COMPARABLE: ReadonlySet<string> = new Set(['number', 'currency', 'date', 'datetime']);
const KEY_RE = /^[a-z0-9_-]{1,40}$/i;

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Checks and cleans a definition sent by an administrator. Answers `{ def }` or `{ errors }`, the
 * errors keyed by field (`name`, `steps.0.approvers`, `on_approve.1`, ...).
 */
export function checkDefinition(input: Row, c: DefinitionContext): { def?: WorkflowDef; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = str(input.name, 120);
  if (!name) errors.name = 'Give the workflow a name.';
  const recordType = String(input.record_type ?? '');
  const type = c.types[recordType];
  if (!type) errors.record_type = 'Choose a record type.';
  const fields = type?.fields ?? {};

  const kind = input.kind ? String(input.kind) : null;
  if (kind && c.kinds?.[kind] === undefined) errors.kind = 'This kind of approval is not available.';
  else if (kind && c.kinds?.[kind] !== recordType) errors.kind = 'This kind of approval belongs to another record type.';
  // A kind's workflow is started by its module; any other workflow cannot claim that trigger.
  let trigger = (TRIGGERS as readonly string[]).includes(String(input.trigger)) ? (input.trigger as Trigger) : null;
  if (kind) trigger = 'module';
  else if (trigger === 'module') trigger = null;
  if (!trigger) errors.trigger = 'Choose what starts the workflow.';
  let triggerField: string | null = null;
  let triggerValue: string | null = null;
  if (trigger === 'status' && type) {
    triggerField = String(input.trigger_field ?? 'status');
    const f = fields[triggerField];
    if (!f || f.type !== 'lookup') errors.trigger_field = 'Choose a list field (such as Status) to watch.';
    else {
      triggerValue = str(input.trigger_value, 80);
      if (!triggerValue || !c.lookup(f.list!).includes(triggerValue)) errors.trigger_value = 'Choose the value that starts the workflow.';
    }
  }

  const conditions = (where: string, raw: unknown): Condition[] => {
    const out: Condition[] = [];
    const items = list(raw);
    if (items.length > MAX_CONDITIONS) errors[where] = `Use at most ${MAX_CONDITIONS} conditions.`;
    items.slice(0, MAX_CONDITIONS).forEach((item, i) => {
      const it = (item ?? {}) as Row;
      const f = fields[String(it.field ?? '')];
      const op = String(it.op ?? '') as Op;
      if (!f) { errors[`${where}.${i}`] = 'Choose a field.'; return; }
      if (!(OPS as readonly string[]).includes(op)) { errors[`${where}.${i}`] = 'Choose a comparison.'; return; }
      if (['gt', 'gte', 'lt', 'lte'].includes(op) && !COMPARABLE.has(f.type)) {
        errors[`${where}.${i}`] = `${f.label} cannot be compared as more or less.`; return;
      }
      let value: unknown = null;
      if (op === 'in') {
        value = list(it.value).map(String).filter(Boolean);
        if (!(value as string[]).length) { errors[`${where}.${i}`] = 'Choose at least one value.'; return; }
      } else if (op !== 'empty' && op !== 'set') {
        value = it.value;
        if (value === null || value === undefined || value === '') { errors[`${where}.${i}`] = 'Give a value to compare with.'; return; }
        if ((f.type === 'number' || f.type === 'currency') && !Number.isFinite(Number(value))) { errors[`${where}.${i}`] = 'Give a number.'; return; }
      }
      if (f.type === 'lookup' && value !== null) {
        const known = c.lookup(f.list!);
        const vals = Array.isArray(value) ? value : [value];
        if (vals.some((v) => !known.includes(String(v)))) { errors[`${where}.${i}`] = `Choose values of ${f.label}.`; return; }
      }
      out.push({ field: String(it.field), op, ...(value === null ? {} : { value }) });
    });
    return out;
  };

  const steps: StepDef[] = [];
  const rawSteps = list(input.steps);
  if (!rawSteps.length) errors.steps = 'Add at least one approval step.';
  if (rawSteps.length > MAX_STEPS) errors.steps = `Use at most ${MAX_STEPS} steps.`;
  const keys = new Set<string>();
  rawSteps.slice(0, MAX_STEPS).forEach((raw, i) => {
    const s = (raw ?? {}) as Row;
    const at = `steps.${i}`;
    const stepName = str(s.name, 80);
    if (!stepName) errors[`${at}.name`] = 'Give the step a name.';
    let key = KEY_RE.test(String(s.key ?? '')) ? String(s.key) : `step-${i + 1}`;
    while (keys.has(key)) key = `${key}-${i + 1}`;
    keys.add(key);

    const a = (s.approvers ?? {}) as Row;
    let approvers: ApproverSpec | null = null;
    if (a.kind === 'users') {
      const users = [...new Set(list(a.users).map(String))];
      if (!users.length) errors[`${at}.approvers`] = 'Name at least one approver.';
      else if (users.length > 20) errors[`${at}.approvers`] = 'Name at most 20 approvers.';
      else if (users.some((u) => !c.users.includes(u))) errors[`${at}.approvers`] = 'One of the approvers is not an active person.';
      approvers = { kind: 'users', users };
    } else if (a.kind === 'role') {
      const role = String(a.role ?? '');
      if (!c.roles.includes(role)) errors[`${at}.approvers`] = 'Choose a role.';
      approvers = { kind: 'role', role };
    } else if (a.kind === 'field') {
      const field = String(a.field ?? '');
      if (fields[field]?.type !== 'user') errors[`${at}.approvers`] = 'Choose a person field of the record, such as its owner.';
      approvers = { kind: 'field', field };
    } else if (a.kind === 'department_head') {
      const from = a.from === 'field' ? 'field' : 'requester';
      const field = from === 'field' ? String(a.field ?? '') : null;
      if (from === 'field' && !['user', 'text', 'lookup'].includes(fields[field ?? '']?.type ?? '')) {
        errors[`${at}.approvers`] = 'Choose the field that names the department or a person in it.';
      }
      approvers = { kind: 'department_head', from, field };
    } else if (a.kind === 'people') {
      const users = [...new Set(list(a.users).map(String))];
      const roles = [...new Set(list(a.roles).map(String))];
      if (!users.length && !roles.length) errors[`${at}.approvers`] = 'Name at least one person or role.';
      else if (users.length > 20) errors[`${at}.approvers`] = 'Name at most 20 approvers.';
      else if (users.some((u) => !c.users.includes(u))) errors[`${at}.approvers`] = 'One of the approvers is not an active person.';
      else if (roles.some((r) => !c.roles.includes(r))) errors[`${at}.approvers`] = 'Choose roles that exist.';
      approvers = { kind: 'people', users, roles };
    } else if (a.kind === 'permission') {
      const permission = String(a.permission ?? '');
      if (!/^[a-z_]+.[a-z_]+$/.test(permission) || (c.permissions && !c.permissions.includes(permission))) errors[`${at}.approvers`] = 'Choose a permission.';
      approvers = { kind: 'permission', permission };
    } else {
      errors[`${at}.approvers`] = 'Choose who approves this step.';
    }

    let quorum: Quorum = 'any';
    if (s.quorum === 'all') quorum = 'all';
    else if (s.quorum !== undefined && s.quorum !== null && s.quorum !== 'any') {
      const n = Number(s.quorum);
      if (!Number.isInteger(n) || n < 1 || n > 20) errors[`${at}.quorum`] = 'Ask for 1 to 20 approvals.';
      else quorum = n === 1 ? 'any' : n;
    }

    let dueHours: number | null = null;
    if (s.due_hours !== undefined && s.due_hours !== null && s.due_hours !== '') {
      const h = Number(s.due_hours);
      if (!Number.isFinite(h) || h <= 0 || h > 24 * 90) errors[`${at}.due_hours`] = 'Give a due time between 1 hour and 90 days.';
      else dueHours = Math.round(h * 100) / 100;
    }

    let escalate: StepDef['escalate_to'] = null;
    const e = s.escalate_to as Row | null | undefined;
    if (e && (list(e.users).length || e.role)) {
      const users = [...new Set(list(e.users).map(String))];
      const role = e.role ? String(e.role) : null;
      if (users.some((u) => !c.users.includes(u))) errors[`${at}.escalate_to`] = 'One of the people to escalate to is not an active person.';
      if (role && !c.roles.includes(role)) errors[`${at}.escalate_to`] = 'Choose a role to escalate to.';
      if (dueHours === null) errors[`${at}.escalate_to`] = 'Give the step a due time to escalate after it.';
      escalate = { users, role };
    }

    if (approvers) steps.push({ key, name: stepName ?? '', approvers, quorum, conditions: conditions(`${at}.conditions`, s.conditions), due_hours: dueHours, escalate_to: escalate });
  });

  const outcome = (where: string, raw: unknown): FieldSet[] => {
    const out: FieldSet[] = [];
    list(raw).slice(0, 10).forEach((item, i) => {
      const it = (item ?? {}) as Row;
      const field = String(it.field ?? '');
      const f = fields[field];
      if (!f || f.readOnly || !WRITABLE.has(f.type)) { errors[`${where}.${i}`] = 'Choose a field that can be changed.'; return; }
      const value = it.value === undefined ? null : it.value;
      if (f.type === 'lookup' && value !== null && !c.lookup(f.list!).includes(String(value))) { errors[`${where}.${i}`] = `Choose a value of ${f.label}.`; return; }
      if (f.type === 'date' && value !== null && value !== TODAY && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) { errors[`${where}.${i}`] = 'Give a date or "today".'; return; }
      if (f.type === 'user' && value !== null && ![LAST_APPROVER, REQUESTER].includes(String(value)) && !c.users.includes(String(value))) {
        errors[`${where}.${i}`] = 'Choose a person, the last approver or the requester.'; return;
      }
      if ((f.type === 'number' || f.type === 'currency') && value !== null && value !== '' && !Number.isFinite(Number(value))) { errors[`${where}.${i}`] = 'Give a number.'; return; }
      if (out.some((o) => o.field === field)) { errors[`${where}.${i}`] = `${f.label} is set twice.`; return; }
      out.push({ field, value });
    });
    return out;
  };

  const def: WorkflowDef = {
    record_type: recordType,
    kind,
    name: name ?? '',
    description: str(input.description, 2000),
    active: input.active !== false,
    trigger: trigger ?? 'manual',
    trigger_field: triggerField,
    trigger_value: triggerValue,
    conditions: conditions('conditions', input.conditions),
    steps,
    on_approve: outcome('on_approve', input.on_approve),
    on_reject: outcome('on_reject', input.on_reject),
  };
  return Object.keys(errors).length ? { errors } : { def };
}
