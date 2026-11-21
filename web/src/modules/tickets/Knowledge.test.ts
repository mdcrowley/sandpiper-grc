import { describe, expect, it, vi } from 'vitest';

// The module registry is built by the web build; this test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { reviewOverdue } = await import('./Knowledge');
const { setLocaleSettings, timeZone } = await import('../../core/format');

// BW-12: an article's "review due" follows the organization's calendar day, not the UTC one.
describe('knowledge article review date', () => {
  it('is due only once the date has passed on the organization calendar', () => {
    expect(reviewOverdue('2026-11-20', '2026-11-21')).toBe(true);
    expect(reviewOverdue('2026-11-21', '2026-11-21')).toBe(false);
  });

  it('uses the organization\'s today by default, where UTC is already tomorrow', () => {
    const before = timeZone();
    vi.useFakeTimers();
    // 18:00 in Los Angeles on Nov 20 is 02:00 UTC on Nov 21.
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'));
    try {
      setLocaleSettings({ timeZone: 'America/Los_Angeles' });
      expect(reviewOverdue('2026-11-20')).toBe(false);
      setLocaleSettings({ timeZone: 'UTC' });
      expect(reviewOverdue('2026-11-20')).toBe(true);
    } finally {
      vi.useRealTimers();
      setLocaleSettings({ timeZone: before });
    }
  });
});
