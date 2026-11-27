// Asset condition and state of good repair (E32): the dashboard of the share past useful life by
// class against its yearly target, asset classes with their benchmarks, targets and members,
// condition assessments, and the aging list. The condition section on asset and site pages is
// `InventoryPanel.tsx`; the vehicle page embeds `ConditionSection` itself.
import type { ModuleDef } from '../../core';
import { AgingPage } from './Aging';
import { AssessmentDetail, AssessmentList } from './Assessments';
import { ClassDetail, ClassList } from './Classes';
import { ConditionDashboard } from './Dashboard';
import './condition.css';

const view = 'assets.view';

const mod: ModuleDef = {
  key: 'condition',
  nav: [
    { group: 'Assets', label: 'Asset condition', path: '/condition', icon: 'chart', permission: view, order: 30 },
  ],
  routes: [
    { path: '/condition', element: <ConditionDashboard />, permission: view },
    { path: '/condition/classes', element: <ClassList />, permission: view },
    { path: '/condition/classes/:id', element: <ClassDetail />, permission: view },
    { path: '/condition/assessments', element: <AssessmentList />, permission: view },
    { path: '/condition/assessments/:id', element: <AssessmentDetail />, permission: view },
    { path: '/condition/aging', element: <AgingPage />, permission: view },
  ],
  create: [
    { label: 'Asset class', path: '/condition/classes?new=1', permission: 'assets.create', icon: 'chart' },
  ],
};
export default mod;
