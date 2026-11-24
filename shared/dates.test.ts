import { describe, expect, it } from 'vitest';
import { addDays, addMonths, addMonthsToInstant, addWeeks, addYears, daysBetween, isYmd, monthEndOf, monthStartOf, weekdayOf } from './dates.ts';
import { addWorkingDays, isWorkingDay, MONDAY_TO_FRIDAY, workingDaysBetween, type WorkingCalendar } from './working-days.ts';

// The one copy of the date helpers (E40-12) and the working-day arithmetic (E40-10).

describe('calendar dates', () => {
  it('adds and subtracts days across months, years and leap days, reading timestamps by their date', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-08T23:30:00Z', 0)).toBe('2026-11-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // no clock change in date-only arithmetic
    expect(addWeeks('2026-11-02', 2)).toBe('2026-11-16');
  });

  it('adds months with the month-end rule, backward too, and years with 29 February', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
    expect(addMonths('2026-05-31', 12)).toBe('2027-05-31');
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2026-07-04', -2)).toBe('2024-07-04');
  });

  it('counts days between, weekdays and month bounds, and checks real dates', () => {
    expect(daysBetween('2026-11-01', '2026-11-30')).toBe(29);
    expect(daysBetween('2026-11-30', '2026-11-01')).toBe(-29);
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(weekdayOf('2026-11-24')).toBe(2); // a Tuesday
    expect(monthStartOf('2026-11-24')).toBe('2026-11-01');
    expect(monthEndOf('2028-02-10')).toBe('2028-02-29');
    expect(isYmd('2026-02-28')).toBe(true);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('2026-2-3')).toBe(false);
    expect(isYmd(20261124)).toBe(false);
  });

  it('moves an instant by months keeping its time of day', () => {
    expect(addMonthsToInstant(new Date('2026-01-31T09:15:00Z'), 1).toISOString()).toBe('2026-02-28T09:15:00.000Z');
    expect(addMonthsToInstant(new Date('2026-12-15T00:00:00Z'), 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('working days', () => {
  const cal: WorkingCalendar = { weekdays: [1, 2, 3, 4, 5], holidays: ['2026-12-25', '2027-01-01'] };

  it('skips weekends and holidays, starting the day after', () => {
    expect(addWorkingDays('2026-11-20', 1)).toBe('2026-11-23'); // Friday + 1 = Monday
    expect(addWorkingDays('2026-12-21', 5, MONDAY_TO_FRIDAY)).toBe('2026-12-28');
    expect(addWorkingDays('2026-12-21', 5, cal)).toBe('2026-12-29');
    expect(addWorkingDays('2026-12-24', 1, cal)).toBe('2026-12-28');
    expect(addWorkingDays('2026-12-31', 1, cal)).toBe('2027-01-04');
    expect(addWorkingDays('2026-12-29', -1, cal)).toBe('2026-12-28');
    expect(addWorkingDays('2026-12-28', -1, cal)).toBe('2026-12-24');
    expect(addWorkingDays('2026-12-21', 0, cal)).toBe('2026-12-21');
  });

  it('adds calendar days when working days are not asked for', () => {
    expect(addWorkingDays('2026-12-21', 5, cal, false)).toBe('2026-12-26');
  });

  it('follows the calendar\'s own weekdays, and counts every day with none', () => {
    const sixDays: WorkingCalendar = { weekdays: [1, 2, 3, 4, 5, 6], holidays: [] };
    expect(addWorkingDays('2026-11-20', 1, sixDays)).toBe('2026-11-21');
    expect(isWorkingDay('2026-11-22', { weekdays: [], holidays: [] })).toBe(true);
    expect(isWorkingDay('2026-12-25', cal)).toBe(false);
    expect(isWorkingDay('2026-12-24', cal)).toBe(true);
  });

  it('never loops for ever on a calendar with every day a holiday', () => {
    const none: WorkingCalendar = { weekdays: [3], holidays: Array.from({ length: 600 }, (_, i) => addDays('2026-11-25', i * 7)) };
    expect(addWorkingDays('2026-11-24', 1, none)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('counts working days between two dates', () => {
    expect(workingDaysBetween('2026-12-21', '2026-12-29', cal)).toBe(5);
    expect(workingDaysBetween('2026-12-29', '2026-12-21', cal)).toBe(-5);
    expect(workingDaysBetween('2026-12-21', '2026-12-21', cal)).toBe(0);
  });
});
