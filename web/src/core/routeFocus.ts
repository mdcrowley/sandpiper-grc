// Where the keyboard focus goes when the page changes without a page load (E16-15).
//
// A single-page application changes pages without the browser loading a new document, so a screen
// reader says nothing about the new page, and when the link or button that was used disappears with
// the old page the focus falls back to the top of the document. The screen reader run found both
// (docs/accessibility.md). After every change of address (path), once the new page shows its main
// heading, the focus moves to that heading, so it is read ("heading level 1, Tickets") and Tab goes on
// from the top of the page content. The heading gets tabindex="-1": it can take the focus but is not
// a Tab stop.
//
// It does not move the focus when it is already inside the page content (the new page put it in a
// field with autoFocus, or it is on a section's own tabs, which stay) or in a dialog, nor on the first
// page of a page load, where the browser already starts at the top and the screen reader reads the
// new document. It does on the first page after signing in
// on the sign-in form (`noteSignedIn`), and when another layout is reached from inside the application
// (the portal from the main application). An old address that replaces itself with its new one at once
// (a redirect on the first page of a load) is still the page load: the focus stays at the top.
import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

let signedInHere = false;
/** The last path any layout using this hook showed: a layout that mounts on another path was reached in the application (the portal from the main application, say). */
let lastPath: string | null = null;
/** The first path of this page load and when it showed: an old address that redirects at once is still the page load. */
let loadPath: { path: string; at: number } | null = null;

/** Tests only: forget earlier page loads, as a new browser tab would. */
export function resetRouteFocusForTests(): void {
  signedInHere = false;
  lastPath = null;
  loadPath = null;
}

/** Called by the sign-in form when it succeeds: the next page takes the focus. */
export function noteSignedIn(): void {
  signedInHere = true;
}

const BUSY = '.route-loading, .mantine-Skeleton-root[data-visible], [aria-busy="true"]';

/** Moves the focus to the new page's main heading after each change of path (see above). */
export function useRouteFocus(container: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const before = shown.current;
    shown.current = pathname;
    // Run again for the same path (React's development double run): nothing changed.
    if (before === pathname) return undefined;
    const arrived = lastPath !== null && lastPath !== pathname;
    lastPath = pathname;
    if (before === null && !signedInHere && !arrived) {
      loadPath = { path: pathname, at: Date.now() };
      return undefined;
    }
    // The first address of the load replaced itself with another (an old address that moved, E43-13):
    // still the page load, so the focus stays at the top and Tab starts at the skip link.
    if (navigationType === 'REPLACE' && loadPath && before === loadPath.path && Date.now() - loadPath.at < 2000) {
      loadPath = null;
      return undefined;
    }
    loadPath = null;
    signedInHere = false;
    let tries = 0;
    let timer = 0;
    const settle = () => {
      const root = container.current;
      const heading = root?.querySelector<HTMLElement>('h1');
      if ((!heading || root?.querySelector(BUSY)) && tries++ < 60) {
        timer = window.setTimeout(settle, 100);
        return;
      }
      // Focus inside the page content was put there by the page (a field with autoFocus) or is on a
      // link that stays, such as a section's own tabs; a dialog opened on arrival keeps it too. Focus
      // on nothing, on what the old page took away, or outside the content (the navigation) moves.
      const now = document.activeElement;
      const lost = !now || now === document.body || !now.isConnected || now === root;
      if (!lost && (root?.contains(now) || now?.closest('[role="dialog"]'))) return;
      focusHeading(root);
    };
    timer = window.setTimeout(settle, 50);
    return () => window.clearTimeout(timer);
  }, [pathname, container]);

  // Focus rescue: a button that is disabled while its work runs, or that the work removes ("Assign
  // to me" once assigned), drops the focus to the top of the document; a screen reader then says
  // nothing and Tab starts again from the skip link. When that happens inside the page content, the
  // focus goes back to the button once it can take it again, or else to the page's heading. Browsers
  // send no event when a focused element is removed, so the focus is looked at a few times a second.
  // A click on a blank part of the page also leaves the focus nowhere; that is left alone.
  useEffect(() => {
    let last: HTMLElement | null = null;
    let waited = 0;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      // A dialog opened from the page returns the focus to what opened it; if that has gone when it
      // closes ("Approve" on an item the approval removes), the same rescue applies.
      if (t?.closest('[role="dialog"]')) return;
      last = t && container.current?.contains(t) ? t : null;
      waited = 0;
    };
    const tick = () => {
      const now = document.activeElement;
      if (!last || (now && now !== document.body) || document.querySelector('[role="dialog"]')) return;
      if (!last.isConnected) { last = null; focusHeading(container.current); return; }
      const unusable = last.matches(':disabled') || last.getAttribute('aria-disabled') === 'true';
      if (unusable) {
        // Busy (its work is running): wait for it, up to about 8 seconds. Unavailable for another
        // reason (a Save button with nothing left to save): go to the heading straight away.
        const busy = last.getAttribute('aria-busy') === 'true' || last.hasAttribute('data-loading');
        if (++waited > (busy ? 80 : 3)) { last = null; focusHeading(container.current); }
        return;
      }
      // Usable: it was busy and is back (focus it again), or the person clicked elsewhere (forget it).
      if (waited) last.focus({ preventScroll: true });
      last = null;
    };
    document.addEventListener('focusin', onFocusIn);
    const timer = window.setInterval(tick, 100);
    return () => { document.removeEventListener('focusin', onFocusIn); window.clearInterval(timer); };
  }, [container]);
}

/** Focuses the page's main heading (or the content itself), without making it a Tab stop. */
function focusHeading(root: HTMLElement | null): void {
  const target = root?.querySelector<HTMLElement>('h1') ?? root;
  if (!target || !target.isConnected) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}
