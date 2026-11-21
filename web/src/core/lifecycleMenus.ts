// Status menus and buttons that follow a record type's lifecycle (E14-31): the bulk edit dialog and
// the hand-written status actions in modules offer only the moves the rules allow. The server
// checks every save anyway; these helpers only keep the web from offering a refused move.
import { allowedStatuses, type LifecycleMeta } from './lifecycle';

/** The lifecycle when it governs `field` and people may set it (not managed by the application). */
export function editableLifecycle(lifecycle: LifecycleMeta | undefined, field: string): LifecycleMeta | undefined {
  return lifecycle && !lifecycle.managed && lifecycle.field === field ? lifecycle : undefined;
}

/**
 * The statuses, out of `values`, that every record holding one of `froms` may be given (the
 * statuses this person may not set are left out). Without rules, every value.
 */
export function allowedForAll(lifecycle: LifecycleMeta | undefined, froms: (string | null | undefined)[], values: string[]): string[] {
  if (!lifecycle || lifecycle.managed) return values;
  const starts = [...new Set(froms.map((f) => f ?? ''))];
  let allowed = values.filter((v) => !lifecycle.denied.includes(v));
  for (const from of starts) {
    const next = allowedStatuses(lifecycle, from, values);
    allowed = allowed.filter((v) => next.includes(v));
  }
  return allowed;
}

/**
 * Whether a record holding `from` may be moved to `to`. `values` is the status list (a status not
 * on it may move anywhere, as on the server); without it, `from` is taken to be on the list.
 */
export function canMoveTo(lifecycle: LifecycleMeta | undefined, from: string | null | undefined, to: string, values?: string[]): boolean {
  if (!lifecycle || lifecycle.managed) return true;
  const list = values ?? [...new Set([from ?? '', to].filter(Boolean))];
  if (from === to) return true;
  return allowedStatuses(lifecycle, from, list.includes(to) ? list : [...list, to]).includes(to);
}

/** Plain words for why a fixed status button is not offered, or '' when the move is allowed. */
export function moveBlockedReason(lifecycle: LifecycleMeta | undefined, from: string | null | undefined, to: string, toLabel: string, values?: string[]): string {
  if (canMoveTo(lifecycle, from, to, values)) return '';
  return lifecycle?.denied.includes(to)
    ? `You may not set the status to ${toLabel} (Administration > Lifecycles).`
    : from
      ? `The lifecycle for this record type does not allow a move to ${toLabel} from the current status (Administration > Lifecycles).`
      : `The lifecycle for this record type does not allow a new record to start as ${toLabel} (Administration > Lifecycles).`;
}
