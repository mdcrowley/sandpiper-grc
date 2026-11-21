// Safety management: dashboard, safety events, the hazard log, indicators and exposure.
import type { ModuleDef } from '../../core';
import { SafetyDashboard } from './Dashboard';
import { EventDetail, EventList } from './Events';
import { HazardDetail, HazardList } from './Hazards';
import { ExposurePage, IndicatorDetail, IndicatorList } from './Indicators';
import { MatrixEditor } from './MatrixEditor';
import './safety.css';

const view = 'safety.view';

const mod: ModuleDef = {
  key: 'safety',
  nav: [
    { group: 'Safety', label: 'Safety dashboard', path: '/safety', icon: 'chart', permission: view, order: 95 },
    { group: 'Safety', label: 'Safety events', path: '/safety/events', icon: 'alert', permission: view, order: 96 },
    { group: 'Safety', label: 'Hazard log', path: '/safety/hazards', icon: 'shield', permission: view, order: 97 },
    { group: 'Safety', label: 'Safety indicators', path: '/safety/indicators', icon: 'target', permission: view, order: 98 },
    { group: 'Administration', label: 'Hazard matrix', path: '/safety/matrix', icon: 'target', permission: 'safety.administer', order: 61 },
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
    { path: '/safety/matrix', element: <MatrixEditor />, permission: 'safety.administer' },
  ],
  create: [
    { label: 'Safety event', path: '/safety/events?new=1', permission: 'safety.create', icon: 'alert' },
    { label: 'Hazard', path: '/safety/hazards?new=1', permission: 'safety.create', icon: 'shield' },
  ],
};
export default mod;
