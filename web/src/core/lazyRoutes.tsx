// Route-level code splitting: a module's pages live in the module's own chunk, which loads the
// first time one of its routes is opened. `lazyRouteElement` gives the element that stands in
// for a route until then; `RouteLoading` is what shows meanwhile.
import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState, Loading } from './ui';

/** The part of a module's default export this file needs (kept loose to avoid a cycle with module.ts). */
interface LoadedModule {
  default?: {
    routes?: { path: string; element: ReactNode }[];
    publicRoutes?: { path: string; element: ReactNode }[];
  };
}

export type RouteKind = 'routes' | 'publicRoutes';

/**
 * Shown while a page's code loads. Nothing for the first 150 ms (most loads finish sooner, and a
 * flash is worse than a pause), then a thin bar under the top bar and a quiet skeleton.
 */
export function RouteLoading({ bare }: { bare?: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className={bare ? 'route-loading route-loading-bare' : 'route-loading'} data-visible={visible || undefined}>
      {visible && (
        <>
          <div className="route-loading-bar" aria-hidden="true" />
          <div className="route-loading-body">
            <Loading label="Loading the page" lines={5} />
          </div>
        </>
      )}
    </div>
  );
}

interface BoundaryProps { children: ReactNode }
interface BoundaryState { failed: boolean }

/** A page's code can fail to load (the server was restarted with a new build, or is unreachable). */
class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('This page failed to load or render.', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="route-error" role="alert">
        <EmptyState
          icon="alert"
          title="This page could not be shown"
          message="The application may have been updated since you opened it, or the server cannot be reached. Reloading usually fixes it."
          action={<Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>Reload the page</Button>}
        />
      </div>
    );
  }
}

/**
 * The element for one route of a module that has not been loaded yet. `index` is the route's
 * position in the module's `routes` (or `publicRoutes`) array; `path` guards against the two
 * getting out of step.
 */
export function lazyRouteElement(
  load: () => Promise<LoadedModule>, kind: RouteKind, index: number, path: string,
): ReactNode {
  const Page = lazy(async () => {
    const def = (await load()).default;
    const list = def?.[kind] ?? [];
    const route = list[index]?.path === path ? list[index] : list.find((r) => r.path === path);
    const element = route?.element ?? (
      <EmptyState icon="alert" title="This page is missing" message={`The module no longer defines the route ${path}.`} />
    );
    return { default: () => <>{element}</> };
  });
  return (
    <RouteErrorBoundary key={`${kind}:${path}`}>
      <Suspense fallback={<RouteLoading bare={kind === 'publicRoutes'} />}>
        <Page />
      </Suspense>
    </RouteErrorBoundary>
  );
}
