import { describe, expect, it } from 'vitest';
import { blackoutWindows } from './conflicts.ts';

// OP-07: repeats of a blackout period keep the organization's wall-clock times across daylight
// saving time, and "repeat until" is a local day. America/Chicago is used as an example zone only.

const ZONE = 'America/Chicago';
const local = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .format(d).replace(',', '');

describe('blackout repeats in the organization\'s time zone (OP-07)', () => {
  // Saturday 22:00 to Sunday 02:00 local, every week from 27 Feb to 27 Mar 2027 (clocks go forward on 14 Mar).
  const weekly = { starts_at: '2027-02-28T04:00:00Z', ends_at: '2027-02-28T08:00:00Z', repeat: 'weekly', repeat_until: '2027-03-27' };

  it('keeps 22:00 local after the clocks change, up to and including the last local day', () => {
    const w = blackoutWindows(weekly, new Date('2027-02-01T00:00:00Z'), new Date('2027-05-01T00:00:00Z'), ZONE);
    expect(w.map((x) => local(x.start))).toEqual(['2027-02-27 22:00', '2027-03-06 22:00', '2027-03-13 22:00', '2027-03-20 22:00', '2027-03-27 22:00']);
    // The ends are 02:00 local; on the night the clocks skip 02:00 it ends when they jump (03:00).
    expect(w.map((x) => local(x.end))).toEqual(['2027-02-28 02:00', '2027-03-07 02:00', '2027-03-14 03:00', '2027-03-21 02:00', '2027-03-28 02:00']);
  });

  it('catches a change at 22:30 local on a repeat after the clocks change, and on the last day', () => {
    // 20 Mar 2027 22:30 to 23:00 CDT (UTC-5).
    expect(blackoutWindows(weekly, new Date('2027-03-21T03:30:00Z'), new Date('2027-03-21T04:00:00Z'), ZONE)).toHaveLength(1);
    // 27 Mar 2027 22:30 to 23:00 CDT: the "repeat until" day itself.
    expect(blackoutWindows(weekly, new Date('2027-03-28T03:30:00Z'), new Date('2027-03-28T04:00:00Z'), ZONE)).toHaveLength(1);
    // Nothing the week after.
    expect(blackoutWindows(weekly, new Date('2027-04-04T03:30:00Z'), new Date('2027-04-04T04:00:00Z'), ZONE)).toHaveLength(0);
  });

  it('keeps the local time for monthly repeats too (clocks go back on 7 Nov 2027)', () => {
    const monthly = { starts_at: '2027-10-01T23:00:00Z', ends_at: '2027-10-02T01:00:00Z', repeat: 'monthly', repeat_until: '2027-12-31' };
    const w = blackoutWindows(monthly, new Date('2027-09-01T00:00:00Z'), new Date('2028-01-15T00:00:00Z'), ZONE);
    expect(w.map((x) => local(x.start))).toEqual(['2027-10-01 18:00', '2027-11-01 18:00', '2027-12-01 18:00']);
    expect(w.map((x) => local(x.end))).toEqual(['2027-10-01 20:00', '2027-11-01 20:00', '2027-12-01 20:00']);
  });
});
