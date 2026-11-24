import { lazy, Suspense, useState, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './core/auth';
import { LoginPage, SetupPage } from './core/AuthPages';
import { EnrollmentGate } from './core/EnrollmentGate';
import { RouteLoading } from './core/lazyRoutes';
import { UiProvider } from './core/mantine';
import { MetaProvider } from './core/meta';
import { moduleOn, modules } from './core/module';
import { ToastProvider } from './core/overlay';
import { renamedPath } from './core/renamedRoutes';
import { Forbidden, NotFound, SwitchedOff } from './core/pages';
import { Shell } from './core/Shell';
import { UnsavedChangesHost } from './core/unsaved';

// Paths and permissions are known at start; each element loads its module's code when first shown
// (see core/module.ts), so nothing here pulls a module's pages into the first download.
const routes = modules.flatMap((m) => (m.routes ?? []).map((r) => ({ ...r, module: m.key })));
const publicRoutes = modules.flatMap((m) => m.publicRoutes ?? []);

// The self-service portal (E15) has a layout of its own, without the shell. It belongs to the portal
// module and is looked up rather than imported, so the application builds and runs without it.
const portalFiles = import.meta.glob<{ PortalApp: ComponentType }>('./modules/portal/PortalApp.tsx');
const loadPortal = Object.values(portalFiles)[0] as (typeof portalFiles)[string] | undefined;
const PortalApp = loadPortal && modules.some((m) => m.key === 'portal')
  ? lazy(() => loadPortal().then((m) => ({ default: m.PortalApp })))
  : null;
// Outside reviewers (E41-09) have a layout of their own too: their account reaches nothing else.
const reviewerFiles = import.meta.glob<{ ReviewerApp: ComponentType }>('./modules/outsidereviews/ReviewerApp.tsx');
const loadReviewer = Object.values(reviewerFiles)[0] as (typeof reviewerFiles)[string] | undefined;
const ReviewerApp = loadReviewer && modules.some((m) => m.key === 'outsidereviews')
  ? lazy(() => loadReviewer().then((m) => ({ default: m.ReviewerApp })))
  : null;
/** Permissions that open some part of the agent screens (anything in the sidebar but the portal itself). */
const agentPermissions = [...new Set(modules.flatMap((m) => m.nav ?? []).map((n) => n.permission)
  .filter((p): p is string => Boolean(p) && !p!.startsWith('portal.')))];
const isPortalPath = (path: string) => path === '/portal' || path.startsWith('/portal/');
/** Pages a portal-only person may still open in the shell: their own account and the guide. */
const keepsShell = (path: string) => path.startsWith('/account') || path.startsWith('/help');

/** Everything behind sign-in: setup wizard, sign-in page, second-factor set-up, the portal, or the shell with module routes. */
function SignedInApp() {
  const { user, setupRequired, mfaEnrollmentBlocked, can, areaOn, switchedOff, features } = useAuth();
  const { pathname, search, hash } = useLocation();
  // Old addresses renamed to American spelling (core/renamedRoutes.ts) go to the new ones.
  const moved = renamedPath(pathname, search, hash);
  if (moved) return <Navigate to={moved} replace />;
  if (setupRequired) return <SetupPage />;
  if (!user) return <LoginPage />;
  // The server refuses everything but second-factor set-up: offer only that (and sign out).
  if (mfaEnrollmentBlocked) return <EnrollmentGate />;
  // An outside reviewer's account (the server's grant): only their reviews and their account security.
  if (ReviewerApp && can('outsidereviews.reviewer') && !agentPermissions.some((p) => can(p))) {
    return <Suspense fallback={<RouteLoading bare />}><ReviewerApp /></Suspense>;
  }
  if (PortalApp && areaOn('portal')) {
    if (isPortalPath(pathname)) {
      return <Suspense fallback={<RouteLoading bare />}><PortalApp /></Suspense>;
    }
    // Someone who can use the portal and nothing else lands there rather than in an empty shell.
    const portalOnly = features.portal && can('portal.view') && !agentPermissions.some((p) => can(p));
    if (portalOnly && !keepsShell(pathname)) return <Navigate to="/portal" replace />;
  }
  return (
    <MetaProvider>
      <Shell>
        <Routes>
          {/* The portal's own pages while it is switched off (Administration > Features). */}
          {PortalApp && !areaOn('portal') && <Route path="/portal/*" element={<SwitchedOff />} />}
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={!moduleOn(r.module, areaOn) || switchedOff(r.permission) ? <SwitchedOff /> : can(r.permission) ? r.element : <Forbidden />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </MetaProvider>
  );
}

/** Everything under the router: toasts, sign-in state, the unsaved-changes guard, then the pages. */
function Root() {
  return (
    <ToastProvider>
      <AuthProvider>
        <UnsavedChangesHost />
        <Routes>
          {publicRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          <Route path="*" element={<SignedInApp />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}

/**
 * UiProvider (Mantine theme, toasts) wraps everything, so public pages and the shell share one look.
 * A data router, so the unsaved-changes guard can stop a move to another page (core/unsaved.tsx);
 * the pages themselves are still declared with <Routes> under its one catch-all route.
 */
export function App() {
  const [router] = useState(() => createBrowserRouter([{ path: '*', element: <Root /> }]));
  return (
    <UiProvider>
      <RouterProvider router={router} />
    </UiProvider>
  );
}
