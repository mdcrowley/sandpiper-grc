// The side menu, the tab strips the shell draws, and the Administration page's cards, worked out from
// every module's `nav` entries (E44-01, wave 24). Pure functions, so they are tested without a browser.
import { matchPath } from 'react-router-dom';
import type { NavItem } from './module';
import { HUB_SECTIONS, NAV_GROUPS, navAllowed, type HubSection, type NavGroup } from './navGroups';

/** Every entry the person may open, menu entries and pages alike. The Administration entry needs one card. */
export function allowedNav(items: NavItem[], can: (permission: string | undefined) => boolean): NavItem[] {
  const allowed = items.filter((item) => !item.hubHome && navAllowed(item, can));
  const hasCards = allowed.some((item) => item.hub);
  return [...allowed, ...items.filter((item) => item.hubHome && hasCards && navAllowed(item, can))];
}

/** The side menu: the groups in order, each with its menu entries sorted by `order`. Empty groups are left out. */
export function menuGroups(items: NavItem[]): { group: NavGroup; items: NavItem[] }[] {
  const menu = items.filter((item) => item.menu !== false);
  return NAV_GROUPS
    .map((group) => ({ group, items: menu.filter((i) => i.group === group).sort((a, b) => (a.order ?? 100) - (b.order ?? 100)) }))
    .filter((g) => g.items.length > 0);
}

const hits = (path: string, pathname: string) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`));

/** The entry (menu entry or page) whose path is the longest one the address equals or starts with. */
export function bestMatch(pathname: string, items: NavItem[]): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of items) if (hits(item.path, pathname) && (!best || item.path.length > best.path.length)) best = item;
  return best;
}

/**
 * The menu entry to highlight for an address: the best-matching entry if it is in the menu; for a page
 * that is not, its `parent`, or the Administration entry for an Administration card, or else the
 * best-matching menu entry.
 */
export function currentMenuPath(pathname: string, items: NavItem[]): string | null {
  const menu = items.filter((i) => i.menu !== false);
  const best = bestMatch(pathname, items);
  if (!best) return null;
  if (best.menu !== false) return best.path;
  const visible = (path: string | undefined) => (path && menu.some((m) => m.path === path) ? path : undefined);
  const hub = items.find((i) => i.hubHome)?.path;
  return visible(best.parent) ?? (best.hub && !best.parent ? visible(hub) : undefined) ?? bestMatch(pathname, menu)?.path ?? null;
}

export interface SectionTab { key: string; label: string; path: string }
export interface SectionTabs { label: string; tabs: SectionTab[]; active: string }

/**
 * The tab strip for an address, when it opens a menu entry that has `tabs` or one of that entry's pages
 * (`parent` and `tab`). Only the exact pages count: a record opened from the list has no strip. The
 * entry's own tab comes first, the others by `order`, and a "Settings" tab last.
 */
export function sectionTabs(pathname: string, items: NavItem[]): SectionTabs | null {
  const here = items.find((i) => matchPath({ path: i.path, end: true }, pathname));
  if (!here) return null;
  const root = here.tabs ? here : items.find((i) => i.path === here.parent && i.tabs);
  if (!root || (here !== root && !here.tab)) return null;
  const children = items
    .filter((i) => i.parent === root.path && i.tab && i !== root)
    .sort((a, b) => Number(a.tab === 'Settings') - Number(b.tab === 'Settings') || (a.order ?? 100) - (b.order ?? 100));
  if (children.length === 0) return null;
  const tabs = [root, ...children].map((i) => ({ key: i.path, label: (i === root ? i.tabs : i.tab) as string, path: i.path }));
  return { label: `${root.label} sections`, tabs, active: here.path };
}

export interface HubCard { section: HubSection; label: string; path: string; icon: NavItem['icon']; hint?: string }

/**
 * The Administration page's cards, by section in order: within a section by `order` (all of them are
 * Administration entries), except Area settings, whose cards come from every area's group: A to Z.
 */
export function hubCards(items: NavItem[]): { section: HubSection; cards: HubCard[] }[] {
  const hub = items.filter((i) => i.hub);
  return HUB_SECTIONS
    .map((section) => ({
      section,
      cards: hub.filter((i) => i.hub === section)
        .sort((a, b) => (section === 'Area settings' ? 0 : (a.order ?? 100) - (b.order ?? 100)) || a.label.localeCompare(b.label))
        .map((i): HubCard => ({ section, label: i.label, path: i.path, icon: i.icon, hint: i.hint })),
    }))
    .filter((s) => s.cards.length > 0);
}

/** The hub card for an address (exact page), for the "Administration ›" breadcrumb. */
export function hubCardAt(pathname: string, items: NavItem[]): NavItem | undefined {
  return items.find((i) => i.hub && matchPath({ path: i.path, end: true }, pathname));
}
