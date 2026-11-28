// The start page ("/", E44-09). A role may send its people somewhere else when they arrive: My work, the
// self-service portal or a dashboard (Administration > Roles > Home page; GET /api/work/home). That happens
// only on arrival, when "/" is the first page of the visit (just after signing in, or the address typed or
// bookmarked): choosing Overview in the menu always shows the Overview.
import { Navigate, useLocation } from 'react-router-dom';
import { Loading, useFetch } from '../../core';
import { OverviewPage } from './OverviewPage';

interface Home { home: 'overview' | 'mywork' | 'portal' | 'dashboard'; route: string }

/** True when this is the first page of the visit, not a move inside the application. */
export function isArrival(key: string, search: string): boolean {
  return key === 'default' && !search;
}

export function HomeRoute() {
  const { key, search } = useLocation();
  const arriving = isArrival(key, search);
  const { data, error } = useFetch<Home>(arriving ? '/api/work/home' : null);
  if (arriving && !data && !error) return <Loading lines={6} label="Opening your start page" />;
  if (arriving && data && data.route && data.route !== '/') return <Navigate to={data.route} replace />;
  return <OverviewPage />;
}
