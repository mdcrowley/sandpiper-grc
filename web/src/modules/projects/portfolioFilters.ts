import type { PortfolioRow } from './types';

// The portfolio's filters live in the page address under the same names the table view
// (ResourceList) uses: `q` and `f.<field>=a,b`. Every view reads them, so switching between
// table, board, timeline and budget keeps what was filtered.

/** Filters the board, timeline and budget views can apply themselves. */
export const VIEW_FILTERS = ['tier', 'stage', 'status', 'rag_overall', 'funding_source', 'project_manager_id', 'rag_trend'] as const;
export type ViewFilter = (typeof VIEW_FILTERS)[number];

export interface PortfolioFilters {
  q: string;
  values: Partial<Record<ViewFilter, string[]>>;
  /** Filters set in the table view that the other views cannot apply (dates, yes/no questions). */
  tableOnly: string[];
}

export function readFilters(search: URLSearchParams): PortfolioFilters {
  const values: PortfolioFilters['values'] = {};
  const tableOnly: string[] = [];
  for (const [key, raw] of search.entries()) {
    if (!key.startsWith('f.') || !raw) continue;
    const field = key.slice(2);
    if ((VIEW_FILTERS as readonly string[]).includes(field)) values[field as ViewFilter] = raw.split(',').filter(Boolean);
    else tableOnly.push(field);
  }
  return { q: search.get('q') ?? '', values, tableOnly };
}

export function writeFilter(search: URLSearchParams, field: ViewFilter | 'q', value: string[] | string): URLSearchParams {
  const next = new URLSearchParams(search);
  const key = field === 'q' ? 'q' : `f.${field}`;
  const text = Array.isArray(value) ? value.join(',') : value;
  if (text) next.set(key, text); else next.delete(key);
  next.delete('page');
  return next;
}

export function clearFilters(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  const view = search.get('view');
  if (view) next.set('view', view);
  return next;
}

export function activeCount(f: PortfolioFilters): number {
  return (f.q ? 1 : 0) + Object.values(f.values).filter((v) => v && v.length).length + f.tableOnly.length;
}

export function applyFilters(rows: PortfolioRow[], f: PortfolioFilters): PortfolioRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((p) => {
    if (q && ![p.name, p.ref, p.department, p.sponsor, p.project_manager].some((t) => (t ?? '').toLowerCase().includes(q))) return false;
    for (const field of VIEW_FILTERS) {
      const wanted = f.values[field];
      if (wanted?.length && !wanted.includes(String(p[field] ?? ''))) return false;
    }
    return true;
  });
}
