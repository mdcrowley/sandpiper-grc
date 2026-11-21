// Shapes of the Lifecycles routes (/api/admin/lifecycles, E14-31) and the small rules the page uses.

/** The "from" of a new record. */
export const NEW = '';

export interface TypeSummary {
  type: string; label: string; plural: string; field: string; fieldLabel: string; list: string;
  managed: boolean; hasNotes: boolean; customized: boolean;
  statuses: number; blocked: number; required: number; limited: number; newStatuses: number;
}

export interface Who { permission: string | null; roles: string[] }

export interface Rules {
  /** Moves that are not allowed, as [from, to]; from '' is a new record. */
  blocked: [string, string][];
  required: Record<string, string[]>;
  who: Record<string, Who>;
}

export interface Detail {
  type: string; label: string; plural: string; route: string;
  field: string; fieldLabel: string; list: string;
  managed: boolean; notes: string[]; customized: boolean; updatedAt: string | null; updatedBy: string | null;
  statuses: { value: string; label: string; color: string }[];
  rules: Rules;
  newStatuses: string[];
  fields: { name: string; label: string; custom: boolean }[];
  roles: { key: string; name: string; enabled: boolean }[];
  permissions: { value: string; label: string }[];
}

/** For each status (and a new record, ''), the statuses it may change to, in list order. */
export function describeMoves(values: string[], blocked: [string, string][]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const from of [NEW, ...values]) {
    out.set(from, values.filter((to) => to !== from && !blocked.some(([a, b]) => a === from && b === to)));
  }
  return out;
}

/** Statuses a new record can never reach through the allowed changes. */
export function unreachable(values: string[], blocked: [string, string][]): string[] {
  const moves = describeMoves(values, blocked);
  const seen = new Set<string>();
  const queue = [NEW];
  while (queue.length) {
    for (const to of moves.get(queue.shift()!) ?? []) {
      if (!seen.has(to)) { seen.add(to); queue.push(to); }
    }
  }
  return values.filter((v) => !seen.has(v));
}
