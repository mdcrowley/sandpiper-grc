import { describe, expect, it } from 'vitest';
import { boardQueryOf, filtersFromQuery, listViewOf, queryFromFilters } from './boardState';

describe('board views as shared list views (E07-25)', () => {
  it('turns board filters into outcome list filters and back', () => {
    const query = 'priority=1&status=partial,met&phase=now,none&fn=GV&owner=u-1&q=backup';
    const view = listViewOf(filtersFromQuery(query));
    expect(view).toEqual({
      q: 'backup', sort: '', dir: 'asc',
      filters: { priority: ['true'], status: ['partial', 'met'], phase: ['now', 'none'], function_code: ['GV'], owner_id: ['u-1'] },
    });
    expect(filtersFromQuery(boardQueryOf(view))).toEqual(filtersFromQuery(query));
  });

  it('keeps "no owner" and a list view saved on the table', () => {
    expect(listViewOf(filtersFromQuery('owner=none')).filters).toEqual({ 'owner_id.null': ['true'] });
    expect(boardQueryOf({ q: '', sort: 'code', dir: 'asc', filters: { 'owner_id.null': ['true'], 'phase.null': ['true'] } })).toBe(queryFromFilters(filtersFromQuery('phase=none&owner=none')));
    expect(boardQueryOf(listViewOf(filtersFromQuery('')))).toBe(queryFromFilters(filtersFromQuery('')));
  });
});
