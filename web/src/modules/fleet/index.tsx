// Fleet: vehicles and their equipment, services and the systems they depend on, equipment
// coverage, and what is affected when a system fails. `AffectedPanel.tsx` is the embed for
// other modules.
import type { ModuleDef } from '../../core';
import { CoveragePage } from './Coverage';
import { ImpactPage } from './Impact';
import { ServiceDetail, ServiceList } from './Services';
import { VehicleModelDetail, VehicleModelList } from './VehicleModels';
import { VehicleDetail, VehicleList } from './Vehicles';
import './fleet.css';

const view = 'fleet.view';

const mod: ModuleDef = {
  key: 'fleet',
  nav: [
    { group: 'Inventory', label: 'Vehicles', path: '/vehicles', icon: 'bus', permission: view, order: 54 },
    { group: 'Inventory', label: 'Services', path: '/services', icon: 'route', permission: view, order: 55 },
    { group: 'Inventory', label: 'Equipment coverage', path: '/fleet/coverage', icon: 'check-square', permission: view, order: 56 },
    { group: 'Inventory', label: 'What is affected', path: '/fleet/impact', icon: 'target', permission: view, order: 57 },
    { group: 'Inventory', label: 'Vehicle models', path: '/vehicle-models', icon: 'clipboard', permission: view, order: 58 },
  ],
  routes: [
    { path: '/vehicles', element: <VehicleList />, permission: view },
    { path: '/vehicles/:id', element: <VehicleDetail />, permission: view },
    { path: '/vehicle-models', element: <VehicleModelList />, permission: view },
    { path: '/vehicle-models/:id', element: <VehicleModelDetail />, permission: view },
    { path: '/services', element: <ServiceList />, permission: view },
    { path: '/services/:id', element: <ServiceDetail />, permission: view },
    { path: '/fleet/coverage', element: <CoveragePage />, permission: view },
    { path: '/fleet/impact', element: <ImpactPage />, permission: view },
  ],
  create: [
    { label: 'Vehicle', path: '/vehicles?new=1', permission: 'fleet.create', icon: 'bus' },
    { label: 'Service', path: '/services?new=1', permission: 'fleet.create', icon: 'route' },
    { label: 'Vehicle model', path: '/vehicle-models?new=1', permission: 'fleet.create', icon: 'clipboard' },
  ],
};
export default mod;
