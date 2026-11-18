import { describe, expect, it } from 'vitest';
import {
  addWorkingMinutes, categoryOf, clockView, DEFAULT_MATRIX, priorityFor, workingMinutesBetween, zonedToUtc, type CalendarDef,
} from './sla.ts';

const WEEKDAY: [string, string] = ['08:00', '17:00'];
const business: CalendarDef = {
  timezone: 'America/New_York', always_open: false,
  hours: { mon: WEEKDAY, tue: WEEKDAY, wed: WEEKDAY, thu: WEEKDAY, fri: WEEKDAY, sat: null, sun: null },
  holidays: [],
};
const always: CalendarDef = { timezone: 'America/New_York', always_open: true, hours: {}, holidays: [] };
const at = (s: string) => new Date(s);
const add = (cal: CalendarDef, from: string, minutes: number) => addWorkingMinutes(cal, at(from), minutes).toISOString();

// November 2026 is on standard time (UTC-5): 08:00 local = 13:00Z, 17:00 local = 22:00Z.
// 20 November 2026 is a Friday.

describe('working time', () => {
  it('converts local wall-clock times in both halves of the year', () => {
    expect(new Date(zonedToUtc('America/New_York', 2026, 11, 20, 8 * 60)).toISOString()).toBe('2026-11-20T13:00:00.000Z');
    expect(new Date(zonedToUtc('America/New_York', 2026, 7, 1, 8 * 60)).toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });

  it('counts minutes inside one working day', () => {
    expect(add(business, '2026-11-20T15:00:00Z', 90)).toBe('2026-11-20T16:30:00.000Z');
  });

  it('lets a target land exactly on closing time', () => {
    expect(add(business, '2026-11-20T21:00:00Z', 60)).toBe('2026-11-20T22:00:00.000Z');
  });

  it('carries over a weekend', () => {
    // Friday 16:30 local + 60 working minutes = Monday 08:30 local.
    expect(add(business, '2026-11-20T21:30:00Z', 60)).toBe('2026-11-23T13:30:00.000Z');
  });

  it('starts the clock at the next opening time when logged out of hours', () => {
    // Saturday midday and Friday 19:00 local both start on Monday 08:00.
    expect(add(business, '2026-11-21T17:00:00Z', 30)).toBe('2026-11-23T13:30:00.000Z');
    expect(add(business, '2026-11-21T00:00:00Z', 30)).toBe('2026-11-23T13:30:00.000Z');
  });

  it('spans several business days', () => {
    // Three business days (3 x 540) from Thursday 10:00 local = Tuesday 10:00 local.
    expect(add(business, '2026-11-19T15:00:00Z', 3 * 540)).toBe('2026-11-24T15:00:00.000Z');
  });

  it('skips holidays', () => {
    const cal = { ...business, holidays: ['2026-11-26'] };
    // Wednesday 16:00 local + 2 hours, Thursday closed = Friday 09:00 local.
    expect(add(cal, '2026-11-25T21:00:00Z', 120)).toBe('2026-11-27T14:00:00.000Z');
    expect(workingMinutesBetween(cal, at('2026-11-25T21:00:00Z'), at('2026-11-27T14:00:00Z'))).toBe(120);
  });

  it('keeps local opening hours when the clocks go forward', () => {
    // Clocks change on Sunday 8 March 2026. Friday 16:00 EST + 2 hours = Monday 09:00 EDT (13:00Z).
    expect(add(business, '2026-03-06T21:00:00Z', 120)).toBe('2026-03-09T13:00:00.000Z');
  });

  it('keeps local opening hours when the clocks go back', () => {
    // Clocks change on Sunday 1 November 2026. Friday 16:00 EDT (20:00Z) + 2 hours = Monday 09:00 EST (14:00Z).
    expect(add(business, '2026-10-30T20:00:00Z', 120)).toBe('2026-11-02T14:00:00.000Z');
  });

  it('counts real minutes in a window that contains a clock change', () => {
    const night: CalendarDef = { timezone: 'America/New_York', always_open: false, hours: { sun: ['00:00', '06:00'] }, holidays: [] };
    // 8 March 2026: 02:00 to 03:00 local does not exist, so the window is five real hours long.
    expect(workingMinutesBetween(night, at('2026-03-08T00:00:00Z'), at('2026-03-09T00:00:00Z'))).toBe(300);
    expect(add(night, '2026-03-08T05:00:00Z', 300)).toBe('2026-03-08T10:00:00.000Z');
  });

  it('runs every minute on a 24 by 7 calendar', () => {
    expect(add(always, '2026-11-21T03:10:00Z', 15)).toBe('2026-11-21T03:25:00.000Z');
    expect(workingMinutesBetween(always, at('2026-11-20T22:00:00Z'), at('2026-11-23T13:00:00Z'))).toBe(63 * 60);
  });

  it('measures working minutes between two instants', () => {
    // Friday 15:00 local to Monday 09:00 local = 2 hours + 1 hour.
    expect(workingMinutesBetween(business, at('2026-11-20T20:00:00Z'), at('2026-11-23T14:00:00Z'))).toBe(180);
    expect(workingMinutesBetween(business, at('2026-11-21T10:00:00Z'), at('2026-11-22T10:00:00Z'))).toBe(0);
    expect(workingMinutesBetween(business, at('2026-11-23T14:00:00Z'), at('2026-11-20T20:00:00Z'))).toBe(0);
  });

  it('adding the measured gap returns to the same point', () => {
    const from = at('2026-11-18T19:17:00Z');
    const to = at('2026-12-02T16:41:00Z');
    const gap = workingMinutesBetween(business, from, to);
    expect(addWorkingMinutes(business, from, gap).toISOString()).toBe(to.toISOString());
  });

  it('does not move a time when nothing is added', () => {
    expect(add(business, '2026-11-20T22:00:00Z', 0)).toBe('2026-11-20T22:00:00.000Z');
  });
});

describe('priority matrix', () => {
  it('maps impact and urgency to a priority', () => {
    expect(priorityFor(DEFAULT_MATRIX, 'organisation', 'high')).toBe('p1');
    expect(priorityFor(DEFAULT_MATRIX, 'department', 'high')).toBe('p2');
    expect(priorityFor(DEFAULT_MATRIX, 'individual', 'high')).toBe('p3');
    expect(priorityFor(DEFAULT_MATRIX, 'individual', 'low')).toBe('p4');
  });

  it('falls back to the default for values the matrix does not know', () => {
    expect(priorityFor(DEFAULT_MATRIX, 'galaxy', 'high')).toBe('p3');
    expect(priorityFor(DEFAULT_MATRIX, null, undefined)).toBe('p3');
  });
});

describe('status categories and clocks', () => {
  it('treats a status with no category as open', () => {
    expect(categoryOf(undefined)).toBe('open');
    expect(categoryOf({})).toBe('open');
    expect(categoryOf({ category: 'nonsense' })).toBe('open');
    expect(categoryOf({ category: 'paused' })).toBe('paused');
  });

  it('reports a running, paused, met and breached clock', () => {
    const due = at('2026-11-23T20:00:00Z'); // Monday 15:00 local
    const base = { dueAt: due, metAt: null, breached: false, pausedAt: null };
    const running = clockView(business, base, at('2026-11-23T19:00:00Z'));
    expect(running).toMatchObject({ state: 'running', remaining_minutes: 60 });

    // Paused on Friday at 16:00 local with 1 + 7 working hours left; looked at on Saturday.
    const paused = clockView(business, { ...base, pausedAt: at('2026-11-20T21:00:00Z') }, at('2026-11-21T15:00:00Z'));
    expect(paused).toMatchObject({ state: 'paused', remaining_minutes: 480, projected_due_at: '2026-11-23T21:00:00.000Z' });

    expect(clockView(business, { ...base, metAt: at('2026-11-23T18:00:00Z') }, at('2026-11-24T18:00:00Z')).state).toBe('met');
    const late = clockView(business, base, at('2026-11-24T14:00:00Z')); // Tuesday 09:00 local
    expect(late).toMatchObject({ state: 'breached', breached: true, remaining_minutes: -180 });
    expect(clockView(null, { ...base, dueAt: null }, at('2026-11-24T14:00:00Z')).state).toBe('none');
  });
});
