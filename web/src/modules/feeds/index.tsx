// Calendar feeds and the work-tracker bridge (E36-03, E36-06). Calendar feeds is a "my account" page
// reached from the menu under the person's name; the administration page holds the feeds switch and
// the work-tracker connections. The work-tracker panel (TrackerLinkPanel) is loaded by the action and
// vulnerability pages with import.meta.glob.
import type { ModuleDef } from '../../core';
import { CalendarFeedsPage } from './CalendarFeeds';
import { FeedsAdminPage } from './FeedsAdmin';

const mod: ModuleDef = {
  key: 'feeds',
  nav: [
    { group: 'Administration', label: 'Calendar and work trackers', path: '/admin/calendar-and-work-trackers', icon: 'calendar', permission: 'admin.administer', order: 48 },
  ],
  routes: [
    // "My account": open to every signed-in user.
    { path: '/account/calendar-feeds', element: <CalendarFeedsPage /> },
    { path: '/admin/calendar-and-work-trackers', element: <FeedsAdminPage />, permission: 'admin.administer' },
  ],
};
export default mod;
