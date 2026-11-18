// Module contract and registry. Every folder in web/src/modules (except those starting with "_")
// default-exports a ModuleDef from its index.tsx and is discovered automatically.
import type { ReactNode } from 'react';
import type { IconName } from './Icon';

export const NAV_GROUPS = [
  'Home', 'Service desk', 'Inventory', 'Change', 'Vendors', 'Cybersecurity', 'Projects', 'Reports', 'Administration',
] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export interface NavItem {
  group: NavGroup;
  label: string;
  path: string;
  icon: IconName;
  /** Hidden unless the user holds this permission. */
  permission?: string;
  /** Position within the group, ascending (default 100). */
  order?: number;
}

export interface ModuleRoute {
  /** React Router path, e.g. `/tickets/:id`. */
  path: string;
  element: ReactNode;
  /** Shows the "no access" page unless the user holds this permission. */
  permission?: string;
}

export interface CreateItem {
  /** Shown in the global Create menu, e.g. "Ticket". */
  label: string;
  /** Where the entry goes, e.g. `/tickets?new=1` (ResourceList opens its New dialog on `?new=1`). */
  path: string;
  permission?: string;
  icon?: IconName;
}

export interface ModuleDef {
  key: string;
  nav?: NavItem[];
  routes?: ModuleRoute[];
  create?: CreateItem[];
  /**
   * Routes rendered without the Shell and without requiring sign-in (e.g. a one-time-link page).
   * They work with or without a session and take precedence over the sign-in screen.
   */
  publicRoutes?: { path: string; element: ReactNode }[];
}

const found = import.meta.glob<{ default?: ModuleDef }>(
  ['../modules/*/index.tsx', '!../modules/_*/index.tsx'],
  { eager: true },
);

export const modules: ModuleDef[] = Object.entries(found)
  .filter(([file, mod]) => {
    if (!mod.default?.key) console.warn(`${file} does not default-export a ModuleDef; ignored.`);
    return Boolean(mod.default?.key);
  })
  .map(([, mod]) => mod.default as ModuleDef)
  .sort((a, b) => a.key.localeCompare(b.key));
