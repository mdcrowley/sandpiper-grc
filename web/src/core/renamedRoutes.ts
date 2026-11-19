// Addresses renamed to American spelling. Old links (bookmarks, emails, notifications saved
// before the change) still work: the application replaces the old start of the address with the
// new one and keeps the rest, the query and the fragment.

export interface RenamedRoute { from: string; to: string }

export const RENAMED_ROUTES: RenamedRoute[] = [
  { from: '/catalogue', to: '/catalog' },
  { from: '/portal/catalogue', to: '/portal/catalog' },
  { from: '/policies/acknowledgements', to: '/policies/acknowledgments' },
];

/** The new address for an old one ("/catalogue/12?x=1" -> "/catalog/12?x=1"), or null when it was not renamed. */
export function renamedPath(pathname: string, search = '', hash = ''): string | null {
  for (const r of RENAMED_ROUTES) {
    if (pathname === r.from || pathname.startsWith(`${r.from}/`)) return `${r.to}${pathname.slice(r.from.length)}${search}${hash}`;
  }
  return null;
}
