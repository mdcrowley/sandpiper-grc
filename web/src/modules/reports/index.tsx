// Reporting: the report builder, saved reports, dashboards, report packs and scheduled delivery.
import type { ModuleDef } from '../../core';
import './reports.css';
import './reports-dash.css';
import { Builder } from './Builder';
import { DashboardPage, DashboardsPage } from './DashboardPages';
import { SchedulesPage, SnapshotPage, SnapshotsPage } from './DeliveryPages';
import { FigurePage, FiguresPage } from './FiguresPages';
import { PackPage, PacksPage } from './PackPages';
import { ReportsPage, ReportView } from './ReportPages';

const mod: ModuleDef = {
  key: 'reports',
  nav: [
    { group: 'Reports', label: 'Dashboards', path: '/dashboards', icon: 'chart', permission: 'dashboards.view', order: 10 },
    { group: 'Reports', label: 'Reports', path: '/reports', icon: 'file-text', permission: 'reports.view', order: 20 },
    { group: 'Reports', label: 'Figures over time', path: '/reports/figures', icon: 'chart', permission: 'reports.view', order: 25 },
    { group: 'Reports', label: 'Report packs', path: '/reports/packs', icon: 'book', permission: 'reports.view', order: 30 },
    { group: 'Reports', label: 'Schedules', path: '/reports/schedules', icon: 'calendar', permission: 'reports.view', order: 40 },
    { group: 'Reports', label: 'Delivered to me', path: '/reports/snapshots', icon: 'bell', order: 50 },
  ],
  routes: [
    { path: '/dashboards', element: <DashboardsPage />, permission: 'dashboards.view' },
    { path: '/dashboards/:id', element: <DashboardPage />, permission: 'dashboards.view' },
    { path: '/reports', element: <ReportsPage />, permission: 'reports.view' },
    { path: '/reports/new', element: <Builder />, permission: 'reports.create' },
    { path: '/reports/figures', element: <FiguresPage />, permission: 'reports.view' },
    { path: '/reports/figures/:id', element: <FigurePage />, permission: 'reports.view' },
    { path: '/reports/packs', element: <PacksPage />, permission: 'reports.view' },
    { path: '/reports/packs/:id', element: <PackPage />, permission: 'reports.view' },
    { path: '/reports/schedules', element: <SchedulesPage />, permission: 'reports.view' },
    { path: '/reports/snapshots', element: <SnapshotsPage /> },
    { path: '/reports/snapshots/:id', element: <SnapshotPage /> },
    { path: '/reports/:id', element: <ReportView />, permission: 'reports.view' },
    { path: '/reports/:id/edit', element: <Builder />, permission: 'reports.edit' },
  ],
  create: [
    { label: 'Report', path: '/reports/new', permission: 'reports.create' },
    { label: 'Dashboard', path: '/dashboards?new=1', permission: 'dashboards.create' },
    { label: 'Report pack', path: '/reports/packs?new=1', permission: 'reports.create' },
  ],
};
export default mod;
