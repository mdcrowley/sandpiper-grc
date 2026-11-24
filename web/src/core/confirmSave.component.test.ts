// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { byLabel, byText, click, render, textOf, typeInto, waitFor, type Harness } from './componentHarness';
import { EditableSummary } from './RecordPage';
import { ResourceForm } from './ResourceForm';

// E39: a form that asks before it saves (a vehicle model shows how many vehicles a change reaches),
// and notes beside values in a summary ("From model ..."). Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const posts = () => ui!.calls.filter((c) => c.method === 'POST' && c.path === '/api/gizmos');

describe('asking before a save (E39-03)', () => {
  it('sends nothing when the answer is no, and saves when it is yes', async () => {
    const saved = vi.fn();
    let answer = false;
    const confirmSave = vi.fn(async () => answer);
    ui = await render(h(ResourceForm, { type: 'gizmo', fields: ['name'], customFields: false, onSaved: saved, confirmSave }), {
      meta, handlers: { 'POST /api/gizmos': (c) => ({ id: 'new-id', ...(c.body as object) }) },
    });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await typeInto(byLabel(ui.container, 'Name'), 'Invented ticket machine');
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(confirmSave).toHaveBeenCalledWith({ name: 'Invented ticket machine' }));
    expect(posts()).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
    answer = true;
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ id: 'new-id', name: 'Invented ticket machine' }));
    expect(posts()).toHaveLength(1);
  });
});

describe('notes beside summary values (E39-02)', () => {
  it('shows what annotate gives after a field\'s value', async () => {
    const row = { id: 'g1', name: 'Invented validator', status: 'open', _display: {} };
    ui = await render(h(EditableSummary, { type: 'gizmo', row, fields: ['name', 'status'], annotate: (f: string) => (f === 'name' ? h('span', { className: 'note' }, 'From model Invented V7') : null) }), { meta });
    await waitFor(() => expect(textOf(ui!.container)).toContain('Invented validator'));
    expect(textOf(ui.container.querySelector('.note'))).toBe('From model Invented V7');
    expect(ui.container.querySelectorAll('.note')).toHaveLength(1);
  });
});
