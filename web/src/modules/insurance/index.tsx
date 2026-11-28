// Insurance (wave 26): the organization's insurance program. One menu entry with tabs: policies (with
// their conditions, covered records, renewals, premium allocation and schedule of values), certificates
// of insurance from vendors with the contract requirements they answer and the requests that ask vendors
// for them, claims with each payment, the renewal calendar, the schedule of values, premium allocation
// and the area's settings. Assets, sites, systems and vehicles show the policies that cover them
// (InventoryPanel.tsx); a contract shows its insurance (ContractInsurance.tsx, loaded by the vendors
// module). Vendors send certificates through a public upload page (CertificateUpload.tsx).
import type { ModuleDef } from '../../core';
import { PremiumAllocation, ShareDetail } from './Allocation';
import { CertificateUploadPage } from './CertificateUpload';
import {
  CertificateDetail, CertificateList, ClaimDetail, ClaimList, ConditionDetail, InsuranceSettings, PolicyDetail, PolicyList, RenewalCalendar,
  RequirementDetail, RequirementList,
} from './Pages';
import { PaymentDetail } from './Payments';
import { RequestDetail, RequestList } from './Requests';
import { ScheduleDetail, ScheduleList } from './Schedule';
import './insurance.css';

const view = 'insurance.view';

const mod: ModuleDef = {
  key: 'insurance',
  nav: [
    { group: 'Risk and compliance', label: 'Insurance', path: '/insurance', icon: 'shield', permission: view, order: 82, tabs: 'Policies' },
    { group: 'Risk and compliance', label: 'Certificates of insurance', path: '/insurance/certificates', icon: 'file-text', permission: view, order: 83, menu: false, parent: '/insurance', tab: 'Certificates' },
    { group: 'Risk and compliance', label: 'Certificate requests', path: '/insurance/certificate-requests', icon: 'message', permission: view, order: 83.5, menu: false, parent: '/insurance', tab: 'Requests' },
    { group: 'Risk and compliance', label: 'Insurance claims', path: '/insurance/claims', icon: 'alert', permission: view, order: 84, menu: false, parent: '/insurance', tab: 'Claims' },
    { group: 'Risk and compliance', label: 'Renewal calendar', path: '/insurance/renewals', icon: 'calendar', permission: view, order: 85, menu: false, parent: '/insurance', tab: 'Renewals' },
    { group: 'Risk and compliance', label: 'Contract insurance requirements', path: '/insurance/requirements', icon: 'scale', permission: view, order: 86, menu: false, parent: '/insurance', tab: 'Contract requirements' },
    { group: 'Risk and compliance', label: 'Schedule of values', path: '/insurance/schedule', icon: 'building', permission: view, order: 86.5, menu: false, parent: '/insurance', tab: 'Schedule of values' },
    { group: 'Risk and compliance', label: 'Premium allocation', path: '/insurance/allocation', icon: 'chart', permission: view, order: 86.6, menu: false, parent: '/insurance', tab: 'Premium allocation' },
    { group: 'Risk and compliance', label: 'Insurance settings', path: '/insurance/settings', icon: 'settings', permission: 'insurance.administer', order: 87, menu: false, parent: '/insurance', tab: 'Settings', hub: 'Area settings', hint: 'When policy and certificate owners are reminded, certificate requests to vendors, and the insurance lists.' },
  ],
  routes: [
    { path: '/insurance', element: <PolicyList />, permission: view },
    { path: '/insurance/certificates', element: <CertificateList />, permission: view },
    { path: '/insurance/certificates/:id', element: <CertificateDetail />, permission: view },
    { path: '/insurance/certificate-requests', element: <RequestList />, permission: view },
    { path: '/insurance/certificate-requests/:id', element: <RequestDetail />, permission: view },
    { path: '/insurance/claims', element: <ClaimList />, permission: view },
    { path: '/insurance/claims/:id', element: <ClaimDetail />, permission: view },
    { path: '/insurance/claim-payments/:id', element: <PaymentDetail />, permission: view },
    { path: '/insurance/renewals', element: <RenewalCalendar />, permission: view },
    { path: '/insurance/requirements', element: <RequirementList />, permission: view },
    { path: '/insurance/requirements/:id', element: <RequirementDetail />, permission: view },
    { path: '/insurance/schedule', element: <ScheduleList />, permission: view },
    { path: '/insurance/schedule/:id', element: <ScheduleDetail />, permission: view },
    { path: '/insurance/allocation', element: <PremiumAllocation />, permission: view },
    { path: '/insurance/premium-shares/:id', element: <ShareDetail />, permission: view },
    { path: '/insurance/conditions/:id', element: <ConditionDetail />, permission: view },
    { path: '/insurance/settings', element: <InsuranceSettings />, permission: 'insurance.administer' },
    { path: '/insurance/:id', element: <PolicyDetail />, permission: view },
  ],
  publicRoutes: [{ path: '/certificate-upload', element: <CertificateUploadPage /> }],
  create: [
    { label: 'Insurance policy', path: '/insurance?new=1', permission: 'insurance.create', icon: 'shield' },
    { label: 'Certificate of insurance', path: '/insurance/certificates?new=1', permission: 'insurance.create', icon: 'file-text' },
    { label: 'Certificate request', path: '/insurance/certificate-requests?new=1', permission: 'insurance.create', icon: 'message' },
    { label: 'Insurance claim', path: '/insurance/claims?new=1', permission: 'insurance.create', icon: 'alert' },
    { label: 'Scheduled property', path: '/insurance/schedule?new=1', permission: 'insurance.create', icon: 'building' },
  ],
};
export default mod;
