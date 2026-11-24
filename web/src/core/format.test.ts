import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EMPTY, currency, formatCurrency, formatDate, formatDateTime, formatDuration, formatNumber,
  fromZonedInput, humanize, relativeTime, setLocaleSettings, timeZone, timeZoneLabel, toZonedInput, todayInZone,
} from './format';

// The organization's zone is set explicitly so the results do not depend on the machine's clock
// or zone (the suite also runs with GRC_TIMEZONE=UTC).
const before = { timeZone: timeZone(), currency: currency() };
beforeAll(() => setLocaleSettings({ timeZone: 'America/New_York', currency: 'USD' }));
afterAll(() => setLocaleSettings(before));

describe('dates', () => {
  it('shows a calendar date as written, whatever the organization zone', () => {
    expect(formatDate('2026-11-18')).toBe('Nov 18, 2026');
    expect(formatDate('2026-11-18T00:00:00Z')).toBe('Nov 18, 2026');
    expect(formatDate('2026-11-18T00:00:00.000+00:00')).toBe('Nov 18, 2026');
    setLocaleSettings({ timeZone: 'Pacific/Auckland' });
    expect(formatDate('2026-11-18')).toBe('Nov 18, 2026');
    setLocaleSettings({ timeZone: 'America/New_York' });
  });

  it('shows an instant on the organization calendar day', () => {
    // 02:30 UTC on the 19th is still the evening of the 18th in New York.
    expect(formatDate('2026-11-19T02:30:00Z')).toBe('Nov 18, 2026');
    expect(formatDateTime('2026-11-19T02:30:00Z')).toBe('Nov 18, 2026, 21:30');
    setLocaleSettings({ timeZone: 'UTC' });
    expect(formatDateTime('2026-11-19T02:30:00Z')).toBe('Nov 19, 2026, 02:30');
    setLocaleSettings({ timeZone: 'America/New_York' });
  });

  it('shows a dash for empty or unreadable values', () => {
    for (const v of [null, undefined, '', 'not a date']) {
      expect(formatDate(v)).toBe(EMPTY);
      expect(formatDateTime(v)).toBe(EMPTY);
      expect(relativeTime(v)).toBe(EMPTY);
    }
    expect(toZonedInput(null)).toBe('');
    expect(fromZonedInput('')).toBe('');
    expect(fromZonedInput('2026-13-45T99:99')).toBe('');
  });

  it('names the zone in everyday words for date field hints (E18-65)', () => {
    expect(timeZoneLabel(new Date('2026-01-15T12:00:00Z'))).toBe('Eastern Standard Time');
    expect(timeZoneLabel(new Date('2026-07-15T12:00:00Z'))).toBe('Eastern Daylight Time');
    setLocaleSettings({ timeZone: 'UTC' });
    expect(timeZoneLabel()).toBe('Coordinated Universal Time');
    setLocaleSettings({ timeZone: 'America/New_York' });
  });

  it('ignores an unknown zone or currency and keeps the previous ones', () => {
    setLocaleSettings({ timeZone: 'Not/AZone' });
    expect(timeZone()).toBe('America/New_York');
    setLocaleSettings({ currency: 'NOPE!' });
    expect(currency()).toBe('USD');
  });

  it('gives today as a YYYY-MM-DD date', () => {
    expect(todayInZone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('date and time inputs', () => {
  it('turns an instant into the organization wall clock and back', () => {
    expect(toZonedInput('2026-11-19T02:30:00Z')).toBe('2026-11-18T21:30');
    expect(fromZonedInput('2026-11-18T21:30')).toBe('2026-11-19T02:30:00.000Z');
    // Summer time (UTC-4) is honored too.
    expect(toZonedInput('2026-07-01T16:00:00Z')).toBe('2026-07-01T12:00');
    expect(fromZonedInput('2026-07-01T12:00')).toBe('2026-07-01T16:00:00.000Z');
  });

  it('round-trips the hours either side of a daylight-saving change', () => {
    // Clocks went back at 02:00 on 1 Nov 2026 in New York and forward on 8 Mar 2026.
    for (const iso of ['2026-11-01T04:30:00.000Z', '2026-11-01T07:30:00.000Z', '2026-03-08T06:30:00.000Z', '2026-03-08T07:30:00.000Z']) {
      expect(fromZonedInput(toZonedInput(iso))).toBe(iso);
    }
  });
});

describe('relative time and durations', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  it('says how long ago or how soon', () => {
    expect(relativeTime('2026-11-18T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-11-18T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-11-17T12:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-11-20T12:00:00Z', now)).toBe('in 2 days');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
  });

  it('writes a length of time in its two largest units', () => {
    expect(formatDuration(30_000)).toBe('30s');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatDuration(3 * 3_600_000)).toBe('3h');
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000 + 59 * 60_000)).toBe('2d 4h');
    expect(formatDuration(86_400_000)).toBe('1d');
    expect(formatDuration(-90 * 60_000)).toBe('1h 30m');
  });
});

describe('numbers and money', () => {
  it('formats numbers and treats blanks as empty', () => {
    expect(formatNumber(1234.567)).toMatch(/^1.234.57$/);
    expect(formatNumber('12')).toBe('12');
    expect(formatNumber(0)).toBe('0');
    for (const v of [null, undefined, '', 'abc']) expect(formatNumber(v)).toBe(EMPTY);
  });

  it('formats money in the organization currency', () => {
    expect(formatCurrency(1234.5)).toMatch(/1.234.50/);
    // E18-65: no cents on whole amounts; cents kept when there are any.
    expect(formatCurrency(50000)).toBe('$50,000');
    expect(formatCurrency('10930000.00')).toBe('$10,930,000');
    expect(formatCurrency(1234.05)).toBe('$1,234.05');
    expect(formatCurrency(0.5)).toBe('$0.50');
    expect(formatCurrency(-20)).toBe('-$20');
    expect(formatCurrency(0)).not.toBe(EMPTY);
    expect(formatCurrency('x')).toBe(EMPTY);
    setLocaleSettings({ currency: 'EUR' });
    expect(currency()).toBe('EUR');
    expect(formatCurrency(10)).toMatch(/€|EUR/);
    setLocaleSettings({ currency: 'USD' });
    expect(formatCurrency(10)).toMatch(/\$|USD/);
  });
});

describe('humanize', () => {
  it('turns a field name into a label', () => {
    expect(humanize('status_reason')).toBe('Status reason');
    expect(humanize('owner_id')).toBe('Owner');
    expect(humanize('title')).toBe('Title');
    expect(humanize('')).toBe('');
  });
});
