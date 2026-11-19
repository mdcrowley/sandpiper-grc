// Overview: the landing page. This file only declares the module; the page is in
// OverviewPage.tsx, the widgets in registry.ts and the widgets*.tsx files, the saved layout in
// layoutStore.ts. The route has no permission of its own: everyone gets "My work", and the
// dashboard widgets check `dashboards.view` themselves.
import type { ModuleDef } from '../../core';
import { OverviewPage } from './OverviewPage';

const mod: ModuleDef = {
  key: 'home',
  nav: [{ group: 'Home', label: 'Overview', path: '/', icon: 'home', order: 0 }],
  routes: [{ path: '/', element: <OverviewPage /> }],
};
export default mod;
