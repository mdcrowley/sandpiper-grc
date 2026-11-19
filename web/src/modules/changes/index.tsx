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
    { group: 'Change', label: 'Changes', path: '/changes', icon: 'refresh', permission: 'changes.view', order: 10 },
    { group: 'Change', label: 'Change calendar', path: '/changes/calendar', icon: 'calendar', permission: 'changes.view', order: 20 },
    { group: 'Change', label: 'New change', path: '/changes/new', icon: 'plus', permission: 'changes.create', order: 30 },
    { group: 'Change', label: 'Change settings', path: '/changes/settings', icon: 'settings', permission: 'changes.administer', order: 90 },
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
