import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_VIEW, loadViews, sameView, storeViews, viewFromParams, type View } from './listState';

const view = (patch: Partial<View>): View => ({ ...EMPTY_VIEW, ...patch });

/** A minimal localStorage, so the saved-view store can be tested in Node. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

describe('reading a list view from the address', () => {
  it('reads search, filters, sort and direction', () => {
    const v = viewFromParams(new URLSearchParams('q=pump&f.status=new,open&f.due_at.gt=2026-11-01&sort=due_at&dir=desc&page=2&tab=x'));
    expect(v).toEqual({ q: 'pump', sort: 'due_at', dir: 'desc', filters: { status: ['new', 'open'], 'due_at.gt': ['2026-11-01'] }, labels: {} });
  });

  it('defaults to ascending, and ignores a direction without a sort', () => {
    expect(viewFromParams(new URLSearchParams('sort=title')).dir).toBe('asc');
    expect(viewFromParams(new URLSearchParams('dir=desc'))).toEqual(EMPTY_VIEW);
  });

  it('drops empty filters and empty values in a filter', () => {
    expect(viewFromParams(new URLSearchParams('f.status=&f.priority=high,,low')).filters).toEqual({ priority: ['high', 'low'] });
  });
});

describe('comparing views', () => {
  it('treats filter order, value order, padding and labels as the same view', () => {
    const a = view({ q: 'pump ', filters: { status: ['open', 'new'], priority: ['high'] }, labels: { x: 'A' } });
    const b = view({ q: 'pump', filters: { priority: ['high'], status: ['new', 'open'], site: [] } });
    expect(sameView(a, b)).toBe(true);
  });

  it('ignores the direction when nothing is sorted', () => {
    expect(sameView(view({ dir: 'desc' }), EMPTY_VIEW)).toBe(true);
    expect(sameView(view({ sort: 'title', dir: 'desc' }), view({ sort: 'title' }))).toBe(false);
  });

  it('tells different searches and filters apart', () => {
    expect(sameView(view({ q: 'a' }), view({ q: 'b' }))).toBe(false);
    expect(sameView(view({ filters: { status: ['new'] } }), view({ filters: { status: ['open'] } }))).toBe(false);
  });
});

describe('saved views kept in this browser', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('stores and loads the views of one record type', () => {
    storeViews('ticket', [{ name: 'Mine', view: view({ filters: { assignee_id: ['me'] } }) }]);
    expect(loadViews('ticket')).toEqual([{ name: 'Mine', view: view({ filters: { assignee_id: ['me'] } }) }]);
    expect(loadViews('risk')).toEqual([]);
  });

  it('fills in fields missing from an older saved view and drops malformed entries', () => {
    localStorage.setItem('grc.views.ticket', JSON.stringify([{ name: 'Old', view: { q: 'x' } }, { view: {} }, null, { name: 'No view' }]));
    expect(loadViews('ticket')).toEqual([{ name: 'Old', view: view({ q: 'x' }) }]);
  });

  it('copes with unreadable or missing storage', () => {
    localStorage.setItem('grc.views.ticket', '{not json');
    expect(loadViews('ticket')).toEqual([]);
    localStorage.setItem('grc.views.ticket', JSON.stringify({ name: 'not a list' }));
    expect(loadViews('ticket')).toEqual([]);
    vi.stubGlobal('localStorage', undefined);
    expect(loadViews('ticket')).toEqual([]);
    expect(() => storeViews('ticket', [])).not.toThrow();
  });
});
