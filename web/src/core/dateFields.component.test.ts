// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { render, textOf, waitFor, type Harness } from './componentHarness';
import { DateTimeFieldImpl } from './dateFields';

// E18-65: a date and time field names the organization's time zone in everyday words, like the
// portal does, not by its identifier ("America/New_York").

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

describe('DateTimeField time zone hint', () => {
  it('shows the friendly name of the zone', async () => {
    // The stand-in server says the organization is on America/New_York.
    ui = await render(h(DateTimeFieldImpl, { label: 'Starts', value: '', onChange: () => {} }), { meta });
    await waitFor(() => expect(textOf(ui!.container)).toMatch(/Time zone: Eastern (Standard|Daylight) Time/));
    expect(textOf(ui.container)).not.toContain('America');
  });

  it('keeps a hint the page gives', async () => {
    ui = await render(h(DateTimeFieldImpl, { label: 'Starts', value: '', onChange: () => {}, hint: 'When the work begins' }), { meta });
    await waitFor(() => expect(textOf(ui!.container)).toContain('When the work begins'));
    expect(textOf(ui.container)).not.toContain('Time zone:');
  });
});
