// Safety management: dashboard, safety events, the hazard log, indicators and exposure.
import type { ModuleDef } from '../../core';
import { SafetyDashboard } from './Dashboard';
import { EventDetail, EventList } from './Events';
import { HazardDetail, HazardList } from './Hazards';
import { ExposurePage, IndicatorDetail, IndicatorList } from './Indicators';
import { MatrixEditor } from './MatrixEditor';
import { ReportRules } from './ReportRules';
import { ConfidentialViewers } from './ConfidentialViewers';
import { SafetyPlanPage } from './Plan';
import './safety.css';

const view = 'safety.view';

const mod: ModuleDef = {
  key: 'safety',
  nav: [
    { group: 'Safety and emergency management', label: 'Safety dashboard', path: '/safety', icon: 'chart', permission: view, order: 10 },
    { group: 'Safety and emergency management', label: 'Safety indicators', path: '/safety/indicators', icon: 'target', permission: view, order: 11, menu: false, parent: '/safety' },
    { group: 'Safety and emergency management', label: 'Safety events', path: '/safety/events', icon: 'alert', permission: view, order: 20 },
    { group: 'Safety and emergency management', label: 'Hazard log', path: '/safety/hazards', icon: 'shield', permission: view, order: 30 },
    // The safety plan (wave 26): a tab of the safety pages; the plan itself is a controlled document.
    { group: 'Safety and emergency management', label: 'Safety plan', path: '/safety/plan', icon: 'file-text', permission: view, permissions: ['policies.view'], order: 15, menu: false, parent: '/safety' },
    // The safety administrators' settings: the Settings tab of the safety pages opens the first; they share a tab strip.
    { group: 'Safety and emergency management', label: 'Hazard matrix', path: '/safety/matrix', icon: 'target', permission: 'safety.administer', order: 12, menu: false, parent: '/safety', tabs: 'Hazard matrix', hub: 'Area settings', hint: 'The likelihood and severity levels hazards are scored on.' },
    { group: 'Safety and emergency management', label: 'Safety reporting rules', path: '/safety/reporting-rules', icon: 'clock', permission: 'safety.administer', order: 13, menu: false, parent: '/safety/matrix', tab: 'Reporting rules', hub: 'Area settings', hint: 'When a safety event must be reported, to whom and how fast.' },
    { group: 'Safety and emergency management', label: 'Confidential safety reports', path: '/safety/confidential', icon: 'eye-off', permission: 'safety.administer', order: 14, menu: false, parent: '/safety/matrix', tab: 'Confidential reports', hub: 'Area settings', hint: 'Who may see the identity of a reporter who asked to stay confidential.' },
  ],
  routes: [
    { path: '/safety', element: <SafetyDashboard />, permission: view },
    { path: '/safety/events', element: <EventList />, permission: view },
    { path: '/safety/events/:id', element: <EventDetail />, permission: view },
    { path: '/safety/hazards', element: <HazardList />, permission: view },
    { path: '/safety/hazards/:id', element: <HazardDetail />, permission: view },
    { path: '/safety/indicators', element: <IndicatorList />, permission: view },
    { path: '/safety/indicators/:id', element: <IndicatorDetail />, permission: view },
    { path: '/safety/exposure', element: <ExposurePage />, permission: view },
    { path: '/safety/plan', element: <SafetyPlanPage />, permission: view },
    { path: '/safety/matrix', element: <MatrixEditor />, permission: 'safety.administer' },
    { path: '/safety/reporting-rules', element: <ReportRules />, permission: 'safety.administer' },
    { path: '/safety/confidential', element: <ConfidentialViewers />, permission: 'safety.administer' },
  ],
  create: [
    { label: 'Safety event', path: '/safety/events?new=1', permission: 'safety.create', icon: 'alert' },
    { label: 'Hazard', path: '/safety/hazards?new=1', permission: 'safety.create', icon: 'shield' },
  ],
};
export default mod;
