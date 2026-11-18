import type { ModuleDef } from '../../core';
import { IntakeForm } from './IntakeForm';
import { PortfolioPage } from './PortfolioPage';
import { ProjectDetail } from './ProjectDetail';
import { SettingsPage } from './SettingsPage';
import './projects.css';

// Projects and portfolio.
const mod: ModuleDef = {
  key: 'projects',
  nav: [
    { group: 'Projects', label: 'Portfolio', path: '/projects', icon: 'folder', permission: 'projects.view', order: 10 },
    { group: 'Projects', label: 'New request', path: '/projects/new', icon: 'plus', permission: 'projects.create', order: 20 },
    { group: 'Projects', label: 'Project settings', path: '/projects/settings', icon: 'settings', permission: 'projects.administer', order: 90 },
  ],
  routes: [
    { path: '/projects', element: <PortfolioPage />, permission: 'projects.view' },
    { path: '/projects/new', element: <IntakeForm />, permission: 'projects.create' },
    { path: '/projects/settings', element: <SettingsPage />, permission: 'projects.administer' },
    { path: '/projects/:id', element: <ProjectDetail />, permission: 'projects.view' },
  ],
  create: [{ label: 'Project request', path: '/projects/new', permission: 'projects.create', icon: 'folder' }],
};

export default mod;
