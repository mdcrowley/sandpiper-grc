// The mobile app's pages on the web (wave 13, E38-02, E38-09; area `mobile`, off by default):
// Account > Devices, the person's signed-in phones, reached from the user menu; Administration >
// Mobile app, the area's settings. The administrator's user page shows a user's devices through
// UserCard.tsx (admin/UserExtensions.tsx). The app's sign-in page is /oauth/authorize (SignIn.tsx,
// opened from modules/mcp/ConsentPage.tsx for the app's client id).
import type { ModuleDef } from '../../core';
import { MobileAdminPage } from './AdminSettings';
import { DevicesPage } from './Devices';

const mod: ModuleDef = {
  key: 'mobile',
  nav: [
    { group: 'Administration', label: 'Mobile app', path: '/admin/mobile-app', icon: 'settings', permission: 'admin.administer', order: 55, menu: false, hub: 'Connections', hint: 'Who may sign in to the mobile app, and its devices.' },
  ],
  routes: [
    { path: '/account/devices', element: <DevicesPage /> },
    { path: '/admin/mobile-app', element: <MobileAdminPage /> },
  ],
};
export default mod;
