// Brand colors chosen by an administrator (Administration > Organization), turned into the design
// tokens of both themes so that every pair the application draws still meets WCAG 2.2 AA.
//
// The administrator picks a primary (brand) color and an accent color. Neither is used as typed:
// each theme gets its own shade of the same hue, made darker (light theme) or lighter (dark theme)
// until text on it, and it as text or a link on the theme's surfaces, reaches 4.5:1, and the
// accent, which is never text, reaches 3:1. The web app lays the tokens over tokens.css; the
// surfaces and ink below are copied from there (keep them in step).

/** The look of a fresh installation (web/src/core/tokens.css). */
export const DEFAULT_PRIMARY = '#17656f';
export const DEFAULT_ACCENT = '#b9782a';

const LIGHT = { surface: '#ffffff', bg: '#f3f6f6', surface2: '#edf2f3', text: '#14252b', navText: '#d5e2e4', navMuted: '#a2b6bb' };
const DARK = { surface: '#151e21', bg: '#0d1416', surface2: '#1d282c', text: '#e4ecee', navText: '#d5e2e4', navMuted: '#8fa5ab' };

export const HEX_RE = /^#[0-9a-f]{6}$/;

/** `#abc`, `abc`, `#AABBCC` -> `#aabbcc`; null when it is not a hex color. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX_RE.test(s) ? s : null;
}

type Rgb = [number, number, number];
type Hsl = [number, number, number];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsl([r, g, b]: Rgb): Hsl {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: Hsl): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const hsl = (hex: string) => rgbToHsl(toRgb(hex));
const fromHsl = (h: number, s: number, l: number) => toHex(hslToRgb([h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l))]));

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * The shade of `hex` (same hue and saturation) nearest to it that reaches `min` against every
 * color in `against`, moving darker or lighter. Black or white at the end, which always passes
 * against the theme's surfaces.
 */
export function shadeFor(hex: string, against: string[], min: number, direction: 'darker' | 'lighter'): string {
  const ok = (c: string) => against.every((a) => contrast(c, a) >= min);
  if (ok(hex)) return hex;
  const [h, s, l] = hsl(hex);
  for (let step = 1; step <= 100; step++) {
    const next = direction === 'darker' ? l - step / 100 : l + step / 100;
    if (next < 0 || next > 1) break;
    const c = fromHsl(h, s, next);
    if (ok(c)) return c;
  }
  return direction === 'darker' ? '#000000' : '#ffffff';
}

const lighten = (hex: string, by: number) => { const [h, s, l] = hsl(hex); return fromHsl(h, s, l + by); };

export type ThemeTokens = Record<string, string>;
export interface ContrastCheck { theme: 'light' | 'dark'; what: string; foreground: string; background: string; ratio: number; min: number; pass: boolean }
export interface BrandColors {
  primary: string;
  accent: string;
  light: ThemeTokens;
  dark: ThemeTokens;
  checks: ContrastCheck[];
  /** Plain sentences saying which chosen colors were adjusted for a theme. */
  notes: string[];
}

/**
 * The tokens of both themes for a primary and an accent color (each defaulting to the standard
 * look), with the contrast checks they meet. Every check passes by construction; they are returned
 * so the screen can show them.
 */
export function deriveBrandColors(primaryIn?: string | null, accentIn?: string | null): BrandColors {
  const primary = normalizeHex(primaryIn) ?? DEFAULT_PRIMARY;
  const accent = normalizeHex(accentIn) ?? DEFAULT_ACCENT;
  const [h, s] = hsl(primary);

  // ---- light theme: brand is a fill under white text and a link color on every light surface.
  const lBrand = shadeFor(primary, ['#ffffff', LIGHT.bg, LIGHT.surface2], 4.5, 'darker');
  const lHover = shadeFor(lighten(lBrand, -0.07), ['#ffffff'], 4.5, 'darker');
  const lSoft = fromHsl(h, Math.min(s, 0.45), 0.93);
  const lLink = shadeFor(lBrand, [LIGHT.surface, LIGHT.bg, LIGHT.surface2, lSoft], 4.5, 'darker');
  const lStrong = shadeFor(fromHsl(h, s, 0.22), [lSoft], 7, 'darker');
  const lAccent = shadeFor(accent, [LIGHT.surface, LIGHT.bg], 3, 'darker');

  // ---- dark theme: brand is a fill under dark text and a link color on every dark surface.
  const dBrand = shadeFor(primary, [DARK.surface, DARK.bg, DARK.surface2], 4.5, 'lighter');
  const dHover = lighten(dBrand, 0.08);
  const dContrast = shadeFor(fromHsl(h, Math.min(s, 0.6), 0.1), [dBrand, dHover], 4.5, 'darker');
  const dSoft = fromHsl(h, Math.min(s, 0.4), 0.16);
  const dLink = shadeFor(dHover, [DARK.surface, DARK.bg, DARK.surface2, dSoft], 4.5, 'lighter');
  const dStrong = shadeFor(fromHsl(h, Math.min(s, 0.5), 0.8), [dSoft], 7, 'lighter');
  const dAccent = shadeFor(accent, [DARK.surface, DARK.bg], 3, 'lighter');

  // ---- the sidebar: a deep tone of the brand hue in both themes, under light text.
  const nav = (theme: typeof LIGHT, l: number) => {
    let bg = fromHsl(h, Math.min(s, 0.5), l);
    let bg2 = fromHsl(h, Math.min(s, 0.45), l + 0.035);
    // Darker until the sidebar's own text passes on both of its backgrounds.
    for (let i = 0; i < 20 && [bg, bg2].some((b) => contrast(theme.navMuted, b) < 4.5 || contrast(theme.navText, b) < 4.5); i++) {
      bg = lighten(bg, -0.01);
      bg2 = lighten(bg2, -0.01);
    }
    const navAccent = shadeFor(accent, [bg, bg2], 3, 'lighter');
    const navFocus = shadeFor(lighten(primary, 0.25), [bg, bg2], 3, 'lighter');
    return { bg, bg2, navAccent, navFocus };
  };
  const ln = nav(LIGHT, 0.12);
  const dn = nav(DARK, 0.07);

  const light: ThemeTokens = {
    '--brand': lBrand, '--brand-hover': lHover, '--brand-contrast': '#ffffff', '--brand-soft': lSoft, '--brand-strong': lStrong,
    '--link': lLink, '--focus': lBrand, '--accent': lAccent,
    '--nav-bg': ln.bg, '--nav-bg-2': ln.bg2, '--nav-accent': ln.navAccent, '--nav-focus': ln.navFocus,
    '--logo-bg': lBrand, '--logo-accent': dAccent,
  };
  const dark: ThemeTokens = {
    '--brand': dBrand, '--brand-hover': dHover, '--brand-contrast': dContrast, '--brand-soft': dSoft, '--brand-strong': dStrong,
    '--link': dLink, '--focus': dLink, '--accent': dAccent,
    '--nav-bg': dn.bg, '--nav-bg-2': dn.bg2, '--nav-accent': dn.navAccent, '--nav-focus': dn.navFocus,
    '--logo-bg': lBrand, '--logo-accent': dAccent,
  };

  const checks: ContrastCheck[] = [];
  const check = (theme: 'light' | 'dark', what: string, foreground: string, background: string, min: number) => {
    const ratio = Math.round(contrast(foreground, background) * 100) / 100;
    checks.push({ theme, what, foreground, background, ratio, min, pass: ratio >= min });
  };
  for (const [theme, t, base] of [['light', light, LIGHT], ['dark', dark, DARK]] as const) {
    check(theme, 'Text on the brand color (buttons, header)', t['--brand-contrast'], t['--brand'], 4.5);
    check(theme, 'Text on the brand color, pointed at', t['--brand-contrast'], t['--brand-hover'], 4.5);
    check(theme, 'Links on the page background', t['--link'], base.surface, 4.5);
    check(theme, 'Links on shaded panels', t['--link'], base.surface2, 4.5);
    check(theme, 'Links on the light brand tint', t['--link'], t['--brand-soft'], 4.5);
    check(theme, 'Text on the light brand tint', base.text, t['--brand-soft'], 4.5);
    check(theme, 'Strong brand text on the tint', t['--brand-strong'], t['--brand-soft'], 4.5);
    check(theme, 'Sidebar text', base.navMuted, t['--nav-bg-2'], 4.5);
    check(theme, 'Accent marks on the page', t['--accent'], base.surface, 3);
    check(theme, 'Focus outline on the page', t['--focus'], base.surface, 3);
    check(theme, 'Accent marks in the sidebar', t['--nav-accent'], t['--nav-bg'], 3);
  }

  const notes: string[] = [];
  if (lBrand !== primary) notes.push(`For the light theme the brand color is darkened to ${lBrand} so text on it and links in it stay readable.`);
  if (dBrand !== primary) notes.push(`For the dark theme the brand color is lightened to ${dBrand} so it stands out on dark backgrounds.`);
  if (lAccent !== accent) notes.push(`For the light theme the accent is darkened to ${lAccent}.`);
  if (dAccent !== accent) notes.push(`For the dark theme the accent is lightened to ${dAccent}.`);
  return { primary, accent, light, dark, checks, notes };
}
