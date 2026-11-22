// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { render, type Harness } from './componentHarness';
import { TableWrap } from './ui';

// E22-48: the scroll box around a table is a named Tab stop only while the table is wider (or
// taller) than the box. happy-dom has no layout, so each box states its sizes in data attributes.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const saved: Record<string, PropertyDescriptor | undefined> = {};
const size = (attr: string, fallback: number) => function (this: HTMLElement) { return Number(this.dataset[attr] ?? fallback); };
beforeAll(() => {
  for (const [prop, attr] of [['scrollWidth', 'sw'], ['clientWidth', 'cw'], ['scrollHeight', 'sh'], ['clientHeight', 'ch']] as const) {
    saved[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: size(attr, 100) });
  }
});
afterAll(() => {
  for (const [prop, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
});

const table = () => h('table', null, h('tbody', null, h('tr', null, h('td', null, 'Depot 3'))));
const box = (container: HTMLElement) => container.querySelector('.table-wrap') as HTMLElement;

describe('TableWrap', () => {
  it('is a named region in the tab order while the table is wider than the box', async () => {
    ui = await render(h(TableWrap, { label: 'Vehicles by depot', 'data-sw': '900', 'data-cw': '400' } as never, table()), { meta });
    const el = box(ui.container);
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Vehicles by depot');
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('also when the table is taller than a box with a height limit', async () => {
    ui = await render(h(TableWrap, { label: 'Report results', 'data-sh': '900', 'data-ch': '400' } as never, table()), { meta });
    expect(box(ui.container).getAttribute('tabindex')).toBe('0');
  });

  it('stays out of the tab order, unnamed, when the table fits', async () => {
    ui = await render(h(TableWrap, { label: 'Vehicles by depot' }, table()), { meta });
    const el = box(ui.container);
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
    expect(el.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps its own class and passes other attributes through', async () => {
    ui = await render(h(TableWrap, { label: 'Users', className: 'adm-table-frame', 'aria-busy': true }, table()), { meta });
    const el = box(ui.container);
    expect(el.className).toBe('table-wrap adm-table-frame');
    expect(el.getAttribute('aria-busy')).toBe('true');
  });
});
