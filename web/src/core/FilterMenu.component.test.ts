// @vitest-environment happy-dom
import { act, createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { click, render, textOf, typeInto, waitFor, type Harness } from './componentHarness';
import { FilterMenu } from './overlay';

// E18-65: the Create menu has a filter box: focus starts in it, typing narrows the entries, the arrow
// keys still move through them, and a filter that matches nothing says so.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const items = [
  { label: 'Ticket', icon: 'ticket' as const, to: '/tickets?new=1', group: 'Service desk' },
  { label: 'Knowledge article', icon: 'book' as const, to: '/knowledge?new=1', group: 'Service desk' },
  { label: 'Safety event', icon: 'alert' as const, to: '/safety/events?new=1', group: 'Safety' },
  { label: 'Hazard', icon: 'alert' as const, to: '/safety/hazards?new=1', group: 'Safety' },
];

const box = () => document.querySelector<HTMLInputElement>('input[aria-label="Filter what to create"]');
const entries = () => [...document.querySelectorAll<HTMLElement>('[role=menuitem]')];
const key = (el: Element | null, k: string) => act(async () => { el?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });

async function open() {
  ui = await render(h(FilterMenu, { label: 'Create', icon: 'plus', items, filterLabel: 'Filter what to create' }), { meta });
  await click(ui.container.querySelector('button'));
  await waitFor(() => expect(box()).not.toBeNull());
}

describe('FilterMenu (the Create menu)', () => {
  it('opens with every entry under its group heading and focus in the filter box', async () => {
    await open();
    expect(entries().map(textOf)).toEqual(['Ticket', 'Knowledge article', 'Safety event', 'Hazard']);
    const groups = [...document.querySelectorAll('[role=menu] [role=group]')];
    expect(groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent)).toEqual(['Service desk', 'Safety']);
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it('narrows the entries as you type, by label or group, and says when nothing matches', async () => {
    await open();
    await typeInto(box(), 'saf');
    expect(entries().map(textOf)).toEqual(['Safety event', 'Hazard']);
    await typeInto(box(), 'art');
    expect(entries().map(textOf)).toEqual(['Knowledge article']);
    expect(textOf(document.querySelector('[role=status]'))).toBe('1 choice');
    await typeInto(box(), 'zebra');
    expect(entries()).toHaveLength(0);
    expect(textOf(document.querySelector('.ui-fmenu-empty'))).toBe('No match for “zebra”');
    expect(textOf(document.querySelector('[role=status]'))).toBe('No match');
  });

  it('moves with the arrow keys from the box into the entries and back', async () => {
    await open();
    await key(box(), 'ArrowDown');
    expect(document.activeElement).toBe(entries()[0]);
    await key(entries()[0], 'ArrowDown');
    expect(document.activeElement).toBe(entries()[1]);
    await key(entries()[1], 'End');
    expect(document.activeElement).toBe(entries()[3]);
    await key(entries()[3], 'ArrowDown');
    expect(document.activeElement).toBe(entries()[0]);
    await key(entries()[0], 'ArrowUp');
    expect(document.activeElement).toBe(box());
    await key(box(), 'ArrowUp');
    expect(document.activeElement).toBe(entries()[3]);
  });

  it('opens the first match with Enter in the box', async () => {
    await open();
    await typeInto(box(), 'hazard');
    await key(box(), 'Enter');
    await waitFor(() => expect(ui!.location()).toBe('/safety/hazards?new=1'));
  });
});
