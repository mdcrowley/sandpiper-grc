import { describe, expect, it } from 'vitest';
import { ariaDescription } from './ChartImpl';

// BW-07: what a screen reader hears for a chart: each point's category and its own value, never the
// internal dimensions of a stacked series ("6; 0; 6; NaN"). Invented data only.
describe('the words a screen reader hears for a chart', () => {
  it('gives each stacked series its own values', () => {
    const text = ariaDescription({
      xAxis: { type: 'category', data: ['Spotting fake messages', 'Safe passwords'] },
      yAxis: { type: 'value' },
      series: [
        { type: 'bar', stack: 'all', name: 'Completed', data: [6, 4] },
        { type: 'bar', stack: 'all', name: 'Overdue', data: [{ value: 2 }, 0] },
      ],
    });
    expect(text).toBe('Chart. 2 series. Completed: Spotting fake messages 6; Safe passwords 4. Overdue: Spotting fake messages 2; Safe passwords 0.');
    expect(text).not.toMatch(/NaN/);
  });

  it('names pie slices and heat-map cells', () => {
    expect(ariaDescription({ series: [{ type: 'pie', name: 'Risks', data: [{ name: 'High', value: 3 }, { name: 'Low', value: 1200 }] }] }))
      .toBe('Chart. Risks: High 3; Low 1,200.');
    expect(ariaDescription({
      xAxis: { type: 'category', data: ['Low', 'High'] }, yAxis: { type: 'category', data: ['Depot'] },
      series: [{ type: 'heatmap', name: 'Count', data: [[0, 0, 5], [1, 0, 2]] }],
    })).toBe('Chart. Count: Depot, Low 5; Depot, High 2.');
  });

  it('says how many values there are when it reads only the first 12', () => {
    const data = Array.from({ length: 20 }, (_, i) => i);
    const text = ariaDescription({ xAxis: { type: 'category', data: data.map((i) => `W${i}`) }, series: [{ type: 'line', name: 'Opened', data }] });
    expect(text).toContain('Opened: the first 12 of 20 values: W0 0;');
    expect(text).not.toContain('W12');
  });
});
