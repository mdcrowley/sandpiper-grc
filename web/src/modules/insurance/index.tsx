// Insurance (wave 26): the organization's insurance program. One menu entry with tabs: policies (with
// their conditions, covered records and renewals), certificates of insurance from vendors with the
// contract requirements they answer, claims, the renewal calendar and the area's settings. Assets,
// sites, systems and vehicles show the policies that cover them (InventoryPanel.tsx).
import type { ModuleDef } from '../../core';
import {
  CertificateDetail, CertificateList, ClaimDetail, ClaimList, ConditionDetail, InsuranceSettings, PolicyDetail, PolicyList, RenewalCalendar,
  RequirementDetail, RequirementList,
} from './Pages';
import './insurance.css';

const view = 'insurance.view';

const mod: ModuleDef = {
  key: 'insurance',
  nav: [
    { group: 'Risk and compliance', label: 'Insurance', path: '/insurance', icon: 'shield', permission: view, order: 82, tabs: 'Policies' },
    { group: 'Risk and compliance', label: 'Certificates of insurance', path: '/insurance/certificates', icon: 'file-text', permission: view, order: 83, menu: false, parent: '/insurance', tab: 'Certificates' },
    { group: 'Risk and compliance', label: 'Insurance claims', path: '/insurance/claims', icon: 'alert', permission: view, order: 84, menu: false, parent: '/insurance', tab: 'Claims' },
    { group: 'Risk and compliance', label: 'Renewal calendar', path: '/insurance/renewals', icon: 'calendar', permission: view, order: 85, menu: false, parent: '/insurance', tab: 'Renewals' },
    { group: 'Risk and compliance', label: 'Contract insurance requirements', path: '/insurance/requirements', icon: 'scale', permission: view, order: 86, menu: false, parent: '/insurance', tab: 'Contract requirements' },
    { group: 'Risk and compliance', label: 'Insurance settings', path: '/insurance/settings', icon: 'settings', permission: 'insurance.administer', order: 87, menu: false, parent: '/insurance', tab: 'Settings', hub: 'Area settings', hint: 'When policy and certificate owners are reminded, and the insurance lists.' },
  ],
  routes: [
    { path: '/insurance', element: <PolicyList />, permission: view },
    { path: '/insurance/certificates', element: <CertificateList />, permission: view },
    { path: '/insurance/certificates/:id', element: <CertificateDetail />, permission: view },
    { path: '/insurance/claims', element: <ClaimList />, permission: view },
    { path: '/insurance/claims/:id', element: <ClaimDetail />, permission: view },
    { path: '/insurance/renewals', element: <RenewalCalendar />, permission: view },
    { path: '/insurance/requirements', element: <RequirementList />, permission: view },
    { path: '/insurance/requirements/:id', element: <RequirementDetail />, permission: view },
    { path: '/insurance/conditions/:id', element: <ConditionDetail />, permission: view },
    { path: '/insurance/settings', element: <InsuranceSettings />, permission: 'insurance.administer' },
    { path: '/insurance/:id', element: <PolicyDetail />, permission: view },
  ],
  create: [
    { label: 'Insurance policy', path: '/insurance?new=1', permission: 'insurance.create', icon: 'shield' },
    { label: 'Certificate of insurance', path: '/insurance/certificates?new=1', permission: 'insurance.create', icon: 'file-text' },
    { label: 'Insurance claim', path: '/insurance/claims?new=1', permission: 'insurance.create', icon: 'alert' },
  ],
};
export default mod;
