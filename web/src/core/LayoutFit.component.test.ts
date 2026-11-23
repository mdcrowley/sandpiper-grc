// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { byText, click, render, textOf, waitFor, type Call, type Harness } from './componentHarness';
import { Menu } from './overlay';
import { RecordPage } from './RecordPage';
import { ResourceList } from './ResourceList';
import { Button, PageHeader, Tabs } from './ui';

vi.mock('./module', () => ({
  MODULE_AREA: {}, moduleOn: () => true, NAV_GROUPS: [], modules: [], routePaths: [],
  preloadRoute: () => {}, loadModule: async () => undefined,
}));

// E18-63: lists leave out lower-priority columns when the page is narrow, tab strips put the tabs that
// do not fit into a More menu, and header buttons keep one order. happy-dom has no layout, so the
// widths are stated here: every tab 100 px, the More button 80, every column 200 (the check box
// column 40); the tab strip is 350 px wide and the table box 700.

const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  saved.rect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
  saved.clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const width = this.getAttribute('role') === 'tab' ? 100
        : this.classList.contains('ui-tabs-more') ? 80
          : this.tagName === 'TH' ? (this.dataset.field ? 200 : 40) : 0;
      return { x: 0, y: 0, top: 0, left: 0, bottom: 20, right: width, width, height: 20, toJSON: () => ({}) };
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('ui-tabbar') ? 350 : this.classList.contains('rc-table-wrap') ? 700 : 0;
    },
  });
});
afterAll(() => {
  for (const [prop, d] of Object.entries({ getBoundingClientRect: saved.rect, clientWidth: saved.clientWidth })) {
    if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
  }
});

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const tabNames = () => [...ui!.container.querySelectorAll('[role="tab"]')].map((t) => textOf(t));

describe('tab strip (E18-63)', () => {
  const five = ['Overview', 'Contracts', 'Systems', 'Reviews', 'Reports'].map((label) => ({ key: label.toLowerCase(), label, content: `${label} panel` }));

  it('puts the tabs that do not fit into a More menu', async () => {
    ui = await render(h(Tabs, { label: 'Vendor sections', tabs: five }), { meta });
    // 350 - 80 for More leaves room for two 100 px tabs.
    await waitFor(() => expect(tabNames()).toEqual(['Overview', 'Contracts']));
    const more = byText(ui.container, 'button', 'More');
    expect(more).not.toBeNull();
    expect(textOf(more)).toContain('vendor sections: 3');
    // The strip itself is still a tab list of real tabs; More is outside it.
    expect(ui.container.querySelector('[role="tablist"]')?.contains(more)).toBe(false);
  });

  it('keeps the active tab in the strip and opens a tab from the More menu', async () => {
    let chosen = '';
    ui = await render(h(Tabs, { label: 'Vendor sections', tabs: five, active: 'reviews', onChange: (k: string) => { chosen = k; } }), { meta });
    await waitFor(() => expect(tabNames()).toEqual(['Overview', 'Reviews']));
    expect(ui.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Reviews');

    await click(byText(ui.container, 'button', 'More'));
    const doc = ui.container.ownerDocument;
    await waitFor(() => expect(byText(doc.body, '[role="menuitem"]', 'Reports')).not.toBeNull());
    expect([...doc.querySelectorAll('[role="menuitem"]')].map((m) => textOf(m))).toEqual(['Contracts', 'Systems', 'Reports']);
    await click(byText(doc.body, '[role="menuitem"]', 'Reports'));
    expect(chosen).toBe('reports');
  });

  it('shows every tab when they fit', async () => {
    ui = await render(h(Tabs, { label: 'Few', tabs: five.slice(0, 3) }), { meta });
    await waitFor(() => expect(tabNames()).toEqual(['Overview', 'Contracts', 'Systems']));
    expect(byText(ui.container, 'button', 'More')).toBeNull();
  });
});

describe('page header order (E18-63)', () => {
  const buttons = () => [...ui!.container.querySelectorAll('.page-actions button')].map((b) => b.getAttribute('aria-label') ?? textOf(b));

  it('on a record page: the primary button first and the "⋯" menu last, whatever order they are given in', async () => {
    const ID = '00000000-0000-4000-8000-000000000007';
    ui = await render(h(RecordPage, {
      type: 'gizmo',
      defaultTabs: [],
      actions: () => [
        h(Menu, { key: 'm', label: 'More actions', icon: 'more', iconOnly: true, items: [{ label: 'Archive' }] }),
        h(Button, { key: 's' }, 'Assign'),
        h(Button, { key: 'p', variant: 'primary' }, 'Start repair'),
      ],
    }), {
      meta, route: `/gizmos/${ID}`, routePattern: '/gizmos/:id',
      handlers: { [`GET /api/gizmos/${ID}`]: () => ({ id: ID, ref: 'GZ-00007', name: 'Platform display 7', status: 'open', _display: {} }) },
    });
    await waitFor(() => expect(buttons()[0]).toBe('Start repair'));
    const order = buttons();
    expect(order.indexOf('Assign')).toBeGreaterThan(0);
    expect(order.at(-1)).toBe('More actions');
  });

  it('elsewhere: buttons keep their given order, with the "⋯" menu last', async () => {
    ui = await render(h(PageHeader, {
      title: 'Gizmos',
      actions: [
        h(Menu, { key: 'm', label: 'More actions', iconOnly: true, items: [{ label: 'Archive' }] }),
        h(Button, { key: 'i' }, 'Import'),
        h(Button, { key: 'n', variant: 'primary' }, 'New gizmo'),
      ],
    }), { meta });
    await waitFor(() => expect(buttons()).toEqual(['Import', 'New gizmo', 'More actions']));
  });
});

describe('list columns by priority (E18-63)', () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, ref: `GZ-0000${i + 1}`, name: `Fare gate ${i + 1}`,
    status: 'open', cost: 100 + i, notes: 'Spare in the store', cf_depot: 'North yard',
  }));
  const list = (call: Call) => ({ rows, total: rows.length, page: 1, pageSize: Number(call.query.get('pageSize') ?? 25) });
  const headers = () => [...ui!.container.querySelectorAll('thead th[data-field]')].map((th) => textOf(th));

  it('leaves out the lowest-priority columns, rightmost first, and offers them in the column chooser', async () => {
    // Five 200 px columns and a 40 px check box column in a 700 px box: two columns give way.
    ui = await render(h(ResourceList, {
      type: 'gizmo', title: 'Gizmos', filters: ['status'],
      columns: ['ref', 'name', { field: 'notes', priority: 3 }, 'cost', 'status'],
    }), { meta, route: '/gizmos', handlers: { 'GET /api/gizmos': list } });
    await waitFor(() => expect(headers()).toEqual(['Reference', 'Name', 'Status']));

    await click(ui.container.querySelector('[aria-label="Choose columns"]'));
    const doc = ui.container.ownerDocument;
    await waitFor(() => expect(byText(doc.body, '.mantine-Checkbox-root', 'Notes')).not.toBeNull());
    const box = (label: string) => byText(doc.body, '.mantine-Checkbox-root', label)!;
    expect(textOf(box('Notes'))).toContain('Hidden to fit this width');
    expect((box('Notes').querySelector('input') as HTMLInputElement).checked).toBe(false);
    expect((box('Status').querySelector('input') as HTMLInputElement).checked).toBe(true);

    // Checking a left-out column keeps it on, however narrow the page (the table then scrolls sideways).
    await click(box('Cost').querySelector('input'));
    await waitFor(() => expect(headers()).toContain('Cost'));
    expect(headers()).toEqual(['Reference', 'Name', 'Cost', 'Status']);
  });
});
