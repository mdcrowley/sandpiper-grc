// Inventory: systems, assets, sites and data categories.
import type { ModuleDef } from '../../core';
import { AssetImportPage } from './AssetImport';
import { AssetDetail, AssetList, DisposalApprovalsPage } from './Assets';
import { AssetModelDetail, AssetModelList } from './AssetModels';
import { DataCategoryDetail, DataCategoryList } from './DataCategories';
import { ReportsPage } from './Reports';
import { SiteDetail, SiteList } from './Sites';
import { MapPage } from './SystemMap';
import { SystemDetail, SystemList } from './Systems';
import './inventory.css';

const mod: ModuleDef = {
  key: 'inventory',
  nav: [
    { group: 'Assets', label: 'Systems', path: '/systems', icon: 'server', permission: 'systems.view', order: 10, tabs: 'Systems' },
    { group: 'Assets', label: 'Relationship map', path: '/systems/map', icon: 'link', permission: 'systems.view', order: 11, menu: false, parent: '/systems', tab: 'Map' },
    { group: 'Assets', label: 'Data categories', path: '/data-categories', icon: 'database', permission: 'data.view', order: 12, menu: false, parent: '/systems', tab: 'Data categories' },
    { group: 'Assets', label: 'Inventory reports', path: '/inventory/reports', icon: 'chart', permission: 'systems.view', order: 13, menu: false, parent: '/systems', tab: 'Checks' },
    { group: 'Assets', label: 'Assets', path: '/assets', icon: 'box', permission: 'assets.view', order: 20, tabs: 'Assets' },
    { group: 'Assets', label: 'Asset models', path: '/asset-models', icon: 'clipboard', permission: 'assets.view', order: 21, menu: false, parent: '/assets', tab: 'Models' },
    { group: 'Assets', label: 'Disposal approvals', path: '/assets/disposals', icon: 'check-square', permission: 'assets.approve', order: 25, menu: false, parent: '/assets', tab: 'Disposals' },
    { group: 'Assets', label: 'Sites', path: '/sites', icon: 'map-pin', permission: 'sites.view', order: 40 },
  ],
  routes: [
    { path: '/systems', element: <SystemList />, permission: 'systems.view' },
    { path: '/systems/map', element: <MapPage />, permission: 'systems.view' },
    { path: '/systems/:id', element: <SystemDetail />, permission: 'systems.view' },
    { path: '/assets', element: <AssetList />, permission: 'assets.view' },
    { path: '/assets/import', element: <AssetImportPage />, permission: 'assets.create' },
    { path: '/assets/disposals', element: <DisposalApprovalsPage />, permission: 'assets.view' },
    { path: '/assets/:id', element: <AssetDetail />, permission: 'assets.view' },
    { path: '/asset-models', element: <AssetModelList />, permission: 'assets.view' },
    { path: '/asset-models/:id', element: <AssetModelDetail />, permission: 'assets.view' },
    { path: '/sites', element: <SiteList />, permission: 'sites.view' },
    { path: '/sites/:id', element: <SiteDetail />, permission: 'sites.view' },
    { path: '/data-categories', element: <DataCategoryList />, permission: 'data.view' },
    { path: '/data-categories/:id', element: <DataCategoryDetail />, permission: 'data.view' },
    // The page lists only the reports the user may see.
    { path: '/inventory/reports', element: <ReportsPage /> },
  ],
  create: [
    { label: 'Asset', path: '/assets?new=1', permission: 'assets.create', icon: 'box' },
    { label: 'Asset model', path: '/asset-models?new=1', permission: 'assets.create', icon: 'clipboard' },
    { label: 'System', path: '/systems?new=1', permission: 'systems.create', icon: 'server' },
  ],
};
export default mod;
