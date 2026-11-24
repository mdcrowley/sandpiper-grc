// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { render, waitFor, type Harness } from './componentHarness';
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

// E18-65: a hand-written table in <TableWrap fit> leaves out lower-priority columns while it is too
// wide, like the shared lists. Each heading states its natural width in data-w (no layout here).
describe('TableWrap fit', () => {
  let rect: PropertyDescriptor | undefined;
  beforeAll(() => {
    rect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) { const w = Number(this.dataset?.w ?? 0); return { width: w, height: 20, top: 0, left: 0, right: w, bottom: 20, x: 0, y: 0, toJSON() {} }; },
    });
  });
  afterAll(() => { if (rect) Object.defineProperty(Element.prototype, 'getBoundingClientRect', rect); });

  const th = (text: string, w: number, priority?: number) => h('th', { key: text, 'data-w': w, 'data-priority': priority }, text);
  const wide = () => h('table', null,
    h('thead', null, h('tr', null, th('Class', 200), th('Rates', 80, 3), th('In use', 70), th('Past useful life', 120, 1), th('Target', 80))),
    h('tbody', null, h('tr', null, ['Bus', 'Vehicles', '40', '5', '8%'].map((t) => h('td', { key: t }, t)))));
  const hidden = (container: HTMLElement) => container.querySelector('table')?.getAttribute('data-fit-hide') ?? '';

  it('leaves out priority 3 columns, then the rightmost priority 2, while the table is too wide', async () => {
    ui = await render(h(TableWrap, { label: 'Classes', fit: true, 'data-cw': '420' } as never, wide()), { meta });
    await waitFor(() => expect(hidden(ui!.container)).toBe('2 5'));
  });

  it('keeps every column when the table fits', async () => {
    ui = await render(h(TableWrap, { label: 'Classes', fit: true, 'data-cw': '1000' } as never, wide()), { meta });
    await waitFor(() => expect(ui!.container.querySelector('table')).not.toBeNull());
    expect(ui.container.querySelector('table')?.hasAttribute('data-fit-hide')).toBe(false);
  });

  it('does nothing without fit', async () => {
    ui = await render(h(TableWrap, { label: 'Classes', 'data-cw': '200' } as never, wide()), { meta });
    expect(ui.container.querySelector('table')?.hasAttribute('data-fit-hide')).toBe(false);
  });
});
