// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { byText, click, render, textOf, waitFor, type Harness } from './componentHarness';
import { RecordPage } from './RecordPage';

// The build's list of web modules comes from a Vite plugin (vite.config.ts) that the test runner does
// not load; the record page's lazily loaded panels (files, approvals) reach it through the core
// index. No modules are needed here.
vi.mock('./module', () => ({
  MODULE_AREA: {}, moduleOn: () => true, NAV_GROUPS: [], modules: [], routePaths: [],
  preloadRoute: () => {}, loadModule: async () => undefined,
}));

// E18-43: the generic record page in a browser-like document: its tabs, the tab kept in the page
// address, and summary fields the record type does not have. Invented data only.

const ID = '00000000-0000-4000-8000-000000000007';
const row = {
  id: ID, ref: 'GZ-00007', name: 'Platform display 7', status: 'in_repair', cost: 1200, notes: 'Left side of the platform.',
  cf_depot: 'North yard', created_at: '2026-11-02T14:00:00Z', updated_at: '2026-11-03T15:00:00Z', _display: {},
};
const history = [{
  id: 1, at: '2026-11-03T15:00:00Z', actor_name: 'Pat Example', action: 'gizmo.update', summary: 'Gizmo updated: GZ-00007 Platform display 7 (Status)',
  before: { status: 'open' }, after: { status: 'in_repair' },
}];

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const tabs = () => [...ui!.container.querySelectorAll('[role="tab"]')].map((t) => textOf(t).replace(/\s*\d+$/, ''));
const selected = () => textOf(ui!.container.querySelector('[role="tab"][aria-selected="true"]')).replace(/\s*\d+$/, '');
/** The panel of the selected tab. */
const panel = () => {
  const tab = ui!.container.querySelector('[role="tab"][aria-selected="true"]');
  return textOf(tab && ui!.container.ownerDocument.getElementById(tab.getAttribute('aria-controls') ?? ''));
};

function page(route = `/gizmos/${ID}`) {
  return render(h(RecordPage, {
    type: 'gizmo',
    summaryFields: ['status', 'cost', 'funder_interest'],
    tabs: [{ key: 'parts', label: 'Parts', count: 2, content: () => h('p', null, 'Two spare panels on the shelf.') }],
    defaultTabs: ['activity', 'history'],
  }), {
    meta, route, routePattern: '/gizmos/:id',
    handlers: { [`GET /api/gizmos/${ID}`]: () => row, 'GET /api/history': () => history },
  });
}

describe('generic record page (E18-43)', () => {
  it('shows the record with its module tabs first, then the built-in ones', async () => {
    ui = await page();
    await waitFor(() => expect(textOf(ui!.container)).toContain('Platform display 7'));
    await waitFor(() => expect(tabs()).toEqual(['Parts', 'Activity', 'History']));
    expect(selected()).toBe('Parts');
    expect(panel()).toContain('Two spare panels on the shelf.');
  });

  it('moves to another tab, keeps it in the address, and opens on it again', async () => {
    ui = await page();
    await waitFor(() => expect(tabs()).toContain('History'));
    await click(byText(ui.container, '[role="tab"]', 'History'));
    await waitFor(() => expect(selected()).toBe('History'));
    expect(ui.location()).toContain('tab=history');
    await waitFor(() => expect(panel()).toContain('Pat Example'));
    expect(ui.calls.some((c) => c.path === '/api/history' && c.query.get('record_id') === ID)).toBe(true);
    ui.unmount();

    ui = await page(`/gizmos/${ID}?tab=history`);
    await waitFor(() => expect(selected()).toBe('History'));
  });

  it('shows the summary fields the record type has, its custom fields, and not a field it lacks', async () => {
    ui = await page();
    await waitFor(() => expect(textOf(ui!.container)).toContain('In repair'));
    const text = textOf(ui.container);
    expect(text).toContain('Status');
    expect(text).toContain('North yard');
    expect(text).not.toMatch(/funder/i);
  });
});
