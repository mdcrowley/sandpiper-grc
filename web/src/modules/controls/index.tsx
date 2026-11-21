// Control library and control testing (E26): the library, what each control covers, tests with
// sampled items and the reviewer's sign-off, the coverage view and the dashboard.
import type { ModuleDef } from '../../core';
import { ControlDetail, ControlList } from './Controls';
import { CoveragePage } from './Coverage';
import { ControlsDashboard } from './Dashboard';
import { TestDetail, TestList } from './Tests';
import './controls.css';

const view = 'controls.view';

const mod: ModuleDef = {
  key: 'controls',
  nav: [
    { group: 'Governance', label: 'Controls', path: '/controls', icon: 'shield', permission: view, order: 20 },
    { group: 'Governance', label: 'Control tests', path: '/controls/tests', icon: 'check-square', permission: view, order: 21 },
  ],
  routes: [
    { path: '/controls', element: <ControlList />, permission: view },
    { path: '/controls/dashboard', element: <ControlsDashboard />, permission: view },
    { path: '/controls/coverage', element: <CoveragePage />, permission: view },
    { path: '/controls/tests', element: <TestList />, permission: view },
    { path: '/controls/tests/:id', element: <TestDetail />, permission: view },
    { path: '/controls/:id', element: <ControlDetail />, permission: view },
  ],
  create: [
    { label: 'Control', path: '/controls?new=1', permission: 'controls.create', icon: 'shield' },
    { label: 'Control test', path: '/controls/tests?new=1', permission: 'controls.create', icon: 'check-square' },
  ],
};
export default mod;
