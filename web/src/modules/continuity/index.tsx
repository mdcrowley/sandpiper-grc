// Business continuity and emergency management: the overview, business processes with their
// dependencies and impact analyses, the gap report, plans with call trees and checklists, and
// emergency activations.
import type { ModuleDef } from '../../core';
import { ActivationDetail, ActivationList } from './Activations';
import { BiaDetail, BiaList } from './Bia';
import { ContinuityDashboard } from './Dashboard';
import { GapReport } from './Gaps';
import { PlanDetail, PlanList } from './Plans';
import { ProcessDetail, ProcessList } from './Processes';
import './continuity.css';

const view = 'continuity.view';

const mod: ModuleDef = {
  key: 'continuity',
  nav: [
    { group: 'Safety', label: 'Business continuity', path: '/continuity', icon: 'shield', permission: view, order: 100 },
    { group: 'Safety', label: 'Continuity plans', path: '/continuity/plans', icon: 'clipboard', permission: view, order: 101 },
    { group: 'Safety', label: 'Emergency activations', path: '/continuity/activations', icon: 'alert', permission: view, order: 102 },
  ],
  routes: [
    { path: '/continuity', element: <ContinuityDashboard />, permission: view },
    { path: '/continuity/processes', element: <ProcessList />, permission: view },
    { path: '/continuity/processes/:id', element: <ProcessDetail />, permission: view },
    { path: '/continuity/impact-analyses', element: <BiaList />, permission: view },
    { path: '/continuity/impact-analyses/:id', element: <BiaDetail />, permission: view },
    { path: '/continuity/gaps', element: <GapReport />, permission: view },
    { path: '/continuity/plans', element: <PlanList />, permission: view },
    { path: '/continuity/plans/:id', element: <PlanDetail />, permission: view },
    { path: '/continuity/activations', element: <ActivationList />, permission: view },
    { path: '/continuity/activations/:id', element: <ActivationDetail />, permission: view },
  ],
  create: [
    { label: 'Business process', path: '/continuity/processes?new=1', permission: 'continuity.create', icon: 'shield' },
    { label: 'Continuity plan', path: '/continuity/plans?new=1', permission: 'continuity.create', icon: 'clipboard' },
    { label: 'Emergency activation', path: '/continuity/activations?new=1', permission: 'continuity.create', icon: 'alert' },
  ],
};
export default mod;
