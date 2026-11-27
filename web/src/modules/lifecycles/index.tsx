// Administration > Lifecycles (E14-31): allowed status changes, required fields and who may set
// each status, per record type. Always on (not a feature area); the server leaves out the record
// types of switched-off areas.
import type { ModuleDef } from '../../core';
import { LifecyclesPage } from './LifecyclesPage';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'lifecycles',
  nav: [
    { group: 'Administration', label: 'Lifecycles', path: '/admin/lifecycles', icon: 'route', permission: ADMIN, order: 42, menu: false, hub: 'Records setup', hint: 'The statuses a record moves through, and the rules for each step.' },
  ],
  routes: [
    { path: '/admin/lifecycles', element: <LifecyclesPage />, permission: ADMIN },
  ],
};
export default mod;
