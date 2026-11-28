import { describe, expect, it } from 'vitest';
import { widgetOff } from '../reports/offTypes';
import type { Widget } from '../reports/types';
import { periodLabel, quarterExample } from './shared';

describe('strategy period labels (E46-58)', () => {
  it('labels calendar and fiscal periods', () => {
    expect(periodLabel('2026-Q1')).toBe('2026 Q1');
    expect(periodLabel('FY2027-Q1')).toBe('FY2027 Q1');
    expect(periodLabel('FY2027')).toBe('FY2027');
    expect(periodLabel('2026-03')).toBe('March 2026');
    expect(quarterExample({ fiscal_year_start_month: 7 })).toBe('FY2027-Q2');
    expect(quarterExample(null)).toBe('2026-Q2');
  });

  it('leaves a measure widget out while the strategy area is off (E46-60)', () => {
    const w: Widget = { id: 'm1', kind: 'measure', title: 'x', x: 0, y: 0, w: 6, h: 4, config: { measureId: 'a', recordType: 'strategic_measure' } };
    expect(widgetOff(w, new Set(['strategic_measure']))).toBe(true);
    expect(widgetOff(w, new Set())).toBe(false);
  });
});
