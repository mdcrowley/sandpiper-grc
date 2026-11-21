// The organization's look (Administration > Organization, E14-35): its logos, its brand colors and
// the application name, read from `branding` in /api/auth/state (the same as GET /api/branding),
// so the sign-in page, the portal and the vendor response page have it before anyone signs in.
//
// Colors arrive as design tokens per theme, already made accessible by the server
// (server/src/core/branding-colors.ts); they are laid over tokens.css by a style element added
// after it, for `:root` (light) and `:root[data-theme="dark"]`. The favicon becomes a square icon
// drawn from the logo (E14-36) and the browser tab's title ends with the application name. Mantine's
// numbered brand scale is made from the brand color too (`brandScale`, used by core/mantine.tsx).
import { useSyncExternalStore } from 'react';

export interface Branding {
  appName: string;
  name: string;
  shortName: string;
  colors: { light: Record<string, string>; dark: Record<string, string> } | null;
  logo: { light: string | null; dark: string | null; lightType?: string | null };
}

const DEFAULT_TITLE = 'Sandpiper GRC';
let current: Branding = { appName: DEFAULT_TITLE, name: '', shortName: '', colors: null, logo: { light: null, dark: null } };
const listeners = new Set<() => void>();

/** Only custom properties and plain colors reach the style element. */
const TOKEN_RE = /^--[a-z0-9-]+$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const block = (selector: string, tokens: Record<string, string> = {}) => {
  const lines = Object.entries(tokens).filter(([k, v]) => TOKEN_RE.test(k) && COLOR_RE.test(v)).map(([k, v]) => `  ${k}: ${v};`);
  return lines.length ? `${selector} {\n${lines.join('\n')}\n}` : '';
};

/** The CSS that lays the organization's colors over the standard tokens, in both themes. */
export function brandingCss(colors: Branding['colors']): string {
  if (!colors) return '';
  return [block(':root', colors.light), block(':root[data-theme="dark"]', colors.dark)].filter(Boolean).join('\n');
}

/** Only an address on this server (the logo route) is used for a logo or favicon. */
const ownUrl = (u: string | null | undefined) => (typeof u === 'string' && u.startsWith('/api/branding/logo/') ? u : null);

/** The browser tab's title ends with this (the application name). */
export function appTitle(): string {
  return current.appName || DEFAULT_TITLE;
}

/** Sets the organization's look: colors, favicon and title. Safe to call again with the same value. */
export function applyBranding(next: Partial<Branding> | null | undefined, appName?: string): void {
  const before = appTitle();
  current = {
    appName: appName || next?.appName || DEFAULT_TITLE,
    name: next?.name ?? '',
    shortName: next?.shortName ?? '',
    colors: next?.colors ?? null,
    logo: { light: ownUrl(next?.logo?.light), dark: ownUrl(next?.logo?.dark) ?? ownUrl(next?.logo?.light), lightType: next?.logo?.lightType ?? null },
  };
  if (typeof document !== 'undefined') {
    let style = document.getElementById('grc-branding') as HTMLStyleElement | null;
    const css = brandingCss(current.colors);
    if (css) {
      if (!style) {
        style = document.createElement('style');
        style.id = 'grc-branding';
        document.head.appendChild(style); // after the stylesheets, so it wins over tokens.css
      }
      if (style.textContent !== css) style.textContent = css;
    } else style?.remove();

    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) {
      icon.dataset.standard ??= icon.getAttribute('href') ?? '/favicon.svg';
      const logo = current.logo.light;
      // The logo itself at once; the square icon made from it takes its place once drawn (below).
      const href = logo ? squareCache.get(`${logo}|32`) ?? logo : icon.dataset.standard;
      if (icon.getAttribute('href') !== href) {
        icon.setAttribute('href', href);
        icon.setAttribute('type', !logo ? 'image/svg+xml' : href.startsWith('data:') ? 'image/png' : current.logo.lightType ?? 'image/png');
      }
      setTouchIcon(logo ? squareCache.get(`${logo}|180`) ?? null : null);
      if (logo) void squareIcons(logo, icon);
    }
    // The tab title ends with the application name: replace the old ending, or the whole of a bare one.
    const title = appTitle();
    if (title !== before || document.title === DEFAULT_TITLE) {
      const parts = document.title.split(' · ');
      document.title = parts.length > 1 && parts[parts.length - 1] === before ? [...parts.slice(0, -1), title].join(' · ') : title;
    }
  }
  listeners.forEach((fn) => fn());
}

// ---------- the square browser-tab icon (E14-36) ----------

/**
 * Where a picture of w × h goes in a square of `size` pixels, leaving `pad` pixels round it:
 * as large as fits, centered, never stretched.
 */
export function fitSquare(w: number, h: number, size: number, pad = 0): { x: number; y: number; width: number; height: number } {
  const room = Math.max(1, size - 2 * pad);
  const scale = room / Math.max(1, w, h);
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  return { x: Math.round((size - width) / 2), y: Math.round((size - height) / 2), width, height };
}

/** Icons already drawn, by "logo address|size": data: addresses, also kept in the browser between visits. */
const squareCache = new Map<string, string>();
const CACHE_KEY = 'grc.squareIcons';
try {
  const saved: Record<string, unknown> = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') : {};
  for (const [k, v] of Object.entries(saved)) if (typeof v === 'string' && v.startsWith('data:image/png;base64,')) squareCache.set(k, v);
} catch { /* no storage: drawn again on each visit */ }
let drawing = '';

/** The Home-screen icon (phones and tablets), only while the organization has a logo. */
function setTouchIcon(href: string | null) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!href) { link?.remove(); return; }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

/**
 * Draws the logo into squares of 32 pixels (the tab icon, see-through around the logo) and 180
 * pixels (the Home-screen icon, on white, which those screens need), keeps them and puts them in
 * place. Where the browser cannot draw (no canvas), the logo as uploaded stays the icon.
 */
async function squareIcons(logo: string, icon: HTMLLinkElement) {
  if (squareCache.has(`${logo}|32`) && squareCache.has(`${logo}|180`)) return;
  if (drawing === logo || typeof Image === 'undefined') return;
  drawing = logo;
  try {
    const img = new Image();
    img.src = logo;
    await img.decode();
    const draw = (size: number, pad: number, background: string | null) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const g = canvas.getContext('2d');
      if (!g) return null;
      if (background) { g.fillStyle = background; g.fillRect(0, 0, size, size); }
      const f = fitSquare(img.naturalWidth, img.naturalHeight, size, pad);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, f.x, f.y, f.width, f.height);
      const url = canvas.toDataURL('image/png');
      return url.startsWith('data:image/png;base64,') ? url : null;
    };
    const small = draw(32, 0, null);
    const large = draw(180, 18, '#ffffff');
    if (!small || !large) return;
    squareCache.set(`${logo}|32`, small);
    squareCache.set(`${logo}|180`, large);
    try {
      // Only the current logo's icons are kept.
      localStorage.setItem(CACHE_KEY, JSON.stringify({ [`${logo}|32`]: small, [`${logo}|180`]: large }));
    } catch { /* full or blocked: drawn again next time */ }
    if (current.logo.light === logo) {
      icon.setAttribute('href', small);
      icon.setAttribute('type', 'image/png');
      setTouchIcon(large);
    }
  } catch {
    /* the picture could not be drawn: the logo as uploaded stays the icon */
  } finally {
    if (drawing === logo) drawing = '';
  }
}

// ---------- Mantine's numbered brand scale (E14-36) ----------

/** Mantine's standard brand scale (core/mantine.tsx); index 7 is the light theme's brand color. */
export const STANDARD_SCALE = ['#edf7f7', '#d8ecec', '#b3dadb', '#86c9cc', '#5fb3b8', '#3f9aa1', '#267f88', '#17656f', '#0f525b', '#0a3d45'] as const;

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Ten shades of the brand color for Mantine's numbered scale, lightest first, shaped like the
 * standard scale: index 7 is the brand color itself (the light theme's accessible shade), the
 * lighter ones run up to a pale tint and the darker ones down from it. Null for the standard look.
 */
export function brandScale(brand: string | null | undefined): string[] | null {
  if (!brand || !COLOR_RE.test(brand)) return null;
  const hex = brand.toLowerCase();
  if (hex === STANDARD_SCALE[7]) return [...STANDARD_SCALE];
  const [h, s, l] = hexToHsl(hex);
  const std = STANDARD_SCALE.map(hexToHsl);
  const [, s7, l7] = std[7];
  const top = Math.max(l + 0.02, 0.96);
  return std.map(([, si, li], i) => {
    if (i === 7) return hex;
    const sat = Math.max(0, Math.min(1, s7 > 0 ? (s * si) / s7 : s));
    const light = i < 7 ? l + ((li - l7) / (std[0][2] - l7)) * (top - l) : l * (li / l7);
    return hslToHex(h, sat, Math.max(0, Math.min(1, light)));
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The organization's look, kept current. */
export function useBranding(): Branding {
  return useSyncExternalStore(subscribe, () => current);
}
