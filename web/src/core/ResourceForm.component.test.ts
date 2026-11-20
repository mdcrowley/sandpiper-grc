// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { byLabel, byText, click, render, reply, textOf, typeInto, waitFor, type Harness } from './componentHarness';
import { ResourceForm } from './ResourceForm';

// E18-43: the generic form in a browser-like document: messages beside the fields they are about,
// what it sends, and fields the record type does not have. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

/** The form cell of one field, and the message shown in it. */
const cell = (field: string) => ui!.container.querySelector(`[data-field="${field}"]`);
const posts = () => ui!.calls.filter((c) => c.method === 'POST' && c.path === '/api/gizmos');

describe('generic form (E18-43)', () => {
  it('says beside the field that a required value is missing, without calling the server', async () => {
    ui = await render(h(ResourceForm, { type: 'gizmo', fields: ['name', 'status'], onSaved: vi.fn() }), { meta });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(textOf(cell('name'))).toContain('Name is required.'));
    expect(cell('name')!.getAttribute('data-invalid-field')).toBe('true');
    expect(cell('status')!.getAttribute('data-invalid-field')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it('puts the server\'s field messages beside their fields, and other problems above the form', async () => {
    const saved = vi.fn();
    ui = await render(h(ResourceForm, { type: 'gizmo', fields: ['name', 'cost'], onSaved: saved }), {
      meta,
      handlers: {
        'POST /api/gizmos': () => reply(400, {
          error: { code: 'validation', message: 'Check the highlighted fields.', fields: { cost: 'Cost must be a number.', parent_id: 'Parent was not found.' } },
        }),
      },
    });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await typeInto(byLabel(ui.container, 'Name'), 'Fare gate 7');
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(textOf(cell('cost'))).toContain('Cost must be a number.'));
    expect(posts()[0].body).toEqual({ name: 'Fare gate 7' });
    // A message about a field the form does not show goes in the alert above the form.
    const alert = ui.container.querySelector('[role="alert"].rc-form-error');
    expect(textOf(alert)).toContain('Parent was not found.');
    expect(textOf(cell('name'))).not.toContain('required');
    expect(saved).not.toHaveBeenCalled();
  });

  it('saves and hands back the new record', async () => {
    const saved = vi.fn();
    ui = await render(h(ResourceForm, { type: 'gizmo', fields: ['name'], customFields: false, onSaved: saved }), {
      meta, handlers: { 'POST /api/gizmos': (c) => ({ id: 'new-id', ...(c.body as object) }) },
    });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await typeInto(byLabel(ui.container, 'Name'), 'Platform display 3');
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ id: 'new-id', name: 'Platform display 3' }));
  });

  it('leaves out a field the record type does not have, and adds its custom fields under their section', async () => {
    ui = await render(h(ResourceForm, { type: 'gizmo', fields: ['name', 'funder_interest', 'status'], onSaved: vi.fn() }), { meta });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    expect(cell('funder_interest')).toBeNull();
    expect(textOf(ui.container)).not.toMatch(/funder/i);
    expect(cell('cf_depot')).not.toBeNull();
    expect(textOf(ui.container.querySelector('legend'))).toBe('Where it is');
  });
});
