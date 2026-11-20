// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { appTitle, applyBranding, brandingCss } from './branding';

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
