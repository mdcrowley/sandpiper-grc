import { describe, expect, it } from 'vitest';
import { fitCategoryLabels } from '../../core/ChartImpl';

// E18-36: category labels along the bottom of a chart never run together.
const measure = (s: string) => s.length * 7;
const bars = (names: string[]) => ({ xAxis: { type: 'category', data: names }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: names.map(() => 1) }] });

describe('fitting category labels to the room each one has', () => {
  it('keeps short labels on one line, every one shown', () => {
    const fit = fitCategoryLabels(bars(['New', 'Open', 'Done']), 600, measure);
    expect(fit.xAxis?.[0].axisLabel).toMatchObject({ interval: 0, overflow: 'none' });
    expect(fit.grid).toBeUndefined();
  });

  it('wraps two-word labels onto two lines when a word fits, and makes room below', () => {
    const names = ['Ordered', 'In stock', 'In service', 'In repair', 'Retired', 'Disposed', 'Awaiting disposal'];
    const fit = fitCategoryLabels(bars(names), 560, measure);
    const label = fit.xAxis?.[0].axisLabel as Record<string, unknown>;
    expect(label).toMatchObject({ interval: 0, overflow: 'break' });
    // Each label is narrower than its slot, so neighbors cannot touch.
    expect(Number(label.width)).toBeLessThan((560 - 48 - 16) / names.length);
    expect(Number(fit.grid?.bottom)).toBeGreaterThan(32);
  });

  it('tilts and shortens labels when even a word does not fit, leaving out ones that would overlap', () => {
    const names = Array.from({ length: 30 }, (_, i) => `Depot number ${i + 1}`);
    const fit = fitCategoryLabels(bars(names), 600, measure);
    expect(fit.xAxis?.[0].axisLabel).toMatchObject({ rotate: 36, overflow: 'truncate', hideOverlap: true, interval: 'auto' });
  });

  it('leaves alone an axis the option already tilts, and value axes', () => {
    const tilted = { xAxis: { type: 'category', data: ['A long label', 'Another long label'], axisLabel: { rotate: 45 } } };
    expect(fitCategoryLabels(tilted, 200, measure)).toEqual({});
    expect(fitCategoryLabels({ xAxis: { type: 'value' } }, 200, measure)).toEqual({});
  });
});
