// Civil rights programs (feature area `civilrights`, off by default): programs with their required
// elements, notices, language assistance and reports; complaints with their time limits, confidential
// by default; business participation goals with awards and attainment. One menu entry with tabs.
import type { ModuleDef } from '../../core';
import { ComplaintDetail, ComplaintList } from './Complaints';
import { AwardDetail, AwardList, GoalDetail, GoalList } from './Participation';
import { ProgramDetail, ProgramList, TemplateDetail, TemplateList } from './Programs';
import { ReportDetail, ReportList } from './Reports';
import { CivilRightsSettings } from './Settings';

const view = 'civilrights.view';
const group = 'Governance and records';

const mod: ModuleDef = {
  key: 'civilrights',
  nav: [
    { group, label: 'Civil rights', path: '/civil-rights', icon: 'scale', permission: view, order: 50, tabs: 'Programs' },
    { group, label: 'Civil rights complaints', path: '/civil-rights/complaints', icon: 'message', permission: view, order: 51, menu: false, parent: '/civil-rights', tab: 'Complaints' },
    { group, label: 'Civil rights reports', path: '/civil-rights/reports', icon: 'file-text', permission: view, order: 52, menu: false, parent: '/civil-rights', tab: 'Reports' },
    { group, label: 'Participation goals', path: '/civil-rights/goals', icon: 'target', permission: view, order: 53, menu: false, parent: '/civil-rights', tab: 'Participation' },
    { group, label: 'Participation awards', path: '/civil-rights/awards', icon: 'clipboard', permission: view, order: 54, menu: false, parent: '/civil-rights', tab: 'Awards' },
    { group, label: 'Program templates', path: '/civil-rights/templates', icon: 'book', permission: view, order: 55, menu: false, parent: '/civil-rights', tab: 'Templates' },
    { group, label: 'Civil rights settings', path: '/civil-rights/settings', icon: 'settings', permission: view, order: 56, menu: false, parent: '/civil-rights', tab: 'Settings' },
  ],
  routes: [
    { path: '/civil-rights', element: <ProgramList />, permission: view },
    { path: '/civil-rights/complaints', element: <ComplaintList />, permission: view },
    { path: '/civil-rights/complaints/:id', element: <ComplaintDetail />, permission: view },
    { path: '/civil-rights/reports', element: <ReportList />, permission: view },
    { path: '/civil-rights/reports/:id', element: <ReportDetail />, permission: view },
    { path: '/civil-rights/goals', element: <GoalList />, permission: view },
    { path: '/civil-rights/goals/:id', element: <GoalDetail />, permission: view },
    { path: '/civil-rights/awards', element: <AwardList />, permission: view },
    { path: '/civil-rights/awards/:id', element: <AwardDetail />, permission: view },
    { path: '/civil-rights/templates', element: <TemplateList />, permission: view },
    { path: '/civil-rights/templates/:id', element: <TemplateDetail />, permission: view },
    { path: '/civil-rights/settings', element: <CivilRightsSettings />, permission: view },
    { path: '/civil-rights/:id', element: <ProgramDetail />, permission: view },
  ],
  create: [
    { label: 'Civil rights complaint', path: '/civil-rights/complaints?new=1', permission: 'civilrights.create', icon: 'message' },
    { label: 'Civil rights program', path: '/civil-rights?new=1', permission: 'civilrights.create', icon: 'scale' },
  ],
};
export default mod;
