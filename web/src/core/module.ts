// Module contract and registry. Every folder in web/src/modules (except those starting with "_")
// default-exports a ModuleDef from its index.tsx and is discovered automatically.
//
// Code splitting: the build reads each module's `key`, `nav`, `create` and route paths out of
// its index.tsx (the `grc-modules` plugin in vite.config.ts) so the shell has them at start,
// while the module itself (its pages, styles and whatever they import) is a separate chunk
// loaded when one of its routes is first opened. `modules` below looks the same either way:
// a lazily loaded module's route elements are stand-ins that load the chunk and then render
// the module's real element.
import type { ReactNode } from 'react';
import { matchPath } from 'react-router-dom';
import { entries } from 'virtual:grc-modules';
import type { IconName } from './Icon';
import { lazyRouteElement } from './lazyRoutes';
import type { HubSection, NavGroup } from './navGroups';

/**
 * The optional area (Administration > Features, server/src/core/features.ts) each whole web module
 * belongs to: while the area is off its menu entries, Create entries and pages are gone. Modules
 * not listed are always on, or follow their permissions alone: the risks module also holds the
 * action tracker.
 */
export const MODULE_AREA: Record<string, string> = {
  tickets: 'tickets', changes: 'changes', vendors: 'vendors', frameworks: 'frameworks', secincidents: 'secincidents',
  policies: 'policies', training: 'training', vulnerabilities: 'vulnerabilities', projects: 'projects',
  reports: 'reports', fleet: 'fleet', safety: 'safety', portal: 'portal',
  audits: 'audits', controls: 'controls', funding: 'funding', governance: 'governance',
  // Wave 11. Legal holds (holds), integrations and feeds are not areas: they are always on.
  continuity: 'continuity', condition: 'condition', ot: 'ot', records: 'records',
  // Wave 13: asset tags, and the mobile app's pages on the web (Account > Devices).
  tags: 'tags', mobile: 'mobile',
  // Wave 14: push notification credentials (Administration > Push notifications) belong to the mobile app.
  push: 'mobile',
  // Wave 20: user access reviews (E41-02).
  accessreviews: 'accessreviews',
  // Wave 22: the records retention schedule and destruction log (E41-15).
  recordsretention: 'recordsretention',
  // Wave 25: the evidence library (E45-06).
  evidence: 'evidence',
  // Wave 26 (E46): procurement and budgets, insurance, civil rights programs, strategy and performance.
  procurement: 'procurement', insurance: 'insurance', civilrights: 'civilrights', strategy: 'strategy',
};

/** Whether a web module's area is on (always true for a module that is not part of an area). */
export const moduleOn = (key: string, areaOn: (area: string) => boolean) => !MODULE_AREA[key] || areaOn(MODULE_AREA[key]);

export { HUB_SECTIONS, LEGACY_NAV_GROUPS, NAV_GROUPS, navAllowed, navGroupOf, type HubSection, type NavGroup } from './navGroups';

export interface NavItem {
  group: NavGroup;
  label: string;
  path: string;
  icon: IconName;
  /** Hidden unless the user holds this permission. */
  permission?: string;
  /** Hidden unless the user also holds each of these (a page that needs two permissions). */
  permissions?: string[];
  /** Position within the group, ascending (default 100); unique within its group (navOrder.test.ts). */
  order?: number;
  /**
   * `false`: a page, not a side-menu entry. It stays in the command palette ("Go to"), in the Create
   * menu's grouping, as a tab (`tab`) and on the Administration page (`hub`).
   */
  menu?: false;
  /** The menu entry this page sits under: highlighted while it is open, and the page whose tab strip shows it. */
  parent?: string;
  /** Its label in the parent's tab strip ("Settings" is always drawn last). */
  tab?: string;
  /**
   * On a menu entry: the label of its own first tab. The shell then draws the tab strip of the entry and
   * every page whose `parent` it is under the page heading (pages with a tab strip of their own leave it out).
   */
  tabs?: string;
  /** A card in this section of the Administration page (/admin). */
  hub?: HubSection;
  /** One line under the card's title on the Administration page. */
  hint?: string;
  /** The Administration entry itself: shown to whoever may open at least one card of the page. */
  hubHome?: true;
  /**
   * On a menu entry: an API path answering `{ count }`, shown as a small number beside the entry while above
   * zero (E44-09: what is waiting on My work). Read when the shell starts, when the person moves to another
   * page (at most once a minute) and every five minutes.
   */
  count?: string;
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

type Loader = () => Promise<{ default?: ModuleDef }>;

/** Loaders by module key, each started at most once. Only lazily loaded modules appear here. */
const loaders = new Map<string, Loader>();
/** Which lazily loaded module owns each route path. */
const routeOwners: { path: string; key: string }[] = [];

function once(load: Loader): Loader {
  let started: Promise<{ default?: ModuleDef }> | null = null;
  return () => {
    started ??= load().catch((err) => {
      started = null; // let a later attempt try again (e.g. after the network comes back)
      throw err;
    });
    return started;
  };
}

function build(): ModuleDef[] {
  const out: ModuleDef[] = [];
  for (const entry of entries) {
    if (entry.eager) {
      const def = entry.eager.default as ModuleDef | undefined;
      if (!def?.key) console.warn(`${entry.file} does not default-export a ModuleDef; ignored.`);
      else out.push(def);
      continue;
    }
    const { manifest } = entry;
    if (!manifest || !entry.load) continue;
    const load = once(entry.load as Loader);
    loaders.set(manifest.key, load);
    for (const r of [...manifest.routes, ...manifest.publicRoutes]) routeOwners.push({ path: r.path, key: manifest.key });
    out.push({
      key: manifest.key,
      nav: manifest.nav as NavItem[],
      create: manifest.create as CreateItem[],
      routes: manifest.routes.map((r, i) => ({ ...r, element: lazyRouteElement(load, 'routes', i, r.path) })),
      publicRoutes: manifest.publicRoutes.map((r, i) => ({ path: r.path, element: lazyRouteElement(load, 'publicRoutes', i, r.path) })),
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Every module in the build, sorted by key. `nav`, `create` and the route paths and
 * permissions are available at once; the route elements of a lazily loaded module render a
 * short loading state the first time and then the module's own page.
 */
export const modules: ModuleDef[] = build();

/** Every route path of every module (shell routes and public ones), as written in the modules. */
export const routePaths: string[] = modules.flatMap((m) => [...(m.routes ?? []), ...(m.publicRoutes ?? [])].map((r) => r.path));

/**
 * Start loading the code behind an address ahead of the click (the shell calls this when the
 * pointer or focus reaches a navigation link). Harmless for unknown or already loaded addresses.
 */
export function preloadRoute(href: string): void {
  const pathname = href.split(/[?#]/)[0] || '/';
  const exact = routeOwners.find((r) => r.path === pathname);
  const owner = exact ?? routeOwners.find((r) => matchPath({ path: r.path, end: true }, pathname));
  if (owner) void loaders.get(owner.key)?.().catch(() => undefined);
}

/** Load a module's code by key; resolves to its full definition (undefined for an unknown key). */
export async function loadModule(key: string): Promise<ModuleDef | undefined> {
  const load = loaders.get(key);
  if (load) return (await load()).default;
  return modules.find((m) => m.key === key);
}

// For tools/browse.mjs --all-routes and for debugging: the route table, without loading any page.
(window as unknown as { __grcRoutes?: string[] }).__grcRoutes = routePaths;
// For the feature-switch browser test (tools/e2e/suites/09-features-off.mjs): which module owns each
// route, and the area each module belongs to.
(window as unknown as { __grcRouteModules?: Record<string, string> }).__grcRouteModules = Object.fromEntries(
  modules.flatMap((m) => [...(m.routes ?? []), ...(m.publicRoutes ?? [])].map((r) => [r.path, m.key])),
);
(window as unknown as { __grcModuleArea?: Record<string, string> }).__grcModuleArea = MODULE_AREA;
