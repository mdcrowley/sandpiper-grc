// Display labels for user and record ids that arrive without one (history values, filters
// restored from a shared address). Looked up in batches and remembered for the session:
// people through GET /api/users/labels?ids= (which also names people since disabled or
// removed), records through POST /api/records/labels (ids the caller may not see are left out).
// On a server without those routes it falls back to the user list and one GET per record.
import { useEffect, useState } from 'react';
import { api, ApiError, type Row } from './api';
import type { ResourceMeta } from './meta';

export interface LabelTarget {
  /** 'user', or a record type key. */
  kind: string;
  id: string;
}

const known = new Map<string, string>();
/** Keys asked for and not found (hidden, removed): not asked again this session. */
const missingKeys = new Set<string>();
const inFlight = new Set<string>();
let users: Promise<Map<string, string>> | null = null;
let batchRoutes = true;
/** Components waiting for labels: told whenever any lookup finishes. */
const listeners = new Set<() => void>();

const keyOf = (t: LabelTarget) => `${t.kind}:${t.id}`;

/** Remember a label we already hold (a picked option, a row's `_display`). */
export function rememberLabel(kind: string, id: string | null | undefined, label: string | null | undefined): void {
  if (id && label) known.set(`${kind}:${id}`, label);
}

export function knownLabel(kind: string, id: string): string | undefined {
  return known.get(`${kind}:${id}`);
}

const recordLabel = (label: string | undefined, ref: string | undefined | null) => (label ? (ref ? `${ref} ${label}` : label) : undefined);

function loadUsers(): Promise<Map<string, string>> {
  users ??= api.get<{ id: string; label: string }[]>('/api/users/options').then(
    (list) => new Map(list.map((u) => [u.id, u.label])),
    () => { users = null; return new Map<string, string>(); },
  );
  return users;
}

/** The old way: the picker list for people and one request per record. */
async function resolveOneByOne(targets: LabelTarget[], resources: Record<string, ResourceMeta>): Promise<void> {
  await Promise.all(targets.map(async (t) => {
    let label: string | undefined;
    if (t.kind === 'user') label = (await loadUsers()).get(t.id);
    else {
      const resource = resources[t.kind];
      if (resource) {
        try {
          const row = await api.get<Row>(`${resource.path}/${t.id}`);
          label = recordLabel(row?.[resource.titleField] ? String(row[resource.titleField]) : undefined, resource.refField ? row?.[resource.refField] : undefined);
        } catch {
          label = undefined;
        }
      }
    }
    if (label) known.set(keyOf(t), label); else missingKeys.add(keyOf(t));
  }));
}

/** Looks up labels for every target in at most two requests. */
async function resolveBatch(targets: LabelTarget[], resources: Record<string, ResourceMeta>): Promise<void> {
  if (!batchRoutes) return resolveOneByOne(targets, resources);
  const people = targets.filter((t) => t.kind === 'user').map((t) => t.id);
  const records: Record<string, string[]> = {};
  for (const t of targets) if (t.kind !== 'user') (records[t.kind] ??= []).push(t.id);
  try {
    await Promise.all([
      people.length > 0 && api.get<{ id: string; label: string; active?: boolean }[]>(`/api/users/labels?ids=${people.map(encodeURIComponent).join(',')}`)
        .then((list) => { for (const u of list) known.set(`user:${u.id}`, u.active === false ? `${u.label} (no longer active)` : u.label); }),
      Object.keys(records).length > 0 && api.post<Record<string, Record<string, { label: string; ref?: string | null }>>>('/api/records/labels', { records })
        .then((byType) => {
          for (const [type, ids] of Object.entries(byType)) {
            for (const [id, l] of Object.entries(ids ?? {})) {
              const label = recordLabel(l.label, l.ref);
              if (label) known.set(`${type}:${id}`, label);
            }
          }
        }),
    ]);
    for (const t of targets) if (!known.has(keyOf(t))) missingKeys.add(keyOf(t));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      batchRoutes = false;
      await resolveOneByOne(targets, resources);
    }
  }
}

/**
 * Labels for the given targets, filled in as they are found. Keys are `${kind}:${id}`.
 * At most `limit` ids are looked up per render, in one batch.
 */
export function useLabels(targets: LabelTarget[], resources: Record<string, ResourceMeta>, limit = 200): Record<string, string> {
  const wanted = [...new Set(targets.map(keyOf))].sort().join('|');
  const [, bump] = useState(0);
  useEffect(() => {
    const tell = () => bump((n) => n + 1);
    listeners.add(tell);
    return () => { listeners.delete(tell); };
  }, []);
  useEffect(() => {
    const todo = wanted.split('|').filter((k) => k && !known.has(k) && !missingKeys.has(k) && !inFlight.has(k)).slice(0, limit);
    if (todo.length === 0) return undefined;
    for (const k of todo) inFlight.add(k);
    const list = todo.map((key) => {
      const at = key.indexOf(':');
      return { kind: key.slice(0, at), id: key.slice(at + 1) };
    });
    void resolveBatch(list, resources).finally(() => {
      for (const k of todo) inFlight.delete(k);
      for (const tell of listeners) tell();
    });
    return undefined;
  }, [wanted, resources, limit]);
  const out: Record<string, string> = {};
  for (const key of wanted.split('|')) {
    const label = known.get(key);
    if (label) out[key] = label;
  }
  return out;
}
