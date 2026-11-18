// Light/dark theme: stored choice wins, otherwise the operating system preference.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'grc.theme';
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function resolve(): Theme {
  return stored() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

let current: Theme = 'light';

function apply(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
  listeners.forEach((fn) => fn());
}

/** Call once before first render. */
export function initTheme(): void {
  apply(resolve());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(resolve()));
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  apply(theme);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, () => current);
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}

/** Current value of a design token, e.g. `cssVar('--text')`. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
