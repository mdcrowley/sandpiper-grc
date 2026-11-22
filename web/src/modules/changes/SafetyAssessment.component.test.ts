// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIZMO_META } from '../../core/componentMeta';
import { byLabel, byText, click, render, typeInto, waitFor, type Harness } from '../../core/componentHarness';
import type { Meta } from '../../core/meta';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { SafetyAssessment } = await import('./SafetyAssessment');

// E22-14, the pattern for a picker dialog: once something is picked the dialog holds a draft, so
// Escape asks before discarding it; with nothing picked it closes at once. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
// happy-dom has no font loading; Mantine's growing text boxes listen for it.
beforeAll(() => {
  const doc = document as unknown as { fonts?: unknown };
  if (!doc.fonts) doc.fonts = { addEventListener: () => undefined, removeEventListener: () => undefined };
});

const META: Meta = {
  ...GIZMO_META,
  resources: {
    ...GIZMO_META.resources,
    change: {
      type: 'change', label: 'Change', plural: 'Changes', module: 'changes', path: '/api/changes', route: '/changes',
      titleField: 'title', refField: 'ref', restricted: false,
      fields: { title: { label: 'Title', type: 'text', required: true }, safety_impact: { label: 'Affects safety', type: 'boolean' } },
    },
    hazard: {
      type: 'hazard', label: 'Hazard', plural: 'Hazards', module: 'safety', path: '/api/hazards', route: '/safety/hazards',
      titleField: 'title', refField: 'ref', restricted: false, fields: { title: { label: 'Hazard', type: 'text', required: true } },
    },
  },
};

const ROW = { id: 'c1', ref: 'CHG-00001', title: 'Replace the depot radio console', status: 'draft', safety_impact: true, updated_at: '2026-11-01T10:00:00Z', _display: {} };
const page = () => document.body;
const prompt = () => byText(page(), '.ui-sheet', 'Discard this draft?');
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const picker = () => byLabel(page(), 'Hazard');

describe('a picker dialog asks before discarding a pick (E22-14)', () => {
  it('closes at once with nothing picked, and asks once a hazard is picked', async () => {
    ui = await render(h(SafetyAssessment, { row: ROW, canEdit: true, onChanged: () => undefined }), {
      meta: META,
      handlers: {
        'GET /api/changes/c1/safety-assessment': () => ({ available: true, safety_impact: true, required: true, count: 0, hazards: [] }),
        'GET /api/records/lookup': () => [{ id: 'hz1', label: 'HAZ-00007 Platform edge gap at the north station' }],
      },
    });
    await waitFor(() => expect(byText(ui!.container, 'button', 'Link a hazard')).not.toBeNull());

    await click(byText(ui.container, 'button', 'Link a hazard'));
    await waitFor(() => expect(picker()).not.toBeNull());
    escape();
    await waitFor(() => expect(picker()).toBeNull());
    expect(prompt()).toBeNull();

    await click(byText(ui.container, 'button', 'Link a hazard'));
    await waitFor(() => expect(picker()).not.toBeNull());
    await typeInto(picker(), 'platform');
    await waitFor(() => expect(byText(page(), '[role="option"]', 'Platform edge gap')).not.toBeNull());
    await click(byText(page(), '[role="option"]', 'Platform edge gap'));
    await waitFor(() => expect((picker() as HTMLInputElement).value).toContain('Platform edge gap'));
    escape();
    await waitFor(() => expect(prompt()).not.toBeNull());
    await click(byText(page(), 'button', 'Keep editing'));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(picker()).not.toBeNull();
    escape();
    await waitFor(() => expect(prompt()).not.toBeNull());
    await click(byText(page(), 'button', 'Discard'));
    await waitFor(() => expect(picker()).toBeNull());
  });
});
