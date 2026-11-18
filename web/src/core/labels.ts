// Display labels for user and record ids that arrive without one (history values, filters
// restored from a shared address). Looked up once and remembered for the session.
import { useEffect, useState } from 'react';
import { api, type Row } from './api';
import type { ResourceMeta } from './meta';

export interface LabelTarget {
  /** 'user', or a record type key. */
  kind: string;
  id: string;
}

const known = new Map<string, string>();
const pending = new Map<string, Promise<string | undefined>>();
let users: Promise<Map<string, string>> | null = null;

const keyOf = (t: LabelTarget) => `${t.kind}:${t.id}`;

/** Remember a label we already hold (a picked option, a row's `_display`). */
export function rememberLabel(kind: string, id: string | null | undefined, label: string | null | undefined): void {
  if (id && label) known.set(`${kind}:${id}`, label);
}

export function knownLabel(kind: string, id: string): string | undefined {
  return known.get(`${kind}:${id}`);
}

function loadUsers(): Promise<Map<string, string>> {
  users ??= api.get<{ id: string; label: string }[]>('/api/users/options').then(
    (list) => new Map(list.map((u) => [u.id, u.label])),
    () => { users = null; return new Map<string, string>(); },
  );
  return users;
}

function resolve(target: LabelTarget, resources: Record<string, ResourceMeta>): Promise<string | undefined> {
  const key = keyOf(target);
  const running = pending.get(key);
  if (running) return running;
  let job: Promise<string | undefined>;
  if (target.kind === 'user') {
    job = loadUsers().then((map) => map.get(target.id));
  } else {
    const resource = resources[target.kind];
    job = resource
      ? api.get<Row>(`${resource.path}/${target.id}`).then(
        (row) => {
          const title = row?.[resource.titleField];
          const ref = resource.refField ? row?.[resource.refField] : undefined;
          return title ? (ref ? `${ref} ${title}` : String(title)) : undefined;
        },
        () => undefined,
      )
      : Promise.resolve(undefined);
  }
  job = job.then((label) => {
    if (label) known.set(key, label);
    return label;
  });
  pending.set(key, job);
  return job;
}

/**
 * Labels for the given targets, filled in as they are found. Keys are `${kind}:${id}`.
 * At most `limit` lookups are started, so a long history cannot flood the server.
 */
export function useLabels(targets: LabelTarget[], resources: Record<string, ResourceMeta>, limit = 30): Record<string, string> {
  const wanted = [...new Set(targets.map(keyOf))].sort().join('|');
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    const missing = wanted.split('|').filter((k) => k && !known.has(k)).slice(0, limit);
    for (const key of missing) {
      const at = key.indexOf(':');
      void resolve({ kind: key.slice(0, at), id: key.slice(at + 1) }, resources).then((label) => {
        if (live && label) bump((n) => n + 1);
      });
    }
    return () => { live = false; };
  }, [wanted, resources, limit]);
  const out: Record<string, string> = {};
  for (const key of wanted.split('|')) {
    const label = known.get(key);
    if (label) out[key] = label;
  }
  return out;
}
