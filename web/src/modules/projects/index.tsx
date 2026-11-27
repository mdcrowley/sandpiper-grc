import type { ModuleDef } from '../../core';
import { CertItemList, CertItemPage, CertRequirementList, CertRequirementPage } from './CertPages';
import { IntakeForm } from './IntakeForm';
import { PortfolioPage } from './PortfolioPage';
import { ProjectDetail } from './ProjectDetail';
import { SettingsPage } from './SettingsPage';
import './projects.css';

// Projects and portfolio.
const mod: ModuleDef = {
  key: 'projects',
  nav: [
    { group: 'Projects and funding', label: 'Project portfolio', path: '/projects', icon: 'folder', permission: 'projects.view', order: 10, tabs: 'Portfolio' },
    { group: 'Projects and funding', label: 'Certifiable items', path: '/projects/certifiable-items', icon: 'shield', permission: 'projects.view', order: 11, menu: false, parent: '/projects', tab: 'Certifiable items' },
    { group: 'Projects and funding', label: 'Project settings', path: '/projects/settings', icon: 'settings', permission: 'projects.administer', order: 12, menu: false, parent: '/projects', tab: 'Settings', hub: 'Area settings', hint: 'Scoring, gates, who may send a request, and the request form.' },
  ],
  routes: [
    { path: '/projects', element: <PortfolioPage />, permission: 'projects.view' },
    { path: '/projects/new', element: <IntakeForm /> },
    { path: '/projects/settings', element: <SettingsPage />, permission: 'projects.administer' },
    // E41-08: safety and security certification.
    { path: '/projects/certifiable-items', element: <CertItemList />, permission: 'projects.view' },
    { path: '/projects/certifiable-items/:id', element: <CertItemPage />, permission: 'projects.view' },
    { path: '/projects/certification-requirements', element: <CertRequirementList />, permission: 'projects.view' },
    { path: '/projects/certification-requirements/:id', element: <CertRequirementPage />, permission: 'projects.view' },
    { path: '/projects/:id', element: <ProjectDetail />, permission: 'projects.view' },
  ],
  create: [{ label: 'Project request', path: '/projects/new', icon: 'folder', permission: 'projects.request' }],
};

export default mod;
