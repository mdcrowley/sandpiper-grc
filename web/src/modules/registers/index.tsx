// Registers an administrator defines (E41-06). Administration > Registers defines them; each register's
// own menu entry and Create entry come from NavExtras.ts (they are made while the application runs), in
// the menu group its administrator chose. The module itself is always on; each register has its own
// switch under Administration > Features and its own permissions.
import type { ModuleDef } from '../../core';
import { AdminRegisterPage, AdminRegistersPage } from './Admin';
import { RegisterHome, RegisterList, RegisterRecord } from './Records';
import './registers.css';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'registers',
  nav: [
    { group: 'Administration', label: 'Registers', path: '/admin/registers', icon: 'folder', permission: ADMIN, order: 44, menu: false, hub: 'Records setup', hint: 'Simple record types of your own, each with a menu entry.' },
  ],
  routes: [
    { path: '/registers', element: <RegisterHome /> },
    { path: '/registers/:key', element: <RegisterList /> },
    { path: '/registers/:key/:id', element: <RegisterRecord /> },
    { path: '/admin/registers', element: <AdminRegistersPage />, permission: ADMIN },
    { path: '/admin/registers/:key', element: <AdminRegisterPage />, permission: ADMIN },
  ],
};
export default mod;
