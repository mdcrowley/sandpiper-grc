// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { appTitle, applyBranding, brandingCss, brandScale, fitSquare, STANDARD_SCALE } from './branding';

describe('organization branding (Administration > Organization)', () => {
  it('writes only custom properties with plain colors', () => {
    const css = brandingCss({
      light: { '--brand': '#123456', '--link': 'red; } body { display: none', 'color': '#000000' },
      dark: { '--brand': '#abcdef' },
    });
    expect(css).toBe(':root {\n  --brand: #123456;\n}\n:root[data-theme="dark"] {\n  --brand: #abcdef;\n}');
    expect(brandingCss(null)).toBe('');
  });

  it('lays the colors over the tokens, sets the favicon and title, and takes them away again', () => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
    document.title = 'Sandpiper GRC';
    applyBranding({
      name: 'Example Transit Authority', shortName: 'ETA',
      colors: { light: { '--brand': '#123456' }, dark: { '--brand': '#abcdef' } },
      logo: { light: '/api/branding/logo/light?v=abc', dark: 'https://elsewhere.example/logo.png', lightType: 'image/png' },
    }, 'Harbor Line GRC');
    expect(document.getElementById('grc-branding')?.textContent).toContain('--brand: #123456;');
    const icon = document.querySelector('link[rel="icon"]')!;
    expect(icon.getAttribute('href')).toBe('/api/branding/logo/light?v=abc');
    expect(icon.getAttribute('type')).toBe('image/png');
    expect(appTitle()).toBe('Harbor Line GRC');
    expect(document.title).toBe('Harbor Line GRC');

    document.title = 'Tickets · Harbor Line GRC';
    applyBranding({ colors: null, logo: { light: null, dark: null } }, 'Example GRC');
    expect(document.getElementById('grc-branding')).toBeNull();
    expect(icon.getAttribute('href')).toBe('/favicon.svg');
    expect(document.title).toBe('Tickets · Example GRC');
  });
});

describe('the square tab icon and the brand scale (E14-36)', () => {
  it('fits a logo of any shape into a square, centered and never stretched', () => {
    expect(fitSquare(400, 100, 32)).toEqual({ x: 0, y: 12, width: 32, height: 8 });
    expect(fitSquare(100, 400, 180, 18)).toEqual({ x: 72, y: 18, width: 36, height: 144 });
    expect(fitSquare(64, 64, 32)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  it('makes ten shades of the brand color, lightest first, with the brand color itself at index 7', () => {
    const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
    expect(brandScale(null)).toBeNull();
    expect(brandScale('red')).toBeNull();
    expect(brandScale(STANDARD_SCALE[7])).toEqual([...STANDARD_SCALE]);
    for (const brand of ['#7a1f5c', '#0b3d91', '#2f6b2f', '#000000', '#5c5c5c']) {
      const scale = brandScale(brand)!;
      expect(scale).toHaveLength(10);
      expect(scale[7]).toBe(brand);
      scale.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
      for (let i = 1; i < 10; i++) expect(lum(scale[i])).toBeLessThanOrEqual(lum(scale[i - 1]));
    }
  });
});
