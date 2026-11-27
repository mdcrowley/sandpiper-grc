import type { ModuleDef } from '../../core';
import { ActionDetail } from './ActionDetail';
import { ActionTracker } from './ActionTracker';
import { CapDetail } from './CapDetail';
import { CapRegister } from './CapRegister';
import { MyActions } from './MyActions';
import { ObligationDetail, ObligationList } from './Obligations';
import { RiskDetail } from './RiskDetail';
import { RiskRegister } from './RiskRegister';
import { RiskReport } from './RiskReport';
import { RiskReviews } from './RiskReviews';
import { ScaleEditor } from './ScaleEditor';
import './risks.css';
import { Appetite } from './Appetite';
import { KriDetail, KriList } from './KriPages';
import { RegulatoryChangeDetail, RegulatoryChangeList } from './RegulatoryChanges';

export { ActionsPanel } from './ActionsPanel';

const mod: ModuleDef = {
  key: 'risks',
  nav: [
    { group: 'Home', label: 'My actions', path: '/actions/mine', icon: 'check-circle', permission: 'actions.view', order: 31, menu: false, parent: '/my-work', tab: 'Actions' },
    { group: 'Risk and compliance', label: 'Risk register', path: '/risks', icon: 'alert', permission: 'risks.view', order: 10 },
    { group: 'Risk and compliance', label: 'Risk reviews', path: '/risks/reviews', icon: 'calendar', permission: 'risks.view', order: 11, menu: false, parent: '/risks' },
    { group: 'Risk and compliance', label: 'Key risk indicators', path: '/kris', icon: 'target', permission: 'risks.view', order: 12, menu: false, parent: '/risks' },
    { group: 'Risk and compliance', label: 'Risk report', path: '/risks/report', icon: 'chart', permission: 'risks.view', order: 13, menu: false, parent: '/risks' },
    { group: 'Risk and compliance', label: 'Risk scales', path: '/risks/scales', icon: 'target', permission: 'risks.administer', order: 14, menu: false, parent: '/risks', hub: 'Area settings', hint: 'Likelihood and impact levels and the rating matrix.' },
    { group: 'Risk and compliance', label: 'Risk appetite', path: '/risks/appetite', icon: 'scale', permission: 'risks.view', order: 15, menu: false, parent: '/risks', hub: 'Area settings', hint: 'How much risk the organization accepts, by category.' },
    { group: 'Risk and compliance', label: 'Obligations', path: '/obligations', icon: 'scale', permission: 'obligations.view', order: 20, tabs: 'Obligations' },
    { group: 'Risk and compliance', label: 'Regulatory changes', path: '/regulatory-changes', icon: 'file-text', permission: 'obligations.view', order: 21, menu: false, parent: '/obligations', tab: 'Regulatory changes' },
    { group: 'Risk and compliance', label: 'Action tracker', path: '/actions', icon: 'check-square', permission: 'actions.view', order: 60, tabs: 'Action tracker' },
    { group: 'Risk and compliance', label: 'Corrective action plans', path: '/caps', icon: 'clipboard', permission: 'actions.view', order: 61, menu: false, parent: '/actions', tab: 'Corrective action plans' },
  ],
  routes: [
    { path: '/risks', element: <RiskRegister />, permission: 'risks.view' },
    { path: '/risks/reviews', element: <RiskReviews />, permission: 'risks.view' },
    { path: '/risks/report', element: <RiskReport />, permission: 'risks.view' },
    { path: '/risks/scales', element: <ScaleEditor />, permission: 'risks.administer' },
    { path: '/risks/:id', element: <RiskDetail />, permission: 'risks.view' },
    { path: '/actions', element: <ActionTracker />, permission: 'actions.view' },
    { path: '/actions/mine', element: <MyActions />, permission: 'actions.view' },
    { path: '/actions/:id', element: <ActionDetail />, permission: 'actions.view' },
    { path: '/obligations', element: <ObligationList />, permission: 'obligations.view' },
    { path: '/obligations/:id', element: <ObligationDetail />, permission: 'obligations.view' },
    { path: '/caps', element: <CapRegister />, permission: 'actions.view' },
    { path: '/caps/:id', element: <CapDetail />, permission: 'actions.view' },
    { path: '/regulatory-changes', element: <RegulatoryChangeList />, permission: 'obligations.view' },
    { path: '/regulatory-changes/:id', element: <RegulatoryChangeDetail />, permission: 'obligations.view' },
    { path: '/kris', element: <KriList />, permission: 'risks.view' },
    { path: '/kris/:id', element: <KriDetail />, permission: 'risks.view' },
    { path: '/risks/appetite', element: <Appetite />, permission: 'risks.view' },
  ],
  create: [
    { label: 'Risk', path: '/risks?new=1', permission: 'risks.create' },
    { label: 'Action', path: '/actions?new=1', permission: 'actions.create' },
    { label: 'Obligation', path: '/obligations?new=1', permission: 'obligations.create' },
    { label: 'Regulatory change', path: '/regulatory-changes?new=1', permission: 'obligations.create' },
    { label: 'Key risk indicator', path: '/kris?new=1', permission: 'risks.create' },
  ],
};

export default mod;
