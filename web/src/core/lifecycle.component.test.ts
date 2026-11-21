// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META } from './componentMeta';
import { byLabel, byText, click, render, textOf, waitFor, type Harness } from './componentHarness';
import type { Meta } from './meta';
import { ResourceForm } from './ResourceForm';

// E14-31: the generic form follows the record type's lifecycle from /api/meta. Invented data only.

const meta: Meta = {
  ...GIZMO_META,
  resources: {
    gizmo: {
      ...GIZMO_META.resources.gizmo,
      lifecycle: { field: 'status', managed: false, blocked: [['open', 'retired']], required: { in_repair: ['cost'] }, denied: [] },
    },
  },
  lookups: {
    gizmo_status: [...GIZMO_META.lookups.gizmo_status, { value: 'retired', label: 'Retired', color: 'gray', sort: 30 }],
  },
};

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const cell = (field: string) => ui!.container.querySelector(`[data-field="${field}"]`);
const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => textOf(o));

describe('the form follows the lifecycle (E14-31)', () => {
  it('offers only the statuses the record may move to', async () => {
    ui = await render(h(ResourceForm, { type: 'gizmo', id: 'g1', fields: ['name', 'status', 'cost'], initial: { name: 'Fare gate 7', status: 'open' }, onSaved: vi.fn() }), { meta });
    await waitFor(() => expect(byLabel(ui!.container, 'Status')).not.toBeNull());
    await click(byLabel(ui.container, 'Status'));
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(options()).toEqual(['Open', 'In repair']);
  });

  it('marks the fields the chosen status needs as required on a new record and says so without calling the server', async () => {
    ui = await render(h(ResourceForm, { type: 'gizmo', fields: ['name', 'status', 'cost'], initial: { name: 'Fare gate 7', status: 'in_repair' }, onSaved: vi.fn() }), { meta });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(textOf(cell('cost'))).toContain('Cost is required.'));
    expect(ui.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});
