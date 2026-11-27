import type { ModuleDef } from '../../core';
import { CalendarPage } from './CalendarPage';
import { ChangeDetail } from './ChangeDetail';
import { ChangeList } from './ChangeList';
import { NewChange } from './NewChange';
import { SettingsPage } from './SettingsPage';
import './changes.css';

// Change enablement: the register, the guided "New change" flow, the calendar and the settings.
const mod: ModuleDef = {
  key: 'changes',
  nav: [
    { group: 'IT services', label: 'Changes', path: '/changes', icon: 'refresh', permission: 'changes.view', order: 30, tabs: 'Changes' },
    { group: 'IT services', label: 'Change calendar', path: '/changes/calendar', icon: 'calendar', permission: 'changes.view', order: 31, menu: false, parent: '/changes', tab: 'Calendar' },
    { group: 'IT services', label: 'Change settings', path: '/changes/settings', icon: 'settings', permission: 'changes.administer', order: 33, menu: false, parent: '/changes', tab: 'Settings', hub: 'Area settings', hint: 'Change types, approval rules and blackout periods.' },
  ],
  routes: [
    { path: '/changes', element: <ChangeList />, permission: 'changes.view' },
    { path: '/changes/calendar', element: <CalendarPage />, permission: 'changes.view' },
    { path: '/changes/new', element: <NewChange />, permission: 'changes.create' },
    { path: '/changes/settings', element: <SettingsPage />, permission: 'changes.administer' },
    { path: '/changes/:id', element: <ChangeDetail />, permission: 'changes.view' },
  ],
  create: [{ label: 'Change', path: '/changes/new', permission: 'changes.create', icon: 'refresh' }],
};

export default mod;
