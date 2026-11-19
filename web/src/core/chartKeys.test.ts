import { describe, expect, it } from 'vitest';
import { segmentsOf } from './ChartImpl';

// E18-42: every part of a chart that a click opens can also be opened from the keyboard.
describe('chart drill-down without a pointer', () => {
  it('names bar segments after their category and value', () => {
    const list = segmentsOf({
      xAxis: { type: 'category', data: ['Open', 'Closed'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', name: 'Tickets', data: [{ value: 4, key: 'open' }, 7] }],
    });
    expect(list.map((x) => x.label)).toEqual(['Open Open: 4', 'Open Closed: 7']);
    expect(list[0].segment).toMatchObject({ name: 'Open', value: 4, dataIndex: 0, data: { value: 4, key: 'open' } });
  });

  it('includes the series name when there are several, and skips gaps', () => {
    const list = segmentsOf({
      yAxis: [{ type: 'category', data: ['High', 'Low'] }],
      xAxis: { type: 'value' },
      series: [{ type: 'bar', name: 'Open', data: [2, null] }, { type: 'bar', name: 'Closed', data: [1, 3] }],
    });
    expect(list.map((x) => x.label)).toEqual(['Open Open: High: 2', 'Open Closed: High: 1', 'Open Closed: Low: 3']);
  });

  it('names pie slices, and leaves relationship graphs out', () => {
    expect(segmentsOf({ series: [{ type: 'pie', data: [{ name: 'Vendors', value: 5 }] }] }).map((x) => x.label)).toEqual(['Open Vendors: 5']);
    expect(segmentsOf({ series: [{ type: 'graph', data: [{ name: 'A' }] }] })).toEqual([]);
  });
});
