// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from '../../core/componentMeta';
import { byLabel, byText, click, render, typeInto, waitFor, type Harness } from '../../core/componentHarness';

vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { ListsPage } = await import('./Lists');

// Wave 15: Administration > Lists names each list (never its key) and edits the settings a list keeps
// on its values, here how a business impact analysis question is answered. Saving a value keeps the
// other settings the application stores beside it. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const rows = [
  { id: 'q1', list_key: 'bia_question', value: 'staff_needed', label: 'How many staff keep the workaround going?', color: 'gray', sort: 10, active: true, meta: { kind: 'number', note: 'kept' } },
];

describe('Administration > Lists', () => {
  it('names the list, shows a value\'s setting and keeps its other settings when saved', async () => {
    ui = await render(h(ListsPage), {
      meta, route: '/admin/lists?list=bia_question',
      handlers: {
        'GET /api/lookups': () => [{ list_key: 'bia_question', count: 1 }, { list_key: 'kb_category', count: 3 }],
        'GET /api/lookups/bia_question': () => rows,
        'PATCH /api/lookups/q1': (call) => ({ ...rows[0], ...(call.body as object) }),
      },
    });
    await waitFor(() => expect(byText(ui!.container, '.card-title', 'Business impact analysis question')).not.toBeNull());
    expect(byText(ui.container, '.adm-list-nav button', 'Knowledge article category')).not.toBeNull();
    expect(byText(ui.container, '.adm-list-nav button', 'Kb category')).toBeNull();
    expect(byText(ui.container, 'th', 'Answered as')).not.toBeNull();
    expect(byText(ui.container, 'td', 'A number')).not.toBeNull();

    await click(byText(ui.container, 'button', 'Edit'));
    await waitFor(() => expect(byLabel(document.body, 'Answered as')).not.toBeNull());
    await typeInto(byLabel(document.body, 'Shown as'), 'How many people keep the workaround going?');
    await click(byText(document.body, 'button', 'Save value'));
    await waitFor(() => expect(ui!.calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = ui.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({ label: 'How many people keep the workaround going?', meta: { kind: 'number', note: 'kept' } });
  });
});
