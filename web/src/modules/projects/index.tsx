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
    { group: 'Projects', label: 'Project portfolio', path: '/projects', icon: 'folder', permission: 'projects.view', order: 10 },
    // Shown to whoever may send a request: who may is a setting (E11-16), so the server grants
    // "projects.request" per person in /api/auth/state (BW-06).
    { group: 'Projects', label: 'New project request', path: '/projects/new', icon: 'plus', permission: 'projects.request', order: 20 },
    { group: 'Projects', label: 'Project settings', path: '/projects/settings', icon: 'settings', permission: 'projects.administer', order: 90 },
  ],
  routes: [
    { path: '/projects', element: <PortfolioPage />, permission: 'projects.view' },
    { path: '/projects/new', element: <IntakeForm /> },
    { path: '/projects/settings', element: <SettingsPage />, permission: 'projects.administer' },
    { path: '/projects/:id', element: <ProjectDetail />, permission: 'projects.view' },
  ],
  create: [{ label: 'Project request', path: '/projects/new', icon: 'folder', permission: 'projects.request' }],
};

export default mod;
