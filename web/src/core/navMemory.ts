// What the shell remembers about where a person goes (E44-04): pinned pages, kept on the server with
// the person's other preferences (core/preferences.ts) and shown at the top of the menu and in the
// command palette; and the records recently opened, kept in this browser per person and shown in
// the palette before anything is typed. Also the context the shell gives page headers: the tab strip
// for the page, the Administration breadcrumb and the pin button.
import { createContext, useContext } from 'react';
import type { IconName } from './Icon';
import { readLocal, writeLocal } from './preferences';
import type { SectionTabs } from './navModel';

export interface PinnedPage { path: string; label: string; icon?: IconName }
export interface RecentRecord { path: string; label: string; reference?: string }

export const MAX_PINS = 10;
export const MAX_RECENT_RECORDS = 8;
/** The server preference that holds the pins. */
export const PINS_KEY = 'nav.pinned';
export const pinsLocalKey = (user: string) => `grc.nav.pinned.${user}`;
const recentKey = (user: string) => `grc.recent.records.${user}`;

/** Pins with a path and label, at most MAX_PINS, without repeats (stored values are not trusted). */
export function cleanPins(value: unknown): PinnedPage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: PinnedPage[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') continue;
    const { path, label, icon } = v as Record<string, unknown>;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || typeof label !== 'string' || !label || seen.has(path)) continue;
    seen.add(path);
    out.push({ path, label: label.slice(0, 120), ...(typeof icon === 'string' ? { icon: icon as IconName } : {}) });
  }
  return out.slice(0, MAX_PINS);
}

/** The pins after pinning or unpinning a page (a new pin goes last; the limit keeps the oldest). */
export function togglePin(pins: PinnedPage[], page: PinnedPage): PinnedPage[] {
  if (pins.some((p) => p.path === page.path)) return pins.filter((p) => p.path !== page.path);
  return pins.length >= MAX_PINS ? pins : [...pins, page];
}

/* ---------- recently opened records ---------- */

// The shell sets whose list a record page adds to; nothing is kept while nobody is signed in.
let recentUser: string | null = null;
export function setRecentUser(user: string | null): void {
  recentUser = user;
}

export function readRecentRecords(user: string): RecentRecord[] {
  const value = readLocal<unknown>(recentKey(user), []);
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is RecentRecord => Boolean(v) && typeof v.path === 'string' && v.path.startsWith('/') && typeof v.label === 'string')
    .slice(0, MAX_RECENT_RECORDS);
}

/** Put a record at the top of the signed-in person's recent records. */
export function rememberRecord(record: RecentRecord): void {
  if (!recentUser || !record.path.startsWith('/') || !record.label) return;
  const list = [record, ...readRecentRecords(recentUser).filter((r) => r.path !== record.path)].slice(0, MAX_RECENT_RECORDS);
  writeLocal(recentKey(recentUser), list);
}

/* ---------- what the shell tells page headers ---------- */

export interface ShellPageContext {
  /** The tab strip for this address, when its menu entry has one the shell draws. */
  tabs: SectionTabs | null;
  /** On a page of the Administration page: its title, for the "Administration ›" breadcrumb. */
  hubCrumb: { label: string; to: string } | null;
  pinned: (path: string) => boolean;
  togglePin: (page: PinnedPage) => void;
  pinsFull: boolean;
}

export const ShellPage = createContext<ShellPageContext | null>(null);
export const useShellPage = () => useContext(ShellPage);
