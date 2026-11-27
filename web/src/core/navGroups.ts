// The side menu's groups and the Administration page's sections (E44-01). Kept apart from module.ts, which
// reads the build's module list, so tests and pure helpers (navModel.ts) can use them.
import type { NavItem } from './module';

/** Whether a person may see a navigation entry: its permission and every one of its `permissions`. */
export const navAllowed = (item: Pick<NavItem, 'permission' | 'permissions'>, can: (permission: string | undefined) => boolean) =>
  can(item.permission) && (item.permissions ?? []).every((p) => can(p));

/**
 * The side menu's groups, in order (wave 24 navigation redesign, E44-01). Named after the work people
 * do, not after code modules. Help is not a group: the top bar's "?" opens the guide for the page.
 */
export const NAV_GROUPS = [
  'Home', 'IT services', 'Assets', 'Vendors', 'Projects and funding', 'Security', 'Risk and compliance',
  'Safety and emergency management', 'Governance and records', 'Documents', 'People and training', 'Reports', 'Administration',
] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/**
 * Group names used before wave 24, mapped to the group that took their place. A register's menu group
 * is a setting an administrator chose (registers module), so stored values may still hold an old name.
 */
export const LEGACY_NAV_GROUPS: Record<string, NavGroup> = {
  'Service desk': 'IT services', Change: 'IT services', Inventory: 'Assets', Cybersecurity: 'Security',
  Safety: 'Safety and emergency management', Governance: 'Governance and records', People: 'People and training',
  Projects: 'Projects and funding', Help: 'Home',
};

/** A group name as the menu knows it: current names pass through, old ones are mapped, unknown ones go to Home. */
export function navGroupOf(name: string | null | undefined): NavGroup {
  if (name && (NAV_GROUPS as readonly string[]).includes(name)) return name as NavGroup;
  return (name && LEGACY_NAV_GROUPS[name]) || 'Home';
}

/**
 * Groups whose name joins two areas, and the name each takes while one of those areas is switched off:
 * a switched-off area is named nowhere (Administration > Features), so "Risk and compliance" reads
 * "Compliance" while the risk register is off. `[area, name without it]` pairs, checked in order.
 */
const SHORT_NAMES: Partial<Record<NavGroup, [area: string, name: string][]>> = {
  'Projects and funding': [['funding', 'Projects'], ['projects', 'Funding']],
  'Risk and compliance': [['risks', 'Compliance']],
  'Safety and emergency management': [['safety', 'Emergency management'], ['continuity', 'Safety']],
  'Governance and records': [['records', 'Governance'], ['governance', 'Records']],
  'People and training': [['training', 'People']],
};

/** The name a group is shown under, given which areas are on. */
export function groupLabel(group: string, areaOn: (area: string) => boolean): string {
  for (const [area, name] of SHORT_NAMES[group as NavGroup] ?? []) if (!areaOn(area)) return name;
  return group;
}

/** The sections of the Administration page (/admin), in order. */
export const HUB_SECTIONS = [
  'People and access', 'Organization', 'Records setup', 'Area settings', 'Connections', 'Data and operations',
] as const;
export type HubSection = (typeof HUB_SECTIONS)[number];
