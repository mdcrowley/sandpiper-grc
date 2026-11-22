// The rules of the phone edit form (spec §5.4), kept apart from the screen so they are easy to test:
// which status moves are offered, what changed, which fields a move needs that only the web form
// shows, and what conflicts with someone else's change. Owner: APP-WORK.
import { toServer } from './fields';
import type { FieldMeta, LookupValue, ResourceMeta, RecordRow } from './types';

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');

/** Values of a lookup field the person may choose now: the lifecycle's blocked moves and denied statuses left out. */
export function choicesFor(meta: ResourceMeta, name: string, field: FieldMeta, current: unknown, lookups: Record<string, LookupValue[]>): LookupValue[] {
  const all = (field.list && lookups[field.list]) || [];
  const lc = meta.lifecycle;
  if (!lc || lc.field !== name) return all;
  const from = String(current ?? '');
  return all.filter((v) =>
    v.value === from || (!lc.denied.includes(v.value) && !lc.blocked.some(([a, b]) => a === from && b === v.value)));
}

/** The fields whose value changed, as the server takes them. */
export function buildPatch(fields: [string, FieldMeta][], original: RecordRow, values: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [name, field] of fields) {
    if (!(name in values)) continue;
    const next = toServer(field, values[name]);
    if (!same(next, original[name])) patch[name] = next;
  }
  return patch;
}

/**
 * Fields a status move needs (lifecycle `required`) that are empty and not on the phone form: the
 * app cannot complete that move and says to finish on the web.
 */
export function webOnlyRequirements(meta: ResourceMeta, row: RecordRow, values: Record<string, unknown>, onForm: string[]): string[] {
  const lc = meta.lifecycle;
  if (!lc) return [];
  const status = String(values[lc.field] ?? row[lc.field] ?? '');
  const needed = lc.required[status] ?? [];
  return needed.filter((f) => !onForm.includes(f) && (row[f] === null || row[f] === undefined || row[f] === ''))
    .map((f) => meta.fields[f]?.label ?? f);
}

export interface Conflict {
  name: string;
  label: string;
  /** What the person saw when they opened the form. */
  before: unknown;
  /** What they want. */
  mine: unknown;
  /** What is saved now (someone else's change). */
  theirs: unknown;
}

/** The person's changes that someone else also changed since: both values shown for a choice. */
export function findConflicts(meta: ResourceMeta, original: RecordRow, patch: Record<string, unknown>, fresh: RecordRow): Conflict[] {
  return Object.entries(patch)
    .filter(([name, mine]) => !same(fresh[name], original[name]) && !same(fresh[name], mine))
    .map(([name, mine]) => ({ name, label: meta.fields[name]?.label ?? name, before: original[name], mine, theirs: fresh[name] }));
}

/** After a conflict: the patch to send on top of the fresh record, keeping "mine" where chosen. */
export function resolvePatch(patch: Record<string, unknown>, conflicts: Conflict[], keepMine: Record<string, boolean>, fresh: RecordRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, mine] of Object.entries(patch)) {
    const c = conflicts.find((x) => x.name === name);
    if (c && !keepMine[name]) continue;
    if (!same(fresh[name], mine)) out[name] = mine;
  }
  return out;
}

/**
 * Whether the form must keep a value in this field (no "None" choice, no Clear): required fields,
 * fields with a default (a status always has one) and the type's lifecycle field.
 */
export function needsValue(meta: ResourceMeta, name: string, field: FieldMeta): boolean {
  return Boolean(field.required) || (field.default !== undefined && field.default !== null) || meta.lifecycle?.field === name;
}
