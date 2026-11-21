import type { ModuleDef } from '../../core';
import { ActionDetail } from './ActionDetail';
import { ActionTracker } from './ActionTracker';
import { MyActions } from './MyActions';
import { ObligationDetail, ObligationList } from './Obligations';
import { RiskDetail } from './RiskDetail';
import { RiskRegister } from './RiskRegister';
import { RiskReport } from './RiskReport';
import { RiskReviews } from './RiskReviews';
import { ScaleEditor } from './ScaleEditor';
import './risks.css';
// Wave 10 step 0: the pages below are stubs that render nothing yet, so their imports, nav and route
// entries are commented out. Each owner uncomments its own lines once its page renders:
// TODO(CAP agent, E23): import { CapDetail } from './CapDetail'; import { CapRegister } from './CapRegister';
// TODO(COMPLIANCE agent, E30): import { Appetite } from './Appetite'; import { KriDetail, KriList } from './KriPages';
//   import { RegulatoryChangeDetail, RegulatoryChangeList } from './RegulatoryChanges';

export { ActionsPanel } from './ActionsPanel';

const mod: ModuleDef = {
  key: 'risks',
  nav: [
    { group: 'Home', label: 'My actions', path: '/actions/mine', icon: 'check-circle', permission: 'actions.view', order: 30 },
    { group: 'Cybersecurity', label: 'Risk register', path: '/risks', icon: 'alert', permission: 'risks.view', order: 20 },
    { group: 'Cybersecurity', label: 'Risk reviews', path: '/risks/reviews', icon: 'calendar', permission: 'risks.view', order: 21 },
    { group: 'Cybersecurity', label: 'Action tracker', path: '/actions', icon: 'check-square', permission: 'actions.view', order: 60 },
    { group: 'Cybersecurity', label: 'Obligations', path: '/obligations', icon: 'scale', permission: 'obligations.view', order: 70 },
    { group: 'Reports', label: 'Risk report', path: '/risks/report', icon: 'chart', permission: 'risks.view', order: 40 },
    { group: 'Administration', label: 'Risk scales', path: '/risks/scales', icon: 'target', permission: 'risks.administer', order: 60 },
    // TODO(CAP agent, E23): { group: 'Governance', label: 'Corrective action plans', path: '/caps', icon: 'clipboard', permission: 'actions.view', order: 30 },
    // TODO(COMPLIANCE agent, E30): { group: 'Cybersecurity', label: 'Regulatory changes', path: '/regulatory-changes', icon: 'file-text', permission: 'obligations.view', order: 72 },
    // TODO(COMPLIANCE agent, E30): { group: 'Cybersecurity', label: 'Key risk indicators', path: '/kris', icon: 'target', permission: 'risks.view', order: 22 },
    // TODO(COMPLIANCE agent, E30): { group: 'Administration', label: 'Risk appetite', path: '/risks/appetite', icon: 'scale', permission: 'risks.administer', order: 61 },
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
    // TODO(CAP agent, E23): { path: '/caps', element: <CapRegister />, permission: 'actions.view' },
    // TODO(CAP agent, E23): { path: '/caps/:id', element: <CapDetail />, permission: 'actions.view' },
    // TODO(COMPLIANCE agent, E30): { path: '/regulatory-changes', element: <RegulatoryChangeList />, permission: 'obligations.view' },
    // TODO(COMPLIANCE agent, E30): { path: '/regulatory-changes/:id', element: <RegulatoryChangeDetail />, permission: 'obligations.view' },
    // TODO(COMPLIANCE agent, E30): { path: '/kris', element: <KriList />, permission: 'risks.view' },
    // TODO(COMPLIANCE agent, E30): { path: '/kris/:id', element: <KriDetail />, permission: 'risks.view' },
    // TODO(COMPLIANCE agent, E30): { path: '/risks/appetite', element: <Appetite />, permission: 'risks.administer' },
  ],
  create: [
    { label: 'Risk', path: '/risks?new=1', permission: 'risks.create' },
    { label: 'Action', path: '/actions?new=1', permission: 'actions.create' },
    { label: 'Obligation', path: '/obligations?new=1', permission: 'obligations.create' },
  ],
};

export default mod;
