// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from '../../core/componentMeta';
import { byLabel, byText, click, render, textOf, typeInto, waitFor, type Harness } from '../../core/componentHarness';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { DepartmentsCard } = await import('./Departments');

// E22-14, the pattern for a form dialog: a hand-written dialog holding typed input passes `dirty`, so
// Escape (and ×, and a click outside) asks before the draft is discarded, while an untouched dialog
// closes at once. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const page = () => document.body;
const prompt = () => byText(page(), '.ui-sheet', 'Discard this draft?');
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const dialogOpen = () => byLabel(page(), 'Name') !== null;

describe('a form dialog asks before discarding a draft (E22-14)', () => {
  it('closes at once when nothing was typed, and asks when something was', async () => {
    ui = await render(h(DepartmentsCard), {
      meta, handlers: { 'GET /api/admin/departments': () => [{ id: 'd1', name: 'Rail operations', members: 4 }] },
    });
    await waitFor(() => expect(byText(ui!.container, 'td', 'Rail operations')).not.toBeNull());

    await click(byText(ui.container, 'button', 'Add department'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    escape();
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(prompt()).toBeNull();

    await click(byText(ui.container, 'button', 'Add department'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    await typeInto(byLabel(page(), 'Name'), 'Paratransit scheduling');
    escape();
    await waitFor(() => expect(prompt()).not.toBeNull());
    await click(byText(page(), 'button', 'Keep editing'));
    await waitFor(() => expect(prompt()).toBeNull());
    expect((byLabel(page(), 'Name') as HTMLInputElement).value).toBe('Paratransit scheduling');
    escape();
    await waitFor(() => expect(prompt()).not.toBeNull());
    await click(byText(page(), 'button', 'Discard'));
    await waitFor(() => expect(dialogOpen()).toBe(false));
  });

  it('counts a rename as a draft only once the name differs from the one it opened with', async () => {
    ui = await render(h(DepartmentsCard), {
      meta, handlers: { 'GET /api/admin/departments': () => [{ id: 'd1', name: 'Rail operations', members: 4 }] },
    });
    await waitFor(() => expect(byText(ui!.container, 'button', 'Rename')).not.toBeNull());
    await click(byText(ui.container, 'button', 'Rename'));
    await waitFor(() => expect(dialogOpen()).toBe(true));
    expect(textOf(byText(page(), '.ui-sheet', 'Rename department'))).toContain('Rename department');
    escape();
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(prompt()).toBeNull();
  });
});
