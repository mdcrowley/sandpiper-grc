import { shouldLock } from './unlock';

const profile = (required: boolean, afterMinutes = 5) => ({ unlock: { required, afterMinutes } });

describe('unlock', () => {
  it('is off unless chosen or required', () => {
    expect(shouldLock({ prefs: { unlock: false }, profile: profile(false), backgroundAt: 0, now: 10 ** 9, coldStart: true })).toBe(false);
    expect(shouldLock({ prefs: { unlock: false }, profile: profile(true), backgroundAt: null, now: 0, coldStart: true })).toBe(true);
    expect(shouldLock({ prefs: { unlock: true }, profile: profile(false), backgroundAt: null, now: 0, coldStart: true })).toBe(true);
  });
  it('asks again only after the idle time in the background', () => {
    const base = { prefs: { unlock: true }, profile: profile(false, 5), coldStart: false };
    expect(shouldLock({ ...base, backgroundAt: 0, now: 4 * 60_000 })).toBe(false);
    expect(shouldLock({ ...base, backgroundAt: 0, now: 5 * 60_000 })).toBe(true);
    expect(shouldLock({ ...base, backgroundAt: null, now: 10 ** 9 })).toBe(false);
  });
});
