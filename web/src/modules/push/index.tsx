// Administration > Push notifications (E38-14; part of the Mobile app area, so hidden while it is off):
// the organization's own credentials for Apple's push service, Firebase Cloud Messaging and
// UnifiedPush, a test push to your own phones, and how many phones are registered.
import type { ModuleDef } from '../../core';
import { PushAdminPage } from './PushAdmin';

const mod: ModuleDef = {
  key: 'push',
  nav: [
    { group: 'Administration', label: 'Push notifications', path: '/admin/push', icon: 'bell', permission: 'admin.administer', order: 57, menu: false, hub: 'Connections', hint: 'The credentials that send notifications to phones.' },
  ],
  routes: [
    { path: '/admin/push', element: <PushAdminPage />, permission: 'admin.administer' },
  ],
};
export default mod;
