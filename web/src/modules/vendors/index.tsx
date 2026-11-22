// Vendors and contracts: vendors, contracts, security terms, evidence, assessments and renewals, and the
// vendor risk lifecycle (reassessments, exclusion-list checks, issues and offboarding).
import type { ModuleDef } from '../../core';
import { ContractDetail, ContractList } from './ContractPages';
import { EvidenceDetail, EvidenceExpiring, EvidenceList } from './EvidencePages';
import { IssueDetail, IssueList } from './Issues';
import { MissingDates } from './MissingDates';
import { OffboardingDetail, OffboardingList } from './Offboardings';
import { AssessmentQuestions } from './Questions';
import { Reassessments } from './Reassessments';
import { RenewalCalendar } from './RenewalCalendar';
import { TermsMatrix } from './TermsMatrix';
import { VendorDetail, VendorList } from './VendorPages';
import { VendorResponsePage } from './VendorResponse';
import './vendors.css';

const mod: ModuleDef = {
  key: 'vendors',
  nav: [
    { group: 'Vendors', label: 'Vendors', path: '/vendors', icon: 'building', permission: 'vendors.view', order: 10 },
    { group: 'Vendors', label: 'Security terms matrix', path: '/vendors/terms', icon: 'shield', permission: 'contracts.view', order: 20 },
    { group: 'Vendors', label: 'Contracts', path: '/contracts', icon: 'file-text', permission: 'contracts.view', order: 30 },
    { group: 'Vendors', label: 'Renewal calendar', path: '/contracts/renewals', icon: 'calendar', permission: 'contracts.view', order: 40 },
    { group: 'Vendors', label: 'Evidence', path: '/evidence', icon: 'clipboard', permission: 'vendors.view', order: 50 },
    { group: 'Vendors', label: 'Expiring evidence', path: '/evidence/expiring', icon: 'clock', permission: 'vendors.view', order: 60 },
    { group: 'Vendors', label: 'Reassessments due', path: '/vendors/reassessments', icon: 'calendar', permission: 'vendors.view', order: 70 },
    { group: 'Vendors', label: 'Vendor issues', path: '/vendors/issues', icon: 'alert', permission: 'vendors.view', order: 80 },
    { group: 'Vendors', label: 'Offboarding', path: '/vendors/offboardings', icon: 'logout', permission: 'vendors.view', order: 90 },
  ],
  routes: [
    { path: '/vendors', element: <VendorList />, permission: 'vendors.view' },
    { path: '/vendors/terms', element: <TermsMatrix />, permission: 'contracts.view' },
    { path: '/vendors/questions', element: <AssessmentQuestions />, permission: 'vendors.view' },
    { path: '/vendors/reassessments', element: <Reassessments />, permission: 'vendors.view' },
    { path: '/vendors/issues', element: <IssueList />, permission: 'vendors.view' },
    { path: '/vendors/issues/:id', element: <IssueDetail />, permission: 'vendors.view' },
    { path: '/vendors/offboardings', element: <OffboardingList />, permission: 'vendors.view' },
    { path: '/vendors/offboardings/:id', element: <OffboardingDetail />, permission: 'vendors.view' },
    { path: '/vendors/:id', element: <VendorDetail />, permission: 'vendors.view' },
    { path: '/contracts', element: <ContractList />, permission: 'contracts.view' },
    { path: '/contracts/renewals', element: <RenewalCalendar />, permission: 'contracts.view' },
    { path: '/contracts/dates', element: <MissingDates />, permission: 'contracts.view' },
    { path: '/contracts/:id', element: <ContractDetail />, permission: 'contracts.view' },
    { path: '/evidence', element: <EvidenceList />, permission: 'vendors.view' },
    { path: '/evidence/expiring', element: <EvidenceExpiring />, permission: 'vendors.view' },
    { path: '/evidence/:id', element: <EvidenceDetail />, permission: 'vendors.view' },
  ],
  // A vendor answering an assessment through a link, without an account (E06-21).
  publicRoutes: [{ path: '/vendor-response/:token', element: <VendorResponsePage /> }],
  create: [
    { label: 'Vendor', path: '/vendors?new=1', permission: 'vendors.create', icon: 'building' },
    { label: 'Contract', path: '/contracts?new=1', permission: 'contracts.create', icon: 'file-text' },
    { label: 'Evidence item', path: '/evidence?new=1', permission: 'vendors.create', icon: 'clipboard' },
    { label: 'Vendor issue', path: '/vendors/issues?new=1', permission: 'vendors.create', icon: 'alert' },
  ],
};

export default mod;
