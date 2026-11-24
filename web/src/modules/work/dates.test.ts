import { describe, expect, it } from 'vitest';
import { monthGrid, monthLabel, weekStart } from './dates';

describe('compliance calendar dates', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-11-24')).toBe('2026-11-23'); // a Tuesday
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekStart('2026-11-29')).toBe('2026-11-23'); // a Sunday
  });

  it('covers the month in whole weeks', () => {
    const days = monthGrid('2026-11-10');
    expect(days[0]).toBe('2026-10-26');
    expect(days[days.length - 1]).toBe('2026-12-06');
    expect(days.length % 7).toBe(0);
    expect(days).toContain('2026-11-30');
  });

  it('names the month', () => {
    expect(monthLabel('2026-02-14')).toBe('February 2026');
  });
});
