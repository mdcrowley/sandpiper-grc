import { describe, expect, it } from 'vitest';
import { fitColumns, fitTabs, type FitColumn } from './fit';

const col = (field: string, priority: 1 | 2 | 3, width: number): FitColumn => ({ field, priority, width });

describe('fitColumns', () => {
  const cols = [col('ref', 1, 100), col('title', 1, 300), col('status', 1, 120), col('owner', 2, 150), col('due', 2, 130), col('notes', 3, 200)];

  it('keeps every column when they fit', () => {
    expect(fitColumns(cols, 1000)).toEqual([]);
    expect(fitColumns(cols, 0)).toEqual([]);
  });

  it('drops priority 3 first, then the rightmost priority 2', () => {
    expect(fitColumns(cols, 900)).toEqual(['notes']);
    expect(fitColumns(cols, 800)).toEqual(['notes']);
    expect(fitColumns(cols, 799)).toEqual(['notes', 'due']);
    expect(fitColumns(cols, 600)).toEqual(['notes', 'due', 'owner']);
  });

  it('never drops priority 1 columns, even when they alone are too wide', () => {
    expect(fitColumns(cols, 300)).toEqual(['notes', 'due', 'owner']);
  });

  it('counts the fixed width of the selection column', () => {
    expect(fitColumns(cols, 1000, 40)).toEqual(['notes']);
  });

  it('treats unmeasured columns as taking no room', () => {
    expect(fitColumns([col('a', 1, 0), col('b', 2, 0)], 10)).toEqual([]);
  });
});

describe('fitTabs', () => {
  const widths = [100, 120, 90, 150, 110];

  it('shows every tab when they fit', () => {
    expect(fitTabs(widths, 600, 80, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(fitTabs(widths, 0, 80, 0)).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps room for the More button', () => {
    // 400 - 80 = 320 of room: tabs 0, 1 and 2 (310).
    expect(fitTabs(widths, 400, 80, 0)).toEqual([0, 1, 2]);
  });

  it('keeps the active tab in view, in place of the last ones that fit', () => {
    expect(fitTabs(widths, 400, 80, 3)).toEqual([0, 3]);
    expect(fitTabs(widths, 400, 80, 4)).toEqual([0, 4]);
    expect(fitTabs(widths, 420, 80, 4)).toEqual([0, 1, 4]);
  });

  it('shows at least the active tab when nothing fits', () => {
    expect(fitTabs(widths, 100, 80, 2)).toEqual([2]);
    expect(fitTabs(widths, 100, 80, -1)).toEqual([0]);
  });

  it('draws unmeasured tabs so they can be measured', () => {
    expect(fitTabs([0, 0, 0], 50, 80, 0)).toEqual([0, 1, 2]);
  });
});
