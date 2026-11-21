// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GIZMO_META } from './componentMeta';
import { byLabel, byText, click, render, textOf, waitFor, type Harness } from './componentHarness';
import type { LifecycleMeta } from './lifecycle';
import type { Meta } from './meta';
import { ResourceList } from './ResourceList';

// E14-31: bulk edit of the status offers only the statuses every selected record may move to.
// Invented data only.

const metaWith = (lifecycle: LifecycleMeta): Meta => ({
  ...GIZMO_META,
  resources: { gizmo: { ...GIZMO_META.resources.gizmo, lifecycle } },
  lookups: { gizmo_status: [...GIZMO_META.lookups.gizmo_status, { value: 'retired', label: 'Retired', color: 'gray', sort: 30 }] },
});
const RULES: LifecycleMeta = { field: 'status', managed: false, blocked: [['open', 'retired'], ['in_repair', 'open']], required: {}, denied: [] };

const rows = [
  { id: '00000000-0000-4000-8000-000000000001', ref: 'GZ-00001', name: 'Fare gate 1', status: 'open', cost: 100 },
  { id: '00000000-0000-4000-8000-000000000002', ref: 'GZ-00002', name: 'Platform display 2', status: 'in_repair', cost: 200 },
  { id: '00000000-0000-4000-8000-000000000003', ref: 'GZ-00003', name: 'Fare gate 3', status: 'open', cost: 300 },
];
const list = () => ({ rows, total: rows.length, page: 1, pageSize: 25 });

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
/** The options of the listbox the given picker controls. */
const optionsOf = (input: HTMLElement | null) => {
  const box = input && document.getElementById(input.getAttribute('aria-controls') ?? '');
  return box ? [...box.querySelectorAll('[role="option"]')].map((o) => textOf(o)) : [];
};
/** Opens the New status picker and waits until it offers exactly `expected` (options can render in more than one pass). */
async function expectStatusOptions(expected: string[]): Promise<void> {
  await waitFor(() => expect(byLabel(dialog(), 'New status')).not.toBeNull());
  const input = byLabel(dialog(), 'New status');
  await click(input);
  await waitFor(() => expect(optionsOf(byLabel(dialog(), 'New status'))).toEqual(expected));
  expect(optionsOf(byLabel(dialog(), 'New status'))).toEqual(expected);
}
/** The bulk edit dialog: the last one open (one closing from an earlier test may still be in the document). */
const dialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;

/** Renders the list, selects the given references and opens bulk edit on the status. */
async function bulkEditStatus(meta: Meta, refs: string[]) {
  ui = await render(h(ResourceList, { type: 'gizmo', title: 'Gizmos', columns: ['ref', 'name', 'status'], bulkFields: ['status'] }),
    { meta, route: '/gizmos', handlers: { 'GET /api/gizmos': list } });
  await waitFor(() => expect(textOf(ui!.container.querySelector('table'))).toContain('GZ-00001'));
  for (const ref of refs) await click(ui.container.querySelector(`[aria-label="Select ${ref}"]`));
  await click(byText(ui.container, 'button', 'Edit selected'));
  await waitFor(() => expect(dialog()).not.toBeNull());
  await click(byLabel(dialog(), 'Field to change'));
  await waitFor(() => expect(optionsOf(byLabel(dialog(), 'Field to change'))).toContain('Status'));
  const fieldBox = document.getElementById(byLabel(dialog(), 'Field to change')?.getAttribute('aria-controls') ?? '');
  await click([...(fieldBox?.querySelectorAll('[role="option"]') ?? [])].find((o) => textOf(o) === 'Status'));
}

describe('bulk edit follows the lifecycle (E14-31)', () => {
  it('offers only the statuses allowed from the current status of every selected record', async () => {
    await bulkEditStatus(metaWith(RULES), ['GZ-00001', 'GZ-00002']);
    await expectStatusOptions(['In repair']);
  });

  it('offers the moves of records that share a status', async () => {
    await bulkEditStatus(metaWith(RULES), ['GZ-00001', 'GZ-00003']);
    await expectStatusOptions(['Open', 'In repair']);
  });

  it('says so plainly when no status can be given to all the selected records', async () => {
    await bulkEditStatus(metaWith({ ...RULES, denied: ['in_repair'] }), ['GZ-00001', 'GZ-00002']);
    await waitFor(() => expect(textOf(dialog())).toContain('No status can be given to all the selected gizmos'));
    expect(textOf(dialog())).toContain('(Open, In repair)');
    expect(byLabel(dialog(), 'New status')).toBeNull();
    const apply = byText(dialog(), 'button', 'Apply to 2 gizmos') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('offers every status when the record type has no rules', async () => {
    await bulkEditStatus(GIZMO_META, ['GZ-00001', 'GZ-00002']);
    await expectStatusOptions(['Open', 'In repair']);
  });
});
