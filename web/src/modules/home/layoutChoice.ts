// Which shape of Overview suits the person (E12-07). People with work to do see their own lists
// first, then the figures. People who only look (an executive viewer, an auditor: no permission to
// create, change, approve or administer anything, as GET /api/dashboards/home reports) see the
// figures first, a way into each area they may open, and their few personal lists last.

export type OverviewMode = 'work' | 'look';

/** What the Dashboard section shows: the person's home dashboard, or the Overview's own figures. */
export type DashboardView = 'home' | 'overview';

const viewKey = (userId: string) => `grc.u.${userId}.overview.view`;

/** The view chosen last time in this browser (a per-browser convenience; default: the home dashboard). */
export function loadView(userId: string): DashboardView {
  try {
    return window.localStorage.getItem(viewKey(userId)) === 'overview' ? 'overview' : 'home';
  } catch {
    return 'home';
  }
}

export function saveView(userId: string, view: DashboardView): void {
  try {
    window.localStorage.setItem(viewKey(userId), view);
  } catch {
    // Not remembered: the default comes back next time.
  }
}

export interface AreaLink { label: string; path: string; group: string }

/**
 * The areas a person may open, from the navigation, grouped as the sidebar groups them. Home and
 * Help are left out: they are not "areas to look at".
 */
export function areasFor(
  nav: readonly { group: string; label: string; path: string; permission?: string; permissions?: string[] }[],
  can: (permission: string | undefined) => boolean,
): AreaLink[] {
  const skip = new Set(['Home', 'Help']);
  const seen = new Set<string>();
  // Pages that start a new record ("New project request") are for doing, not looking.
  const starts = /(\/new\b|[?&]new=1)/;
  return nav.filter((n) => !skip.has(n.group) && !starts.test(n.path) && can(n.permission) && (n.permissions ?? []).every((p) => can(p)) && !seen.has(n.path) && seen.add(n.path))
    .map((n) => ({ label: n.label, path: n.path, group: n.group }));
}
