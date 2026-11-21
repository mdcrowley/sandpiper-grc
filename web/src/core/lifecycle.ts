// Allowed status changes and required fields per record type (E14-31), as /api/meta gives them in
// each record type's `lifecycle`. The server checks every save; these helpers let a form offer only
// the statuses a record may move to and mark the fields the chosen status needs.

export interface LifecycleMeta {
  /** The status field the rules are about. */
  field: string;
  /** The application alone sets the status (Administration > Lifecycles cannot change it). */
  managed: boolean;
  /** Moves that are not allowed, as [from, to]; from '' is a new record. */
  blocked: [string, string][];
  /** Fields that must be filled in before a record may have the status. */
  required: Record<string, string[]>;
  /** Statuses the signed-in person may not move a record to. */
  denied: string[];
}

/**
 * The statuses a record holding `from` ('' or null: a new record) may be given, out of `values`.
 * The current status is always kept, so the picker still shows it. Without rules, every value.
 */
export function allowedStatuses(lifecycle: LifecycleMeta | undefined, from: string | null | undefined, values: string[]): string[] {
  if (!lifecycle) return values;
  const start = from ?? '';
  // A record holding a status that is no longer on the list may move anywhere (as on the server).
  const fromKnown = start === '' || values.includes(start);
  return values.filter((to) => to === start
    || ((!fromKnown || !lifecycle.blocked.some(([a, b]) => a === start && b === to)) && !lifecycle.denied.includes(to)));
}

/** Fields the status needs filled in (none for no status or no rules). */
export function requiredFor(lifecycle: LifecycleMeta | undefined, status: unknown): string[] {
  if (!lifecycle || typeof status !== 'string' || !status) return [];
  return lifecycle.required[status] ?? [];
}
