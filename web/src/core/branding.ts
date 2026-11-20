// The organization's look (Administration > Organization, E14-35): its logos, its brand colors and
// the application name, read from `branding` in /api/auth/state (the same as GET /api/branding),
// so the sign-in page, the portal and the vendor response page have it before anyone signs in.
//
// Colors arrive as design tokens per theme, already made accessible by the server
// (server/src/core/branding-colors.ts); they are laid over tokens.css by a style element added
// after it, for `:root` (light) and `:root[data-theme="dark"]`. The favicon becomes the logo and
// the browser tab's title ends with the application name.
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
      const href = current.logo.light ?? icon.dataset.standard;
      if (icon.getAttribute('href') !== href) {
        icon.setAttribute('href', href);
        icon.setAttribute('type', current.logo.light ? current.logo.lightType ?? 'image/png' : 'image/svg+xml');
      }
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

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The organization's look, kept current. */
export function useBranding(): Branding {
  return useSyncExternalStore(subscribe, () => current);
}
