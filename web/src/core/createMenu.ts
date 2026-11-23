// The global Create menu (Shell): entries grouped like the navigation, each with an icon (E18-63).
import type { IconName } from './Icon';
import type { CreateItem, NavGroup, NavItem } from './module';

export interface CreateEntry extends CreateItem {
  icon: IconName;
  group: NavGroup;
}

/** The longest navigation path that the address equals or starts (`/a` matches `/a` and `/a/b`). */
function longestMatch(address: string, items: NavItem[]): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of items) {
    const hit = item.path === '/' ? address === '/' : address === item.path || address.startsWith(`${item.path}/`);
    if (hit && (!best || item.path.length > best.path.length)) best = item;
  }
  return best;
}

/**
 * The navigation entry a Create entry belongs under: the module's own entry whose path best matches
 * the entry's address, else any visible entry that does, else the module's first entry.
 */
export function createHome(path: string, own: NavItem[], visible: NavItem[]): NavItem | undefined {
  const address = path.split(/[?#]/)[0].replace(/(.)\/$/, '$1');
  return longestMatch(address, own) ?? longestMatch(address, visible) ?? own[0];
}

/**
 * Create entries in menu order: by navigation group (in `groups` order), then A to Z. An entry
 * without an icon takes its navigation entry's icon (or a plus).
 */
export function createEntries(mods: { create?: CreateItem[]; nav?: NavItem[] }[], visible: NavItem[], groups: readonly NavGroup[]): CreateEntry[] {
  return mods
    .flatMap((m) => (m.create ?? []).map((item): CreateEntry => {
      const home = createHome(item.path, m.nav ?? [], visible);
      return { ...item, icon: item.icon ?? home?.icon ?? 'plus', group: home?.group ?? 'Home' };
    }))
    .sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.label.localeCompare(b.label));
}
