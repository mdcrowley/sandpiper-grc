import type { ModuleDef } from '../../core';
import { AssessmentsPage } from './Assessments';
import { BoardPage } from './Board';
import { CoveragePage } from './Coverage';
import { ManagePage } from './Manage';
import { OutcomeDetail } from './OutcomeDetail';
import { SettingsPage } from './SettingsPage';
import { SnapshotPage } from './SnapshotDetail';
import { SnapshotReport } from './SnapshotReport';
import './frameworks.css';

const mod: ModuleDef = {
  key: 'frameworks',
  nav: [
    { group: 'Security', label: 'Framework outcomes', path: '/frameworks', icon: 'target', permission: 'frameworks.view', order: 10, tabs: 'Outcomes' },
    { group: 'Security', label: 'Assessments', path: '/assessments', icon: 'chart', permission: 'frameworks.view', order: 11, menu: false, parent: '/frameworks', tab: 'Assessments' },
    { group: 'Security', label: 'Coverage of other frameworks', path: '/frameworks/coverage', icon: 'link', permission: 'frameworks.view', order: 12, menu: false, parent: '/frameworks', tab: 'Coverage' },
    { group: 'Security', label: 'Framework settings', path: '/frameworks/settings', icon: 'settings', permission: 'frameworks.administer', order: 14, menu: false, parent: '/frameworks', tab: 'Settings', hub: 'Area settings', hint: 'How outcomes are scored and when review reminders go out.' },
  ],
  routes: [
    { path: '/frameworks', element: <BoardPage />, permission: 'frameworks.view' },
    { path: '/frameworks/board/:id', element: <BoardPage />, permission: 'frameworks.view' },
    { path: '/frameworks/outcomes', element: <BoardPage view="table" />, permission: 'frameworks.view' },
    { path: '/frameworks/outcomes/:id', element: <OutcomeDetail />, permission: 'frameworks.view' },
    { path: '/frameworks/coverage', element: <CoveragePage />, permission: 'frameworks.view' },
    { path: '/frameworks/manage', element: <ManagePage />, permission: 'frameworks.view' },
    { path: '/frameworks/settings', element: <SettingsPage />, permission: 'frameworks.view' },
    { path: '/assessments', element: <AssessmentsPage />, permission: 'frameworks.view' },
    { path: '/assessments/:id', element: <SnapshotPage />, permission: 'frameworks.view' },
    { path: '/assessments/:id/report', element: <SnapshotReport />, permission: 'frameworks.view' },
  ],
  create: [
    { label: 'Framework outcome', path: '/frameworks/outcomes?new=1', permission: 'frameworks.create' },
    { label: 'Assessment snapshot', path: '/assessments?new=1', permission: 'frameworks.create' },
    { label: 'Framework', path: '/frameworks/manage?new=1', permission: 'frameworks.create' },
  ],
};

export default mod;
