// Audits and inspections (E24): the audit plan and coverage, engagements, checklist templates,
// recurring inspections run on a phone or tablet, findings and evidence requests.
import type { ModuleDef } from '../../core';
import { AreaDetail, AreaList } from './Areas';
import { AuditsDashboard } from './Dashboard';
import { AuditDetail, AuditList } from './Engagements';
import { FindingDetail, FindingList } from './Findings';
import { InspectionDetail, InspectionList, ScheduleDetail, ScheduleList } from './Inspections';
import { InspectionRun } from './InspectionRun';
import { MyRequests, RequestDetail, RequestList } from './Requests';
import { TemplateDetail, TemplateList } from './Templates';
import './audits.css';

const view = 'audits.view';

const mod: ModuleDef = {
  key: 'audits',
  nav: [
    { group: 'Governance', label: 'Audits', path: '/audits', icon: 'clipboard', permission: view, order: 10 },
    { group: 'Governance', label: 'Audit findings', path: '/audit-findings', icon: 'alert-circle', permission: view, order: 12 },
    { group: 'Safety', label: 'Inspections', path: '/inspections', icon: 'check-square', permission: view, order: 99 },
  ],
  routes: [
    { path: '/audits', element: <AuditsDashboard />, permission: view },
    { path: '/audits/areas', element: <AreaList />, permission: view },
    { path: '/audits/areas/:id', element: <AreaDetail />, permission: view },
    { path: '/audits/engagements', element: <AuditList />, permission: view },
    { path: '/audits/engagements/:id', element: <AuditDetail />, permission: view },
    { path: '/audits/templates', element: <TemplateList />, permission: view },
    { path: '/audits/templates/:id', element: <TemplateDetail />, permission: view },
    { path: '/audits/requests', element: <RequestList />, permission: view },
    { path: '/audits/requests/:id', element: <RequestDetail />, permission: view },
    // Anyone signed in: the evidence requests addressed to them.
    { path: '/audits/my-requests', element: <MyRequests /> },
    { path: '/inspections', element: <InspectionList />, permission: view },
    { path: '/inspections/schedules', element: <ScheduleList />, permission: view },
    { path: '/inspections/schedules/:id', element: <ScheduleDetail />, permission: view },
    { path: '/inspections/:id', element: <InspectionDetail />, permission: view },
    { path: '/inspections/:id/run', element: <InspectionRun />, permission: view },
    { path: '/audit-findings', element: <FindingList />, permission: view },
    { path: '/audit-findings/:id', element: <FindingDetail />, permission: view },
  ],
  create: [
    { label: 'Audit', path: '/audits/engagements?new=1', permission: 'audits.create', icon: 'clipboard' },
    { label: 'Inspection', path: '/inspections?new=1', permission: 'audits.create', icon: 'check-square' },
  ],
};
export default mod;
