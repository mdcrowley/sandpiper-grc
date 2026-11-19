// In-app notifications. The bell is exported from ./NotificationBell for the shell's top bar;
// this module adds the full page (which also holds each person's preferences), the email and
// background-job administration pages, the reminder settings page, and the public
// "Forgot your password?" page.
import type { ModuleDef } from '../../core';
import { EmailSettingsPage } from './EmailSettings';
import { ForgotPasswordPage } from './ForgotPassword';
import { JobsPage } from './JobsPage';
import { NotificationsPage } from './NotificationsPage';
import { ReminderSettingsPage } from './ReminderSettings';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'notifications',
  nav: [
    { group: 'Home', label: 'Notifications', path: '/notifications', icon: 'message', order: 50 },
    { group: 'Administration', label: 'Email', path: '/admin/email', icon: 'message', permission: ADMIN, order: 47 },
    { group: 'Administration', label: 'Background jobs', path: '/admin/jobs', icon: 'refresh', permission: ADMIN, order: 49 },
    { group: 'Administration', label: 'Reminders', path: '/admin/reminders', icon: 'clock', permission: ADMIN, order: 48 },
  ],
  routes: [
    { path: '/notifications', element: <NotificationsPage /> },
    { path: '/admin/email', element: <EmailSettingsPage />, permission: ADMIN },
    { path: '/admin/jobs', element: <JobsPage />, permission: ADMIN },
    { path: '/admin/reminders', element: <ReminderSettingsPage />, permission: ADMIN },
  ],
  publicRoutes: [{ path: '/forgot-password', element: <ForgotPasswordPage /> }],
};
export default mod;
