// Fleet: vehicles and their equipment, services and the systems they depend on, equipment
// coverage, and what is affected when a system fails. `AffectedPanel.tsx` is the embed for
// other modules.
import type { ModuleDef } from '../../core';
import { CoveragePage } from './Coverage';
import { ImpactPage } from './Impact';
import { IntervalDetail, IntervalList, MaintenanceDuePage, ReadingDetail, ReadingList, RecordDetail, RecordList } from './Maintenance';
import { ServiceDetail, ServiceList } from './Services';
import { VehicleModelDetail, VehicleModelList } from './VehicleModels';
import { VehicleDetail, VehicleList } from './Vehicles';
import './fleet.css';

const view = 'fleet.view';

const mod: ModuleDef = {
  key: 'fleet',
  nav: [
    { group: 'Assets', label: 'Vehicles', path: '/vehicles', icon: 'bus', permission: view, order: 50 },
    { group: 'Assets', label: 'Services', path: '/services', icon: 'route', permission: view, order: 51, menu: false, parent: '/vehicles' },
    { group: 'Assets', label: 'Equipment coverage', path: '/fleet/coverage', icon: 'check-square', permission: view, order: 52, menu: false, parent: '/vehicles' },
    { group: 'Assets', label: 'What is affected', path: '/fleet/impact', icon: 'target', permission: view, order: 53, menu: false, parent: '/vehicles' },
    { group: 'Assets', label: 'Vehicle models', path: '/vehicle-models', icon: 'clipboard', permission: view, order: 54, menu: false, parent: '/vehicles' },
    // Wave 27 (E46-71): planned maintenance, its intervals, the services done and the readings (mileage history).
    { group: 'Assets', label: 'Planned maintenance', path: '/fleet/maintenance', icon: 'clock', permission: view, order: 55, menu: false, parent: '/vehicles' },
    { group: 'Assets', label: 'Maintenance intervals', path: '/fleet/maintenance/intervals', icon: 'refresh', permission: view, order: 56, menu: false, parent: '/vehicles' },
    { group: 'Assets', label: 'Services done', path: '/fleet/maintenance/records', icon: 'check-square', permission: view, order: 57, menu: false, parent: '/vehicles' },
    { group: 'Assets', label: 'Vehicle readings', path: '/fleet/readings', icon: 'chart', permission: view, order: 58, menu: false, parent: '/vehicles' },
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
    { path: '/fleet/maintenance', element: <MaintenanceDuePage />, permission: view },
    { path: '/fleet/maintenance/intervals', element: <IntervalList />, permission: view },
    { path: '/fleet/maintenance/intervals/:id', element: <IntervalDetail />, permission: view },
    { path: '/fleet/maintenance/records', element: <RecordList />, permission: view },
    { path: '/fleet/maintenance/records/:id', element: <RecordDetail />, permission: view },
    { path: '/fleet/readings', element: <ReadingList />, permission: view },
    { path: '/fleet/readings/:id', element: <ReadingDetail />, permission: view },
  ],
  create: [
    { label: 'Vehicle', path: '/vehicles?new=1', permission: 'fleet.create', icon: 'bus' },
    { label: 'Service', path: '/services?new=1', permission: 'fleet.create', icon: 'route' },
    { label: 'Vehicle model', path: '/vehicle-models?new=1', permission: 'fleet.create', icon: 'clipboard' },
    { label: 'Maintenance record', path: '/fleet/maintenance/records?new=1', permission: 'fleet.create', icon: 'check-square' },
    { label: 'Vehicle reading', path: '/fleet/readings?new=1', permission: 'fleet.create', icon: 'chart' },
  ],
};
export default mod;
