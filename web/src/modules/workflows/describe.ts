// Plain-English descriptions of a workflow's parts, for the flow picture and the list of workflows.
import { formatCurrency, formatDate, formatNumber } from '../../core';
import { hoursText, OP_LABELS, quorumText, type ApproverSpec, type Condition, type Definition, type FieldSet, type OptionField, type Options, type ApprovalUnit, type Route, type StepDef, END } from './data';

export interface Labels {
  field(name: string): OptionField | undefined;
  fieldLabel(name: string): string;
  value(field: string, v: unknown): string;
  role(key: string | null | undefined): string;
  person(id: string): string;
}

export function makeLabels(options: Options | undefined, recordType: string, people: Record<string, string>): Labels {
  const type = options?.types.find((t) => t.type === recordType);
  const field = (name: string) => type?.fields.find((f) => f.name === name);
  const person = (id: string) => people[id] ?? 'Someone';
  return {
    field,
    fieldLabel: (name) => field(name)?.label ?? name,
    person,
    role: (key) => options?.roles.find((r) => r.key === key)?.name ?? key ?? 'a role',
    value(name, v) {
      const f = field(name);
      if (v === null || v === undefined || v === '') return 'empty';
      if (Array.isArray(v)) return v.map((x) => this.value(name, x)).join(' or ');
      if (!f) return String(v);
      if (f.type === 'lookup') return options?.lookups[f.list ?? '']?.find((o) => o.value === v)?.label ?? String(v);
      if (f.type === 'currency') return formatCurrency(v as number);
      if (f.type === 'number') return formatNumber(v as number);
      if (f.type === 'date') return v === 'today' ? 'the day it ends' : formatDate(v as string);
      if (f.type === 'boolean') return v === true || v === 'true' ? 'Yes' : 'No';
      if (f.type === 'user') return v === 'approver' ? 'the last approver' : v === 'requester' ? 'the requester' : person(String(v));
      return `"${String(v)}"`;
    },
  };
}

export function conditionText(c: Condition, l: Labels): string {
  const label = l.fieldLabel(c.field);
  if (c.op === 'empty' || c.op === 'set') return `${label} ${OP_LABELS[c.op]}`;
  return `${label} ${OP_LABELS[c.op]} ${l.value(c.field, c.value)}`;
}

export const conditionsText = (cs: Condition[], l: Labels) => cs.map((c) => conditionText(c, l)).join(' and ');

export function approverText(a: ApproverSpec | undefined, l: Labels): string {
  if (!a) return '';
  switch (a.kind) {
    case 'users': return a.users.length ? a.users.map(l.person).join(', ') : 'Nobody chosen yet';
    case 'role': return a.role ? `Everyone with the role ${l.role(a.role)}` : 'A role (not chosen yet)';
    case 'field': return a.field ? `The record's ${l.fieldLabel(a.field).toLowerCase()}` : 'A person on the record (not chosen yet)';
    case 'department_head': return a.from === 'field' && a.field
      ? `Head of the department in ${l.fieldLabel(a.field).toLowerCase()}`
      : "Head of the requester's department";
    case 'people': return [...a.users.map(l.person), ...a.roles.map((r) => `everyone with the role ${l.role(r)}`)].join(', ') || 'Nobody chosen yet';
    case 'permission': return a.permission ? `Everyone who holds ${a.permission}` : 'A permission (not chosen yet)';
    default: return '';
  }
}

export function stepQuorumText(s: ApprovalUnit): string {
  if (!s.approvers) return '';
  if (s.approvers.kind === 'users') return quorumText(s.quorum, s.approvers.users.length);
  if (s.approvers.kind === 'role' || s.approvers.kind === 'people' || s.approvers.kind === 'permission') return quorumText(s.quorum);
  return 'They approve';
}

export function dueText(s: ApprovalUnit, l: Labels): string | null {
  if (!s.due_hours) return null;
  const who = s.escalate_to ? [...s.escalate_to.users.map(l.person), ...(s.escalate_to.role ? [`the ${l.role(s.escalate_to.role)} role`] : [])] : [];
  return `Due within ${hoursText(s.due_hours)}${who.length ? `, then escalates to ${who.join(', ')}` : ', then approvers are reminded'}`;
}

export const setsText = (sets: FieldSet[], l: Labels) =>
  sets.map((s) => `${l.fieldLabel(s.field)} to ${l.value(s.field, s.value)}`).join(', ');

export function triggerText(d: Definition, l: Labels): string {
  if (d.trigger === 'create') return 'When a record is created';
  if (d.trigger === 'status') return d.trigger_field && d.trigger_value
    ? `When ${l.fieldLabel(d.trigger_field).toLowerCase()} changes to ${l.value(d.trigger_field, d.trigger_value)}`
    : 'When a field changes to a value';
  if (d.trigger === 'module') return d.kind_starts_when ?? `When its module asks for it${d.kind_label ? ` (${d.kind_label.toLowerCase()})` : ''}`;
  return 'When someone asks for approval';
}

/** "If cost is more than $10,000, go to Director" for a route after a step (E14-32). */
export function routeText(r: Route, steps: StepDef[], l: Labels): string {
  const target = r.to === END ? 'finish (approved)' : `go to "${steps.find((s) => s.key === r.to)?.name || 'a later step'}"`;
  return r.conditions.length ? `If ${conditionsText(r.conditions, l)}, ${target}` : `Then ${target}`;
}
