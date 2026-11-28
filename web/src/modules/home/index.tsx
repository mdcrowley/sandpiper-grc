// Overview: the landing page. This file only declares the module; the page is in
// OverviewPage.tsx, the widgets in registry.ts and the widgets*.tsx files, the saved layout in
// layoutStore.ts. The route has no permission of its own: everyone gets "My work", and the
// dashboard widgets check `dashboards.view` themselves.
import type { ModuleDef } from '../../core';
import { HomeRoute } from './HomeRoute';

const mod: ModuleDef = {
  key: 'home',
  nav: [{ group: 'Home', label: 'Overview', path: '/', icon: 'home', order: 0 }],
  // On arrival, a role may send its people to My work, the portal or a dashboard instead (HomeRoute.tsx, E44-09).
  routes: [{ path: '/', element: <HomeRoute /> }],
};
export default mod;
