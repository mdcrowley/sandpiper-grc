import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './core/auth';
import { LoginPage, SetupPage } from './core/AuthPages';
import { EnrolmentGate } from './core/EnrolmentGate';
import { UiProvider } from './core/mantine';
import { MetaProvider } from './core/meta';
import { modules } from './core/module';
import { ToastProvider } from './core/overlay';
import { Forbidden, NotFound } from './core/pages';
import { Shell } from './core/Shell';

// Paths and permissions are known at start; each element loads its module's code when first shown
// (see core/module.ts), so nothing here pulls a module's pages into the first download.
const routes = modules.flatMap((m) => m.routes ?? []);
const publicRoutes = modules.flatMap((m) => m.publicRoutes ?? []);

/** Everything behind sign-in: setup wizard, sign-in page, second-factor set-up, or the shell with module routes. */
function SignedInApp() {
  const { user, setupRequired, mfaEnrollmentBlocked, can } = useAuth();
  if (setupRequired) return <SetupPage />;
  if (!user) return <LoginPage />;
  // The server refuses everything but second-factor set-up: offer only that (and sign out).
  if (mfaEnrollmentBlocked) return <EnrolmentGate />;
  return (
    <MetaProvider>
      <Shell>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={can(r.permission) ? r.element : <Forbidden />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </MetaProvider>
  );
}

/** UiProvider (Mantine theme, toasts) wraps everything, so public pages and the shell share one look. */
export function App() {
  return (
    <UiProvider>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              {publicRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
              <Route path="*" element={<SignedInApp />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </UiProvider>
  );
}
