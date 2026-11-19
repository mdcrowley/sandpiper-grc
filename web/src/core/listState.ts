// State of a ResourceList: the view (search, filters, sort) and page, kept in the page address
// when the list owns the page, plus saved views and per-user preferences in localStorage.
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readLocal, useSyncedPreference, writeLocal } from './preferences';

export interface View {
  q: string;
  sort: string;
  dir: 'asc' | 'desc';
  /** Keyed like the list contract without `f.`: `status`, `due_at.gt`. */
  filters: Record<string, string[]>;
  /** Labels of picked users and records, so a restored view can show them. */
  labels: Record<string, string>;
}

export interface SavedView {
  name: string;
  view: View;
}

export const EMPTY_VIEW: View = { q: '', sort: '', dir: 'asc', filters: {}, labels: {} };

/** Two views are the same when search, sort and filters match (labels are decoration). */
export function sameView(a: View, b: View): boolean {
  const norm = (v: View) => JSON.stringify([
    v.q.trim(), v.sort, v.sort ? v.dir : '',
    Object.keys(v.filters).filter((k) => v.filters[k].length > 0).sort().map((k) => [k, [...v.filters[k]].sort()]),
  ]);
  return norm(a) === norm(b);
}

/** Reads `?q=&f.status=new,open&sort=due_at&dir=desc&page=2`. */
export function viewFromParams(params: URLSearchParams): View {
  const filters: Record<string, string[]> = {};
  for (const [key, value] of params) {
    if (key.startsWith('f.') && value) filters[key.slice(2)] = value.split(',').filter(Boolean);
  }
  const sort = params.get('sort') ?? '';
  return { q: params.get('q') ?? '', sort, dir: sort && params.get('dir') === 'desc' ? 'desc' : 'asc', filters, labels: {} };
}

function writeParams(prev: URLSearchParams, view: View, page: number): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of prev) {
    if (!key.startsWith('f.') && !['q', 'sort', 'dir', 'page'].includes(key)) next.append(key, value);
  }
  if (view.q) next.set('q', view.q);
  for (const key of Object.keys(view.filters).sort()) {
    if (view.filters[key].length > 0) next.set(`f.${key}`, view.filters[key].join(','));
  }
  if (view.sort) {
    next.set('sort', view.sort);
    next.set('dir', view.dir);
  }
  if (page > 1) next.set('page', String(page));
  return next;
}

export interface ListState {
  view: View;
  page: number;
  /** Change part of the view; goes back to page 1. `replace` avoids a history entry (typing in search). */
  change: (patch: Partial<View>, options?: { replace?: boolean }) => void;
  setPage: (page: number) => void;
}

/**
 * With `urlSync` the address bar is the source of truth: links are shareable and Back undoes a
 * filter. Without it (lists embedded in a tab or card) the address is read once and then left alone.
 */
export function useListState(urlSync: boolean): ListState {
  const [params, setParams] = useSearchParams();
  const [local, setLocal] = useState<{ view: View; page: number }>(() => ({ view: viewFromParams(params), page: 1 }));

  const key = params.toString();
  const fromUrl = useMemo(() => {
    const p = new URLSearchParams(key);
    return { view: viewFromParams(p), page: Math.max(1, Number.parseInt(p.get('page') ?? '1', 10) || 1) };
  }, [key]);
  const current = urlSync ? fromUrl : local;

  const change = useCallback((patch: Partial<View>, options?: { replace?: boolean }) => {
    if (urlSync) {
      setParams((prev) => writeParams(prev, { ...viewFromParams(prev), ...patch }, 1), { replace: options?.replace });
    } else {
      setLocal((s) => ({ view: { ...s.view, ...patch }, page: 1 }));
    }
  }, [urlSync, setParams]);

  const setPage = useCallback((page: number) => {
    if (urlSync) setParams((prev) => writeParams(prev, viewFromParams(prev), page));
    else setLocal((s) => ({ ...s, page }));
  }, [urlSync, setParams]);

  return { view: current.view, page: current.page, change, setPage };
}

/* ---------- localStorage ---------- */

function normalizeViews(parsed: unknown): SavedView[] {
  return Array.isArray(parsed)
    ? (parsed as SavedView[]).filter((v) => v && typeof v.name === 'string' && v.view).map((v) => ({ name: v.name, view: { ...EMPTY_VIEW, ...v.view } }))
    : [];
}

/** The saved views kept in this browser (see useSavedViews for the copy that follows the person). */
export function loadViews(type: string): SavedView[] {
  return normalizeViews(readLocal<unknown>(`grc.views.${type}`, []));
}

export function storeViews(type: string, views: SavedView[]): void {
  writeLocal(`grc.views.${type}`, views);
}

/**
 * A remembered preference (column choice, density, page size). Keys of the form
 * `grc.u.<user id>.<name>` are also kept on the server as the preference `list.<name>`, so they
 * follow the person between browsers; other keys stay in this browser.
 */
export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const personal = /^grc\.u\.[^.]+\.(.+)$/.exec(key);
  const serverKey = personal && personal[1] && !key.startsWith('grc.u.anon.') ? `list.${personal[1]}`.slice(0, 120) : '';
  return useSyncedPreference<T>(serverKey || `local-only:${key}`, key, fallback, Boolean(serverKey));
}

/** Saved views of a record type: on the server as `views:<type>`, mirrored in this browser. */
export function useSavedViews(type: string): [SavedView[], (views: SavedView[]) => void] {
  const [raw, set] = useSyncedPreference<unknown>(`views:${type}`, `grc.views.${type}`, []);
  const views = useMemo(() => normalizeViews(raw), [raw]);
  return [views, set as (views: SavedView[]) => void];
}
