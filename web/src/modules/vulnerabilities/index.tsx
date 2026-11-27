// Vulnerabilities: findings list and record, dashboard, CSV import with history, and the severity policy.
import type { ModuleDef } from '../../core';
import { VulnerabilityDashboard } from './Dashboard';
import { VulnerabilityDetail } from './Detail';
import { DuplicatesPage } from './Duplicates';
import { GroupsPage } from './Groups';
import { ImportBatchPage, ImportHistory } from './Imports';
import { ImportWizard } from './ImportWizard';
import { VulnerabilityList } from './List';
import { PolicySettings } from './PolicySettings';
import { Guard } from './shared';
import './vulnerabilities.css';

const view = 'vulnerabilities.view';

const mod: ModuleDef = {
  key: 'vulnerabilities',
  nav: [
    { group: 'Security', label: 'Vulnerabilities', path: '/vulnerabilities', icon: 'bug', permission: view, order: 30 },
    { group: 'Security', label: 'Vulnerability dashboard', path: '/vulnerabilities/dashboard', icon: 'chart', permission: view, order: 31, menu: false, parent: '/vulnerabilities' },
    { group: 'Security', label: 'Vulnerability severity policy', path: '/vulnerabilities/settings', icon: 'settings', permission: 'vulnerabilities.administer', order: 32, menu: false, parent: '/vulnerabilities', hub: 'Area settings', hint: 'How fast findings of each severity must be fixed.' },
  ],
  // Findings are security records: Guard also asks for security.view, as the server does.
  routes: [
    { path: '/vulnerabilities', element: <Guard><VulnerabilityList /></Guard>, permission: view },
    { path: '/vulnerabilities/dashboard', element: <Guard><VulnerabilityDashboard /></Guard>, permission: view },
    { path: '/vulnerabilities/import', element: <Guard need="importFindings"><ImportWizard /></Guard>, permission: 'vulnerabilities.create' },
    { path: '/vulnerabilities/imports', element: <Guard><ImportHistory /></Guard>, permission: view },
    { path: '/vulnerabilities/imports/:id', element: <Guard><ImportBatchPage /></Guard>, permission: view },
    { path: '/vulnerabilities/duplicates', element: <Guard><DuplicatesPage /></Guard>, permission: view },
    { path: '/vulnerabilities/groups', element: <Guard><GroupsPage /></Guard>, permission: view },
    { path: '/vulnerabilities/settings', element: <Guard><PolicySettings /></Guard>, permission: view },
    { path: '/vulnerabilities/:id', element: <Guard><VulnerabilityDetail /></Guard>, permission: view },
  ],
  create: [{ label: 'Vulnerability', path: '/vulnerabilities?new=1', permission: 'vulnerabilities.create', icon: 'bug' }],
};
export default mod;
