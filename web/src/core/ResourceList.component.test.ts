// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { byText, click, render, textOf, typeInto, waitFor, type Call, type Harness } from './componentHarness';
import type { Meta } from './meta';
import { ResourceList } from './ResourceList';

// E18-43: the generic list in a browser-like document: what it asks the server for as filters,
// search and paging change, and what it shows. Invented data only.

const meta: Meta = {
  resources: {
    gizmo: {
      type: 'gizmo', label: 'Gizmo', plural: 'Gizmos', module: 'tickets', path: '/api/gizmos', route: '/gizmos',
      titleField: 'name', refField: 'ref', restricted: false,
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        status: { label: 'Status', type: 'lookup', list: 'gizmo_status' },
        cost: { label: 'Cost', type: 'currency' },
      },
    },
  },
  lookups: {
    gizmo_status: [
      { value: 'open', label: 'Open', color: 'blue', sort: 10 },
      { value: 'in_repair', label: 'In repair', color: 'amber', sort: 20 },
    ],
  },
};

/** 60 invented gizmos; the stand-in server filters by status and search and pages like the real one. */
const all = Array.from({ length: 60 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, ref: `GZ-${String(i + 1).padStart(5, '0')}`,
  name: `${i % 2 ? 'Fare gate' : 'Platform display'} ${i + 1}`, status: i % 3 ? 'open' : 'in_repair', cost: 100 + i,
}));
function list(call: Call) {
  const status = call.query.get('f.status')?.split(',');
  const q = (call.query.get('q') ?? '').toLowerCase();
  const rows = all.filter((r) => (!status || status.includes(r.status)) && (!q || r.name.toLowerCase().includes(q)));
  const page = Number(call.query.get('page') ?? 1);
  const size = Number(call.query.get('pageSize') ?? 25);
  return { rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageSize: size };
}

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const listCalls = () => ui!.calls.filter((c) => c.method === 'GET' && c.path === '/api/gizmos');
const lastList = () => listCalls().at(-1)!;
const tableText = () => textOf(ui!.container.querySelector('table'));

describe('generic list (E18-43)', () => {
  it('shows the first page and moves to the next one', async () => {
    ui = await render(h(ResourceList, { type: 'gizmo', title: 'Gizmos', columns: ['ref', 'name', 'status'], filters: ['status'] }),
      { meta, route: '/gizmos', handlers: { 'GET /api/gizmos': list } });
    await waitFor(() => expect(tableText()).toContain('GZ-00001'));
    expect(textOf(ui.container)).toContain('1–25 of 60 gizmos');
    expect(lastList().query.get('page')).toBe('1');
    expect(tableText()).not.toContain('GZ-00026');

    await click(ui.container.querySelector('[aria-label="Page 2"]'));
    await waitFor(() => expect(tableText()).toContain('GZ-00026'));
    expect(lastList().query.get('page')).toBe('2');
    expect(textOf(ui.container)).toContain('26–50 of 60 gizmos');
    // The page is kept in the address, so Back and a shared link return to it.
    expect(ui.location()).toContain('page=2');
  });

  it('applies a filter from the address, shows it as a pill, and removes it', async () => {
    ui = await render(h(ResourceList, { type: 'gizmo', title: 'Gizmos', columns: ['ref', 'name', 'status'], filters: ['status'] }),
      { meta, route: '/gizmos?f.status=in_repair', handlers: { 'GET /api/gizmos': list } });
    await waitFor(() => expect(textOf(ui!.container)).toContain('of 20 gizmos'));
    expect(lastList().query.get('f.status')).toBe('in_repair');
    const pills = ui.container.querySelector('[aria-label="Active filters"]');
    expect(textOf(pills)).toContain('Status: In repair');
    // Lookup values show their labels in the cells too.
    expect(tableText()).toContain('In repair');
    expect(tableText()).not.toMatch(/\bOpen\b/);

    await click(ui.container.querySelector('[aria-label="Remove filter Status: In repair"]'));
    await waitFor(() => expect(textOf(ui!.container)).toContain('of 60 gizmos'));
    expect(lastList().query.get('f.status')).toBeNull();
    expect(ui.location()).not.toContain('f.status');
  });

  it('searches after a pause and starts again from the first page', async () => {
    ui = await render(h(ResourceList, { type: 'gizmo', title: 'Gizmos', columns: ['ref', 'name'] }),
      { meta, route: '/gizmos?page=2', handlers: { 'GET /api/gizmos': list } });
    await waitFor(() => expect(tableText()).toContain('GZ-00026'));
    const box = ui.container.querySelector('input[type="search"], input[placeholder^="Search"]');
    await typeInto(box, 'fare gate');
    await waitFor(() => expect(lastList().query.get('q')).toBe('fare gate'));
    await waitFor(() => expect(textOf(ui!.container)).toContain('of 30 gizmos'));
    expect(lastList().query.get('page')).toBe('1');
    expect(byText(ui.container, '[aria-label="Active filters"]', 'Search')).not.toBeNull();
  });

  it('leaves out a column or filter the record type does not have (a switched-off option)', async () => {
    ui = await render(h(ResourceList, {
      type: 'gizmo', title: 'Gizmos', columns: ['ref', 'name', 'funder_interest'], filters: ['status', 'funder_interest'],
    }), { meta, route: '/gizmos', handlers: { 'GET /api/gizmos': list } });
    await waitFor(() => expect(tableText()).toContain('GZ-00001'));
    const headers = [...ui.container.querySelectorAll('thead th')].map((th) => textOf(th));
    expect(headers.join('|')).toContain('Name');
    expect(headers.join('|')).not.toMatch(/funder/i);
    // The Filters popover offers Status (and tags) but not the missing field.
    await click(byText(ui.container, 'button', 'Filters'));
    await waitFor(() => expect(textOf(document.body)).toContain('Status'));
    expect(textOf(document.body)).not.toMatch(/funder/i);
  });
});
