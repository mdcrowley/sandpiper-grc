// E15 Self-service portal. The pages live under /portal with a layout of their own
// (PortalApp.tsx, picked up by App.tsx); this definition only adds the way in from the sidebar.
import type { ModuleDef } from '../../core';

const mod: ModuleDef = {
  key: 'portal',
  nav: [
    { group: 'Home', label: 'Self-service portal', path: '/portal', icon: 'user', permission: 'portal.view', order: 90 },
  ],
};

export default mod;
