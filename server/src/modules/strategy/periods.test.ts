import { describe, expect, it } from 'vitest';
import { frequencyOf, measureState, normalizePeriod, periodLabel, periodRange, quarterOf, quartersBetween } from './periods.ts';

describe('periods', () => {
  it('reads years, quarters and months, and dates inside them', () => {
    expect(normalizePeriod('quarterly', '2026-q2')).toBe('2026-Q2');
    expect(normalizePeriod('quarterly', '2026-05-14')).toBe('2026-Q2');
    expect(normalizePeriod('monthly', '2026-05-14')).toBe('2026-05');
    expect(normalizePeriod('yearly', '2026-05')).toBe('2026');
    expect(normalizePeriod('monthly', '2026-Q2')).toBeNull();
    expect(normalizePeriod('quarterly', '2026')).toBeNull();
    expect(normalizePeriod('quarterly', 'soon')).toBeNull();
    expect(frequencyOf('2026-Q4')).toBe('quarterly');
    expect(frequencyOf('2026-13')).toBeNull();
  });

  it('works out first and last days, quarters and labels', () => {
    expect(periodRange('2024-Q1')).toEqual({ start: '2024-01-01', end: '2024-03-31' });
    expect(periodRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodRange('2025')).toEqual({ start: '2025-01-01', end: '2025-12-31' });
    expect(quarterOf('2025-12-31')).toBe('2025-Q4');
    expect(quartersBetween('2025-11-02', '2026-04-01')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
    expect(periodLabel('2026-Q1')).toBe('2026 Q1');
    expect(periodLabel('2026-03')).toBe('March 2026');
  });

  it('compares an actual with its target by direction and tolerance', () => {
    expect(measureState('increase', 85, 86)).toBe('met');
    expect(measureState('increase', 85, 82)).toBe('near'); // within 5% of 85
    expect(measureState('increase', 85, 70)).toBe('missed');
    expect(measureState('decrease', 2, 1.9)).toBe('met');
    expect(measureState('decrease', 2, 2.05)).toBe('near');
    expect(measureState('decrease', 2, 3)).toBe('missed');
    expect(measureState('maintain', 100, 103, 5)).toBe('met');
    expect(measureState('maintain', 100, 108, 5)).toBe('near');
    expect(measureState('increase', null, 3)).toBe('no_target');
    expect(measureState('increase', 3, null)).toBeNull();
  });
});
