import { afterEach, describe, expect, it, vi } from 'vitest';

// BW-11: numbers and money are written in US English like the dates, whatever the browser's
// language, so a figure reads the same on screen, in exports and for every viewer. A browser set
// to German is played by making the default locale (no locale given) German.
const Real = Intl.NumberFormat;
afterEach(() => { Intl.NumberFormat = Real; vi.resetModules(); });

describe('numbers in a browser set to another language', () => {
  it('stay in the US form', async () => {
    const German = function (locales?: string | string[], options?: Intl.NumberFormatOptions) {
      return new Real(locales ?? 'de-DE', options);
    } as unknown as typeof Intl.NumberFormat;
    Intl.NumberFormat = German;
    vi.resetModules();
    const { formatNumber, formatCurrency, setLocaleSettings } = await import('./format');
    setLocaleSettings({ currency: 'USD' });
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });
});
