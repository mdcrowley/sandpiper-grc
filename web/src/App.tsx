import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './core/auth';
import { LoginPage, SetupPage } from './core/AuthPages';
import { MetaProvider } from './core/meta';
import { modules } from './core/module';
import { ToastProvider } from './core/overlay';
import { Forbidden, NotFound } from './core/pages';
import { Shell } from './core/Shell';

const routes = modules.flatMap((m) => m.routes ?? []);
const publicRoutes = modules.flatMap((m) => m.publicRoutes ?? []);

/** Everything behind sign-in: setup wizard, sign-in page, or the shell with module routes. */
function SignedInApp() {
  const { user, setupRequired, can } = useAuth();
  if (setupRequired) return <SetupPage />;
  if (!user) return <LoginPage />;
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

export function App() {
  return (
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
  );
}
