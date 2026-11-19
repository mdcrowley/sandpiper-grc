// In-app notifications. The bell is exported from ./NotificationBell for the shell's top bar;
// this module adds the full page, which also holds each person's preferences.
import type { ModuleDef } from '../../core';
import { NotificationsPage } from './NotificationsPage';

const mod: ModuleDef = {
  key: 'notifications',
  nav: [{ group: 'Home', label: 'Notifications', path: '/notifications', icon: 'message', order: 50 }],
  routes: [{ path: '/notifications', element: <NotificationsPage /> }],
};
export default mod;
