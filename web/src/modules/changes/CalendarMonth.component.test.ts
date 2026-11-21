// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from '../../core/componentMeta';
import { render, textOf, waitFor, type Harness } from '../../core/componentHarness';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { CalendarMonth } = await import('./CalendarMonth');

// BW-09: a screen reader hears each day of the change calendar as a date people read, not ISO.
let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

describe('change calendar month', () => {
  it('names the week a day opens as "Oct 26, 2026"', async () => {
    const days = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
    ui = await render(h(CalendarMonth, { days, month: '2026-10-01', changes: [], blackouts: [], onOpenDay: () => undefined, canMove: false, onMove: async () => undefined } as never), { meta });
    await waitFor(() => expect(ui!.container.querySelectorAll('.sr-only').length).toBeGreaterThan(0));
    const spoken = [...ui.container.querySelectorAll('.sr-only')].map((e) => textOf(e)).join(' | ');
    expect(spoken).toContain('open the week of Oct 26, 2026');
    expect(spoken).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
