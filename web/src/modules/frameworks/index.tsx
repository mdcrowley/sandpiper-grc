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
    { group: 'Cybersecurity', label: 'Framework outcomes', path: '/frameworks', icon: 'target', permission: 'frameworks.view', order: 10 },
    { group: 'Cybersecurity', label: 'Assessments', path: '/assessments', icon: 'chart', permission: 'frameworks.view', order: 15 },
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
