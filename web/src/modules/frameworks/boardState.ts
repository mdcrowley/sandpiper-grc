// The outcomes board's filters: what they are, how they sit in the page address, and the
// saved views and preferences kept in this browser.
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BoardOutcome } from './types';

export interface BoardFilters {
  /** Focus on priority outcomes: only they are shown and the function bands count only them. */
  priority: boolean;
  statuses: string[];
  phases: string[];
  functions: string[];
  /** '' = anyone, 'none' = no owner, otherwise a user id. */
  owner: string;
  /** Text looked for in the code and wording. */
  q: string;
}

export const NO_FILTERS: BoardFilters = { priority: false, statuses: [], phases: [], functions: [], owner: '', q: '' };

/** A phase filter value meaning "no phase set". */
export const NO_PHASE = 'none';

export function matches(o: BoardOutcome, f: BoardFilters): boolean {
  if (f.priority && !o.priority) return false;
  if (f.statuses.length && !f.statuses.includes(o.status)) return false;
  if (f.phases.length && !f.phases.includes(o.phase ?? NO_PHASE)) return false;
  if (f.functions.length && !f.functions.includes(o.function_code ?? '')) return false;
  if (f.owner === 'none' ? o.owner_id !== null : f.owner !== '' && o.owner_id !== f.owner) return false;
  if (f.q) {
    const needle = f.q.toLowerCase();
    if (![o.code, o.description, o.official_text].some((t) => (t ?? '').toLowerCase().includes(needle))) return false;
  }
  return true;
}

const list = (v: string | null) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

/** Address form: ?priority=1&status=partial,met&phase=now&fn=GV&owner=<id>&q=text */
export function filtersFromQuery(query: string): BoardFilters {
  const p = new URLSearchParams(query);
  return {
    priority: p.get('priority') === '1',
    statuses: list(p.get('status')),
    phases: list(p.get('phase')),
    functions: list(p.get('fn')),
    owner: p.get('owner') ?? '',
    q: p.get('q') ?? '',
  };
}

export function queryFromFilters(f: BoardFilters): string {
  const p = new URLSearchParams();
  if (f.priority) p.set('priority', '1');
  if (f.statuses.length) p.set('status', f.statuses.join(','));
  if (f.phases.length) p.set('phase', f.phases.join(','));
  if (f.functions.length) p.set('fn', f.functions.join(','));
  if (f.owner) p.set('owner', f.owner);
  if (f.q.trim()) p.set('q', f.q.trim());
  return p.toString();
}

export const isFiltered = (f: BoardFilters) => queryFromFilters(f) !== '';

/** The board's filters, read from and written to the page address. */
export function useBoardFilters(): [BoardFilters, (next: BoardFilters, replace?: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const filters = useMemo(() => filtersFromQuery(query), [query]);
  const set = useCallback((next: BoardFilters, replace = false) => {
    setParams(new URLSearchParams(queryFromFilters(next)), { replace });
  }, [setParams]);
  return [filters, set];
}

// ---------- this browser's memory: saved views, density, the framework last looked at ----------

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

export interface BoardView { name: string; query: string }

const VIEWS_KEY = 'grc.views.framework_board';

export function loadBoardViews(): BoardView[] {
  const parsed = read<unknown>(VIEWS_KEY, []);
  return Array.isArray(parsed)
    ? (parsed as BoardView[]).filter((v) => v && typeof v.name === 'string' && typeof v.query === 'string')
    : [];
}

export function storeBoardViews(views: BoardView[]): void {
  write(VIEWS_KEY, views);
}

export type Density = 'detailed' | 'compact' | 'map';
const DENSITIES: Density[] = ['detailed', 'compact', 'map'];

export function useDensity(): [Density, (d: Density) => void] {
  const [value, setValue] = useState<Density>(() => {
    const stored = read<string>('grc.frameworks.density', 'detailed');
    return DENSITIES.includes(stored as Density) ? (stored as Density) : 'detailed';
  });
  const set = useCallback((d: Density) => { setValue(d); write('grc.frameworks.density', d); }, []);
  return [value, set];
}

const CURRENT_KEY = 'grc.frameworks.current';
export const rememberedFramework = () => read<string | null>(CURRENT_KEY, null);
export const rememberFramework = (id: string) => write(CURRENT_KEY, id);
